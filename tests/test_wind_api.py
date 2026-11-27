"""Exercise real import -> parse -> source-bound calculations and immutable lineage."""

import hashlib
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from wind_platform.main import create_app
from wind_platform.services.analysis import LongTermOptions, run_long_term
from wind_platform.services.store import LocalStore


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as instance:
        yield instance


def import_csv(client, stage, content, channels=None, **options):
    upload = client.post(
        "/api/v1/files",
        data={"stage": stage, "tower_id": "mast1"},
        files={"file": ("synthetic.csv", content)},
    )
    assert upload.status_code == 200, upload.text
    file = upload.json()
    response = client.post(
        f"/api/v1/files/{file['id']}/parse",
        json={
            "timezone": "UTC",
            "delimiter": "comma",
            "channels": channels
            or [{"index": 1, "quantity": "speed", "height": 80, "unit": "m/s", "arm": "N"}],
            **options,
        },
    )
    assert response.status_code == 200, response.text
    return file, response.json()


def test_full_workflow_preserves_original_and_gives_distinct_denominators(client):
    raw = b"Date,WS80m\n2024-01-01 00:00,4\n2024-01-01 00:10,8\n"
    file, r = import_csv(client, "raw", raw)
    _, qc = import_csv(client, "qc", raw.replace(b",8", b",-9999"))
    _, result = import_csv(client, "result", raw)
    response = client.post(
        "/api/v1/analysis",
        json={
            "raw_id": r["id"],
            "qc_id": qc["id"],
            "result_id": result["id"],
            "start": "2024-01-01",
            "end": "2024-01-02",
            "observed_start": "2024-01-01T00:00",
            "observed_end": "2024-01-01T00:30",
            "density_method": "manual",
            "manual_density": 1.2,
            "aggregation": "10min",
        },
    )
    assert response.status_code == 200, response.text
    run = response.json()
    complete = run["outputs"]["completeness"]["rows"][0]
    assert complete["retention_percent"] == 50
    assert complete["annual_expected"] == 52560
    assert complete["annual_valid"] == 1
    assert complete["standard_completeness_percent"] == pytest.approx(100 / 3)
    assert run["outputs"]["monthly"]["rows"][0]["power_density"] == pytest.approx(172.8)
    assert run["outputs"]["turbulence"]["status"] == "unavailable"
    assert run["warnings"]
    local = client.app.state.wind_store
    assert local.read_original(file["sha256"]) == raw
    assert hashlib.sha256(raw).hexdigest() == file["sha256"]
    exported = client.get(f"/api/v1/runs/{run['id']}/tables/monthly.csv")
    import csv
    from io import StringIO

    assert exported.status_code == 200
    exported_row = next(csv.DictReader(StringIO(exported.text.lstrip("\ufeff"))))
    assert float(exported_row["power_density"]) == pytest.approx(172.8)
    assert client.get(f"/api/v1/runs/{run['id']}").json() == run


def test_stage_enforcement_and_timestamp_duplicates(client):
    _, raw = import_csv(client, "raw", b"Date,WS\n2024-01-01 00:00,5")
    response = client.post("/api/v1/analysis", json={"qc_id": raw["id"]})
    assert response.status_code == 422
    assert client.get("/api/v1/datasets/../../secrets").status_code == 404


def test_all_missing_wind_is_an_unavailable_output_not_a_successful_empty_chart(client):
    _, result = import_csv(client, "result", b"Date,WS\n2024-01-01 00:00,-9999")
    response = client.post(
        "/api/v1/analysis",
        json={
            "result_id": result["id"],
            "start": "2024-01-01",
            "end": "2025-01-01",
            "density_method": "manual",
            "manual_density": 1.2,
            "aggregation": "10min",
        },
    )
    assert response.status_code == 200, response.text
    monthly = response.json()["outputs"]["monthly"]
    assert monthly["status"] == "unavailable" and "没有可用风速" in monthly["reason"]


def test_correlation_matches_same_utc_instants_across_declared_timezones(client):
    y = b"Date,WS\n2024-01-01 00:00,3\n2024-01-01 00:10,5\n2024-01-01 00:20,7\n2024-01-01 00:30,9\n"
    x = b"Date,WS\n2024-01-01 08:00,1\n2024-01-01 08:10,2\n2024-01-01 08:20,3\n2024-01-01 08:30,4\n"
    _, target = import_csv(client, "qc", y)
    _, reference = import_csv(client, "reference", x, timezone="Asia/Shanghai")
    response = client.post(
        "/api/v1/correlations",
        json={
            "target_id": target["id"],
            "reference_id": reference["id"],
            "target_channel": "c0",
            "reference_channel": "c0",
            "start": "2024-01-01",
            "end": "2024-01-02",
            "timezone": "UTC",
            "sectors": 1,
            "aggregation": "native",
        },
    )
    assert response.status_code == 200, response.text
    row = response.json()["outputs"]["correlation"]["rows"][0]
    assert row["count"] == 4
    assert (row["slope"], row["intercept"], row["r"]) == pytest.approx((2, 1, 1))


def test_gap_fill_creates_new_channel_and_reconstructs_missing_time_slot(client):
    content = (
        b"Date,WS\n2024-01-01 00:00,3\n2024-01-01 00:10,5\n"
        b"2024-01-01 00:20,7\n2024-01-01 00:30,9\n2024-01-01 00:50,13\n"
    )
    _, source = import_csv(client, "qc", content)
    ref = (
        b"Date,WS\n2024-01-01 00:00,1\n2024-01-01 00:10,2\n"
        b"2024-01-01 00:20,3\n2024-01-01 00:30,4\n"
        b"2024-01-01 00:40,5\n2024-01-01 00:50,6\n"
    )
    _, reference = import_csv(client, "reference", ref)
    response = client.post(
        "/api/v1/processing",
        json={
            "operation": "gap-fill",
            "dataset_id": source["id"],
            "channel_id": "c0",
            "reference_id": reference["id"],
            "reference_channel": "c0",
        },
    )
    assert response.status_code == 200, response.text
    out = response.json()
    assert out["row_count"] == 6
    assert out["transformation"]["details"]["filled_count"] == 1
    assert out["transformation"]["details"]["post_fill_completeness"] == 1
    dataset = client.app.state.wind_store.get("datasets", out["id"])
    assert dataset["channels"][-1]["values"] == pytest.approx([3, 5, 7, 9, 11, 13])
    assert client.app.state.wind_store.get("datasets", source["id"])["row_count"] == 5


def test_long_term_leap_year_weighting_and_missing_year_lines(tmp_path):
    store = LocalStore(tmp_path)
    a, b = datetime(2020, 7, 1, tzinfo=UTC), datetime(2023, 7, 1, tzinfo=UTC)
    stamps, values = [], []
    stamp = a
    while stamp < b:
        stamps.append(stamp.isoformat())
        values.append(
            2
            if stamp < datetime(2021, 7, 1, tzinfo=UTC)
            else 4
            if stamp < datetime(2022, 7, 1, tzinfo=UTC)
            else 8
        )
        stamp += timedelta(hours=1)
    data = {
        "timestamps": stamps,
        "start": stamps[0],
        "end_exclusive": b.isoformat(),
        "options": {"timezone": "UTC", "interval_minutes": 60},
        "channels": [{"id": "c0", "quantity": "speed", "statistic": "mean", "values": values}],
        "stage": "reference",
    }
    ref = store.put("datasets", data)
    result = store.put("datasets", {**data, "stage": "result"})
    run = run_long_term(
        store,
        LongTermOptions(
            reference_id=ref["id"],
            result_id=result["id"],
            speed_channel="c0",
            start="2022-07-01",
            end="2023-07-01",
            timezone="UTC",
            windows=[4, 3, 1],
        ),
    )
    summary = run["outputs"]["reference-years"]["summary"]
    assert summary["means"][0]["mean_speed"] is None
    assert summary["means"][1]["mean_speed"] == pytest.approx(14 / 3)
    assert summary["means"][2]["mean_speed"] == 8
    assert run["outputs"]["reference-years"]["rows"][-1]["concurrent"]


def test_365_days_of_records_qualify_across_a_leap_anniversary(tmp_path):
    from wind_platform.core.calculations import CalculationError

    store = LocalStore(tmp_path)
    start = datetime(2023, 11, 18, tzinfo=UTC)
    stamps = [(start + timedelta(hours=i)).isoformat() for i in range(366 * 24)]
    reference = {
        "timestamps": stamps,
        "start": stamps[0],
        "end_exclusive": (start + timedelta(days=366)).isoformat(),
        "options": {"timezone": "UTC", "interval_minutes": 60},
        "channels": [
            {"id": "c0", "quantity": "speed", "statistic": "mean", "values": [3] * len(stamps)}
        ],
        "stage": "reference",
    }
    ref = store.put("datasets", reference)

    def result(hours):
        return store.put(
            "datasets",
            {
                **reference,
                "stage": "result",
                "timestamps": stamps[:hours],
                "end_exclusive": (start + timedelta(hours=hours)).isoformat(),
                "channels": [{**reference["channels"][0], "values": [3] * hours}],
            },
        )

    config = dict(
        reference_id=ref["id"],
        speed_channel="c0",
        start="2023-11-18",
        end="2024-11-18",
        timezone="UTC",
        windows=[1],
    )
    run = run_long_term(store, LongTermOptions(result_id=result(365 * 24)["id"], **config))
    assert run["outputs"]["reference-years"]["rows"][0]["count"] == 366 * 24
    with pytest.raises(CalculationError, match="365"):
        run_long_term(store, LongTermOptions(result_id=result(365 * 24 - 1)["id"], **config))
