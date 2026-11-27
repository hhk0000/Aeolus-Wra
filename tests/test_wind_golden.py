"""Independent analytic cases; these guard formulas, boundaries and source semantics."""

import math

import numpy as np
import pytest
from wind_platform.core import calculations as calc
from wind_platform.core.ingestion import ParseOptions, parse_dataset, suggest_channel
from wind_platform.services.analysis import aggregate


def test_power_uses_mean_of_cubes_and_energy_uses_actual_duration():
    # Hand calculation: .5*1.2*(4^3+8^3)/2=172.8, not .6*6^3=129.6.
    result = calc.wind_statistics([4, 8], 1.2, 60)
    assert result["mean_speed"] == 6
    assert result["power_density"] == pytest.approx(172.8)
    assert result["energy_density_wh_m2"] == pytest.approx(345.6)


def test_density_uses_pa_and_paired_period_means_with_national_273():
    assert calc.density([15], [101325]) == pytest.approx(101325 / 82656)
    # Missing temperature excludes its pressure as well.
    assert calc.density([15, None], [101325, 60000]) == pytest.approx(101325 / 82656)
    assert calc.density([15], altitude_m=1000) == pytest.approx(353.05 / 288 * math.exp(-34 / 288))
    with pytest.raises(calc.CalculationError):
        calc.density([-273], [101325])


def test_turbulence_is_mean_and_std_of_ratios_not_std_of_instrument_sd():
    result = calc.turbulence([15, 15, 15, 0], [1.5, 3, 4.5, 1])
    row = result["rows"][15]
    assert row["count"] == 3
    assert row["mean"] == pytest.approx(0.2)
    assert row["std"] == pytest.approx(0.1)
    assert row["characteristic"] == pytest.approx(0.3)
    assert row["representative"] == pytest.approx(0.328)
    assert result["excluded"] == 1
    assert calc.turbulence([15], [3])["rows"][15]["representative"] is None


def test_shear_uses_common_samples_and_can_report_negative_shear():
    result = calc.shear(
        [40, 80, 160], [[4, 4, None], [4 * 2**0.2, 4 * 2**0.2, 99], [4 * 4**0.2, 4 * 4**0.2, 99]]
    )
    assert result["count"] == 2
    assert result["alpha"] == pytest.approx(0.2)
    assert all(p["alpha"] == pytest.approx(0.2) for p in result["pairs"])
    assert calc.shear([50, 100], [[8], [4]])["alpha"] == pytest.approx(-1)


def test_north_wrap_calm_and_energy_conservation():
    assert [calc.sector_index(d) for d in [0, 360, 348.75, 11.249, 11.25]] == [0, 0, 0, 0, 1]
    result = calc.rose([0, 2, 4, None], [90, 359, 1, 180])
    assert result["paired_count"] == 3
    assert result["calm_frequency"] == pytest.approx(100 / 3)
    assert result["rows"][0]["frequency"] == pytest.approx(200 / 3)
    assert result["rows"][0]["energy_frequency"] == 100
    assert calc.circular_mean([359, 1]) == pytest.approx(0, abs=1e-10)
    assert calc.circular_mean([0, 180]) is None
    with pytest.raises(calc.CalculationError):
        calc.rose([5], [-999])


def test_centered_bins_include_boundaries_without_loss():
    result = calc.frequencies([0, 0.4999, 0.5, 1.5, 25.5, 30])
    assert [result[i]["count"] for i in [0, 1, 2, 26]] == [2, 1, 1, 2]
    assert sum(r["frequency"] for r in result) == pytest.approx(100)
    assert sum(r["energy_frequency"] for r in result) == pytest.approx(100)


def test_correlation_reports_r_and_r_squared_separately():
    fit = calc.regression([1, 2, 3, 4], [5, 7, 9, 11])
    assert (fit["slope"], fit["intercept"], fit["r"]) == pytest.approx((2, 3, 1))
    origin = calc.regression([1, 2, 3, 4], [5, 7, 9, 11], True)
    assert origin["r"] == pytest.approx(1)
    assert origin["r_squared"] < 0.8
    with pytest.raises(calc.CalculationError):
        calc.regression([1, 1, 1], [1, 2, 3])


def test_weibull_recovers_rayleigh_quantiles_with_zero_mass():
    # Rayleigh c=2,k=2 quantiles, no stochastic tolerance or random seed.
    p = (np.arange(10000) + 0.5) / 10000
    result = calc.weibull(np.concatenate([[0] * 1000, 2 * np.sqrt(-np.log1p(-p))]))
    assert result["k"] == pytest.approx(2, abs=0.001)
    assert result["c"] == pytest.approx(2, abs=0.001)
    assert result["zero_fraction"] == pytest.approx(1 / 11)
    assert sum(r["fitted_frequency"] for r in result["rows"]) == pytest.approx(100)


def test_gumbel_finite_sample_coefficients_and_return_probability():
    # 10 annual maxima 20..29: mean=24.5; sample variance=82.5/9.
    result = calc.extreme_gumbel(list(range(20, 30)))
    assert result["sample_std"] == pytest.approx(math.sqrt(82.5 / 9))
    assert result["alpha"] == pytest.approx(0.94970 / math.sqrt(82.5 / 9))
    f = math.exp(-math.exp(-result["alpha"] * (result["speed"] - result["location"])))
    assert f == pytest.approx(0.98)
    assert calc.GUMBEL_COEFFICIENTS[90][0] == 1.20073
    with pytest.raises(calc.CalculationError):
        calc.extreme_gumbel(list(range(20, 31)))


def test_short_aliases_and_exclusions_do_not_misclassify():
    assert suggest_channel("WS100m Avg m/s")["quantity"] == "speed"
    assert suggest_channel("Temperature 10m °C")["quantity"] == "temperature"
    assert suggest_channel("Data Availability %")["quantity"] == ""
    assert suggest_channel("Inner Temperature")["quantity"] == ""
    assert suggest_channel("VWindSpeed")["quantity"] == ""
    assert suggest_channel("Avg")["quantity"] != "voltage"


def parse_options(**changes):
    return ParseOptions(
        timezone="Asia/Shanghai",
        delimiter="comma",
        channels=[
            {"index": 1, "quantity": "speed", "statistic": "mean", "height": 80, "unit": "m/s"}
        ],
        **changes,
    )


def test_ingestion_normalizes_endpoint_and_rejects_duplicates_and_unknown_flags():
    data = parse_dataset(
        b"Date,WS80m\n2024-01-01 00:10,5\n2024-01-01 00:20,-9999\n",
        parse_options(timestamp_position="end"),
    )
    assert data["start"] == "2023-12-31T16:00:00+00:00"
    assert data["channels"][0]["values"] == [5, None]
    for bad in [
        b"Date,WS\n2024-01-01 00:00,5\n2024-01-01 00:00,6",
        b"Date,WS\n2024-01-01 00:00,ERROR",
    ]:
        with pytest.raises(calc.CalculationError):
            parse_dataset(bad, parse_options())


def test_hourly_aggregation_requires_all_six_values():
    from datetime import UTC, datetime, timedelta

    stamps = [datetime(2024, 1, 1, tzinfo=UTC) + timedelta(minutes=10 * i) for i in range(12)]
    _, arrays = aggregate(stamps, [np.array([1, 1, 1, 1, 1, 7, 4, 4, np.nan, 4, 4, 4])], 10)
    assert arrays[0][0] == 2
    assert np.isnan(arrays[0][1])


def test_representative_c1_conditional_curve_offsets_and_extrapolation_guard():
    # Conditional curve y=2x+1: long mean 3 vs concurrent 2 => +2m/s.
    x = [1, 2, 3, 4] * 10
    y = [2 * v + 1 for v in x]
    rows = calc.conditional_sector_offsets(y, x, [0] * 40, 3, 2)
    assert len(rows) == 1 and rows[0]["delta"] == pytest.approx(2)
    with pytest.raises(calc.CalculationError, match="外插"):
        calc.conditional_sector_offsets(y, x, [0] * 40, 5, 2)


def test_power_classes_use_published_heights_and_preserve_source_priority():
    from wind_platform.core.power_classes import power_class

    assert power_class(50, 200)["class"] == "2"
    assert power_class(100, 150)["class"] == "D-2"
    assert power_class(50, 200, "industry")["class"] == "2"
    assert power_class(110, 300)["class"] is None
    assert power_class(50, 2000)["class"] == "7"


def test_uniform_wind_profile_reports_zero_shear_without_undefined_r_squared():
    result = calc.shear([40, 80, 160], [[5, 5], [5, 5], [5, 5]])
    assert result["alpha"] == pytest.approx(0)
    assert result["r_squared"] is None
