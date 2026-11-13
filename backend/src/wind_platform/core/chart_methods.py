"""Explicit optional chart methods; the validated MLE implementation is retained."""

import math

import numpy as np
from scipy import optimize, special, stats

from wind_platform.core.calculations import CalculationError, numbers, weibull


def fit_weibull(speed, method="mle"):
    if method == "mle":
        return weibull(speed)
    v = numbers(speed)
    v = v[np.isfinite(v)]
    p = np.sort(v[v > 0])
    if len(p) < 3 or (v < 0).any() or np.ptp(p) < 1e-10:
        raise CalculationError("拟合需要至少3个有变化的正风速，且不含负风速。")
    if method == "least-squares":
        f = (np.arange(1, len(p) + 1) - 0.3) / (len(p) + 0.4)
        fit = stats.linregress(np.log(p), np.log(-np.log1p(-f)))
        k, c = float(fit.slope), float(np.exp(-fit.intercept / fit.slope))
    elif method == "moments":
        ratio = p.var() / p.mean() ** 2 + 1
        k = optimize.brentq(
            lambda x: np.exp(special.gammaln(1 + 2 / x) - 2 * special.gammaln(1 + 1 / x)) - ratio,
            0.1,
            1000,
        )
        c = float(p.mean() / special.gamma(1 + 1 / k))
    elif method == "energy":
        ratio = np.mean(p**3) / p.mean() ** 3
        k = optimize.brentq(
            lambda x: np.exp(special.gammaln(1 + 3 / x) - 3 * special.gammaln(1 + 1 / x)) - ratio,
            0.1,
            1000,
        )
        c = float(p.mean() / special.gamma(1 + 1 / k))
    else:
        raise CalculationError("未知Weibull拟合方法。")
    mass = len(p) / len(v)
    rows = []
    for j in range(27):
        lo = math.exp(-((max(0, j - 0.5) / c) ** k))
        hi = 0 if j == 26 else math.exp(-(((j + 0.5) / c) ** k))
        rows.append(
            {
                "bin": j,
                "fitted_frequency": (lo - hi) * mass * 100 + (100 * (1 - mass) if j == 0 else 0),
            }
        )
    return {
        "k": float(k),
        "c": c,
        "positive_count": len(p),
        "zero_fraction": 1 - mass,
        "rows": rows,
        "note": f"补充拟合方法：{method}；正风速条件拟合，零值单列。",
    }
