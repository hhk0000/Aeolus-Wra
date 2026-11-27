"""Single-grid-point preliminary extreme wind methods."""

import re
from calendar import isleap
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from math import isfinite, log, log1p, sqrt
from statistics import mean, stdev

from wind_platform.core.calculations import CalculationError
from wind_platform.core.ingestion import decode_text, split_line

STANDARD_DENSITY = 1.225
DEFAULT_MULTIPLIER = 5.0
WIND_CLASS_REFERENCE_SPEEDS = (("III", 37.5), ("II", 42.5), ("I", 50.0))


def reference_wind_class(standard_speed):
    """Preliminary wind-speed screening against GB 51096–2015 Table 3.2.12."""
    if standard_speed is None:
        return None
    return next(
        (
            wind_class
            for wind_class, limit in WIND_CLASS_REFERENCE_SPEEDS
            if standard_speed <= limit
        ),
        None,
    )


def valid_pressure(value):
    return isfinite(value) and value > 0 and isfinite(1600 * value)


def pressure_stations(raw):
    content, _ = decode_text(raw)
    lines = [(i, line.strip()) for i, line in enumerate(content.splitlines(), 1) if line.strip()]
    if not lines:
        raise CalculationError("风压库没有站点。")
    first = lines[0][1]
    delimiter = "tab" if "\t" in first else "comma" if "," in first else "space"
    stations = []
    for number, line in lines:
        columns = split_line(line, delimiter)
        if delimiter == "space" and len(columns) > 4:
            columns = [" ".join(columns[:-3]), *columns[-3:]]
        try:
            name, longitude, latitude, pressure = (value.strip() for value in columns)
            if number == lines[0][0] and re.fullmatch(
                r"地点|站点(?:名称)?|地名|location|station(?: name)?", name, re.IGNORECASE
            ):
                if re.match(r"纬度|latitude|lat\b", longitude, re.IGNORECASE):
                    raise CalculationError("风压库第二列须为经度，第三列须为纬度。")
                continue
            lon, lat, value = float(longitude), float(latitude), float(pressure)
            if not name or not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError
            if not valid_pressure(value):
                raise ValueError
        except ValueError as exc:
            raise CalculationError(
                f"风压库第 {number} 行无效，须依次填写地点、经度、纬度、50年基本风压（kN/m²）。"
            ) from exc
        stations.append({"name": name, "lon": lon, "lat": lat, "pressure": value})
    if not stations:
        raise CalculationError("风压库没有站点。")
    return stations


def pressure_site_speed(standard_speed, density):
    return standard_speed * sqrt(STANDARD_DENSITY / density) if standard_speed is not None else None


def five_day_thunderstorm(records, year, height, c1, c2):
    """Apply the report's equations (1-7) and (1-8) to 73 five-day maxima."""
    start = datetime(year, 1, 1)
    sample_size = 73
    steps_per_block = 5 * 24 * 6
    step = timedelta(minutes=10)
    maxima = []
    for block in range(sample_size):
        speeds = []
        for index in range(steps_per_block):
            timestamp = start + (block * steps_per_block + index) * step
            sample = records.get(timestamp)
            if sample is None or not isfinite(sample[0]):
                raise CalculationError(
                    f"五日雷暴法需要连续有效的 10 分钟风速，{timestamp:%Y-%m-%d %H:%M} 缺测。"
                )
            speeds.append(sample[0])
        maxima.append(max(speeds))
    if isleap(year):
        # Equation (1-7) uses 73 groups. Require the full leap year's coverage.
        for index in range(steps_per_block // 5):
            timestamp = start + timedelta(days=365) + index * step
            sample = records.get(timestamp)
            if sample is None or not isfinite(sample[0]):
                raise CalculationError(
                    f"五日雷暴法需要完整自然年资料，{timestamp:%Y-%m-%d %H:%M} 缺测。"
                )
    mu, sigma = mean(maxima), stdev(maxima)
    if sigma <= 0:
        raise CalculationError("五日雷暴法的五日最大风速样本标准差为零，无法拟合。")
    alpha = c1 / sigma
    if not isfinite(alpha) or alpha <= 0:
        raise CalculationError("五日雷暴法的 C₁ 过大或过小，请核对系数。")
    u = mu - c2 / alpha
    site_speed = u - log(-log1p(-1 / (50 * sample_size))) / alpha
    if not isfinite(site_speed) or site_speed <= 0:
        raise CalculationError("五日雷暴法未得到有效风速，请核对样本与系数。")
    return {
        "year": year,
        "height": float(height),
        "sample_size": sample_size,
        "c1": c1,
        "c2": c2,
        "mean": mu,
        "stdev": sigma,
        "alpha": alpha,
        "u": u,
        "site_speed": site_speed,
    }


def extreme_wind(
    mean_speed, density, multiplier=DEFAULT_MULTIPLIER, station=None, thunderstorm=None
):
    mean_speed_used = float(Decimal(str(mean_speed)).quantize(Decimal("0.01"), ROUND_HALF_UP))
    site_speed = mean_speed_used * multiplier
    multiplier_standard = site_speed * sqrt(density / STANDARD_DENSITY)
    if not isfinite(site_speed) or not isfinite(multiplier_standard):
        raise CalculationError("风速倍数过大，无法计算有效的风速。")
    pressure_standard = sqrt(1600 * station["pressure"]) if station else None
    pressure_site = pressure_site_speed(pressure_standard, density)
    candidates = {"风压法": pressure_site, "平均风速倍数法": site_speed}
    standard_candidates = {"风压法": pressure_standard, "平均风速倍数法": multiplier_standard}
    if thunderstorm is not None:
        candidates["五日雷暴法"] = thunderstorm["site_speed"]
        standard_speed = thunderstorm["site_speed"] * sqrt(density / STANDARD_DENSITY)
        if not isfinite(standard_speed):
            raise CalculationError("五日雷暴法折算后的风速超出有效范围。")
        thunderstorm = {**thunderstorm, "standard_speed": standard_speed}
        standard_candidates["五日雷暴法"] = standard_speed
    adopted_method = max(candidates, key=candidates.get) if station else None
    adopted_site = candidates[adopted_method] if adopted_method else None
    adopted = standard_candidates[adopted_method] if adopted_method else None
    return {
        "station": station,
        "mean_speed": mean_speed,
        "mean_speed_used": mean_speed_used,
        "density": density,
        "multiplier": multiplier,
        "site_speed": site_speed,
        "multiplier_standard": multiplier_standard,
        "pressure_standard": pressure_standard,
        "pressure_site": pressure_site,
        "thunderstorm": thunderstorm,
        "adopted_method": adopted_method,
        "adopted_site": adopted_site,
        "adopted": adopted,
        "wind_speed_class": reference_wind_class(adopted),
    }
