"""Align two wind series without extrapolating either source."""

from collections import Counter, defaultdict
from datetime import UTC, datetime
from math import ceil, fsum
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field

from wind_platform.core.calculations import (
    COMPASS,
    CalculationError,
    circular_mean,
    rose,
    sector_index,
)
from wind_platform.core.ingestion import parse_timestamp
from wind_platform.services.analysis import channel, channel_series


class ConcurrentSource(BaseModel):
    dataset_id: str
    speed_channel: str | None = None
    direction_channel: str | None = None


class ConcurrentOptions(BaseModel):
    a: ConcurrentSource
    b: ConcurrentSource
    start: str
    end: str
    timezone: str = "Asia/Shanghai"
    aggregation: Literal["hourly", "native"] = "hourly"
    paired_only: bool = True
    plot_points: int = Field(default=1500, ge=100, le=3000)


class ConcurrentWindow(BaseModel):
    start: float = Field(allow_inf_nan=False)
    end: float = Field(allow_inf_nan=False)


def compare_concurrent(store, config: ConcurrentOptions, window: ConcurrentWindow | None = None):
    sources = (config.a, config.b)
    datasets = [store.get("datasets", source.dataset_id) for source in sources]
    intervals = {data["options"]["interval_minutes"] for data in datasets}
    if config.aggregation == "native" and len(intervals) != 1:
        raise CalculationError("原始步长不同，请选择完整小时对齐。")
    step = 60 if config.aggregation == "hourly" else intervals.pop()
    start = parse_timestamp(config.start, config.timezone, "auto")
    end = parse_timestamp(config.end, config.timezone, "auto")
    if start >= end:
        raise CalculationError("结束时间须晚于开始时间。")
    if window:
        if not start.timestamp() <= window.start < window.end <= end.timestamp():
            raise CalculationError("缩放时段须在原分析时段内。")
        start, end = (
            datetime.fromtimestamp(window.start, UTC),
            datetime.fromtimestamp(window.end, UTC),
        )

    results = {}
    visible_series = {}
    for quantity in ("speed", "direction"):
        ids = [getattr(source, f"{quantity}_channel") for source in sources]
        if not any(ids):
            continue
        sequences = [
            channel_series(
                data,
                channel(data, channel_id, quantity, "mean"),
                start.isoformat(),
                end.isoformat(),
                config.aggregation,
            )
            if channel_id
            else {}
            for data, channel_id in zip(datasets, ids, strict=True)
        ]
        a, b = sequences
        common = a.keys() & b.keys()
        stamps = sorted(common if config.paired_only else a.keys() | b.keys())
        if not window:
            visible_series[quantity] = [
                {stamp: series[stamp] for stamp in stamps if stamp in series}
                for series in sequences
            ]
        stride = max(1, ceil(len(stamps) / config.plot_points))
        # Segment on missing slots or a compass wrap before reducing display points.
        points = []
        segments = [0, 0]
        previous = [None, None]
        prior_stamp = None
        for index, stamp in enumerate(stamps):
            values = [a.get(stamp), b.get(stamp)]
            gap = prior_stamp is not None and (stamp - prior_stamp).total_seconds() > step * 60
            for side, value in enumerate(values):
                if (
                    gap
                    or value is None
                    or (
                        quantity == "direction"
                        and previous[side] is not None
                        and abs(value - previous[side]) > 180
                    )
                ):
                    segments[side] += 1
            if index % stride == 0 or index == len(stamps) - 1:
                points.append([stamp.timestamp(), *values, *segments])
            prior_stamp, previous = stamp, values
        results[quantity] = {
            "paired": len(common),
            "counts": [len(a), len(b)],
            "visible": len(stamps),
            "points": points,
        }
    if not results:
        raise CalculationError("请至少选择一个风速或风向通道。")
    output = {
        "start": start.timestamp(),
        "end": end.timestamp(),
        "timezone": config.timezone,
        "metrics": results,
    }
    if not window:
        output["summary"] = summarize(visible_series, config, datasets)
        output["monthly_metrics"] = monthly_metrics(visible_series, start, end, config.timezone)
    return output


def monthly_metrics(visible_series, start, end, timezone):
    zone = ZoneInfo(timezone)
    output = {}
    for quantity, sources in visible_series.items():
        aggregates = []
        for source in sources:
            grouped = defaultdict(list)
            for stamp, value in source.items():
                local = stamp.astimezone(zone)
                if quantity != "direction" or 0 <= value <= 360:
                    grouped[(local.year, local.month)].append(value)
            averages = {}
            for month, values in grouped.items():
                mean = (
                    circular_mean(values) if quantity == "direction" else fsum(values) / len(values)
                )
                if mean is not None:
                    averages[month] = mean
            aggregates.append(averages)
        a, b = aggregates
        points, segments = [], [0, 0]
        previous_month, previous = None, [None, None]
        for year, month in sorted(a.keys() | b.keys()):
            ordinal = year * 12 + month
            month_start = datetime(year, month, 1, tzinfo=zone)
            month_end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=zone)
            left = max(start.timestamp(), month_start.timestamp())
            right = min(end.timestamp(), month_end.timestamp())
            values = [a.get((year, month)), b.get((year, month))]
            for side, value in enumerate(values):
                if (
                    previous_month is not None
                    and ordinal != previous_month + 1
                    or value is None
                    or previous[side] is None
                    or (quantity == "direction" and abs(value - previous[side]) > 180)
                ):
                    segments[side] += 1
            points.append([(left + right) / 2, *values, *segments])
            previous_month, previous = ordinal, values
        output[quantity] = {
            "paired": len(a.keys() & b.keys()),
            "counts": [len(a), len(b)],
            "visible": len(points),
            "points": points,
        }
    return output


def summarize(visible, config, datasets):
    speeds = visible.get("speed", [{}, {}])
    directions = visible.get("direction", [{}, {}])
    zone = ZoneInfo(config.timezone)
    monthly = []
    for speed in speeds:
        months = [[] for _ in range(12)]
        for stamp, value in speed.items():
            months[stamp.astimezone(zone).month - 1].append(value)
        monthly.append(
            [fsum(values) / len(values) if values else None for values in months]
            + [fsum(speed.values()) / len(speed) if speed else None]
        )
    wind_direction, wind_energy = [], []
    for direction in directions:
        bins = Counter(sector_index(value) for value in direction.values() if 0 <= value <= 360)
        total = sum(bins.values())
        wind_direction.append(
            [
                {"label": label, "degrees": index * 22.5, "frequency": bins[index] / total * 100}
                for index, label in enumerate(COMPASS)
            ]
            if total
            else []
        )
    valid = [
        {
            stamp
            for stamp in speed.keys() & direction.keys()
            if speed[stamp] >= 0 and 0 <= direction[stamp] <= 360
        }
        for speed, direction in zip(speeds, directions, strict=True)
    ]
    if config.paired_only:
        valid = [valid[0] & valid[1]] * 2
    for speed, direction, stamps in zip(speeds, directions, valid, strict=True):
        paired_stamps = sorted(stamps)
        distribution = (
            rose(
                [speed[stamp] for stamp in paired_stamps],
                [direction[stamp] for stamp in paired_stamps],
            )
            if paired_stamps
            else None
        )
        wind_energy.append(
            distribution["rows"]
            if distribution
            and any(row["energy_frequency"] is not None for row in distribution["rows"])
            else []
        )
    return {
        "stages": [dataset["stage"] for dataset in datasets],
        "monthly_speed": monthly,
        "direction": wind_direction,
        "energy": wind_energy,
    }
