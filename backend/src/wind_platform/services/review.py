"""Candidate flags only. Standards require a second judgement before invalidating data."""

from collections import Counter
from datetime import UTC, datetime, timedelta
from itertools import combinations

import numpy as np
from pydantic import BaseModel

from wind_platform.core import calculations as calc
from wind_platform.core.standards import ENGINE_VERSION
from wind_platform.services.analysis import aggregate, times


class ReviewOptions(BaseModel):
    dataset_id: str
    sea_level_pressure_confirmed: bool = False


def review(store, config):
    data = store.get("datasets", config.dataset_id)
    stamps = [datetime.fromisoformat(t) for t in data["timestamps"]]
    step = data["options"]["interval_minutes"]
    flags, counts = [], Counter()

    def flag(t, c, rule, value, reference):
        counts[rule] += 1
        # All flags are counted; UI response bounded to avoid unbounded browser tables.
        if len(flags) < 10000:
            flags.append(
                {
                    "timestamp": t,
                    "channel": c["name"],
                    "rule": rule,
                    "value": value,
                    "reference": reference,
                    "decision": "待人工复核",
                }
            )

    for c in data["channels"]:
        v = calc.numbers(c["values"])
        if c["statistic"] != "mean":
            continue
        for i, value in enumerate(v):
            if not np.isfinite(value):
                continue
            quantity = c["quantity"]
            bounds = {"speed": (0, 75), "direction": (0, 360), "temperature": (-80, 60)}
            if quantity in bounds and not bounds[quantity][0] <= value < bounds[quantity][1]:
                flag(
                    data["timestamps"][i],
                    c,
                    "GB37523表1范围候选",
                    float(value),
                    str(bounds[quantity]),
                )
            if (
                quantity == "pressure"
                and config.sea_level_pressure_confirmed
                and not 87000 < value < 110000
            ):
                flag(
                    data["timestamps"][i],
                    c,
                    "GB37523海平面气压候选",
                    float(value),
                    "(87000,110000)Pa；须确认为海平面气压",
                )
            if (
                i
                and stamps[i] - stamps[i - 1] == timedelta(minutes=10)
                and quantity == "speed"
                and np.isfinite(v[i - 1])
                and abs(value - v[i - 1]) >= 20
            ):
                flag(
                    data["timestamps"][i],
                    c,
                    "GB37523表3风速突变候选",
                    float(value - v[i - 1]),
                    "相邻10min差绝对值<20m/s",
                )
        mask = np.ones(len(stamps), dtype=bool)
        hs, arrays = aggregate(
            times(data, mask), [v], step, {0} if c["quantity"] == "direction" else set()
        )
        hourly = dict(zip(hs, arrays[0], strict=True))
        if c["quantity"] in {"temperature", "pressure"}:
            lag, threshold = (1, 5) if c["quantity"] == "temperature" else (3, 1000)
            for t, value in hourly.items():
                old = hourly.get(t - timedelta(hours=lag), np.nan)
                if np.isfinite(value) and np.isfinite(old) and abs(value - old) >= threshold:
                    flag(
                        t.isoformat(),
                        c,
                        "GB37523表3温压趋势候选",
                        float(value - old),
                        f"{lag}h差绝对值<{threshold} SI单位",
                    )
        if c["quantity"] in {"speed", "direction"}:
            run_start = 0
            for i in range(1, len(v) + 1):
                same = (
                    i < len(v)
                    and np.isfinite(v[i])
                    and v[i] == v[i - 1]
                    and stamps[i] - stamps[i - 1] == timedelta(minutes=step)
                )
                if same:
                    continue
                if np.isfinite(v[i - 1]) and (i - run_start) * step >= 360:
                    flag(
                        data["timestamps"][run_start],
                        c,
                        "NB31147连续不变候选",
                        float(v[i - 1]),
                        f"持续{(i - run_start) * step / 60:g}h；风向须结合非静风条件判断",
                    )
                run_start = i
    speeds = [c for c in data["channels"] if c["quantity"] == "speed" and c["statistic"] == "mean"]
    for low, high in combinations(sorted(speeds, key=lambda c: c["height"]), 2):
        if 0 < high["height"] - low["height"] <= 20 and low["height"] >= 10:
            mask = np.ones(len(stamps), dtype=bool)
            hs, arrays = aggregate(
                times(data, mask), [calc.numbers(low["values"]), calc.numbers(high["values"])], step
            )
            threshold = 2 if low["height"] > 50 else 3 if high["height"] <= 50 else None
            if threshold:
                for t, a, b in zip(hs, *arrays, strict=True):
                    if np.isfinite(a) and np.isfinite(b) and abs(b - a) >= threshold:
                        flag(
                            t.isoformat(),
                            high,
                            "GB37523表2层间风速候选",
                            float(b - a),
                            f"与{low['name']}小时均值差绝对值<{threshold}m/s",
                        )
    gaps = sum(
        max(0, int((b - a).total_seconds() / (step * 60)) - 1)
        for a, b in zip(stamps, stamps[1:], strict=False)
    )
    return store.put(
        "runs",
        {
            "kind": "review",
            "engine_version": ENGINE_VERSION,
            "created_at": datetime.now(UTC).isoformat(),
            "config": config.model_dump(),
            "outputs": {
                "qc-review": {
                    "title": "合理性审核候选",
                    "method": "qc-review",
                    "status": "ready",
                    "rows": flags,
                    "summary": {
                        "counts": dict(counts),
                        "total_flags": sum(counts.values()),
                        "display_limit": 10000,
                        "missing_time_slots": gaps,
                        "sea_level_pressure_check": config.sea_level_pressure_confirmed,
                        "notice": (
                            "仅标记，不删除、不修改、不宣告质控合格。"
                            "风向360在统计时归北，在原始范围审核中列为边界候选。"
                        ),
                    },
                }
            },
        },
    )
