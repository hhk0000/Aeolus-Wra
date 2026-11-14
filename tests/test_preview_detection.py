"""Preview auto-detection cases: step, separate date/time columns, timezone evidence."""

import pytest
from wind_platform.core.ingestion import preview


def detected(text: str) -> dict:
    return preview(text.encode("utf-8"))["detected"]


def test_ten_minute_step_and_default_start_position():
    meta = detected(
        "Date/Time\tWS100m\n2024-01-01 00:00\t5\n2024-01-01 00:10\t6\n2024-01-01 00:20\t7\n"
    )
    assert meta["interval_minutes"] == 10
    assert meta["timestamp_column"] == 0
    assert meta["time_column"] is None
    assert meta["timezone"] is None
    assert meta["timestamp_position"] == "start"
    assert meta["warnings"] == []


def test_hourly_step_with_separate_date_and_time_columns():
    meta = detected(
        "Date\tTime\tWS100m\n2024-01-01\t00:00\t5\n2024-01-01\t01:00\t6\n2024-01-01\t02:00\t7\n"
    )
    assert meta["interval_minutes"] == 60
    assert meta["timestamp_column"] == 0
    assert meta["time_column"] == 1


def test_chinese_date_and_time_columns_are_separated():
    meta = detected("日期\t时间\t风速100m\n2024-01-01\t00:00\t5\n2024-01-01\t00:10\t6\n")
    assert meta["interval_minutes"] == 10
    assert meta["timestamp_column"] == 0
    assert meta["time_column"] == 1


def test_timestamp_column_with_word_time_is_not_mistaken_for_hour_column():
    meta = detected("Time\tWS100m\n2024-01-01 00:00\t5\n2024-01-01 00:10\t6\n")
    assert meta["timestamp_column"] == 0
    assert meta["time_column"] is None
    assert meta["interval_minutes"] == 10


def test_explicit_utc_offset_in_timestamps_is_detected():
    meta = detected(
        "Timestamp\tWS100m\n2024-01-01T00:00:00+00:00\t5\n2024-01-01T00:10:00+00:00\t6\n"
    )
    assert meta["timezone"] == "UTC"
    assert meta["interval_minutes"] == 10


def test_explicit_utc_plus_eight_offset_is_detected_as_fixed_offset():
    meta = detected(
        "Timestamp\tWS100m\n2024-01-01T00:00:00+08:00\t5\n2024-01-01T00:10:00+08:00\t6\n"
    )
    assert meta["timezone"] == "Etc/GMT-8"
    assert meta["interval_minutes"] == 10


def test_unsupported_offset_is_reported_instead_of_raising():
    meta = detected(
        "Timestamp\tWS100m\n2024-01-01T00:00:00+05:00\t5\n2024-01-01T00:10:00+05:00\t6\n"
    )
    assert meta["timezone"] is None
    assert any("UTC+5" in note for note in meta["warnings"])


def test_mixed_aware_and_naive_timestamps_report_readable_warning():
    meta = detected(
        "Timestamp\tWS100m\n"
        "2024-01-01T00:00:00+08:00\t5\n"
        "2024-01-01 00:10:00\t6\n"
        "2024-01-01 00:20:00\t7\n"
    )
    assert meta["timezone"] is None
    assert any("部分带时区偏移" in note for note in meta["warnings"])


@pytest.mark.parametrize(
    ("preamble", "expected"),
    [
        ("Time stamps indicate the end of the time step.", "end"),
        ("时间戳表示时段终点。", "end"),
        ("Time stamps indicate the beginning of the time step.", "start"),
        ("时间戳表示时段起点。", "start"),
    ],
)
def test_timestamp_position_follows_preamble(preamble, expected):
    text = (
        f"Created by exporter\n{preamble}\n\nDate/Time\tWS100m\n"
        "2024-01-01 00:00\t5\n2024-01-01 00:10\t6\n"
    )
    assert detected(text)["timestamp_position"] == expected


@pytest.mark.parametrize(
    ("declaration", "expected"),
    [
        ("Time Zone: UTC\n", "UTC"),
        ("时区：UTC\n", "UTC"),
        ("时间基准: UTC\n", "UTC"),
        ("Time Zone: GMT+08:00\n", "Etc/GMT-8"),
        ("时间基准：UTC+8\n", "Etc/GMT-8"),
        ("时间基准：北京时间\n", "Etc/GMT-8"),
    ],
)
def test_declared_timezone_in_preamble(declaration, expected):
    text = (
        f"Created by exporter\n{declaration}\nDate/Time\tWS100m\n"
        "2024-01-01 00:00\t5\n2024-01-01 00:10\t6\n"
    )
    assert detected(text)["timezone"] == expected


def test_unparseable_timestamps_keep_manual_entry_available():
    meta = detected("Date/Time\tWS100m\nnot-a-time\t5\n2024-01-01 00:10\t6\n2024-01-01 00:20\t7\n")
    # Two valid rows one step apart still expose the step; the skipped row is reported.
    assert meta["interval_minutes"] == 10
    assert any("未能解析" in note for note in meta["warnings"])


def test_fully_unparseable_timestamps_do_not_raise():
    meta = detected("Date/Time\tWS100m\n第一行\t5\n第二行\t6\n")
    assert meta["interval_minutes"] is None
    assert meta["timezone"] is None
    assert any("未识别到可用时间戳" in note for note in meta["warnings"])


def test_non_minute_step_is_rejected_as_unknown():
    meta = detected(
        "Timestamp\tWS100m\n"
        "2024-01-01T00:00:00\t5\n"
        "2024-01-01T00:00:30\t6\n"
        "2024-01-01T00:01:00\t7\n"
    )
    assert meta["interval_minutes"] is None


@pytest.mark.parametrize("offset", ["+08:30", "-00:30", "+00:30", "+05:45", "+08:60"])
def test_timezone_declaration_must_not_discard_offset_minutes(offset):
    meta = detected(
        f"Time Zone: UTC{offset}\nDate/Time\tWS100m\n2024-01-01 00:00\t5\n2024-01-01 00:10\t6\n"
    )
    assert meta["timezone"] is None
    assert meta["warnings"]
