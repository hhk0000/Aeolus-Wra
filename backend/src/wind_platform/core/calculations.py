"""Auditable, pure wind-resource mathematics. All inputs use canonical SI units."""

import math

import numpy as np
from scipy import optimize, stats


class CalculationError(ValueError):
    """Input or method applicability failure, suitable for an engineering user."""


def numbers(values) -> np.ndarray:
    return np.array([np.nan if x is None else float(x) for x in values], dtype=float)


def finite_mean(values) -> float | None:
    values = np.asarray(values, dtype=float)
    valid = values[np.isfinite(values)]
    return float(np.mean(valid)) if len(valid) else None


def density(temperature_c, pressure_pa=None, altitude_m=None, kelvin_offset=273.0) -> float:
    """GB18710 B2/B3: density of period means, not mean instantaneous density."""
    temp = numbers(temperature_c)
    if pressure_pa is not None:
        pressure = numbers(pressure_pa)
        if len(temp) != len(pressure):
            raise CalculationError("气温气压样本数必须相同。")
        mask = np.isfinite(temp) & np.isfinite(pressure)
        if not mask.any():
            raise CalculationError("没有同期有效气温和气压。")
        t, p = float(temp[mask].mean()) + kelvin_offset, float(pressure[mask].mean())
        if t <= 0 or p <= 0:
            raise CalculationError("绝对温度和气压必须为正。")
        return p / (287 * t)
    if altitude_m is None or not np.isfinite(altitude_m):
        raise CalculationError("没有实测气压时必须提供温度传感器处海拔。")
    t_mean = finite_mean(temp)
    if t_mean is None or (t := t_mean + kelvin_offset) <= 0:
        raise CalculationError("缺少有效气温或绝对温度非正。")
    return (353.05 / t) * math.exp(-0.034 * altitude_m / t)


def wind_statistics(speed, rho: float, interval_minutes: float) -> dict:
    v = numbers(speed)
    v = v[np.isfinite(v)]
    if rho <= 0 or not np.isfinite(rho) or interval_minutes <= 0:
        raise CalculationError("密度和时间步长必须为正。")
    if not len(v):
        raise CalculationError("没有有效风速。")
    if (v < 0).any():
        raise CalculationError("存在负风速，请先核对缺测标记与质量控制。")
    power = 0.5 * rho * v**3
    return {
        "count": len(v),
        "mean_speed": float(v.mean()),
        "power_density": float(power.mean()),
        "energy_density_wh_m2": float(power.sum() * interval_minutes / 60),
        "effective_hours_3_25": float(((v >= 3) & (v <= 25)).sum() * interval_minutes / 60),
        "maximum": float(v.max()),
        "minimum": float(v.min()),
    }


def speed_bin(value: float) -> int:
    """Centered 1m/s intervals, half-open [j-.5,j+.5), >=25.5 overflow."""
    return min(26, int(math.floor(value + 0.5)))


def frequencies(speed) -> list[dict]:
    v = numbers(speed)
    v = v[np.isfinite(v)]
    if not len(v) or (v < 0).any():
        raise CalculationError("频率统计需要非负有效风速。")
    energy = float(np.sum(v**3))
    bins = np.minimum(26, np.floor(v + 0.5)).astype(int)
    return [
        {
            "bin": j,
            "label": "[0,0.5)" if j == 0 else ">=25.5" if j == 26 else f"[{j - 0.5:g},{j + 0.5:g})",
            "count": int((bins == j).sum()),
            "frequency": float((bins == j).sum() / len(v) * 100),
            "energy_frequency": float(np.sum(v[bins == j] ** 3) / energy * 100) if energy else None,
        }
        for j in range(27)
    ]


COMPASS = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
]


def sector_index(degrees: float, sectors: int = 16) -> int:
    if not math.isfinite(degrees) or not 0 <= degrees <= 360 or sectors < 1:
        raise CalculationError("风向需在0至360度内，扇区数须为正。")
    width = 360 / sectors
    return int(math.floor(((degrees % 360) + width / 2) / width)) % sectors


def circular_mean(degrees) -> float | None:
    arr = numbers(degrees)
    arr = arr[np.isfinite(arr)]
    if not len(arr):
        return None
    if ((arr < 0) | (arr > 360)).any():
        raise CalculationError("风向超出0至360度，不能自动折返异常值。")
    x, y = np.cos(np.radians(arr)).mean(), np.sin(np.radians(arr)).mean()
    if math.hypot(x, y) < 1e-10:
        return None
    angle = float(math.degrees(math.atan2(y, x)) % 360)
    return 0.0 if math.isclose(angle, 360, abs_tol=1e-10) else angle


def rose(speed, direction, sectors=16, calm_threshold=0.5) -> dict:
    v, d = numbers(speed), numbers(direction)
    if len(v) != len(d):
        raise CalculationError("玫瑰图需要同期风速、风向。")
    if (v[np.isfinite(v)] < 0).any():
        raise CalculationError("玫瑰图存在负风速。")
    valid = np.isfinite(v) & np.isfinite(d)
    if ((d[valid] < 0) | (d[valid] > 360)).any():
        raise CalculationError("风向不在0至360度内，请复核。")
    v, d = v[valid], d[valid]
    n = len(v)
    if not n:
        raise CalculationError("没有同期有效风速风向。")
    calm = v < calm_threshold
    indices = np.array([sector_index(x, sectors) for x in d])
    energy = float(np.sum(v**3))
    rows = []
    for j in range(sectors):
        mask = (indices == j) & ~calm
        rows.append(
            {
                "sector": j,
                "label": COMPASS[j] if sectors == 16 else f"{j * 360 / sectors:g}°",
                "degrees": j * 360 / sectors,
                "count": int(mask.sum()),
                "frequency": float(mask.sum() / n * 100),
                "energy_frequency": float(np.sum(v[mask] ** 3) / energy * 100) if energy else None,
            }
        )
    return {
        "rows": rows,
        "paired_count": n,
        "unpaired_count": len(valid) - n,
        "calm_frequency": float(calm.sum() / n * 100),
        "calm_energy_frequency": float(np.sum(v[calm] ** 3) / energy * 100) if energy else None,
        "calm_threshold": calm_threshold,
        "note": "扇区频率加静风频率为100%；风向平均使用圆周均值。",
    }


def turbulence(speed, instrument_sd, ddof=1, minimum_samples=20) -> dict:
    v, sd = numbers(speed), numbers(instrument_sd)
    if len(v) != len(sd):
        raise CalculationError("湍流风速和仪器标准差必须同期。")
    valid = np.isfinite(v) & np.isfinite(sd) & (v > 0) & (sd >= 0)
    v, sd = v[valid], sd[valid]
    if not len(v):
        raise CalculationError("没有正风速与非负仪器十分钟标准差配对。")
    if v.max() > 150:
        raise CalculationError("风速超过本工具150m/s数值适用上限，请核对标记或开展专项分析。")
    ti = sd / v
    bins = np.floor(v + 0.5).astype(int)
    rows = []
    for j in range(int(bins.max()) + 1):
        values = ti[bins == j]
        mean = finite_mean(values)
        std = float(values.std(ddof=ddof)) if len(values) > ddof else None
        rows.append(
            {
                "bin": j,
                "count": len(values),
                "mean": mean,
                "std": std,
                "characteristic": mean + std if std is not None else None,
                "representative": mean + 1.28 * std if std is not None else None,
                "sufficient_samples": len(values) >= minimum_samples,
            }
        )
    return {
        "count": len(v),
        "excluded": len(valid) - len(v),
        "ddof": ddof,
        "rows": rows,
        "mean_ti": float(ti.mean()),
        "minimum_samples": minimum_samples,
        "note": "NB/T31147：先计算每条I，再统计风速箱内I的标准差；低样本箱仅作提示。",
    }


def conditional_sector_offsets(
    target, reference, directions, long_mean, concurrent_mean, resolution=0.1, minimum_samples=30
):
    """GB37523 C.1 conditional means, with explicit piecewise-linear curve convention."""
    y, x, d = numbers(target), numbers(reference), numbers(directions)
    if len(y) != len(x) or len(y) != len(d) or resolution <= 0:
        raise CalculationError("象限订正输入必须同期，风速组距须为正。")
    valid = np.isfinite(y) & np.isfinite(x) & np.isfinite(d)
    y, x, d = y[valid], x[valid], d[valid]
    sectors = np.array([sector_index(v) for v in d])
    rows = []
    for sector in sorted(set(sectors)):
        mask = sectors == sector
        xx, yy = x[mask], y[mask]
        if len(xx) < minimum_samples:
            raise CalculationError(
                f"{COMPASS[sector]}扇区同期样本不足{minimum_samples}对，不能自动确定订正曲线。"
            )
        groups = np.floor(yy / resolution + 0.5).astype(int)
        # Each point: conditional mean of reference x for a mast-speed group, actual mast y mean.
        points = sorted(
            (float(xx[groups == group].mean()), float(yy[groups == group].mean()))
            for group in set(groups)
        )
        if len(points) < 3 or any(
            b[0] - a[0] <= 1e-10 for a, b in zip(points, points[1:], strict=False)
        ):
            raise CalculationError(f"{COMPASS[sector]}扇区至少需3个不同参照均值的条件分组。")
        xp, yp = np.array(points).T
        if (
            not xp.min()
            <= min(long_mean, concurrent_mean)
            <= max(long_mean, concurrent_mean)
            <= xp.max()
        ):
            raise CalculationError(f"{COMPASS[sector]}订正均值超出条件曲线范围，不进行无依据外插。")
        delta = float(np.interp(long_mean, xp, yp) - np.interp(concurrent_mean, xp, yp))
        rows.append(
            {
                "sector": int(sector),
                "label": COMPASS[sector],
                "count": len(xx),
                "delta": delta,
                "curve": [[a, b] for a, b in points],
                "resolution": resolution,
                "curve_policy": "conditional-means-piecewise-linear",
            }
        )
    if not rows:
        raise CalculationError("没有可用于象限订正的同期有效样本。")
    return rows


def shear(heights, columns) -> dict:
    h = numbers(heights)
    values = np.array([numbers(c) for c in columns])
    if len(h) < 2 or len(h) != len(values) or (h <= 0).any() or len(set(h)) != len(h):
        raise CalculationError("切变至少需要两个不同的正高度。")
    valid = np.all(np.isfinite(values) & (values > 0), axis=0)
    if not valid.any():
        raise CalculationError("没有各选定高度共同有效且大于零的风速。")
    means = values[:, valid].mean(axis=1)
    fit = stats.linregress(np.log(h), np.log(means))
    pairs = [
        {
            "low": float(h[i]),
            "high": float(h[j]),
            "alpha": float(np.log(means[j] / means[i]) / np.log(h[j] / h[i])),
            "count": int(valid.sum()),
        }
        for i in range(len(h))
        for j in range(i + 1, len(h))
    ]
    return {
        "alpha": float(fit.slope),
        "intercept": float(fit.intercept),
        "r_squared": None if np.ptp(np.log(means)) <= 1e-14 else float(fit.rvalue**2),
        "count": int(valid.sum()),
        "pairs": pairs,
        "profile": [
            {"height": float(z), "mean_speed": float(v)} for z, v in zip(h, means, strict=True)
        ],
    }


def regression(x, y, through_origin=False) -> dict:
    x, y = numbers(x), numbers(y)
    if len(x) != len(y):
        raise CalculationError("回归输入必须为同期样本。")
    valid = np.isfinite(x) & np.isfinite(y)
    x, y = x[valid], y[valid]
    if len(x) < 3 or np.ptp(x) <= 1e-12 or np.ptp(y) <= 1e-12:
        raise CalculationError("至少需要3对且两侧均有变化的同期样本。")
    pearson = stats.pearsonr(x, y)
    fit = stats.linregress(x, y)
    slope = float(np.dot(x, y) / np.dot(x, x)) if through_origin else float(fit.slope)
    intercept = 0.0 if through_origin else float(fit.intercept)
    prediction = slope * x + intercept
    r2 = 1 - np.sum((y - prediction) ** 2) / np.sum((y - y.mean()) ** 2)
    return {
        "count": len(x),
        "slope": slope,
        "intercept": intercept,
        "r": float(pearson.statistic),
        "p_value": float(pearson.pvalue),
        "r_squared": float(r2),
        "through_origin": through_origin,
        "x_min": float(x.min()),
        "x_max": float(x.max()),
        "rmse": float(np.sqrt(np.mean((y - prediction) ** 2))),
    }


def weibull(speed) -> dict:
    values = numbers(speed)
    values = values[np.isfinite(values)]
    if not len(values) or (values < 0).any():
        raise CalculationError("Weibull需要非负风速。")
    positive = values[values > 0]
    if len(positive) < 3 or np.ptp(positive) < 1e-10:
        raise CalculationError("Weibull至少需3个有变化的正风速样本。")
    logs = np.log(positive)

    def equation(k):
        weights = np.exp(k * (logs - logs.max()))
        return 1 / k + logs.mean() - np.dot(weights, logs) / weights.sum()

    if equation(1000) >= 0:
        raise CalculationError("数据变异过小，Weibull形状参数超出数值范围。")
    k = optimize.brentq(equation, 0.01, 1000, xtol=1e-10)
    c = float(np.exp(logs.max() + np.log(np.exp(k * (logs - logs.max())).mean()) / k))
    mass = len(positive) / len(values)
    rows = []
    for j in range(27):
        low, high = max(0, j - 0.5), j + 0.5
        lo = 1 - math.exp(-((low / c) ** k))
        hi = 1 if j == 26 else 1 - math.exp(-((high / c) ** k))
        rows.append(
            {
                "bin": j,
                "fitted_frequency": float((hi - lo) * mass * 100)
                + (100 * (1 - mass) if j == 0 else 0),
            }
        )
    return {
        "k": float(k),
        "c": c,
        "positive_count": len(positive),
        "zero_fraction": 1 - mass,
        "rows": rows,
        "note": (
            "企业补充方法：二参数MLE；正风速条件拟合，零值质量单列；拟合成功不表示单峰假设成立。"
        ),
    }


# Visually checked against the user's NB/T31147 PDF, physical p38 / printed p29.
GUMBEL_COEFFICIENTS = {
    10: (0.94970, 0.49520),
    15: (1.02057, 0.51820),
    20: (1.06283, 0.52355),
    25: (1.09145, 0.53086),
    30: (1.11238, 0.53622),
    35: (1.12847, 0.54034),
    40: (1.14132, 0.54362),
    45: (1.15185, 0.54630),
    50: (1.16066, 0.54853),
    60: (1.17465, 0.55208),
    70: (1.18536, 0.55477),
    80: (1.19385, 0.55688),
    90: (1.20073, 0.55860),
    100: (1.20649, 0.56002),
    250: (1.24292, 0.56878),
    500: (1.25880, 0.57240),
    1000: (1.26851, 0.57450),
    100000: (1.28255, 0.57722),
}


def extreme_gumbel(annual_maxima, return_period=50, interpolate=False) -> dict:
    v = numbers(annual_maxima)
    if not np.isfinite(v).all() or (v <= 0).any() or len(v) < 10 or return_period <= 1:
        raise CalculationError("需至少10个连续年度有效最大10min风速，重现期须大于1年。")
    n, std = len(v), float(v.std(ddof=1))
    if std == 0:
        raise CalculationError("年最大风速无变化，不能拟合极值I型分布。")
    if n in GUMBEL_COEFFICIENTS:
        c1, c2 = GUMBEL_COEFFICIENTS[n]
        policy = "exact-table"
    elif interpolate and n < max(GUMBEL_COEFFICIENTS):
        keys = sorted(GUMBEL_COEFFICIENTS)
        c1 = float(np.interp(n, keys, [GUMBEL_COEFFICIENTS[k][0] for k in keys]))
        c2 = float(np.interp(n, keys, [GUMBEL_COEFFICIENTS[k][1] for k in keys]))
        policy = "linear-interpolation-implementation-choice"
    else:
        raise CalculationError("样本数不在NB附录D系数表中；需明确选用线性插值约定后计算。")
    alpha = c1 / std
    location = float(v.mean()) - c2 / alpha
    value = location - math.log(-math.log(1 - 1 / return_period)) / alpha
    return {
        "count": n,
        "mean": float(v.mean()),
        "sample_std": std,
        "c1": c1,
        "c2": c2,
        "alpha": alpha,
        "location": location,
        "return_period": return_period,
        "speed": value,
        "coefficient_policy": policy,
        "note": "站点原高度、原密度下最大10min风速；不是3s极大风速，也不是轮毂标准密度换算结果。",
    }
