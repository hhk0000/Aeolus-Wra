"""Single-point hourly mesoscale statistics and in-place v1 Word bindings."""

import re
from base64 import b64encode
from copy import deepcopy
from datetime import datetime
from io import BytesIO

import numpy as np
from docx import Document
from docx.oxml import OxmlElement
from docx.shared import RGBColor
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


def hourly_records(raw):
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
    records = {}
    for n, line in enumerate(text.splitlines()[header_line:], header_line + 1):
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
    if not records:
        raise CalculationError("TXT 无数据。")
    return f"{height:g}", records


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
    height, records = hourly_records(raw)
    content, _ = decode_text(raw)
    lines = content.splitlines()
    header = next(
        (
            i
            for i, line in enumerate(lines[:200])
            if re.search(r"date|timestamp|日期|时间", line, re.I)
            and any(separator in line for separator in ("\t", ",", ";"))
        ),
        0,
    )
    preamble = "\n".join(lines[:header])
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
                if kind in ("annual", "freq", "fit") and j == 0:
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


def build(template, raw, rho, project, factor=75.0, energy_file=None, location=None):
    height, times, v, d, years, start, annual, avg, year = hourly(raw)
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

    fields = {
        "分析高度": height,
        "时间步长": "1 h",
        "代表年份": str(year),
        "20年起止年月": f"{start}年1月—{start + 19}年12月",
        "20年平均风速": fmt(avg),
        "10年平均风速": fmt(np.nanmean(v[years >= start + 10])),
        "相对偏差": fmt(deviation * 100),
        "代表年选取说明": "平风年中偏差最小"
        if deviation <= 0.02 + 1e-12
        else "无平风年，取偏差最小年份",
        "轮毂高度空气密度": str(rho),
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
        ("风向频率玫瑰图", COMPASS, [("", direction)], "rose"),
        ("风能频率玫瑰图", COMPASS, [("", energy)], "rose"),
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
    if template is None:
        return {
            "year": year,
            "height": float(height),
            "fields": fields,
            "monthly": [[fmt(speed), fmt(power)] for speed, power in months],
            "charts": [
                {
                    "title": title,
                    "image": b64encode(figure(title, labels, values, kind)).decode("ascii"),
                }
                for title, labels, values, kind in series
                if kind != "annual"
            ],
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
    for i, (s, p) in enumerate(months):
        row(1, i + 1, [f"{i + 1}月", fmt(s), fmt(p)])
    row(1, 13, ["全年平均", fields["年平均风速"], fields["年平均风功率密度"]])
    for i, (s, p) in enumerate(hours):
        row(2, i + 1, [i, fmt(s), fmt(p)])
    # The sample has 26 data rows. Pool both upper-tail bins in its final row.
    for i, r in enumerate(freq[:25]):
        row(3, i + 1, [r["label"], fmt(f[i]) + "%", fmt(e[i]) + "%"])
    row(3, 26, [">=24.5", fmt(sum(f[25:])) + "%", fmt(sum(e[25:])) + "%"])
    row(3, 27, ["3～25 m/s", fields["区间风速频率"] + "%", fields["区间风能频率"] + "%"])
    for i, label in enumerate(COMPASS):
        row(4, i + 1, [label, fmt(direction[i]) + "%"])
        row(5, i + 1, [label, fmt(energy[i]) + "%"])
    shapes = {s._inline.docPr.name: s for s in doc.inline_shapes}

    replaced_rids = set()

    def bind_image(shape, png):
        replaced_rids.add(shape._inline.graphic.graphicData.pic.blipFill.blip.embed)
        rid, _ = doc.part.get_or_add_image(BytesIO(png))
        shape._inline.graphic.graphicData.pic.blipFill.blip.embed = rid

    for title, labels, ss, kind in series:
        bind_image(shapes[title], figure(title, labels, ss, kind))
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

            bind_image(InlineShape(new), figure(new.docPr.name, COMPASS, [("", longdir)], "rose"))
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
