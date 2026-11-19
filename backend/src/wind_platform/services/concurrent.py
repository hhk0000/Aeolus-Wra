"""Align two wind series without extrapolating either source."""

from math import ceil
from typing import Literal

from pydantic import BaseModel, Field

from wind_platform.core.calculations import CalculationError
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


def compare_concurrent(store, config: ConcurrentOptions) -> dict:
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

    results = {}
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
    return {
        "start": start.timestamp(),
        "end": end.timestamp(),
        "timezone": config.timezone,
        "metrics": results,
    }
