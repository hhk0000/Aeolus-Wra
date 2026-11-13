import numpy as np
import pytest
from scipy.stats import weibull_min
from wind_platform.core.chart_methods import fit_weibull


@pytest.mark.parametrize("method", ["mle", "least-squares", "moments", "energy"])
def test_optional_weibull_methods_recover_distribution_and_keep_probability_mass(method):
    values = weibull_min.ppf((np.arange(10000) + 0.5) / 10000, 2, scale=7)
    fit = fit_weibull(values, method)
    assert fit["k"] == pytest.approx(2, rel=0.01)
    assert fit["c"] == pytest.approx(7, rel=0.01)
    assert sum(r["fitted_frequency"] for r in fit["rows"]) == pytest.approx(100)


def test_zero_mass_is_retained_by_supplementary_fit():
    fit = fit_weibull([0, 0, 2, 4, 7, 8], "moments")
    assert fit["zero_fraction"] == pytest.approx(1 / 3)
    assert fit["rows"][0]["fitted_frequency"] >= 100 / 3
