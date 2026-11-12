"""Explicit transformations, saved as new datasets with an unbroken parent lineage."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
from pydantic import BaseModel, Field

from wind_platform.core import calculations as calc
from wind_platform.core.standards import ENGINE_VERSION
from wind_platform.services.analysis import (
    channel,
    channel_series,
    expected_count,
    period,
    shift_year,
    values,
)


class ProcessingOptions(BaseModel):
    operation: str
    dataset_id: str
    channel_id: str
    reference_id: str | None = None
    reference_channel: str | None = None
    qc_id: str | None = None
    shear_channels: list[str] = Field(default_factory=list)
    target_height: float | None = Field(default=None, gt=0, le=1000)
    start: str | None = None
    end: str | None = None
    direction_channel: str | None = None
    baseline_years: int = Field(default=20, ge=20, le=50)
    correction_resolution: float = Field(default=0.1, ge=0.01, le=1)
    reference_suitability_confirmed: bool = False


def process(store, config):
    source = store.get("datasets", config.dataset_id)
    if source["stage"] not in {"qc", "result"}:
        raise calc.CalculationError("序列处理以实测质控或结果阶段为输入，原始资料仅保留与审核。")
    target = channel(source, config.channel_id, "speed", "mean")
    derived = deepcopy(source)
    derived.pop("id", None)
    derived["stage"] = "result"
    derived["derived_from"] = [source["id"]]
    derived["engine_version"] = ENGINE_VERSION
    derived["created_at"] = datetime.now(UTC).isoformat()
    v = calc.numbers(target["values"])
    new = deepcopy(target)
    new["id"] = f"c{len(source['channels'])}"
    details = {}
    if config.operation == "representative-c1":
        if not config.reference_id or not config.start or not config.end:
            raise calc.CalculationError("象限订正需要参照文件、风速/风向通道及完整分析年。")
        if not config.reference_suitability_confirmed:
            raise calc.CalculationError("请确认长期站点一致性、气候相似性及参考资料适用性。")
        reference = store.get("datasets", config.reference_id)
        if reference["stage"] != "reference":
            raise calc.CalculationError("长期参照需单独作为参考资料导入。")
        rc = channel(reference, config.reference_channel, "speed", "mean")
        dc = channel(source, config.direction_channel, "direction", "mean")
        a, b, mask = period(source, config.start, config.end)
        local_a = a.astimezone(ZoneInfo(source["options"]["timezone"]))
        if shift_year(local_a, 1).astimezone(UTC) != b:
            raise calc.CalculationError("代表年订正至少需要一个明确的完整周年。")
        baseline_start = shift_year(local_a, 1 - config.baseline_years).astimezone(UTC)
        long_series = channel_series(
            reference, rc, baseline_start.isoformat(), b.isoformat(), "hourly"
        )
        expected_long = expected_count(baseline_start, b, 60)
        if len(long_series) != expected_long:
            raise calc.CalculationError(
                "本自动实现要求选定长期基准完整小时覆盖；至少20年，缺测须先另行核实处理。"
            )
        xs = channel_series(reference, rc, a.isoformat(), b.isoformat(), "hourly")
        ys = channel_series(source, target, a.isoformat(), b.isoformat(), "hourly")
        ds = channel_series(source, dc, a.isoformat(), b.isoformat(), "hourly")
        complete = len(ys) / expected_count(a, b, 60)
        if complete < 0.9:
            raise calc.CalculationError("代表年订正前完整小时有效完整率低于90%。")
        paired = sorted(xs.keys() & ys.keys() & ds.keys())
        fit = calc.regression([xs[t] for t in paired], [ys[t] for t in paired])
        if fit["r"] <= 0 or fit["p_value"] > 0.05:
            raise calc.CalculationError("长期参考未通过正相关及0.05显著性条件。")
        long_mean = float(np.mean(list(long_series.values())))
        concurrent_mean = float(np.mean(list(xs.values())))
        if min(long_series.values()) < 0 or min(ys.values()) < 0:
            raise calc.CalculationError("订正序列存在负风速，请先核对缺测标记。")
        offsets = calc.conditional_sector_offsets(
            [ys[t] for t in paired],
            [xs[t] for t in paired],
            [ds[t] for t in paired],
            long_mean,
            concurrent_mean,
            config.correction_resolution,
        )
        deltas = {row["sector"]: row["delta"] for row in offsets}
        directions = calc.numbers(dc["values"])
        for i, (speed, direction) in enumerate(zip(v, directions, strict=True)):
            if not mask[i] or not np.isfinite(speed):
                continue
            if not np.isfinite(direction) or calc.sector_index(direction) not in deltas:
                raise calc.CalculationError("待订正记录缺风向或所在扇区无可靠条件曲线。")
            corrected = speed + deltas[calc.sector_index(direction)]
            if corrected < 0:
                raise calc.CalculationError("象限代数差订正产生负风速，请人工复核，不自动截零。")
            v[i] = corrected
        new["name"] = f"Representative C1 {target['name']}"
        derived["derived_from"].append(reference["id"])
        details = {
            "offsets": offsets,
            "long_mean": long_mean,
            "concurrent_mean": concurrent_mean,
            "hourly_completeness": complete,
            "overall_correlation": fit,
            "baseline_start": baseline_start.isoformat(),
            "baseline_end": b.isoformat(),
            "note": (
                "GB37523附录C.1；条件均值分组后分段线性连线为明确软件约定，禁止曲线范围外外插。"
            ),
        }
    elif config.operation == "extrapolation":
        if not config.qc_id or not config.target_height:
            raise calc.CalculationError("外推需要明确质控数据、切变通道和目标高度。")
        qc = store.get("datasets", config.qc_id)
        if qc["stage"] != "qc" or qc["tower_id"] != source["tower_id"]:
            raise calc.CalculationError("切变必须来自同塔实测质控数据。")
        if (
            source.get("derived_from")
            and source.get("transformation", {}).get("operation") == "extrapolation"
        ):
            raise calc.CalculationError("不对已外推序列重复外推；请选择原高度基础通道。")
        selected = [channel(qc, id_, "speed", "mean") for id_ in config.shear_channels]
        if (
            len(selected) < 2
            or not selected[0]["arm"].strip()
            or len({c["arm"].strip().casefold() for c in selected}) != 1
        ):
            raise calc.CalculationError("请选择至少两层同支臂实测通道，并填写支臂方向。")
        _, _, mask = period(qc, config.start, config.end)
        details = calc.shear([c["height"] for c in selected], [values(c, mask) for c in selected])
        if (v[np.isfinite(v)] < 0).any():
            raise calc.CalculationError("基础序列存在负风速，请先确认缺测标记。")
        v *= (config.target_height / target["height"]) ** details["alpha"]
        new["height"] = config.target_height
        new["name"] = f"Extrapolated {config.target_height:g}m from {target['name']}"
        derived["derived_from"].append(qc["id"])
        a, b, _ = period(qc, config.start, config.end)
        details["warnings"] = (
            ["质控切变时段不足完整年，外推结果仅供时段分析。"]
            if b - a < timedelta(days=365)
            else []
        )
    elif config.operation in {"gap-fill", "tower-shadow"}:
        if not config.reference_id:
            raise calc.CalculationError("请选择参照数据和通道。")
        reference = store.get("datasets", config.reference_id)
        rc = channel(reference, config.reference_channel, "speed", "mean")
        if reference["options"]["interval_minutes"] != source["options"]["interval_minutes"]:
            raise calc.CalculationError("变换要求同一步长；小时中尺度不能直接复制为10min资料。")
        refs = dict(zip(reference["timestamps"], rc["values"], strict=True))
        if config.operation == "tower-shadow":
            if (
                reference["tower_id"] != source["tower_id"]
                or target["height"] != rc["height"]
                or target["id"] == rc["id"]
                and source["id"] == reference["id"]
            ):
                raise calc.CalculationError("塔影候选需要同塔同高度的两个不同传感器。")
            v = np.array(
                [
                    max(y, x) if y is not None and x is not None else np.nan
                    for y, x in [
                        (y, refs.get(t))
                        for t, y in zip(source["timestamps"], target["values"], strict=True)
                    ]
                ]
            )
            details = {
                "formula": "NB31147 5.2.17：max(v1,v2)",
                "note": "缺任何通道仍缺测；未对其他要素处理。",
            }
        else:
            if source["stage"] != "qc":
                raise calc.CalculationError("插补入口只接受明确标记的实测质控阶段。")
            a, b, mask = period(source, config.start, config.end)
            n = expected_count(a, b, source["options"]["interval_minutes"])
            completeness = int(np.isfinite(v[mask]).sum()) / n
            if completeness < 0.7:
                raise calc.CalculationError("插补前有效数据完整率低于70%，不能按本方法进行插补。")
            x, y = [], []
            for t, value, keep in zip(source["timestamps"], target["values"], mask, strict=True):
                r = refs.get(t)
                if keep and value is not None and r is not None:
                    x.append(r)
                    y.append(value)
            fit = calc.regression(x, y)
            if fit["r"] <= 0 or fit["p_value"] > 0.05:
                raise calc.CalculationError("参照数据未通过正相关及0.05显著性条件。")
            # Reconstruct missing timestamp slots only inside the declared assessment period.
            step = timedelta(minutes=source["options"]["interval_minutes"])
            existing = {t: i for i, t in enumerate(source["timestamps"])}
            grid, stamp = set(existing), a
            while stamp < b:
                grid.add(stamp.isoformat())
                stamp += step
            stamps = sorted(grid)
            for c in derived["channels"]:
                c["values"] = [c["values"][existing[t]] if t in existing else None for t in stamps]
            base = next(c for c in derived["channels"] if c["id"] == target["id"])
            result, count = [], 0
            filled_times = []
            for t, original in zip(stamps, base["values"], strict=True):
                stamp = datetime.fromisoformat(t)
                r = refs.get(t)
                if a <= stamp < b and original is None and r is not None:
                    prediction = fit["slope"] * r + fit["intercept"]
                    if prediction < 0:
                        raise calc.CalculationError(
                            "插补产生负预测，不截零，请更换方法或分扇区重新评估。"
                        )
                    result.append(prediction)
                    count += 1
                    filled_times.append(t)
                else:
                    result.append(original)
            v = calc.numbers(result)
            derived["timestamps"] = stamps
            derived["row_count"] = len(stamps)
            derived["start"] = stamps[0]
            derived["end_exclusive"] = (datetime.fromisoformat(stamps[-1]) + step).isoformat()
            details = {
                "fit": fit,
                "filled_count": count,
                "filled_timestamps": filled_times,
                "pre_fill_completeness": completeness,
                "post_fill_completeness": sum(
                    value is not None
                    for t, value in zip(stamps, result, strict=True)
                    if a <= datetime.fromisoformat(t) < b
                )
                / n,
                "note": "全局线性插补，不等同于代表年订正；每个插补时间格可追溯；实测值保留。",
            }
        derived["derived_from"].append(reference["id"])
        new["name"] = f"{config.operation} {target['name']}"
    else:
        raise calc.CalculationError("不支持的序列处理方法。")
    if not np.isfinite(v[~np.isnan(v)]).all():
        raise calc.CalculationError("处理产生非有限值，请核对参数。")
    new["values"] = [float(value) if np.isfinite(value) else None for value in v]
    derived["channels"].append(new)
    derived["filename"] = f"derived_{config.operation}_{source['filename']}"
    derived["transformation"] = {
        "operation": config.operation,
        "config": config.model_dump(),
        "details": details,
    }
    return store.put("datasets", derived)
