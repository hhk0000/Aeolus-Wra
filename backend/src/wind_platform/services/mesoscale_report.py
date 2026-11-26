"""Single-point mesoscale statistics and in-place v1 Word bindings."""

import math
import re
from copy import deepcopy
from datetime import datetime
from io import BytesIO
from itertools import pairwise

import numpy as np
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Emu, RGBColor
from docx.text.run import Run
from PIL import Image, ImageDraw, ImageFont

from wind_platform.core.calculations import (
    COMPASS,
    CalculationError,
    density_at_height,
    frequencies,
    rose,
    wind_statistics,
)
from wind_platform.core.chart_methods import fit_weibull
from wind_platform.core.ingestion import decode_text, preview, split_line
from wind_platform.services import approved_assessment_template
from wind_platform.services.assessment_extreme import (
    DEFAULT_MULTIPLIER,
    extreme_wind,
    five_day_thunderstorm,
)
from wind_platform.services.assessment_power_grade import classify_power_density
from wind_platform.services.mesoscale_word_charts import formal_figure

DENSITY_NAME = r"空气密度|(?:air[ _-]*)?density(?![a-z])|rho(?![a-z])|ρ"
DENSITY_UNIT = r"kg\s*(?:/\s*m\s*\^?[3³]|[· ]\s*m\s*(?:\^?-3|⁻³))"
MEASUREMENT_HEIGHT = re.compile(r"(?<![\d.])(\d+(?:\.\d+)?)\s*m(?![/A-Za-z\d²³])", re.I)
WEIBULL_METHOD_LABELS = {
    "mle": "二参数最大似然法（MLE）",
    "least-squares": "累计概率线性最小二乘",
    "moments": "矩估计",
    "energy": "均速与能量匹配",
}


def density_metadata(preamble):
    values = re.findall(
        rf"^\s*(?:{DENSITY_NAME})(?:\s*[（(\[]\s*{DENSITY_UNIT}\s*[）)\]])?"
        rf"\s*[:=：]\s*([0-9]+(?:\.[0-9]+)?)(?:\s*{DENSITY_UNIT})?\s*$",
        preamble,
        re.I | re.M,
    )
    return float(values[0]) if len(values) == 1 and 0 < float(values[0]) < 3 else None


def hourly_records(raw):
    height, records, _, _, _ = _read_hourly(raw)
    return height, records


def _read_hourly(raw, source_details=False, speed_only=False):
    detected = preview(raw)
    ti = detected["detected"]["timestamp_column"]
    if detected["detected"]["time_column"] is not None:
        raise CalculationError("中尺度 TXT 须使用单列日期时间。")
    text, _ = decode_text(raw)
    header_line = detected["header_line"]
    delimiter = detected["delimiter"]
    lines = text.splitlines()
    data_lines = lines[header_line:]
    columns = {}
    for quantity in ("speed",) if speed_only else ("speed", "direction"):
        candidates = [
            channel
            for channel in detected["suggestions"]
            if channel["quantity"] == quantity
            and channel["statistic"] == "mean"
            and channel["height"] is not None
            and not channel["ambiguous"]
            and channel["index"] != ti
        ]
        if quantity == "direction" and "speed" in columns:
            has_directions = bool(candidates)
            candidates = [c for c in candidates if c["height"] == columns["speed"]["height"]]
            if has_directions and not candidates:
                raise CalculationError("风速与风向高度不同，最高风速层须有同高风向。")
        elif candidates:
            heights = {channel["height"] for channel in candidates}
            highest = max(heights)
            if len(heights) > 1:
                highest_recorded = None
                for line in data_lines:
                    row = split_line(line, delimiter)
                    for channel in candidates:
                        if highest_recorded is not None and channel["height"] <= highest_recorded:
                            continue
                        try:
                            value = float(row[channel["index"]])
                        except (IndexError, ValueError):
                            continue
                        if math.isfinite(value) and value >= 0:
                            highest_recorded = channel["height"]
                    if highest_recorded == highest:
                        break
                if highest_recorded is not None:
                    highest = highest_recorded
            candidates = [c for c in candidates if c["height"] == highest]
        if len(candidates) != 1:
            raise CalculationError(
                "须在最高风速层识别到唯一的一列平均风速和同高风向。"
                "支持 Speed_100m / Direction_100m 或 Anem125m / Vane125m 等表头。"
            )
        columns[quantity] = candidates[0]
    speed = columns["speed"]
    height = speed["height"]
    vi = speed["index"]
    di = None if speed_only else columns["direction"]["index"]
    if not re.search(r"\bm\s*/\s*s\b", detected["headers"][vi], re.I) or (
        di is not None and not re.search(r"°|\bdeg\b", detected["headers"][di], re.I)
    ):
        raise CalculationError("平均风速须为 m/s，风向须为度（° 或 Deg）。")
    preamble = "\n".join(lines[: header_line - 1]) if source_details else ""
    density_columns = (
        [
            i
            for i, label in enumerate(detected["headers"])
            if re.match(DENSITY_NAME, label.strip(), re.I) and re.search(DENSITY_UNIT, label, re.I)
        ]
        if source_details
        else []
    )
    at_layer, untagged = [], []
    for index in density_columns:
        layer = MEASUREMENT_HEIGHT.search(detected["headers"][index])
        if layer and float(layer[1]) == height:
            at_layer.append(index)
        elif not layer:
            untagged.append(index)
    density_columns = at_layer or untagged
    density_index = density_columns[0] if len(density_columns) == 1 else None
    temperatures = {}
    temperature_column = None
    temperature_kelvin = False
    if source_details:
        candidates = [
            c
            for c in detected["suggestions"]
            if c["quantity"] == "temperature"
            and c["statistic"] == "mean"
            and not c["ambiguous"]
            and re.search(
                r"(?:°|º|�)\s*[CK]\b|℃|(?:\[|\()\s*[CK]\s*(?:\]|\))|(?<=[_\s])[CK]$",
                detected["headers"][c["index"]],
                re.I,
            )
        ]
        preferred = [c for c in candidates if c["height"] == height] or candidates
        if len(preferred) == 1:
            temperature_column = preferred[0]["index"]
            temperature_kelvin = preferred[0]["unit"] == "K"
    densities = {}
    records = {}
    for n, line in enumerate(data_lines, header_line + 1):
        if not line.strip():
            continue
        try:
            row = split_line(line, delimiter)
            dt = datetime.fromisoformat(row[ti].strip().replace("/", "-"))
            if dt in records or dt.minute % 10 or dt.second or dt.microsecond or dt.tzinfo:
                raise ValueError()
            v = float(row[vi]) if row[vi].strip() else np.nan
            d = float(row[di]) if di is not None and row[di].strip() else np.nan
            if np.isinf(v) or np.isinf(d) or v < 0 or d < 0 or d > 360:
                raise ValueError()
            records[dt] = (v, d)
        except (IndexError, ValueError) as exc:
            raise CalculationError(f"第 {n} 行时间重复、偏离10分钟网格或数值无效。") from exc
        for index, bucket in ((density_index, densities), (temperature_column, temperatures)):
            if index is None or index >= len(row):
                continue
            try:
                value = float(row[index])
            except ValueError:
                continue
            if bucket is temperatures:
                value -= 273.15 if temperature_kelvin else 0
                if not -100 <= value <= 100:
                    continue
            elif not 0 < value < 3:
                continue
            total, count = bucket.get(dt.year, (0.0, 0))
            bucket[dt.year] = (total + value, count + 1)
    if not records:
        raise CalculationError("TXT 无数据。")
    return (
        f"{height:g}",
        records,
        preamble,
        densities,
        temperatures,
    )


def record_interval(records):
    if all(t.minute == 0 for t in records):
        return 60
    stamps = sorted(records)
    cadence = 0
    for before, after in pairwise(stamps):
        cadence = math.gcd(cadence, int((after - before).total_seconds() // 60))
        if cadence == 10:
            return cadence
    raise CalculationError("资料须为整点逐小时序列或可识别的10分钟序列。")


def natural_window(records, interval_minutes=60):
    valid_years = {t.year for t, (speed, _) in records.items() if np.isfinite(speed)}
    first, last = min(records), max(records)
    last_minute = 60 - interval_minutes
    legacy_end = (
        last.year if last == datetime(last.year, 12, 31, 23, last_minute) else last.year - 1
    )
    legacy_start = legacy_end - 19
    if (
        legacy_start >= 1
        and first <= datetime(legacy_start, 1, 1)
        and datetime(legacy_end, 12, 31, 23, last_minute) in records
        and all(year in valid_years for year in range(legacy_start, legacy_end + 1))
    ):
        return legacy_start, legacy_end
    complete_years = {
        year
        for year in valid_years
        if datetime(year, 1, 1) in records and datetime(year, 12, 31, 23, last_minute) in records
    }
    if not complete_years:
        raise CalculationError(
            f"资料未覆盖一个完整自然年（1月1日00:00至12月31日23:{last_minute:02d}）。"
        )
    end = start = max(complete_years)
    while start - 1 in complete_years and end - start < 19:
        start -= 1
    return start, end


def hourly(raw):
    return select_year(*hourly_records(raw))


def select_year(height, records, interval_minutes=None):
    interval_minutes = interval_minutes or record_interval(records)
    start, end = natural_window(records, interval_minutes)
    times = sorted(t for t in records if start <= t.year <= end)
    v, d = np.array([records[t] for t in times]).T
    years = np.array([t.year for t in times])
    annual = []
    for y in range(start, end + 1):
        a = v[(years == y) & np.isfinite(v)]
        if not len(a):
            raise CalculationError(f"{y}年没有有效风速。")
        annual.append(float(a.mean()))
    avg = float(np.nanmean(v))
    if avg <= 0:
        raise CalculationError("资料期平均风速为零，无法选择分析年。")
    idx = int(np.argmin(np.abs(np.array(annual) - avg))) if len(annual) == 20 else len(annual) - 1
    return height, times, v, d, years, start, annual, avg, start + idx, interval_minutes


def period_mean(buckets, start, end):
    totals = [value for year, value in buckets.items() if start <= year <= end]
    count = sum(n for _, n in totals)
    return sum(total for total, _ in totals) / count if count else None


def assessment_source(raw, speed_only=False):
    height, records, preamble, densities, temperatures = _read_hourly(
        raw, source_details=not speed_only, speed_only=speed_only
    )
    coordinates = {}
    for label, key, positive, negative in (
        ("Latitude", "lat", "N", "S"),
        ("Longitude", "lon", "E", "W"),
    ):
        match = re.search(
            rf"^\s*{label}\s*=\s*([{positive}{negative}])?\s*([-+]?\d+(?:\.\d+)?)\s*$",
            preamble,
            re.I | re.M,
        )
        if match:
            value = float(match[2])
            coordinates[key] = -abs(value) if (match[1] or "").upper() == negative else value
    source = {
        "height": float(height),
        "first": min(records).isoformat(),
        "last": max(records).isoformat(),
        "coordinates": coordinates,
        "density_by_year": {str(y): total / count for y, (total, count) in densities.items()},
        "density_constant": density_metadata(preamble),
        "temperature_by_year": {
            str(y): total / count for y, (total, count) in temperatures.items()
        },
        "interval_minutes": record_interval(records),
    }
    try:
        _, _, _, _, _, start, annual, mean, year, _ = select_year(
            height, records, source["interval_minutes"]
        )
    except CalculationError as exc:
        return {**source, "window_years": 0, "coverage_error": str(exc)}
    end = start + len(annual) - 1
    return {
        **source,
        "start_year": start,
        "end_year": end,
        "window_years": len(annual),
        "density_period": period_mean(densities, start, end),
        "temperature_period": period_mean(temperatures, start, end),
        "coverage_error": None,
        "year": year,
        "mean_speed": mean,
        "annual": annual,
        "deviation": (annual[year - start] - mean) / mean * 100,
    }


def figure(title, labels, series, kind, *, fit_label=None):
    frequency_plot = kind in ("freq", "fit")
    frequency_top = (
        max(2, 2 * math.ceil(max(max(values) for _, values in series) / 2)) if frequency_plot else 0
    )
    chart_bottom = 95 + max(370, frequency_top // 2 * 24)
    im = Image.new("RGB", (1000, chart_bottom + 105), "white")
    draw = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("msyh.ttc", 20)
    except OSError:
        font = ImageFont.load_default(size=17)
    colors = ["#4F81BD", "#C0504D"]
    draw.text((45, 12), title, font=font, fill="black")
    if fit_label:
        draw.text((920, 12), fit_label, font=font, fill="#52665b", anchor="rt")
    if kind == "rose":
        vals = series[0][1]
        angles = np.arange(16) * np.pi / 8

        def points(radius):
            return [
                (500 + radius[i] * np.sin(a), 290 - radius[i] * np.cos(a))
                for i, a in enumerate(angles)
            ]

        maximum = max(max(vals), 1)
        for step in range(1, 6):
            draw.polygon(points([step * 40] * 16), outline="#b0b0b0")
        for pos, label in zip(points([225] * 16), COMPASS, strict=True):
            draw.text(pos, label, anchor="mm", font=font, fill="black")
        draw.line(
            points(np.array(vals) * 200 / maximum) + points(np.array(vals) * 200 / maximum)[:1],
            fill=colors[0],
            width=4,
        )
        draw.text((20, 515), f"外圈 {maximum:.1f}%", font=font, fill="black")
    else:
        x = np.linspace(83, 902, len(labels))
        if frequency_plot:
            axis_title = Image.new("RGBA", (180, 26))
            ImageDraw.Draw(axis_title).text(
                (90, 13), "风速频率（%）", font=font, fill=colors[0], anchor="mm"
            )
            vertical_title = axis_title.transpose(Image.Transpose.ROTATE_90)
            im.paste(
                vertical_title,
                (2, (95 + chart_bottom - vertical_title.height) // 2),
                vertical_title,
            )
        for j, (name, values) in enumerate(series):
            values = np.array(values, dtype=float)
            limit = max(float(np.nanmax(values)) if np.isfinite(values).any() else 0, 1)
            if kind == "annual":
                limit = max(1, max(max(s[1]) for s in series))
            elif frequency_plot:
                limit = frequency_top
            draw.text((50 + j * 470, 45), name, font=font, fill=colors[j])
            step = (
                1
                if kind == "annual" or kind == "line" and j == 0
                else 100
                if kind == "line"
                else 2
                if frequency_plot
                else None
            )
            if step:
                limit = math.ceil(limit / step) * step
                ticks = range(0, limit + step, step)
            else:
                ticks = np.linspace(0, limit, 6)
            for tick in ticks if not frequency_plot or j == 0 else ():
                y = chart_bottom - (chart_bottom - 95) * tick / limit
                if j == 0:
                    draw.line((70, y, 920, y), fill="#dddddd")
                draw.text(
                    (65 if j == 0 else 925, y),
                    f"{tick:g}" if step else f"{tick:.1f}",
                    anchor="rm" if j == 0 else "lm",
                    font=font,
                    fill=colors[j],
                )
            prev = None
            for xi, val in zip(x, values, strict=True):
                if not np.isfinite(val):
                    prev = None
                    continue
                yy = chart_bottom - (chart_bottom - 95) * val / limit
                if kind == "freq":
                    half_width = (x[1] - x[0]) * 0.18
                    offset = half_width * (-1.15 if j == 0 else 1.15)
                    if val > 0:
                        draw.rectangle(
                            (xi + offset - half_width, yy, xi + offset + half_width, chart_bottom),
                            fill=colors[j],
                        )
                elif kind in ("annual", "fit") and j == 0:
                    draw.rectangle((xi - 6, yy, xi + 6, chart_bottom), fill=colors[j])
                else:
                    if prev:
                        draw.line((*prev, xi, yy), fill=colors[j], width=4)
                    draw.ellipse((xi - 3, yy - 3, xi + 3, yy + 3), fill=colors[j])
                prev = (xi, yy)
        for i, xi in enumerate(x):
            if len(labels) < 18 or i % 2 == 0:
                draw.text(
                    (xi, chart_bottom + 15), str(labels[i]), anchor="mt", font=font, fill="black"
                )
    buf = BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def rose_points(field, values):
    return (
        [
            {"label": label, "degrees": i * 22.5, field: float(value)}
            for i, (label, value) in enumerate(zip(COMPASS, values, strict=True))
        ]
        if len(values)
        else []
    )


def monthly_rose_figure(months, field):
    cell_width, cell_height = 380, 320
    image = Image.new("RGB", (3 * cell_width, 4 * cell_height), "white")
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("msyh.ttc", 23)
    except OSError:
        font = ImageFont.load_default(size=19)
    for i, rows in enumerate(months):
        col, row = i % 3, i // 3
        x, y = col * cell_width, row * cell_height
        draw.rectangle((x, y, x + cell_width - 1, y + cell_height - 1), outline="#8f8f8f")
        draw.text((x + cell_width // 2, y + 16), f"{i + 1}月", anchor="mt", font=font, fill="black")
        if rows:
            values = [r[field] for r in rows]
            with Image.open(BytesIO(figure("", COMPASS, [("", values)], "rose"))) as plot:
                panel = plot.crop((242, 48, 758, 530))
                panel.thumbnail((300, 266), Image.Resampling.LANCZOS)
                image.paste(panel, (x + (cell_width - panel.width) // 2, y + 38))
            draw.text(
                (x + 12, y + cell_height - 10),
                f"外圈 {max(max(values), 1):.1f}%",
                anchor="lb",
                font=font,
                fill="#52665b",
            )
        else:
            draw.text(
                (x + cell_width // 2, y + cell_height // 2),
                "有效资料不足",
                anchor="mm",
                font=font,
                fill="#52665b",
            )
    result = BytesIO()
    image.save(result, "PNG")
    return result


def assessment_charts(series, fit):
    plot_types = {"freq": "frequency", "fit": "weibull"}
    fields_by_kind = {
        "line": ["mean_speed", "power_density"],
        "freq": ["frequency", "energy_frequency"],
        "fit": ["frequency", "fitted_frequency"],
    }
    for title, labels, values, kind in series:
        if kind == "annual":
            continue
        if kind == "rose":
            field, data = values[0]
            yield {
                "title": title,
                "plot": "rose",
                "energy": field == "energy_frequency",
                "rows": rose_points(field, data),
            }
            continue
        plot = (
            ("monthly" if len(labels) == 12 else "hourly") if kind == "line" else plot_types[kind]
        )
        fields = fields_by_kind[kind]
        label_key = "period" if kind == "line" else "bin"
        rows = [
            {
                label_key: label,
                **{
                    field: float(points[i]) if np.isfinite(points[i]) else None
                    for field, (_, points) in zip(fields, values, strict=True)
                },
            }
            for i, label in enumerate(labels)
        ]
        yield {
            "title": title,
            "plot": plot,
            "fields": fields,
            "rows": rows,
            **(
                {"fit": {key: fit[key] for key in ("k", "c", "positive_count", "zero_fraction")}}
                if kind == "fit" and fit
                else {}
            ),
        }


def pressure_source_text(station):
    name = station["name"]
    province = station.get("province", "")
    if station.get("manual"):
        source = "采用手动填写的风压。"
        if station["matched_pressure"] is not None:
            source += f"风压库参考为{province}{name}站的 {station['matched_pressure']:g} kN/m²。"
    elif province:
        level = {"county": "区县", "city": "市级", "province": "省级参考站"}[station["level"]]
        source = f"按{level}匹配，采用风压库中的{province}{name}站。"
    else:
        source = (
            f"采用风压库《{station['library']}》的{name}站"
            f"（经度 {station['lon']:g}°，纬度 {station['lat']:g}°）。"
        )
    return source


def pressure_result_text(station, speed, site_speed, density):
    if station is None:
        return "尚未取得基本风压，风压法结果待补。"
    source = pressure_source_text(station)
    return (
        f"{source}50 年一遇基本风压为 {station['pressure']:g} kN/m²，"
        f"标准空气密度参考风速为 {speed:.2f} m/s。按场址空气密度 {density:g} kg/m³ "
        f"反算的等效参考风速为 {site_speed:.2f} m/s。"
    )


def build(
    template,
    raw,
    rho,
    project,
    factor=75.0,
    energy_file=None,
    location=None,
    analysis_year=None,
    *,
    extreme_multiplier=DEFAULT_MULTIPLIER,
    pressure_station=None,
    weibull_method="mle",
    formal_layout=False,
    approved_layout=False,
    hub_height_m=None,
    mean_temperature_c=None,
    thunderstorm_options=None,
    thunderstorm_raw=None,
):
    if weibull_method not in WEIBULL_METHOD_LABELS:
        raise CalculationError("请选择有效的威布尔拟合算法。")
    needs_temperature = hub_height_m is not None and mean_temperature_c is None
    source_height, records, _, _, temperatures = _read_hourly(raw, source_details=needs_temperature)
    height, times, v, d, years, start, annual, avg, recommended_year, interval_minutes = (
        select_year(source_height, records)
    )
    window_years = len(annual)
    end = start + window_years - 1
    short_window = window_years < 20
    if analysis_year is not None and not start <= analysis_year <= end:
        raise CalculationError(f"分析年须在本次资料期（{start}–{end}年）内。")
    if short_window and analysis_year is not None and window_years > 1:
        raise CalculationError("不足20年的已选资料按完整自然年合并分析。")
    combined = short_window and window_years > 1
    year = recommended_year if analysis_year is None else analysis_year
    analysis_start = start if combined else year
    analysis_end = end if combined else year
    hub_height = float(height) if hub_height_m is None else hub_height_m
    source_density = rho
    density_adjustment = None
    if hub_height != float(height):
        temperature = mean_temperature_c
        if temperature is None:
            temperature = period_mean(temperatures, analysis_start, analysis_end)
        if temperature is None:
            raise CalculationError("源风速层与轮毂高度不同，请填写分析期平均气温（℃）。")
        rho = density_at_height(source_density, hub_height - float(height), temperature)
        if not 0 < rho < 3:
            raise CalculationError("折算后的空气密度超出有效范围，请检查高度、温度和源密度。")
        density_adjustment = {
            "source_height_m": float(height),
            "hub_height_m": hub_height,
            "source_density": source_density,
            "hub_density": rho,
            "mean_temperature_c": temperature,
            "temperature_source": "file" if mean_temperature_c is None else "manual",
        }
    mask = (years >= analysis_start) & (years <= analysis_end)
    a, b = v[mask], d[mask]
    stats = wind_statistics(a, source_density, interval_minutes)
    power_grade = classify_power_density(float(height), stats["power_density"])
    thunderstorm = None
    if thunderstorm_options is not None:
        storm_year = thunderstorm_options.year if combined else year
        if storm_year is None:
            raise CalculationError("合并多年分析时，请选择五日雷暴法使用的完整自然年。")
        storm_height, storm_records = height, records
        storm_interval = interval_minutes
        if thunderstorm_raw is not None:
            storm_height, storm_records, _, _, _ = _read_hourly(thunderstorm_raw, speed_only=True)
            storm_interval = record_interval(storm_records)
        if storm_interval != 10:
            raise CalculationError("五日雷暴法需要 10 分钟风速资料，请另传 10 分钟 TXT。")
        if storm_height != height:
            raise CalculationError(
                f"五日雷暴法资料的最高有效风速层须与分析高度 {height:g} m 一致。"
            )
        thunderstorm = five_day_thunderstorm(
            storm_records,
            storm_year,
            storm_height,
            thunderstorm_options.c1,
            thunderstorm_options.c2,
        )
    extreme = extreme_wind(
        stats["mean_speed"], rho, extreme_multiplier, pressure_station, thunderstorm
    )
    dates = [t for t in times if analysis_start <= t.year <= analysis_end]

    def groups(keys, choices):
        result = []
        for x in choices:
            sub = a[(np.array(keys) == x) & np.isfinite(a)]
            result.append(
                (sub.mean(), (0.5 * source_density * sub**3).mean())
                if len(sub)
                else (np.nan, np.nan)
            )
        return np.array(result)

    month_numbers = np.array([t.month for t in dates])
    months = groups(month_numbers, range(1, 13))
    hours = groups([t.hour for t in dates], range(24))
    freq = frequencies(a)

    def directions(speeds, dirs):
        if not np.isfinite(dirs).any():
            raise CalculationError("缺少有效风向。")
        # Direction counts use every valid direction; energy needs contemporaneous speed.
        counts = rose(np.ones_like(dirs), dirs, calm_threshold=0)["rows"]
        energy = rose(speeds, dirs, calm_threshold=0)["rows"]
        return [r["frequency"] for r in counts], [r["energy_frequency"] or 0 for r in energy]

    longdir, _ = directions(v, d)
    direction, energy = directions(a, b)
    monthly_roses = {"frequency": [], "energy_frequency": []}
    for month in range(1, 13):
        mask = month_numbers == month
        observed = b[mask]
        speeds = a[mask]
        paired = np.isfinite(speeds) & np.isfinite(observed)
        monthly_direction = (
            [
                r["frequency"]
                for r in rose(np.ones_like(observed), observed, calm_threshold=0)["rows"]
            ]
            if np.isfinite(observed).any()
            else []
        )
        monthly_energy = (
            [r["energy_frequency"] for r in rose(speeds, observed, calm_threshold=0)["rows"]]
            if (speeds[paired] > 0).any()
            else []
        )
        monthly_roses["frequency"].append(rose_points("frequency", monthly_direction))
        monthly_roses["energy_frequency"].append(rose_points("energy_frequency", monthly_energy))
    if not np.nansum(a**3):
        raise CalculationError("代表年风能为零。")
    effective = (a >= 3) & (a <= 25)
    f = [r["frequency"] for r in freq]
    e = [r["energy_frequency"] or 0 for r in freq]
    deviation = abs(annual[year - start] - avg) / avg

    def fmt(x):
        return f"{x:.2f}" if np.isfinite(x) else "—"

    if combined:
        selection_note = "合并全部完整自然年统计"
    elif window_years == 1:
        selection_note = "仅有一个完整自然年，直接采用"
    elif analysis_year is not None:
        selection_note = f"手动选择分析年，系统推荐年份为{recommended_year}年"
    elif deviation <= 0.02 + 1e-12:
        selection_note = "平风年中偏差最小"
    else:
        selection_note = "无平风年，取偏差最小年份"

    fields = {
        "分析高度": height,
        "时间步长": "1 h" if interval_minutes == 60 else "10 min",
        "代表年份": str(year),
        "20年起止年月": f"{start}年1月—{end}年12月" if not short_window else "资料不足",
        "20年平均风速": fmt(avg) if not short_window else "—",
        "10年平均风速": fmt(np.nanmean(v[years >= end - 9])) if window_years >= 10 else "—",
        "资料期": f"{start}年1月—{end}年12月",
        "资料期年数": str(window_years),
        "资料期平均风速": fmt(avg),
        "分析期": f"{analysis_start}年1月—{analysis_end}年12月",
        "相对偏差": fmt(deviation * 100),
        "代表年选取说明": selection_note,
        "轮毂高度空气密度": f"{rho:.10g}",
        "年平均风速": fmt(stats["mean_speed"]),
        "年平均风功率密度": fmt(stats["power_density"]),
        "大风月": f"{np.nanargmax(months[:, 0]) + 1}月",
        "小风月": f"{np.nanargmin(months[:, 0]) + 1}月",
        "区间累计时数": f"{effective.sum() * interval_minutes / 60:.2f}".rstrip("0").rstrip("."),
        "区间风速频率": fmt(100 * effective.sum() / np.isfinite(a).sum()),
        "区间风能频率": fmt(100 * np.nansum(a[effective] ** 3) / np.nansum(a**3)),
        "风速频率最高区间": freq[np.argmax(f)]["label"],
        "风能频率最高区间": freq[np.argmax(e)]["label"],
        "主风向": COMPASS[np.argmax(direction)],
        "主风向频率": fmt(max(direction)),
        "主风能方向": COMPASS[np.argmax(energy)],
        "主风能频率": fmt(max(energy)),
    }
    if project:
        fields.update({"项目名称": project, "项目名称／XXX地区": project})
    for j, key in enumerate(("风速", "风功率密度")):
        fields[key + "最高时刻"] = f"{np.nanargmax(hours[:, j])}时"
        fields[key + "最低时刻"] = f"{np.nanargmin(hours[:, j])}时"
    try:
        fit = fit_weibull(a, weibull_method)
    except CalculationError:
        if weibull_method != "mle":
            raise
        fit = None
    except ValueError as exc:
        raise CalculationError("当前风速样本无法使用所选威布尔算法拟合。") from exc
    if fit:
        fields.update({"参数A": fmt(fit["c"]), "参数k": fmt(fit["k"])})
    series = [
        (
            "近20年平均风速图",
            range(start, end + 1),
            [("年均风速 m/s", annual), (f"{window_years}年均值 m/s", [avg] * window_years)],
            "annual",
        ),
        (
            "风速和风功率密度月变化图",
            range(1, 13),
            [("风速 m/s", months[:, 0]), ("风功率密度 W/m²", months[:, 1])],
            "line",
        ),
        (
            "风速和风功率密度日变化图",
            range(24),
            [("风速 m/s", hours[:, 0]), ("风功率密度 W/m²", hours[:, 1])],
            "line",
        ),
        ("风速和风能频率图", range(27), [("风速频率 %", f), ("风能频率 %", e)], "freq"),
        ("风向频率玫瑰图", COMPASS, [("frequency", direction)], "rose"),
        ("风能频率玫瑰图", COMPASS, [("energy_frequency", energy)], "rose"),
    ]

    def weibull_series(fitted):
        return (
            "威布尔分布图",
            range(27),
            [
                ("风速频率 %", f),
                ("Weibull 拟合 %", [r["fitted_frequency"] for r in fitted["rows"]]),
            ],
            "fit",
        )

    if fit:
        series.append(weibull_series(fit))
    metrics = ["平均风速（m/s）", "平均风功率密度（W/m²）"]
    tables = {
        "风速和风功率密度月变化图": {
            "headers": ["月份", *metrics],
            "rows": [
                [f"{i}月", fmt(speed), fmt(power)] for i, (speed, power) in enumerate(months, 1)
            ]
            + [
                [
                    "分析期平均" if combined else "全年平均",
                    fields["年平均风速"],
                    fields["年平均风功率密度"],
                ]
            ],
            "summary_rows": 1,
        },
        "风速和风功率密度日变化图": {
            "headers": ["时段", *metrics],
            "rows": [[str(i), fmt(speed), fmt(power)] for i, (speed, power) in enumerate(hours)],
        },
        "风速和风能频率图": {
            "headers": ["风速区间", "风速分布频率", "风功率分布频率"],
            "rows": [
                [r["label"], fmt(f[i]) + "%", fmt(e[i]) + "%"] for i, r in enumerate(freq[:25])
            ]
            + [
                [">=24.5", fmt(sum(f[25:])) + "%", fmt(sum(e[25:])) + "%"],
                ["3～25 m/s", fields["区间风速频率"] + "%", fields["区间风能频率"] + "%"],
            ],
            "summary_rows": 1,
        },
        "风向频率玫瑰图": {
            "headers": ["风向", "风向频率"],
            "rows": [
                [label, fmt(value) + "%"] for label, value in zip(COMPASS, direction, strict=True)
            ],
        },
        "风能频率玫瑰图": {
            "headers": ["风向", "风能频率"],
            "rows": [
                [label, fmt(value) + "%"] for label, value in zip(COMPASS, energy, strict=True)
            ],
        },
    }
    if template is None:
        weibull_charts = {}
        for method in WEIBULL_METHOD_LABELS:
            if method == weibull_method:
                continue
            try:
                alternative = fit_weibull(a, method)
            except ValueError:
                continue
            weibull_charts[method] = next(
                assessment_charts([weibull_series(alternative)], alternative)
            )
        return {
            "year": year,
            "height": float(height),
            "hub_height_m": hub_height,
            "density_adjustment": density_adjustment,
            "power_density_grade": power_grade,
            "window_years": window_years,
            "interval_minutes": interval_minutes,
            "monthly_roses": monthly_roses,
            "analysis_start_year": analysis_start,
            "analysis_end_year": analysis_end,
            "fields": fields,
            "tables": tables,
            "charts": list(assessment_charts(series, fit)),
            "weibull_charts": weibull_charts,
            "extreme": extreme,
        }
    doc = Document(BytesIO(template))
    if approved_layout:
        chart_titles = {"威布尔分布图", *(item[0] for item in series)}
        approved_assessment_template.restore_chart_anchors(
            doc, chart_titles, sample_title=None if fit else "威布尔分布图"
        )

    def fill_cell(cell, value):
        if approved_layout:
            runs = [run for paragraph in cell.paragraphs for run in paragraph.runs if run.text]
            if (
                value is None
                or not runs
                or not all(approved_assessment_template.is_green(run._r) for run in runs)
            ):
                return
            runs[0].text = str(value)
            for extra in runs[1:]:
                extra.text = ""
            return
        runs = cell.paragraphs[0].runs
        run = runs[0] if runs else cell.paragraphs[0].add_run()
        run.text = str(value)
        for extra in runs[1:]:
            extra.text = ""

    def row(table, index, values):
        for cell, value in zip(doc.tables[table].rows[index].cells, values, strict=True):
            fill_cell(cell, value)

    for i in range(min(11, window_years)):
        j = i + 11
        row(
            0,
            i + 1,
            [
                start + i,
                fmt(annual[i]),
                start + j if j < window_years else None if approved_layout else "/",
                fmt(annual[j]) if j < window_years else None if approved_layout else "/",
            ],
        )
    row(
        0,
        12,
        [
            f"{window_years}年平均",
            None if approved_layout and short_window else fmt(avg),
            "近10年平均" if short_window else "10年平均",
            fields["10年平均风速"]
            if window_years >= 10
            else None
            if approved_layout
            else "资料不足",
        ],
    )
    if not approved_layout:
        for unused in doc.tables[0].rows[min(11, window_years) + 1 : 12]:
            unused._tr.getparent().remove(unused._tr)
    for table_index, table in enumerate(tables.values(), 1):
        for row_index, values in enumerate(table["rows"], 1):
            if formal_layout and table_index == 3 and row_index <= 26:
                center = str(row_index - 1) if row_index < 26 else "25（≥24.5）"
                values = [center, *values[1:]]
            row(table_index, row_index, values)
    shapes = {s._inline.docPr.name: s for s in doc.inline_shapes}

    replaced_rids = set()

    def bind_image(shape, png, *, preserve_ratio=False):
        replaced_rids.add(shape._inline.graphic.graphicData.pic.blipFill.blip.embed)
        rid, image = doc.part.get_or_add_image(BytesIO(png))
        shape._inline.graphic.graphicData.pic.blipFill.blip.embed = rid
        if preserve_ratio:
            shape.height = Emu(round(shape.width * image.px_height / image.px_width))

    for title, labels, ss, kind in series:
        caption = "资料期各年平均风速图" if kind == "annual" and short_window else title
        fit_label = WEIBULL_METHOD_LABELS[weibull_method] if kind == "fit" else None
        shape = shapes[title]
        if formal_layout:
            if kind == "line" and len(labels) == 12:
                labels = [f"{month}月" for month in labels]
            elif kind == "freq":
                has_tail = any(values[-1] > 0 for _, values in ss)
                labels = [*range(25), "25+" if has_tail else "25"]
                ss = [(name, [*values[:25], sum(values[25:])]) for name, values in ss]
            png = formal_figure(
                labels,
                ss,
                kind,
                ratio=shape.width / shape.height,
                compass=COMPASS,
                direction=direction,
                fit=fit,
                stats=stats,
                fit_label="最大似然法"
                if approved_layout and kind == "fit" and weibull_method == "mle"
                else fit_label,
                approved_layout=approved_layout,
            )
            shape.width = Cm(14)
            border = shape._inline.graphic.graphicData.pic.spPr
            for existing in border.xpath("./a:ln"):
                border.remove(existing)
            line = OxmlElement("a:ln")
            line.set("w", "6350")
            fill = OxmlElement("a:solidFill")
            color = OxmlElement("a:srgbClr")
            color.set("val", "000000")
            fill.append(color)
            line.append(fill)
            border.append(line)
        else:
            png = figure(caption, labels, ss, kind, fit_label=fit_label)
        bind_image(
            shape,
            png,
            preserve_ratio=formal_layout or kind in ("rose", "freq", "fit"),
        )
        if approved_layout:
            picture_paragraph = shape._inline.xpath("ancestor::w:p[1]")[0]
            approved_assessment_template.clear_generated_chart_note(picture_paragraph.getnext())
        if fit_label:
            shapes[title]._inline.docPr.set("descr", fit_label)
    if not fit and not approved_layout:
        shape = shapes["威布尔分布图"]._inline
        replaced_rids.add(shape.graphic.graphicData.pic.blipFill.blip.embed)
        shape.getparent().remove(shape)
    for para in doc.paragraphs:
        if "在此插入" in para.text and "20" in para.text and "玫瑰图" in para.text:
            para.clear()
            new = deepcopy(shapes["风向频率玫瑰图"]._inline)
            new.docPr.id = doc.part.next_id
            new.docPr.name = f"{window_years}年风向频率玫瑰图"
            drawing = OxmlElement("w:drawing")
            para.add_run()._r.append(drawing)
            drawing.append(new)
            from docx.shape import InlineShape

            bind_image(
                InlineShape(new),
                figure(new.docPr.name, COMPASS, [("", longdir)], "rose"),
                preserve_ratio=True,
            )
    supplemental_figures = (
        ("风能频率分布", "frequency", "各月风向频率玫瑰图"),
        ("威布尔分布", "energy_frequency", "各月风能频率玫瑰图"),
    )
    for heading, field, title in () if formal_layout else supplemental_figures:
        anchor = next((p for p in doc.paragraphs if p.text.strip() == heading), None)
        if anchor is None:
            continue
        picture = doc.add_paragraph()
        picture.alignment = WD_ALIGN_PARAGRAPH.CENTER
        picture.paragraph_format.keep_with_next = True
        shape = picture.add_run().add_picture(
            monthly_rose_figure(monthly_roses[field], field), width=shapes["风向频率玫瑰图"].width
        )
        shape._inline.docPr.name = title
        border = shapes["风向频率玫瑰图"]._inline.graphic.graphicData.pic.spPr.xpath("./a:ln")
        if border:
            shape._inline.graphic.graphicData.pic.spPr.append(deepcopy(border[0]))
        caption = doc.add_paragraph(title, style="图表名称")
        anchor._p.addprevious(picture._p)
        anchor._p.addprevious(caption._p)
    from wind_platform.services.mesoscale_energy import energy_table

    fields.update(
        energy_table(None if approved_layout else doc.tables[6], energy_file, factor, fill_cell)
    )
    if formal_layout:
        for frequencies_at_bins, field in (
            (f, "风速频率最高区间"),
            (e, "风能频率最高区间"),
        ):
            center = np.argmax([*frequencies_at_bins[:25], sum(frequencies_at_bins[25:])])
            fields[field] = f"{center} m/s 档" if center < 25 else "≥24.5 m/s（25 m/s 档）"
        fields["理论发电量汇总"] = (
            f"尾流后理论年发电量合计为 {fields['理论电量合计']} MWh，"
            f"单机平均为 {fields['单机理论电量均值']} MWh。"
            if "理论电量合计" in fields
            else ""
        )
    # Sensitivity methodology has not been approved; suppress the reference project's numbers.
    if not approved_layout:
        for rr in doc.tables[7].rows[2:]:
            for cc in rr.cells:
                if re.search(r"\d", cc.text):
                    fill_cell(cc, "待复核")
    for para in doc.paragraphs:
        if "本阶段理论年发电量综合修正系数暂按" in para.text:
            for run in para.runs:
                if run.text == "75" and (
                    not approved_layout or approved_assessment_template.is_green(run._r)
                ):
                    run.text = f"{factor:g}"
    fields["上传表，现有数据为版式示例"] = ""
    fields.update(location or {})
    fields["换图"] = ""
    grade = power_grade["grade"]
    fields["风功率密度等级及评价待校审"] = f"{grade} 级" if grade else "待复核"
    fields["风压法结果"] = pressure_result_text(
        pressure_station, extreme["pressure_standard"], extreme["pressure_site"], rho
    )
    fields["倍数法结果"] = (
        f"{fields['分析期'] if combined else f'{year} 年'}分析高度 {height} m 的"
        f"{'平均风速' if combined else '年平均风速'}保留两位小数后为 "
        f"{extreme['mean_speed_used']:.2f} m/s，乘以 {extreme_multiplier:g}，"
        f"场址密度下估算风速为 {extreme['site_speed']:.2f} m/s。"
        f"分析配置采用空气密度 {rho:g} kg/m³，折算至标准空气密度后为 "
        f"{extreme['multiplier_standard']:.2f} m/s。"
    )
    methods = "风压法和平均风速倍数法"
    if thunderstorm:
        methods = "风压法、平均风速倍数法和五日雷暴法"
    fields["前期风速判断"] = (
        f"比较{methods}在场址空气密度下的估算结果，"
        f"取{extreme['adopted_method']}的 {extreme['adopted_site']:.2f} m/s，"
        f"折算至标准空气密度后为 {extreme['adopted']:.2f} m/s，作为前期判断依据。"
        if extreme["adopted"] is not None
        else "待补齐风压法结果后，再取各方法的较大值形成前期判断。"
    )
    if approved_layout:
        approved_assessment_template.select_thunderstorm_section(doc, thunderstorm is not None)
        fields.update(
            {
                "风功率密度等级": fields["风功率密度等级及评价待校审"],
                "基本风压": f"{pressure_station['pressure']:g}",
                "风压来源": pressure_source_text(pressure_station).rstrip("。"),
                "风压法标准风速": f"{extreme['pressure_standard']:.2f}",
                "风压法场址风速": f"{extreme['pressure_site']:.2f}",
                "场址空气密度": f"{rho:g}",
                "分析期平均风速": f"{extreme['mean_speed_used']:.2f}",
                "风速倍数": f"{extreme_multiplier:g}",
                "倍数法场址风速": f"{extreme['site_speed']:.2f}",
                "倍数法标准风速": f"{extreme['multiplier_standard']:.2f}",
                "实际参与比选的方法": methods,
                "场址最大风速": f"{extreme['adopted_site']:.2f}",
                "采用方法": extreme["adopted_method"],
                "标准空气密度下最大风速": f"{extreme['adopted']:.2f}",
                "勾选并完成计算时输出本小节": "",
            }
        )
        if short_window:
            for field in ("20年起止年月", "20年平均风速", "代表年份", "相对偏差", "代表年选取说明"):
                fields.pop(field, None)
        if window_years < 10:
            fields.pop("10年平均风速", None)
        if thunderstorm:
            fields.update(
                {
                    "五日雷暴分析年": str(thunderstorm["year"]),
                    "样本均值": f"{thunderstorm['mean']:.2f}",
                    "样本标准差": f"{thunderstorm['stdev']:.2f}",
                    "C₁": f"{thunderstorm['c1']:g}",
                    "C₂": f"{thunderstorm['c2']:g}",
                    "α": f"{thunderstorm['alpha']:.4f}",
                    "u": f"{thunderstorm['u']:.2f}",
                    "五日雷暴法场址风速": f"{thunderstorm['site_speed']:.2f}",
                    "五日雷暴法标准风速": f"{extreme['thunderstorm']['standard_speed']:.2f}",
                }
            )
        approved_assessment_template.restore_sample_fields(doc.paragraphs, fields)
        for section in doc.sections:
            approved_assessment_template.restore_sample_fields(section.header.paragraphs, fields)

    paragraphs = doc.paragraphs
    for para in paragraphs:
        if not approved_layout and para.text == "本节按标准空气密度口径比较两种方法的估算结果。":
            para.clear().add_run(
                "本节比较各启用方法在场址空气密度下的估算结果，再将最大值折算至标准空气密度。"
            )
        if not approved_layout and thunderstorm and para.text.startswith("【前期风速判断】"):
            para.insert_paragraph_before("（3）五日雷暴法", style=para.style)
            para.insert_paragraph_before(
                f"采用 {thunderstorm['year']} 年 {thunderstorm['height']:g} m 高度的"
                " 10 分钟风速资料，"
                f"取各五日时段的最大风速，得到 {thunderstorm['sample_size']} 个样本。"
                "极值Ⅰ型分布参数按 α＝C₁/σ、u＝μ−C₂/α 计算，"
                "50 年一遇最大风速按 V₅₀＝u−ln[ln(50×73/(50×73−1))]/α 计算。",
                style=para.style,
            )
            para.insert_paragraph_before(
                f"样本均值 μ＝{thunderstorm['mean']:.2f} m/s，"
                f"样本标准差 σ＝{thunderstorm['stdev']:.2f} m/s，"
                f"C₁＝{thunderstorm['c1']:g}，C₂＝{thunderstorm['c2']:g}，"
                f"α＝{thunderstorm['alpha']:.4f}，u＝{thunderstorm['u']:.2f} m/s。"
                f"场址空气密度下的估算风速为 {thunderstorm['site_speed']:.2f} m/s，"
                f"折算至标准空气密度后为 {extreme['thunderstorm']['standard_speed']:.2f} m/s。",
                style=para.style,
            )
            break

    def replace(para):
        runs = para.runs
        txt = "".join(r.text for r in runs)
        if "【空气密度说明】" in txt or (
            "【100 m处空气密度】" in txt and "【轮毂高度空气密度】" in txt
        ):
            if density_adjustment:
                temp_source = "按源文件识别" if mean_temperature_c is None else "由分析配置填写"
                description = (
                    f"分析期资料最高风速层为 {height} m，采用空气密度 {source_density:.6f} kg/m³。"
                    f"同期平均气温为 {temperature:.2f} ℃（{temp_source}）。"
                    f"按 GB/T 18710—2002 式（B3）推导的等温高度折算，"
                    f"轮毂高度 {hub_height:g} m 处的空气密度为 {rho:.6f} kg/m³。"
                )
            else:
                description = (
                    f"分析期资料风速层与轮毂高度均为 {height} m，采用空气密度 {rho:.6f} kg/m³。"
                )
            if approved_layout:
                fields["空气密度说明"] = description
            else:
                para.clear().add_run(description)
                return
        if not approved_layout and short_window and "按年平均风速相对20年平均风速" in txt:
            para.clear().add_run(
                f"本次采用{fields['资料期']}的中尺度数据，共{window_years}个自然年。"
                f"{height} m 高度资料期平均风速为{fmt(avg)} m/s。"
                + (
                    f"近10年平均风速为{fields['10年平均风速']} m/s。"
                    if window_years >= 10
                    else "资料不足10年，仅列资料期均值。"
                )
                + f"分析期为{fields['分析期']}，{selection_note}。"
                "结果反映现有资料期风况，长期代表性待补充资料后复核。"
            )
            return
        if not approved_layout and short_window and "选取代表年份为" in txt:
            para.clear().add_run(
                f"分析期为{fields['分析期']}。采用{height} m 高度风速、风向资料，"
                f"时间步长为 {fields['时间步长']}。"
            )
            return
        hits = [
            (
                m,
                f"{hub_height:g}"
                if m[1] == "分析高度" and txt[: m.start()].endswith("轮毂高度")
                else fields[m[1]],
            )
            for m in re.finditer(r"【([^】]+)】", txt)
            if m[1] in fields
        ]
        if short_window and not approved_layout:
            labels = {
                "近20年各年风速表": "资料期各年风速表",
                "近20年平均风速图": "资料期各年平均风速图",
                "20年风向频率玫瑰图": f"{window_years}年资料期风向频率玫瑰图",
                "代表年份": "分析年份",
                "代表年年平均": "分析期平均",
                "代表年": "分析期" if combined else "分析年",
                "全年": "分析期" if combined else "全年",
            }
            hits.extend(
                (m, labels[m[0]])
                for m in re.finditer(
                    r"【[^】]+】|" + "|".join(map(re.escape, labels)),
                    txt,
                )
                if m[0] in labels and m[0] != labels[m[0]]
            )
        for m, value in sorted(hits, key=lambda pair: pair[0].start(), reverse=True):
            runs = para.runs
            offsets = np.cumsum([0] + [len(r.text) for r in runs])
            left = next(i for i in range(len(runs)) if offsets[i] <= m.start() < offsets[i + 1])
            right = next(
                i for i in range(left, len(runs)) if offsets[i] < m.end() <= offsets[i + 1]
            )
            if approved_layout and any(
                run.text and not approved_assessment_template.is_green(run._r)
                for run in runs[left : right + 1]
            ):
                continue
            prefix = runs[left].text[: m.start() - offsets[left]]
            suffix = runs[right].text[m.end() - offsets[right] :]
            if approved_layout and suffix:
                trailing = Run(deepcopy(runs[right]._r), para)
                trailing.text = suffix
                runs[right]._r.addnext(trailing._r)
            for i in range(left + 1, right + 1):
                runs[i].text = ""
            bound = runs[left]
            if approved_layout:
                if prefix:
                    bound = Run(deepcopy(runs[left]._r), para)
                    runs[left]._r.addnext(bound._r)
                    runs[left].text = prefix
                bound.text = value
                if not m[0].startswith("【"):
                    continue
            else:
                bound.text = prefix + value + suffix
            bound.font.color.rgb = RGBColor.from_string("008000")
            bound.font.highlight_color = None
            if approved_layout and m[0] == "【风功率密度等级】":
                bound.font.bold = False
            for shade in bound._r.xpath("./w:rPr/w:shd"):
                shade.getparent().remove(shade)

    for para in doc.paragraphs:
        replace(para)
    for section in doc.sections:
        for para in section.header.paragraphs:
            replace(para)
    if approved_layout:
        approved_assessment_template.apply_body_typefaces(doc.element.body)
    doc.core_properties.comments = "前期中尺度评估 · mesoscale-v1"
    upd = OxmlElement("w:updateFields")
    current_rids = {
        s._inline.graphic.graphicData.pic.blipFill.blip.embed for s in doc.inline_shapes
    }
    for rid in replaced_rids - current_rids:
        doc.part.drop_rel(rid)
    upd.set(qn("w:val"), "true")
    doc.settings.element.append(upd)
    result = BytesIO()
    doc.save(result)
    return result.getvalue()
