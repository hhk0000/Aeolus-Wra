"""End-to-end method prerequisites and immutable engineering transformations."""

from datetime import UTC, datetime, timedelta

import pytest
from wind_platform.core.calculations import CalculationError
from wind_platform.services.processing import ProcessingOptions, process
from wind_platform.services.review import ReviewOptions, review
from wind_platform.services.store import LocalStore


def dataset(stamps, channels, stage="qc"):
    return {
        "stage": stage,
        "tower_id": "mast",
        "filename": "synthetic.txt",
        "sha256": "test",
        "timestamps": [t.isoformat() for t in stamps],
        "start": stamps[0].isoformat(),
        "end_exclusive": (stamps[-1] + timedelta(hours=1)).isoformat(),
        "row_count": len(stamps),
        "options": {"timezone": "UTC", "interval_minutes": 60},
        "channels": channels,
    }


def ch(id_, values, height=100, quantity="speed"):
    return {
        "id": id_,
        "name": id_,
        "quantity": quantity,
        "statistic": "mean",
        "height": height,
        "unit": {"speed": "m/s", "direction": "deg", "pressure": "Pa"}[quantity],
        "arm": "N",
        "values": values,
    }


def test_qc_derived_shear_extrapolation_preserves_base_and_refuses_result_shear(tmp_path):
    store = LocalStore(tmp_path)
    stamps = [datetime(2024, 1, 1, hour=h, tzinfo=UTC) for h in range(3)]
    qc = store.put("datasets", dataset(stamps, [ch("c0", [5, 6, 7], 50), ch("c1", [10, 12, 14])]))
    options = ProcessingOptions(
        operation="extrapolation",
        dataset_id=qc["id"],
        channel_id="c1",
        qc_id=qc["id"],
        shear_channels=["c0", "c1"],
        target_height=200,
    )
    result = process(store, options)
    assert result["channels"][-1]["values"] == pytest.approx([20, 24, 28])
    assert result["transformation"]["details"]["alpha"] == pytest.approx(1)
    assert store.get("datasets", qc["id"])["channels"][1]["values"] == [10, 12, 14]
    options.qc_id = result["id"]
    with pytest.raises(CalculationError, match="质控"):
        process(store, options)


def test_c1_full_year_and_twenty_year_reference_success(tmp_path):
    store = LocalStore(tmp_path)
    first, end, observed = (
        datetime(2005, 1, 1, tzinfo=UTC),
        datetime(2025, 1, 1, tzinfo=UTC),
        datetime(2024, 1, 1, tzinfo=UTC),
    )
    stamps, xs = [], []
    stamp = first
    while stamp < end:
        stamps.append(stamp)
        xs.append(float(1 + stamp.hour % 4) if stamp >= observed else 3.0)
        stamp += timedelta(hours=1)
    reference = store.put("datasets", dataset(stamps, [ch("c0", xs)], "reference"))
    recent = [t for t in stamps if t >= observed]
    ys = [float(2 * (1 + t.hour % 4) + 1) for t in recent]
    target = store.put(
        "datasets",
        dataset(recent, [ch("c0", ys), ch("c1", [0] * len(recent), quantity="direction")]),
    )
    options = ProcessingOptions(
        operation="representative-c1",
        dataset_id=target["id"],
        channel_id="c0",
        direction_channel="c1",
        reference_id=reference["id"],
        reference_channel="c0",
        start="2024-01-01",
        end="2025-01-01",
        reference_suitability_confirmed=True,
    )
    result = process(store, options)
    expected_delta = 2 * (((len(stamps) - len(recent)) * 3 + len(recent) * 2.5) / len(stamps) - 2.5)
    assert result["channels"][-1]["values"][0] == pytest.approx(ys[0] + expected_delta)
    assert result["transformation"]["details"]["hourly_completeness"] == 1
    assert store.get("datasets", target["id"])["channels"][0]["values"][0] == 3
    options.reference_suitability_confirmed = False
    with pytest.raises(CalculationError, match="适用性"):
        process(store, options)


def test_review_does_not_apply_sea_level_pressure_bounds_to_plateau_by_default(tmp_path):
    store = LocalStore(tmp_path)
    stamps = [datetime(2024, 1, 1, h, tzinfo=UTC) for h in range(3)]
    data = store.put("datasets", dataset(stamps, [ch("c0", [80000] * 3, 10, "pressure")]))
    normal = review(store, ReviewOptions(dataset_id=data["id"]))
    flagged = review(store, ReviewOptions(dataset_id=data["id"], sea_level_pressure_confirmed=True))
    assert normal["outputs"]["qc-review"]["summary"]["total_flags"] == 0
    assert flagged["outputs"]["qc-review"]["summary"]["total_flags"] == 3
    assert store.get("datasets", data["id"])["channels"][0]["values"] == [80000] * 3
