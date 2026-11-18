"""Compare saved runs over the same observed UTC hours, keeping each mast separate."""

from datetime import UTC, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

import numpy as np
from pydantic import BaseModel, Field

from wind_platform.core.calculations import CalculationError, wind_statistics
from wind_platform.services.analysis import boundary, channel, channel_series, shift_year


class TowerSelection(BaseModel):
    run_id: str
    channel_id: str
    name: str = Field(min_length=1, max_length=240)


class ComparisonOptions(BaseModel):
    period: Literal["monthly", "hourly", "reference-years"]
    metric: Literal["mean_speed", "power_density"] = "mean_speed"
    window: int = Field(default=30, ge=1, le=100)
    towers: list[TowerSelection] = Field(min_length=2, max_length=4)


def compare_towers(store, config: ComparisonOptions):
    annual = config.period == "reference-years"
    if annual and config.metric != "mean_speed":
        raise CalculationError("长期参考对比使用平均风速。")
    sources, series, densities, year_ranges = [], [], [], []
    tower_ids = set()
    for selection in config.towers:
        run = store.get("runs", selection.run_id)
        options = run["config"]
        if run["kind"] != ("long-term" if annual else "analysis"):
            raise CalculationError("所选运行的数据阶段与对比类型不一致。")
        result = store.get("datasets", options["result_id"]) if options.get("result_id") else None
        if not result or result["stage"] != "result" or not result.get("tower_id"):
            raise CalculationError("所选运行缺少测风塔结果数据。")
        mast = result["tower_id"]
        if mast in tower_ids:
            raise CalculationError("对比须选择不同测风塔。")
        tower_ids.add(mast)
        if annual:
            if config.window not in options["windows"]:
                raise CalculationError("各塔的长期运行须均包含所选年数。")
            if selection.channel_id != options["speed_channel"]:
                raise CalculationError("长期对比须使用该塔长期运行中的风速通道。")
            del result
            data = store.get("datasets", options["reference_id"])
            zone = options["timezone"]
        else:
            data = result
            zone = data["options"]["timezone"]
        speed = channel(data, selection.channel_id, "speed", "mean")
        anchor = boundary(options["start"], zone).astimezone(ZoneInfo(zone))
        end = boundary(options["end"], zone)
        start = shift_year(anchor, 1 - config.window) if annual else anchor
        ranges = {}
        if annual:
            for offset in range(1 - config.window, 1):
                lo, hi = shift_year(anchor, offset), shift_year(anchor, offset + 1)
                ranges[lo.year] = (lo.astimezone(UTC), hi.astimezone(UTC))
        year_ranges.append(ranges)
        density = run["outputs"].get("monthly", {}).get("summary", {}).get("density")
        if config.metric == "power_density" and not density:
            raise CalculationError("风功率密度对比需要每座塔的运行包含已确认的空气密度。")
        densities.append(density)
        series.append(channel_series(data, speed, start.isoformat(), end.isoformat(), "hourly"))
        sources.append(
            {
                "tower_id": mast,
                "name": options.get("tower_name") or selection.name,
                "run_id": run["id"],
                "dataset_id": data["id"],
                "channel": speed["name"],
                "height": speed["height"],
                "stage": data["stage"],
                "timezone": zone,
                "start": start.isoformat(),
                "end_exclusive": end.isoformat(),
            }
        )
    common = sorted(set.intersection(*(set(s) for s in series)))
    if not common:
        raise CalculationError("所选塔没有共同有效的完整小时。")
    axis_zone = ZoneInfo(sources[0]["timezone"])
    if annual:
        periods = sorted(set.intersection(*(set(r) for r in year_ranges)))
        groups = {}
        for year in periods:
            lo = max(r[year][0] for r in year_ranges)
            hi = min(r[year][1] for r in year_ranges)
            groups[year] = [t for t in common if lo <= t < hi]
    else:
        periods = range(1, 13) if config.period == "monthly" else range(24)
        groups = {p: [] for p in periods}
        for stamp in common:
            local = stamp.astimezone(axis_zone)
            groups[local.month if config.period == "monthly" else local.hour].append(stamp)
    rows, paired_count = [], 0
    first = last = None
    for p, stamps in groups.items():
        vals = []
        if stamps:
            paired_count += len(stamps)
            first = stamps[0] if first is None else min(first, stamps[0])
            last = stamps[-1] if last is None else max(last, stamps[-1])
        for s, density in zip(series, densities, strict=True):
            if not stamps:
                vals.append(None)
                continue
            v = np.array([s[t] for t in stamps])
            if (v < 0).any():
                raise CalculationError("所选通道存在负风速，请核对缺测标记。")
            vals.append(
                float(v.mean())
                if config.metric == "mean_speed"
                else wind_statistics(v, density, 60)["power_density"]
            )
        rows.append({"period": p, "count": len(stamps), "values": vals})
    if first is None:
        raise CalculationError("各塔同一周年的统计窗口没有共同有效小时。")
    return {
        "sources": sources,
        "rows": rows,
        "paired_count": paired_count,
        "timezone": str(axis_zone),
        "start": first.isoformat(),
        "end_exclusive": (last + timedelta(hours=1)).isoformat(),
    }
