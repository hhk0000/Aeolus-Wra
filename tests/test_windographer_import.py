"""Synthetic export-format cases, not copied engineering observations."""

import pytest
from pydantic import ValidationError
from wind_platform.core.calculations import CalculationError
from wind_platform.core.ingestion import (
    ChannelMapping,
    ParseOptions,
    decode_text,
    parse_dataset,
    preview,
    suggest_channel,
)


def options(**changes):
    return ParseOptions(
        timezone="Asia/Shanghai",
        channels=[{"index": 1, "quantity": "speed", "height": 100, "unit": "m/s"}],
        **changes,
    )


def test_trailing_empty_header_is_not_a_channel_and_named_missing_value_is_retained():
    text = b"Date/Time\tWind speed 100m\t\n2024-01-01 00:00\t5\n2024-01-01 00:10\t\n"
    meta = preview(text)
    assert meta["headers"] == ["Date/Time", "Wind speed 100m"]
    assert len(meta["suggestions"]) == 2
    assert meta["sample_rows"][1] == ["2024-01-01 00:10", ""]
    data = parse_dataset(text, options())
    assert data["channels"][0]["values"] == [5, None]


def test_exporter_empty_record_tail_can_match_empty_header_tail():
    text = b"Date/Time\tWS100m\t\n2024-01-01 00:00\t5\t\n"
    assert parse_dataset(text, options())["row_count"] == 1


@pytest.mark.parametrize(
    "record",
    [b"2024-01-01 00:00\t5\t99", b"2024-01-01 00:00", b"2024-01-01 00:00\t5\t\t"],
)
def test_header_tail_does_not_hide_extra_values_or_missing_named_columns(record):
    with pytest.raises(CalculationError, match="列"):
        parse_dataset(b"Date/Time\tWS100m\t\n" + record, options())


def test_windographer_channel_suggestions_keep_statistics_and_arm_separate():
    speed = suggest_channel("Ch1_Anem_100.00m_SSW_Avg_m/s [m/s]")
    sd = suggest_channel("Ch1_Anem_100.00m_SSW_SD_m/s [m/s]")
    direction = suggest_channel("Ch13_Vane_100.00m_N_Avg_Deg [°] [°]")
    temperature = suggest_channel("Ch16_Analog_10.00m_N_Avg_C [°C]")
    pressure = suggest_channel("Ch17_Analog_8.00m_N_Avg_kPa [kPa]")
    synthesized = suggest_channel("Speed 115 m Synthesized SD [m/s]")
    assert (speed["quantity"], speed["statistic"], speed["height"], speed["arm"]) == (
        "speed",
        "mean",
        100,
        "SSW",
    )
    assert (sd["quantity"], sd["statistic"], sd["arm"]) == ("speed", "sd", "SSW")
    assert (direction["quantity"], direction["unit"], direction["arm"]) == ("direction", "deg", "N")
    assert (temperature["quantity"], temperature["unit"]) == ("temperature", "C")
    assert (pressure["quantity"], pressure["unit"], pressure["height"]) == ("pressure", "kPa", 8)
    assert (
        synthesized["quantity"],
        synthesized["statistic"],
        synthesized["height"],
        synthesized["arm"],
    ) == ("speed", "sd", 115, "")
    assert suggest_channel("Ch1_Anem_100.00m_SSW_Gust_m/s [°]")["quantity"] == ""
    assert suggest_channel("Ch13_Vane_100.00m_N_GustDir_Deg")["quantity"] == ""


def test_only_non_wind_channels_allow_zero_installation_height():
    mapping = ChannelMapping(index=1, quantity="pressure", height=0, unit="kPa")
    assert mapping.height == 0
    for quantity, unit in [("speed", "m/s"), ("direction", "deg")]:
        with pytest.raises(ValidationError):
            ChannelMapping(index=1, quantity=quantity, height=0, unit=unit)


def test_signed_windographer_mixed_units_are_recovered_without_general_ansi_guessing():
    text = (
        b"Created 2026/01/01 00:00 by Windographer 4.0.2\n\n"
        b"Date/Time\tDirection_100m [\xb0]\tTemperature_2m ["
        + "℃".encode()
        + b"] [\xb0C]\tUnknown_Gust [\xa3\xbf]\t\n"
        b"2024-01-01 00:00\t90\t15\t\n"
    )
    decoded, encoding = decode_text(text)
    assert "[°]" in decoded and "[℃] [°C]" in decoded
    assert "[？]" in decoded  # Other legacy bytes use GB18030, not guessed cp1252.
    assert encoding == "Windographer mixed units (UTF-8/GB18030)"
    ordinary = "Date/Time\t气温10m [℃]\n2024-01-01 00:00\t15\n".encode("gb18030")
    assert decode_text(ordinary) == (ordinary.decode("gb18030"), "gb18030")
    unsigned = b"Date/Time\tDirection_100m [\xb0]\n2024-01-01 00:00\t90\n"
    assert decode_text(unsigned)[1] == "gb18030"


def test_fixed_utc_plus_eight_preserves_hourly_grid_across_historical_dst_transition():
    # These synthetic clock labels straddle China's historical DST start. A
    # fixed-offset export uses each hour exactly once; do not reinterpret it as
    # the historical Asia/Shanghai wall clock, nor silently change that option.
    content = b"Date/Time\tWS100m\n1990-04-15 01:00\t4\n1990-04-15 02:00\t5\n1990-04-15 03:00\t6\n"
    config = ParseOptions(
        timezone="Etc/GMT-8",
        interval_minutes=60,
        channels=[{"index": 1, "quantity": "speed", "height": 100, "unit": "m/s"}],
    )
    data = parse_dataset(content, config)
    assert data["timestamps"] == [
        "1990-04-14T17:00:00+00:00",
        "1990-04-14T18:00:00+00:00",
        "1990-04-14T19:00:00+00:00",
    ]
    assert data["options"]["timezone"] == "Etc/GMT-8"
    with pytest.raises(CalculationError, match="重复"):
        parse_dataset(content, config.model_copy(update={"timezone": "Asia/Shanghai"}))
