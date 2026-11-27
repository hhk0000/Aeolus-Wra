"""Source-specific analyses. Invalid or unavailable groups remain explicit in the result."""

import calendar
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
from pydantic import BaseModel, Field

from wind_platform.core import calculations as calc
from wind_platform.core.chart_methods import fit_weibull
from wind_platform.core.ingestion import parse_timestamp
from wind_platform.core.power_classes import power_class
from wind_platform.core.standards import ENGINE_VERSION
from wind_platform.services.store import LocalStore


class AnalysisOptions(BaseModel):
    rose_all_directions: bool = False
    weibull_method: str = "mle"
    annual_days: int = Field(default=365, ge=365, le=366)
    raw_id: str | None = None
    qc_id: str | None = None
    result_id: str | None = None
    start: str | None = None
    end: str | None = None
    observed_start: str | None = None
    observed_end: str | None = None
    qc_period: str = "all"
    density_method: str = "measured"
    temperature_channel: str | None = None
    pressure_channel: str | None = None
    altitude_m: float | None = None
    manual_density: float | None = Field(default=None, gt=0, le=2)
    result_channels: list[str] = Field(default_factory=list)
    shear_channels: list[str] = Field(default_factory=list)
    aggregation: str = "hourly"
    sectors: int = Field(ge=1, le=36, default=16)
    calm_threshold: float = Field(ge=0, le=1, default=0.5)
    direction_channel: str | None = None


def boundary(text, timezone):
    value = datetime.fromisoformat(text.replace("/", "-"))
    if value.tzinfo is None:
        return parse_timestamp(text, timezone, "auto")
    return value.astimezone(UTC)


def period(data, start=None, end=None) -> tuple[datetime, datetime, np.ndarray]:
    zone = data["options"]["timezone"]
    a = boundary(start, zone) if start else datetime.fromisoformat(data["start"])
    b = boundary(end, zone) if end else datetime.fromisoformat(data["end_exclusive"])
    if a >= b:
        raise calc.CalculationError("统计时段终点须晚于起点；采用左闭右开区间。")
    stamps = [datetime.fromisoformat(v) for v in data["timestamps"]]
    mask = np.array([a <= stamp < b for stamp in stamps], dtype=bool)
    return a, b, mask


def channel(data, id_: str | None, quantity=None, statistic=None) -> dict:
    found = [c for c in data["channels"] if c["id"] == id_]
    if not found:
        raise calc.CalculationError("请明确选择所需通道。")
    c = found[0]
    if quantity and c["quantity"] != quantity or statistic and c["statistic"] != statistic:
        raise calc.CalculationError("所选通道的要素或统计类型不适用。")
    return c


def speed_channels(data) -> list[dict]:
    return [c for c in data["channels"] if c["quantity"] == "speed" and c["statistic"] == "mean"]


def selected_channel(data, id_, quantity):
    if not id_:
        raise calc.CalculationError(f"请确认{quantity}通道。")
    return channel(data, id_, quantity, "mean")


def times(data, mask) -> list[datetime]:
    zone = ZoneInfo(data["options"]["timezone"])
    return [
        datetime.fromisoformat(t).astimezone(zone)
        for t, include in zip(data["timestamps"], mask, strict=True)
        if include
    ]


def values(c, mask):
    return calc.numbers(c["values"])[mask]


def aggregate(stamps, arrays, interval, directions=None):
    """Complete local clock hours only. Never clone hourly values to ten minutes."""
    if interval > 60 or 60 % interval:
        raise calc.CalculationError("小时聚合需要能够整除60分钟的原始步长。")
    groups = defaultdict(list)
    for i, stamp in enumerate(stamps):
        groups[stamp.replace(minute=0, second=0, microsecond=0)].append(i)
    keys, outputs = [], [[] for _ in arrays]
    for key, ids in groups.items():
        keys.append(key)
        complete = (
            len(ids) == 60 // interval and len({stamps[i].minute for i in ids}) == 60 // interval
        )
        for index, (out, arr) in enumerate(zip(outputs, arrays, strict=True)):
            selected = arr[ids]
            if not complete or not np.isfinite(selected).all():
                out.append(np.nan)
            elif directions and index in directions:
                result = calc.circular_mean(selected)
                out.append(np.nan if result is None else result)
            else:
                out.append(float(selected.mean()))
    return keys, [np.array(v) for v in outputs]


def expected_count(a, b, interval):
    value = (b - a).total_seconds() / (interval * 60)
    if not value.is_integer():
        raise calc.CalculationError("统计边界与时间步长不一致。")
    return int(value)


def group_statistics(stamps, v, rho, step, key_fn):
    grouped = defaultdict(list)
    for i, stamp in enumerate(stamps):
        grouped[key_fn(stamp)].append(i)
    rows = []
    for key in sorted(grouped):
        selected = v[grouped[key]]
        if np.isfinite(selected).any():
            rows.append({"period": str(key), **calc.wind_statistics(selected, rho, step)})
    return rows


def run_analysis(store: LocalStore, config: AnalysisOptions) -> dict:
    if not any([config.raw_id, config.qc_id, config.result_id]):
        raise calc.CalculationError("至少选择一份已解析数据。")
    if config.aggregation not in {"hourly", "10min"} or config.qc_period not in {"all", "analysis"}:
        raise calc.CalculationError("统计步长或质控范围无效。")
    sources, warnings, outputs = {}, [], {}
    for stage, id_ in [("raw", config.raw_id), ("qc", config.qc_id), ("result", config.result_id)]:
        if id_:
            data = store.get("datasets", id_)
            if data["stage"] != stage:
                raise calc.CalculationError(f"{stage}分析不允许引用{data['stage']}阶段数据。")
            sources[stage] = data
    towers = {d["tower_id"] for d in sources.values()}
    if len(towers) > 1:
        raise calc.CalculationError("一次风况分析只能使用同一测风塔的数据；跨塔请用相关性模块。")

    def output(id_, title, method, operation):
        try:
            outputs[id_] = {"title": title, "method": method, "status": "ready", **operation()}
        except calc.CalculationError as exc:
            outputs[id_] = {
                "title": title,
                "method": method,
                "status": "unavailable",
                "reason": str(exc),
            }

    raw, qc, result = sources.get("raw"), sources.get("qc"), sources.get("result")
    if raw:

        def raw_records():
            a, b, mask = period(raw, config.observed_start, config.observed_end)
            n = expected_count(a, b, raw["options"]["interval_minutes"])
            return {
                "rows": [
                    {
                        "channel": c["name"],
                        "height": c["height"],
                        "quantity": c["quantity"],
                        "record_count": int(mask.sum()),
                        "valid_count": int(np.isfinite(values(c, mask)).sum()),
                        "expected_count": n,
                    }
                    for c in raw["channels"]
                ],
                "summary": {
                    "start": a.isoformat(),
                    "end_exclusive": b.isoformat(),
                    "interval": raw["options"]["interval_minutes"],
                },
            }

        output("raw-records", "测风塔原始数据统计", "completeness", raw_records)
        if not config.observed_start or not config.observed_end:
            warnings.append(
                "原始观测边界取自文件首末记录，不能据此识别文件两端缺测；请填写计划观测起止。"
            )
    if raw and qc:

        def completeness():
            if raw["options"]["interval_minutes"] != qc["options"]["interval_minutes"]:
                raise calc.CalculationError("原始与质控步长不同，不能直接计算保留率。")
            a, b, raw_mask = period(raw, config.observed_start, config.observed_end)
            _, _, qc_mask = period(qc, a.isoformat(), b.isoformat())
            annual_mask = (
                period(qc, config.start, config.end)[2] if config.start and config.end else None
            )
            annual_expected = config.annual_days * 24 * 60 // qc["options"]["interval_minutes"]
            expected = expected_count(a, b, raw["options"]["interval_minutes"])
            if expected == 0:
                raise calc.CalculationError("没有应测时间格。")
            raw_times = {t for t, keep in zip(raw["timestamps"], raw_mask, strict=True) if keep}
            rows = []
            for c in qc["channels"]:
                matches = [
                    r
                    for r in raw["channels"]
                    if all(r[k] == c[k] for k in ["quantity", "statistic", "height", "arm"])
                ]
                if len(matches) != 1:
                    rows.append(
                        {
                            "channel": c["name"],
                            "height": c["height"],
                            "reason": "原始通道未唯一匹配，请确认要素/高度/支臂。",
                        }
                    )
                    continue
                r = matches[0]
                raw_count = int(raw_mask.sum())
                valid = [
                    (t, v)
                    for t, v, keep in zip(qc["timestamps"], c["values"], qc_mask, strict=True)
                    if keep and v is not None
                ]
                extra = sum(t not in raw_times for t, _ in valid)
                if extra:
                    raise calc.CalculationError(
                        f"质控通道有{extra}条有效记录在原始文件中不存在，不应混入插补数据。"
                    )
                rows.append(
                    {
                        "channel": c["name"],
                        "height": c["height"],
                        "raw_records": raw_count,
                        "raw_valid": int(np.isfinite(values(r, raw_mask)).sum()),
                        "qc_valid": len(valid),
                        "annual_expected": annual_expected,
                        "annual_valid": int(np.isfinite(values(c, annual_mask)).sum())
                        if annual_mask is not None
                        else None,
                        "expected": expected,
                        "retention_percent": len(valid) / raw_count * 100 if raw_count else None,
                        "standard_completeness_percent": len(valid) / expected * 100,
                        "hourly_standard_completeness_percent": _hourly_completeness(
                            qc, c, qc_mask, a, b
                        ),
                        "meets_90_percent_at_selected_step": len(valid) / expected >= 0.9,
                    }
                )
            return {
                "rows": rows,
                "summary": {
                    "start": a.isoformat(),
                    "end_exclusive": b.isoformat(),
                    "note": (
                        "保留率与标准应测分母分别列示；GB18710的小时完整率另列，"
                        "避免把10min完整率当小时完整率。"
                    ),
                },
            }

        output("completeness", "完整率与质控保留率", "completeness", completeness)

    rho = None
    if config.density_method == "manual":
        rho = config.manual_density
        if rho is None:
            warnings.append("未填写固定空气密度，风功率密度与风能统计暂停。")
        else:
            outputs["density"] = {
                "title": "人工确认空气密度",
                "method": "density",
                "status": "ready",
                "rows": [{"period": "人工输入", "density": rho}],
                "summary": {"density": rho, "source": "人工输入，需另附来源"},
            }
    elif qc:

        def density_output():
            nonlocal rho
            _, _, mask = period(
                qc,
                config.start if config.qc_period == "analysis" else None,
                config.end if config.qc_period == "analysis" else None,
            )
            t = selected_channel(qc, config.temperature_channel, "temperature")
            pressure_channel = (
                selected_channel(qc, config.pressure_channel, "pressure")
                if config.density_method == "measured"
                else None
            )
            if config.density_method not in {"measured", "altitude"}:
                raise calc.CalculationError("请选择实测温压、海拔估算或人工密度。")
            temp = values(t, mask)
            p = values(pressure_channel, mask) if pressure_channel else None
            rho = calc.density(temp, p, config.altitude_m)
            stamps = times(qc, mask)
            rows = []
            for m in range(1, 13):
                ids = [i for i, stamp in enumerate(stamps) if stamp.month == m]
                if not ids:
                    continue
                try:
                    monthly = calc.density(
                        temp[ids], p[ids] if p is not None else None, config.altitude_m
                    )
                    rows.append(
                        {
                            "period": str(m),
                            "temperature_c": calc.finite_mean(temp[ids]),
                            "pressure_pa": calc.finite_mean(p[ids]) if p is not None else None,
                            "density": monthly,
                        }
                    )
                except calc.CalculationError:
                    rows.append({"period": str(m), "density": None})
            return {
                "rows": rows,
                "summary": {
                    "density": rho,
                    "kelvin_offset": 273,
                    "gas_constant": 287,
                    "method": config.density_method,
                    "altitude_m": config.altitude_m,
                    "temperature_height": t["height"],
                    "pressure_height": pressure_channel["height"] if pressure_channel else None,
                    "note": (
                        "密度对应温压仪所在高度；轮毂高度密度需另行核实。"
                        "年值由同期温压均值计算，不取12个月等权平均。"
                    ),
                },
            }

        output("density", "空气密度月变化", "density", density_output)
    if qc:
        _, _, mask = period(
            qc,
            config.start if config.qc_period == "analysis" else None,
            config.end if config.qc_period == "analysis" else None,
        )
        qc_stamps = times(qc, mask)

        def ti_output():
            if qc["options"]["interval_minutes"] != 10:
                raise calc.CalculationError("湍流要求10min均值与仪器10min标准差，当前步长不同。")
            rows, summaries, hourly_rows = [], [], []
            for c in speed_channels(qc):
                sd = [
                    s
                    for s in qc["channels"]
                    if s["quantity"] == "speed"
                    and s["statistic"] == "sd"
                    and s["height"] == c["height"]
                    and s["arm"] == c["arm"]
                ]
                if len(sd) != 1:
                    summaries.append(
                        {"channel": c["name"], "reason": "同高度同支臂标准差未唯一确认。"}
                    )
                    continue
                ti = calc.turbulence(values(c, mask), values(sd[0], mask))
                v10, sd10 = values(c, mask), values(sd[0], mask)
                hourly_groups = defaultdict(list)
                for t, v_, sd_ in zip(qc_stamps, v10, sd10, strict=True):
                    if np.isfinite(v_) and v_ > 0 and np.isfinite(sd_) and sd_ >= 0:
                        hourly_groups[t.replace(minute=0, second=0, microsecond=0)].append(sd_ / v_)
                hourly_rows.extend(
                    {
                        "period": t.isoformat(),
                        "channel": c["name"],
                        "height": c["height"],
                        "count": len(samples),
                        "maximum_ti": float(max(samples)),
                        "complete_hour": len(samples) == 6,
                    }
                    for t, samples in hourly_groups.items()
                )
                rows.extend(dict(row, channel=c["name"], height=c["height"]) for row in ti["rows"])
                summaries.append(
                    {
                        "channel": c["name"],
                        "mean_ti": ti["mean_ti"],
                        "count": ti["count"],
                        "excluded": ti["excluded"],
                    }
                )
            if not rows:
                raise calc.CalculationError("没有可计算的均值/仪器标准差配对；请确认通道映射。")
            outputs["turbulence-hourly"] = {
                "title": "逐小时十分钟最大湍流",
                "method": "turbulence",
                "status": "ready",
                "rows": hourly_rows,
                "summary": {
                    "basis": (
                        "GB18710 5.4.6.2：小时内最大10min湍流为该小时代表值；"
                        "与风速段代表性湍流不同。"
                    )
                },
            }
            return {
                "rows": rows,
                "summary": {
                    "channels": summaries,
                    "ddof": 1,
                    "formula": "Icha=mean(I)+std(I)；Irep=mean(I)+1.28std(I)；std为I的样本标准差",
                    "low_sample_notice": "箱内少于20对样本时标注低样本，不作自动机组等级判定。",
                },
            }

        output("turbulence", "湍流强度与样本数", "turbulence", ti_output)

        def shear_output():
            selected = [channel(qc, id_, "speed", "mean") for id_ in config.shear_channels]
            if len(selected) < 2:
                raise calc.CalculationError("请至少选择两层实测风速用于切变。")
            if (
                not selected[0]["arm"].strip()
                or len({c["arm"].strip().casefold() for c in selected}) != 1
            ):
                raise calc.CalculationError(
                    "请确认所有切变传感器为相同安装方向，填写相同支臂标识。"
                )
            fit = calc.shear([c["height"] for c in selected], [values(c, mask) for c in selected])
            rows = [{"group": "综合高度对", **pair} for pair in fit["pairs"]]
            for title, getter in [("月", lambda t: t.month), ("时", lambda t: t.hour)]:
                for group in sorted({getter(t) for t in qc_stamps}):
                    ids = [i for i, t in enumerate(qc_stamps) if getter(t) == group]
                    try:
                        sub = calc.shear(
                            [c["height"] for c in selected],
                            [values(c, mask)[ids] for c in selected],
                        )
                        rows.append(
                            {
                                "group": f"{title}{group}",
                                "alpha": sub["alpha"],
                                "count": sub["count"],
                            }
                        )
                    except calc.CalculationError:
                        continue
            return {"rows": rows, "summary": fit}

        output("shear", "实测风切变与风廓线", "shear", shear_output)

    if result:
        if not config.start or not config.end:
            raise calc.CalculationError("结果数据必须明确分析年起点和排他终点。")
        a, b, mask = period(result, config.start, config.end)
        if b - a < timedelta(days=365):
            warnings.append("分析时段不足一个完整年；当前仅为时段统计，不作为完整年风资源结论。")
        if a < datetime.fromisoformat(result["start"]) or b > datetime.fromisoformat(
            result["end_exclusive"]
        ):
            warnings.append("结果文件未覆盖分析年完整起止边界，请检查缺测与文件选择。")
        result_stamps = times(result, mask)
        selected = (
            [channel(result, id_, "speed", "mean") for id_ in config.result_channels]
            if config.result_channels
            else speed_channels(result)
        )
        if not selected:
            raise calc.CalculationError("结果文件没有平均风速通道。")
        series = [(c, values(c, mask)) for c in selected]
        direction = (
            channel(result, config.direction_channel, "direction", "mean")
            if config.direction_channel
            else None
        )
        step = result["options"]["interval_minutes"]
        d = values(direction, mask) if direction else None
        if config.aggregation == "hourly":
            arrays = [v for _, v in series] + ([d] if d is not None else [])
            result_stamps, aggregated = aggregate(
                result_stamps, arrays, step, {len(series)} if d is not None else set()
            )
            series = [(c, v) for (c, _), v in zip(series, aggregated[: len(series)], strict=True)]
            d = aggregated[-1] if d is not None else None
            step = 60
        elif step != 10:
            raise calc.CalculationError("10min统计模式需要10min结果数据。")
        config_density = rho

        def require_rho():
            if config_density is None:
                raise calc.CalculationError("请确认有效的质控温压密度或输入有来源的固定密度。")
            return config_density

        def statistic_output(key_fn):
            density_ = require_rho()
            rows, summaries = [], []
            for c, v in series:
                rows.extend(
                    dict(row, channel=c["name"], height=c["height"])
                    for row in group_statistics(result_stamps, v, density_, step, key_fn)
                )
                if np.isfinite(v).any():
                    summaries.append(
                        dict(
                            channel=c["name"],
                            height=c["height"],
                            **calc.wind_statistics(v, density_, step),
                            power_class_reference=power_class(
                                c["height"],
                                calc.wind_statistics(v, density_, step)["power_density"],
                            ),
                        )
                    )
            if not rows:
                raise calc.CalculationError(
                    "所选时段没有可用风速；小时模式需小时内各时间格均有效。"
                )
            return {
                "rows": rows,
                "summary": {
                    "channels": summaries,
                    "density": density_,
                    "step_minutes": step,
                    "start": a.isoformat(),
                    "end_exclusive": b.isoformat(),
                },
            }

        output(
            "monthly",
            "风速与风功率密度月变化",
            "wind-statistics",
            lambda: statistic_output(lambda t: t.month),
        )
        output(
            "hourly",
            "风速与风功率密度日变化",
            "wind-statistics",
            lambda: statistic_output(lambda t: t.hour),
        )
        output(
            "monthly-hourly",
            "各月日内变化",
            "wind-statistics",
            lambda: statistic_output(lambda t: f"{t.month:02d}-{t.hour:02d}"),
        )

        def frequency_output(fit=False):
            rows, summaries = [], []
            for c, v in series:
                freq = calc.frequencies(v)
                if fit:
                    fitted = fit_weibull(v, config.weibull_method)
                    freq = [dict(row, **fitted["rows"][i]) for i, row in enumerate(freq)]
                    summaries.append(
                        {key: value for key, value in fitted.items() if key != "rows"}
                        | {"channel": c["name"]}
                    )
                rows.extend(dict(row, channel=c["name"], height=c["height"]) for row in freq)
            return {"rows": rows, "summary": {"channels": summaries, "step_minutes": step}}

        output("frequency", "风速与风能频率", "frequency", frequency_output)
        output("weibull", "Weibull分布拟合", "weibull", lambda: frequency_output(True))

        def rose_output(monthly=False):
            if d is None:
                raise calc.CalculationError("请明确结果数据风向通道。")
            rows, summaries = [], []
            rose_series = [(c, v, d) for c, v in series]
            if config.rose_all_directions:
                rose_series = []
                for dc in result["channels"]:
                    if dc["quantity"] != "direction" or dc["statistic"] != "mean":
                        continue
                    dv = values(dc, mask)
                    if config.aggregation == "hourly":
                        _, direction_arrays = aggregate(
                            times(result, mask),
                            [dv],
                            result["options"]["interval_minutes"],
                            {0},
                        )
                        dv = direction_arrays[0]
                    for c, v in series:
                        label = {
                            **c,
                            "name": f"{c['name']} / WD-{dc['height']:g}m",
                            "direction_height": dc["height"],
                        }
                        rose_series.append((label, v, dv))
            for c, v, direction_values in rose_series:
                for month in range(1, 13) if monthly else [0]:
                    ids = [i for i, t in enumerate(result_stamps) if not month or t.month == month]
                    if not ids:
                        continue
                    try:
                        item = calc.rose(
                            v[ids], direction_values[ids], config.sectors, config.calm_threshold
                        )
                        rows.extend(
                            dict(
                                row,
                                channel=c["name"],
                                height=c["height"],
                                month=month,
                                direction_height=c.get("direction_height", direction["height"]),
                            )
                            for row in item["rows"]
                        )
                        summaries.append(
                            {key: value for key, value in item.items() if key != "rows"}
                            | {"channel": c["name"], "month": month}
                        )
                    except calc.CalculationError:
                        if not monthly:
                            raise
            if not rows:
                raise calc.CalculationError("没有同期有效风速风向。")
            return {
                "rows": rows,
                "summary": {
                    "channels": summaries,
                    "sectors": config.sectors,
                    "direction_height": direction["height"],
                    "calm_threshold": config.calm_threshold,
                },
            }

        output("annual-rose", "全年风向与风能玫瑰", "rose", rose_output)
        output("monthly-rose", "各月风向与风能玫瑰", "rose", lambda: rose_output(True))
    return store.put(
        "runs",
        {
            "kind": "analysis",
            "engine_version": ENGINE_VERSION,
            "created_at": datetime.now(UTC).isoformat(),
            "config": config.model_dump(),
            "sources": {
                k: {
                    key: value
                    for key, value in d.items()
                    if key in {"id", "file_id", "sha256", "stage", "tower_id", "filename"}
                }
                for k, d in sources.items()
            },
            "warnings": warnings,
            "outputs": outputs,
        },
    )


def _hourly_completeness(data, c, mask, a, b):
    if a.minute or b.minute:
        return None
    stamps, arrs = aggregate(
        times(data, mask), [values(c, mask)], data["options"]["interval_minutes"]
    )
    del stamps
    expected = (b - a).total_seconds() / 3600
    return float(np.isfinite(arrs[0]).sum() / expected * 100) if expected else None


class CorrelationOptions(BaseModel):
    target_id: str
    reference_id: str
    target_channel: str
    reference_channel: str
    direction_id: str | None = None
    direction_channel: str | None = None
    start: str
    end: str
    timezone: str = "Asia/Shanghai"
    sectors: int = Field(default=16, ge=1, le=36)
    aggregation: str = "hourly"
    through_origin: bool = False


def channel_series(data, c, start, end, aggregation):
    _, _, mask = period(data, start, end)
    stamps, v = times(data, mask), values(c, mask)
    if aggregation == "hourly":
        stamps, arrays = aggregate(
            stamps,
            [v],
            data["options"]["interval_minutes"],
            {0} if c["quantity"] == "direction" else set(),
        )
        v = arrays[0]
    elif aggregation != "native":
        raise calc.CalculationError("相关性聚合方式无效。")
    return {
        t.astimezone(UTC): value for t, value in zip(stamps, v, strict=True) if np.isfinite(value)
    }


def correlation_data(store, config):
    target = store.get("datasets", config.target_id)
    reference = store.get("datasets", config.reference_id)
    if (
        config.aggregation == "native"
        and target["options"]["interval_minutes"] != reference["options"]["interval_minutes"]
    ):
        raise calc.CalculationError("原始步长不同，请选择完整小时对齐。")
    a = parse_timestamp(config.start, config.timezone, "auto").isoformat()
    b = parse_timestamp(config.end, config.timezone, "auto").isoformat()
    x = channel_series(
        reference,
        channel(reference, config.reference_channel, "speed", "mean"),
        a,
        b,
        config.aggregation,
    )
    y = channel_series(
        target, channel(target, config.target_channel, "speed", "mean"), a, b, config.aggregation
    )
    common = sorted(x.keys() & y.keys())
    d = None
    if config.sectors > 1:
        if not config.direction_id:
            raise calc.CalculationError("分扇区相关性需明确风向数据源和通道。")
        direction = store.get("datasets", config.direction_id)
        d = channel_series(
            direction,
            channel(direction, config.direction_channel, "direction", "mean"),
            a,
            b,
            config.aggregation,
        )
        common = sorted(set(common) & d.keys())
    rows = []
    for sector in range(config.sectors):
        stamps = [
            t for t in common if d is None or calc.sector_index(d[t], config.sectors) == sector
        ]
        xs, ys = [x[t] for t in stamps], [y[t] for t in stamps]
        row = {
            "sector": sector,
            "label": calc.COMPASS[sector]
            if config.sectors == 16
            else f"{sector * 360 / config.sectors:g}°"
            if config.sectors > 1
            else "整体",
            "count": len(stamps),
        }
        try:
            row.update(calc.regression(xs, ys, config.through_origin))
            row["sufficient_samples"] = len(stamps) >= 30
        except calc.CalculationError as exc:
            row["reason"] = str(exc)
        # Deterministic display thinning; fit always uses all paired samples.
        stride = max(1, math_ceil(len(stamps) / 1200))
        row["points"] = [[float(x[t]), float(y[t])] for t in stamps[::stride]]
        rows.append(row)
    return rows, {
        "paired_count": len(common),
        "target_count": len(y),
        "reference_count": len(x),
        "aggregation": config.aggregation,
        "note": "回归使用所有同期样本；单幅显示最多1200点；R²为1-SSE/SST，过原点时不等于r²。",
    }


def math_ceil(value):
    return int(np.ceil(value))


def run_correlation(store, config):
    rows, summary = correlation_data(store, config)
    return store.put(
        "runs",
        {
            "kind": "correlation",
            "engine_version": ENGINE_VERSION,
            "created_at": datetime.now(UTC).isoformat(),
            "config": config.model_dump(),
            "outputs": {
                "correlation": {
                    "title": "同期相关性散点图",
                    "method": "correlation",
                    "status": "ready",
                    "rows": rows,
                    "summary": summary,
                }
            },
        },
    )


class LongTermOptions(BaseModel):
    reference_id: str
    result_id: str
    speed_channel: str
    direction_channel: str | None = None
    start: str
    end: str
    timezone: str = "Asia/Shanghai"
    windows: list[int] = Field(default_factory=lambda: [30, 20, 10], min_length=1, max_length=6)
    direction_period: str = "baseline"


def shift_year(stamp, year_offset):
    year = stamp.year + year_offset
    day = min(stamp.day, calendar.monthrange(year, stamp.month)[1])
    return stamp.replace(year=year, day=day)


def run_long_term(store, config):
    data = store.get("datasets", config.reference_id)
    result = store.get("datasets", config.result_id)
    if data["stage"] != "reference" or result["stage"] != "result":
        raise calc.CalculationError("长期分析需要中尺度参考和结果阶段数据。")
    if any(not 1 <= n <= 100 for n in config.windows):
        raise calc.CalculationError("长期窗口须为1至100年。")
    if config.direction_period not in {"baseline", "concurrent"}:
        raise calc.CalculationError("风向统计范围无效。")
    a = parse_timestamp(config.start, config.timezone, "auto").astimezone(ZoneInfo(config.timezone))
    b = parse_timestamp(config.end, config.timezone, "auto").astimezone(ZoneInfo(config.timezone))
    if shift_year(a, 1) != b:
        raise calc.CalculationError(
            "周年统计需要一个完整周年起止；终点不含当天，2月29日周年按2月28日约定。"
        )
    if (
        datetime.fromisoformat(result["start"]) > a
        or datetime.fromisoformat(result["end_exclusive"]) < b
    ):
        _, _, result_mask = period(result, a.isoformat(), b.isoformat())
        required = 365 * 24 * 60 / result["options"]["interval_minutes"]
        if int(result_mask.sum()) < required:
            raise calc.CalculationError("所选结果文件不足365天数据量，请核对。")
    c = channel(data, config.speed_channel, "speed", "mean")
    rows, all_values = [], {}
    for offset in range(1 - max(config.windows), 1):
        lo, hi = shift_year(a, offset), shift_year(a, offset + 1)
        _, _, mask = period(data, lo.isoformat(), hi.isoformat())
        v = values(c, mask)
        valid = v[np.isfinite(v)]
        if (valid < 0).any():
            raise calc.CalculationError("参考数据存在负风速，请核对缺测标记。")
        expected = expected_count(lo, hi, data["options"]["interval_minutes"])
        all_values[offset] = valid
        rows.append(
            {
                "period": f"{lo:%Y-%m-%d} / {hi:%Y-%m-%d}",
                "offset": offset,
                "mean_speed": calc.finite_mean(valid),
                "count": len(valid),
                "expected": expected,
                "coverage_percent": len(valid) / expected * 100,
                "complete": len(valid) == expected,
                "concurrent": offset == 0,
            }
        )
    means = []
    for n in sorted(set(config.windows), reverse=True):
        selected = [row for row in rows if row["offset"] >= 1 - n]
        complete = all(row["complete"] for row in selected)
        v = np.concatenate([all_values[row["offset"]] for row in selected])
        means.append(
            {
                "years": n,
                "mean_speed": calc.finite_mean(v) if complete else None,
                "complete_years": sum(row["complete"] for row in selected),
                "reason": None if complete else f"不足{n}个完整周年，不绘制该均值线。",
            }
        )
    output = {
        "reference-years": {
            "title": "长期周年风速与同期对比",
            "method": "long-term",
            "status": "ready",
            "rows": rows,
            "summary": {
                "means": means,
                "timezone": config.timezone,
                "start": a.isoformat(),
                "end_exclusive": b.isoformat(),
                "note": (
                    "n年窗口含同期分析年及之前n-1年；均值按全部时间格加权。"
                    "缺失周年均值列为部分数据，不能冒充全年。"
                ),
            },
        }
    }
    if config.direction_channel:
        d = channel(data, config.direction_channel, "direction", "mean")
        rose_rows, rose_summary = [], []
        periods = (
            [1]
            if config.direction_period == "concurrent"
            else sorted(set(config.windows), reverse=True)
        )
        for n in periods:
            lo = shift_year(a, 1 - n)
            _, _, mask = period(data, lo.isoformat(), b.isoformat())
            try:
                rose = calc.rose(values(c, mask), values(d, mask))
                rose_rows.extend(dict(row, window=n) for row in rose["rows"])
                rose_summary.append({k: v for k, v in rose.items() if k != "rows"} | {"window": n})
            except calc.CalculationError:
                continue
        output["reference-rose"] = {
            "title": "长期累计风向与风能",
            "method": "rose",
            "status": "ready" if rose_rows else "unavailable",
            "reason": "没有有效风速风向配对。" if not rose_rows else None,
            "rows": rose_rows,
            "summary": {
                "windows": rose_summary,
                "note": "累计方向分布以实际可用配对为分母；完整度见周年表。",
            },
        }
    else:
        output["reference-rose"] = {
            "title": "长期累计风向",
            "method": "rose",
            "status": "unavailable",
            "reason": "尚未指定风向通道。",
        }
    return store.put(
        "runs",
        {
            "kind": "long-term",
            "engine_version": ENGINE_VERSION,
            "created_at": datetime.now(UTC).isoformat(),
            "config": config.model_dump(),
            "outputs": output,
        },
    )
