"""Wind direction frequencies calculated solely from measured direction channels."""

from datetime import UTC, datetime
from functools import lru_cache

import numpy as np

from wind_platform.core.calculations import COMPASS, CalculationError, sector_index
from wind_platform.services.analysis import boundary, period, times, values


@lru_cache(maxsize=32)
def run_measured_direction(store, analysis_id: str, sectors: int):
    # Sources and saved runs are immutable. Reuse the persisted result for the same request.
    analysis = store.get("runs", analysis_id)
    if analysis["kind"] != "analysis":
        raise CalculationError("请从风资源分析成果打开实测风向。")
    config = analysis["config"]
    outputs, sources = {}, {}
    monthly, annual = [], []
    if config.get("result_id"):
        result = store.get("datasets", config["result_id"])
        zone = result["options"]["timezone"]
        start = boundary(config["start"], zone).isoformat()
        end = boundary(config["end"], zone).isoformat()
    else:
        start, end = config.get("observed_start"), config.get("observed_end")
    channels_seen = set()
    for stage in ("qc", "raw"):
        if not (dataset_id := config.get(f"{stage}_id")):
            continue
        data = store.get("datasets", dataset_id)
        if data["stage"] != stage:
            continue
        _, _, mask = period(data, start, end)
        months = np.array([stamp.month for stamp in times(data, mask)])
        windows = {0: None, **{month: months == month for month in range(1, 13)}}
        for sensor in data["channels"]:
            if sensor["quantity"] != "direction" or sensor["statistic"] != "mean":
                continue
            identity = (sensor["height"], sensor["arm"].strip().casefold())
            if identity in channels_seen:
                continue
            angles = values(sensor, mask)
            valid = np.isfinite(angles) & (angles >= 0) & (angles <= 360)
            if not valid.any():
                continue
            channels_seen.add(identity)
            sources[stage] = {key: data[key] for key in ("id", "filename", "stage", "tower_id")}
            labels = np.fromiter((sector_index(v, sectors) for v in angles[valid]), dtype=int)
            for month, mask_month in windows.items():
                sample = labels if mask_month is None else labels[mask_month[valid]]
                if not len(sample):
                    continue
                rows = monthly if month else annual
                for sector, count in enumerate(np.bincount(sample, minlength=sectors)):
                    rows.append(
                        {
                            "channel": f"{stage}/{sensor['id']}",
                            "height": sensor["height"],
                            "direction_height": sensor["height"],
                            "direction_name": sensor["name"],
                            "source_stage": stage,
                            "month": month,
                            "sector": sector,
                            "label": COMPASS[sector]
                            if sectors == 16
                            else f"{sector * 360 / sectors:g}°",
                            "degrees": sector * 360 / sectors,
                            "count": int(count),
                            "frequency": float(count / len(sample) * 100),
                        }
                    )
    for id_, title, rows in (
        ("annual-rose", "全年实测风向频率", annual),
        ("monthly-rose", "各月实测风向频率", monthly),
    ):
        outputs[id_] = {
            "title": title,
            "method": "measured-direction-frequency",
            "status": "ready" if rows else "unavailable",
            "rows": rows,
            "reason": None if rows else "当前统计时段没有可用的原始或质控实测风向数据。",
            "summary": {"note": "按有效实测风向记录计频率，质控优先，原始补充独有通道。"},
        }
    return store.put(
        "runs",
        {
            "kind": "measured-direction",
            "engine_version": analysis["engine_version"],
            "created_at": datetime.now(UTC).isoformat(),
            "config": {
                "start": start,
                "end": end,
                "sectors": sectors,
                "source_run_id": analysis_id,
                "tower_name": config.get("tower_name"),
            },
            "sources": sources,
            "outputs": outputs,
        },
    )
