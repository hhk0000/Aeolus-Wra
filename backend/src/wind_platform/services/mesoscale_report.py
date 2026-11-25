"""Single-point hourly mesoscale statistics and in-place v1 Word bindings."""

import re
from copy import deepcopy
from datetime import datetime
from io import BytesIO

import numpy as np
from docx import Document
from docx.oxml import OxmlElement
from docx.shared import Emu, RGBColor
from PIL import Image, ImageDraw, ImageFont

from wind_platform.core.calculations import (
    COMPASS,
    CalculationError,
    frequencies,
    rose,
    weibull,
    wind_statistics,
)
from wind_platform.core.ingestion import decode_text, preview, split_line

DENSITY_NAME = r"空气密度|(?:air[ _-]*)?density(?![a-z])|rho(?![a-z])|ρ"
DENSITY_UNIT = r"kg\s*(?:/\s*m\s*\^?[3³]|[· ]\s*m\s*(?:\^?-3|⁻³))"


def density_metadata(preamble):
    values = re.findall(
        rf"^\s*(?:{DENSITY_NAME})(?:\s*[（(\[]\s*{DENSITY_UNIT}\s*[）)\]])?"
        rf"\s*[:=：]\s*([0-9]+(?:\.[0-9]+)?)(?:\s*{DENSITY_UNIT})?\s*$",
        preamble,
        re.I | re.M,
    )
    return float(values[0]) if len(values) == 1 and 0 < float(values[0]) < 3 else None


def hourly_records(raw):
    height, records, _, _ = _read_hourly(raw)
    return height, records


def _read_hourly(raw, source_details=False):
    detected = preview(raw)
    ti = detected["detected"]["timestamp_column"]
    if detected["detected"]["time_column"] is not None:
        raise CalculationError("中尺度 TXT 须使用单列日期时间。")
    columns = {}
    for quantity in ("speed", "direction"):
        candidates = [
            channel
            for channel in detected["suggestions"]
            if channel["quantity"] == quantity
            and channel["statistic"] == "mean"
            and channel["height"] is not None
            and not channel["ambiguous"]
            and channel["index"] != ti
        ]
        if len(candidates) != 1:
            raise CalculationError(
                "须识别到唯一的一列带高度的平均风速和风向。"
                "支持 Speed_100m / Direction_100m 或 Anem125m / Vane125m 等表头。"
            )
        columns[quantity] = candidates[0]
    speed, direction = columns["speed"], columns["direction"]
    height = speed["height"]
    if height != direction["height"]:
        raise CalculationError("风速与风向高度不同，请使用同一分析高度。")
    vi, di = speed["index"], direction["index"]
    speed_header, direction_header = detected["headers"][vi], detected["headers"][di]
    if not re.search(r"\bm\s*/\s*s\b", speed_header, re.I) or not re.search(
        r"°|\bdeg\b", direction_header, re.I
    ):
        raise CalculationError("平均风速须为 m/s，风向须为度（° 或 Deg）。")
    text, _ = decode_text(raw)
    header_line = detected["header_line"]
    delimiter = detected["delimiter"]
    lines = text.splitlines()
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
    density_index = density_columns[0] if len(density_columns) == 1 else None
    densities = {}
    records = {}
    for n, line in enumerate(lines[header_line:], header_line + 1):
        if not line.strip():
            continue
        try:
            row = split_line(line, delimiter)
            dt = datetime.fromisoformat(row[ti].strip().replace("/", "-"))
            if dt in records or dt.minute or dt.second or dt.microsecond or dt.tzinfo:
                raise ValueError()
            v = float(row[vi]) if row[vi].strip() else np.nan
            d = float(row[di]) if row[di].strip() else np.nan
            if np.isinf(v) or np.isinf(d) or v < 0 or d < 0 or d > 360:
                raise ValueError()
            records[dt] = (v, d)
        except (IndexError, ValueError) as exc:
            raise CalculationError(f"第 {n} 行时间重复、非整点或数值无效。") from exc
        if density_index is not None and density_index < len(row):
            try:
                value = float(row[density_index])
            except ValueError:
                continue
            if 0 < value < 3:
                total, count = densities.get(dt.year, (0.0, 0))
                densities[dt.year] = (total + value, count + 1)
    if not records:
        raise CalculationError("TXT 无数据。")
    return (
        f"{height:g}",
        records,
        preamble,
        {str(year): total / count for year, (total, count) in densities.items()},
    )


def natural_window(records):
    first, last = min(records), max(records)
    end = last.year if last == datetime(last.year, 12, 31, 23) else last.year - 1
    start = end - 19
    if first > datetime(start, 1, 1) or datetime(end, 12, 31, 23) not in records:
        raise CalculationError("资料未覆盖最近20个完整自然年。")
    return start, end


def hourly(raw):
    return select_year(*hourly_records(raw))


def select_year(height, records):
    start, end = natural_window(records)
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
        raise CalculationError("20年均值为零，无法选择代表年。")
    idx = int(np.argmin(np.abs(np.array(annual) - avg)))
    return height, times, v, d, years, start, annual, avg, start + idx


def assessment_source(raw):
    height, records, preamble, densities = _read_hourly(raw, source_details=True)
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
        "density_by_year": densities,
        "density_constant": density_metadata(preamble),
    }
    try:
        _, _, _, _, _, start, annual, mean, year = select_year(height, records)
    except CalculationError as exc:
        return {**source, "coverage_error": str(exc)}
    return {
        **source,
        "start_year": start,
        "end_year": start + 19,
        "year": year,
        "mean_speed": mean,
        "annual": annual,
        "deviation": (annual[year - start] - mean) / mean * 100,
    }


def figure(title, labels, series, kind):
    im = Image.new("RGB", (1000, 570), "white")
    draw = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("msyh.ttc", 20)
    except OSError:
        font = ImageFont.load_default(size=17)
    colors = ["#4F81BD", "#C0504D"]
    draw.text((45, 12), title, font=font, fill="black")
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
        for j, (name, values) in enumerate(series):
            values = np.array(values, dtype=float)
            limit = max(float(np.nanmax(values)) if np.isfinite(values).any() else 0, 1)
            if kind in ("annual", "freq", "fit"):
                limit = max(1, max(max(s[1]) for s in series))
            draw.text((50 + j * 470, 45), name, font=font, fill=colors[j])
            for i in range(6):
                y = 465 - 74 * i
                if j == 0:
                    draw.line((70, y, 920, y), fill="#dddddd")
                draw.text(
                    (65 if j == 0 else 925, y),
                    f"{limit * i / 5:.1f}",
                    anchor="rm" if j == 0 else "lm",
                    font=font,
                    fill=colors[j],
                )
            prev = None
            for xi, val in zip(x, values, strict=True):
                if not np.isfinite(val):
                    prev = None
                    continue
                yy = 465 - 370 * val / limit
                if kind == "freq":
                    half_width = (x[1] - x[0]) * 0.18
                    offset = half_width * (-1.15 if j == 0 else 1.15)
                    if val > 0:
                        draw.rectangle(
                            (xi + offset - half_width, yy, xi + offset + half_width, 465),
                            fill=colors[j],
                        )
                elif kind in ("annual", "fit") and j == 0:
                    draw.rectangle((xi - 6, yy, xi + 6, 465), fill=colors[j])
                else:
                    if prev:
                        draw.line((*prev, xi, yy), fill=colors[j], width=4)
                    draw.ellipse((xi - 3, yy - 3, xi + 3, yy + 3), fill=colors[j])
                prev = (xi, yy)
        for i, xi in enumerate(x):
            if len(labels) < 18 or i % 2 == 0:
                draw.text((xi, 480), str(labels[i]), anchor="mt", font=font, fill="black")
    buf = BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


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
                "rows": [
                    {"label": label, "degrees": i * 22.5, field: float(value)}
                    for i, (label, value) in enumerate(zip(labels, data, strict=True))
                ],
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
            **({"fit": {"k": fit["k"], "c": fit["c"]}} if kind == "fit" and fit else {}),
        }


def build(
    template, raw, rho, project, factor=75.0, energy_file=None, location=None, analysis_year=None
):
    height, times, v, d, years, start, annual, avg, recommended_year = hourly(raw)
    if analysis_year is not None and not start <= analysis_year < start + 20:
        raise CalculationError("分析年须在最近20个完整自然年窗口内。")
    year = recommended_year if analysis_year is None else analysis_year
    mask = years == year
    a, b = v[mask], d[mask]
    stats = wind_statistics(a, rho, 60)
    dates = [t for t in times if t.year == year]

    def groups(keys, choices):
        result = []
        for x in choices:
            sub = a[(np.array(keys) == x) & np.isfinite(a)]
            result.append(
                (sub.mean(), (0.5 * rho * sub**3).mean()) if len(sub) else (np.nan, np.nan)
            )
        return np.array(result)

    months = groups([t.month for t in dates], range(1, 13))
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
    if not np.nansum(a**3):
        raise CalculationError("代表年风能为零。")
    effective = (a >= 3) & (a <= 25)
    f = [r["frequency"] for r in freq]
    e = [r["energy_frequency"] or 0 for r in freq]
    deviation = abs(annual[year - start] - avg) / avg

    def fmt(x):
        return f"{x:.2f}" if np.isfinite(x) else "—"

    if analysis_year is not None:
        selection_note = f"手动选择分析年，系统推荐年份为{recommended_year}年"
    elif deviation <= 0.02 + 1e-12:
        selection_note = "平风年中偏差最小"
    else:
        selection_note = "无平风年，取偏差最小年份"

    fields = {
        "分析高度": height,
        "时间步长": "1 h",
        "代表年份": str(year),
        "20年起止年月": f"{start}年1月—{start + 19}年12月",
        "20年平均风速": fmt(avg),
        "10年平均风速": fmt(np.nanmean(v[years >= start + 10])),
        "相对偏差": fmt(deviation * 100),
        "代表年选取说明": selection_note,
        "轮毂高度空气密度": f"{rho:.10g}",
        "年平均风速": fmt(stats["mean_speed"]),
        "年平均风功率密度": fmt(stats["power_density"]),
        "大风月": f"{np.nanargmax(months[:, 0]) + 1}月",
        "小风月": f"{np.nanargmin(months[:, 0]) + 1}月",
        "区间累计时数": str(int(effective.sum())),
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
        fit = weibull(a)
    except CalculationError:
        fit = None
    if fit:
        fields.update({"参数A": fmt(fit["c"]), "参数k": fmt(fit["k"])})
    series = [
        (
            "近20年平均风速图",
            range(start, start + 20),
            [("年均风速 m/s", annual), ("20年均值 m/s", [avg] * 20)],
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
    if fit:
        series.append(
            (
                "威布尔分布图",
                range(27),
                [
                    ("风速频率 %", f),
                    ("Weibull 拟合 %", [r["fitted_frequency"] for r in fit["rows"]]),
                ],
                "fit",
            )
        )
    metrics = ["平均风速（m/s）", "平均风功率密度（W/m²）"]
    tables = {
        "风速和风功率密度月变化图": {
            "headers": ["月份", *metrics],
            "rows": [
                [f"{i}月", fmt(speed), fmt(power)] for i, (speed, power) in enumerate(months, 1)
            ]
            + [["全年平均", fields["年平均风速"], fields["年平均风功率密度"]]],
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
        return {
            "year": year,
            "height": float(height),
            "fields": fields,
            "tables": tables,
            "charts": list(assessment_charts(series, fit)),
        }
    doc = Document(BytesIO(template))

    def fill_cell(cell, value):
        runs = cell.paragraphs[0].runs
        run = runs[0] if runs else cell.paragraphs[0].add_run()
        run.text = str(value)
        for extra in runs[1:]:
            extra.text = ""

    def row(table, index, values):
        for cell, value in zip(doc.tables[table].rows[index].cells, values, strict=True):
            fill_cell(cell, value)

    for i in range(11):
        j = i + 11
        row(
            0,
            i + 1,
            [
                start + i,
                fmt(annual[i]),
                start + j if j < 20 else "/",
                fmt(annual[j]) if j < 20 else "/",
            ],
        )
    row(0, 12, ["20年平均", fmt(avg), "10年平均", fields["10年平均风速"]])
    for table_index, table in enumerate(tables.values(), 1):
        for row_index, values in enumerate(table["rows"], 1):
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
        bind_image(shapes[title], figure(title, labels, ss, kind), preserve_ratio=kind == "rose")
    if not fit:
        shape = shapes["威布尔分布图"]._inline
        replaced_rids.add(shape.graphic.graphicData.pic.blipFill.blip.embed)
        shape.getparent().remove(shape)
    for para in doc.paragraphs:
        if "在此插入" in para.text and "20" in para.text and "玫瑰图" in para.text:
            para.clear()
            new = deepcopy(shapes["风向频率玫瑰图"]._inline)
            new.docPr.id = doc.part.next_id
            new.docPr.name = "20年风向频率玫瑰图"
            drawing = OxmlElement("w:drawing")
            para.add_run()._r.append(drawing)
            drawing.append(new)
            from docx.shape import InlineShape

            bind_image(
                InlineShape(new),
                figure(new.docPr.name, COMPASS, [("", longdir)], "rose"),
                preserve_ratio=True,
            )
    from wind_platform.services.mesoscale_energy import energy_table

    fields.update(energy_table(doc, energy_file, factor, fill_cell))
    # Sensitivity methodology has not been approved; suppress the reference project's numbers.
    for rr in doc.tables[7].rows[2:]:
        for cc in rr.cells:
            if re.search(r"\d", cc.text):
                fill_cell(cc, "待复核")
    for para in doc.paragraphs:
        if "本阶段理论年发电量综合修正系数暂按" in para.text:
            for run in para.runs:
                if run.text == "75":
                    run.text = f"{factor:g}"
    fields["上传表，现有数据为版式示例"] = ""
    fields.update(location or {})
    fields["换图"] = ""

    def replace(para):
        runs = para.runs
        txt = "".join(r.text for r in runs)
        hits = [m for m in re.finditer(r"【([^】]+)】", txt) if m[1] in fields]
        for m in reversed(hits):
            offsets = np.cumsum([0] + [len(r.text) for r in runs])
            left = next(i for i in range(len(runs)) if offsets[i] <= m.start() < offsets[i + 1])
            right = next(
                i for i in range(left, len(runs)) if offsets[i] < m.end() <= offsets[i + 1]
            )
            prefix = runs[left].text[: m.start() - offsets[left]]
            suffix = runs[right].text[m.end() - offsets[right] :]
            for i in range(left + 1, right + 1):
                runs[i].text = ""
            runs[left].text = prefix + fields[m[1]] + suffix
            runs[left].font.color.rgb = RGBColor.from_string("008000")
            runs[left].font.highlight_color = None

    for para in doc.paragraphs:
        replace(para)
    for section in doc.sections:
        for para in section.header.paragraphs:
            replace(para)
    doc.core_properties.comments = "前期中尺度评估 · mesoscale-v1"
    upd = OxmlElement("w:updateFields")
    from docx.oxml.ns import qn

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
