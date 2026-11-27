"""Chart styling for the formal Word assessment template."""

from functools import lru_cache
from io import BytesIO
from math import ceil, cos, floor, hypot, isfinite, pi, sin
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BLUE = "#4F81BD"
RED = "#C0504D"
GOLD = "#b78300"
GRID = "#c5c5c5"
AXIS = "#777777"
WIDTH = 1680


@lru_cache
def font(size, chinese=False):
    filename = "simsun.ttc" if chinese else "times.ttf"
    fallback = (
        "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"
        if chinese
        else "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf"
    )
    for path in (Path("C:/Windows/Fonts") / filename, filename, fallback):
        try:
            return ImageFont.truetype(str(path), size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def label(draw, xy, value, size=34, *, anchor="mm", color="#222222"):
    draw.text(
        xy, value, anchor=anchor, font=font(size, any(ord(c) > 255 for c in value)), fill=color
    )


def rotated_label(image, xy, value, degrees=90, size=36):
    layer = Image.new("RGBA", (520, size * 2))
    label(ImageDraw.Draw(layer), (260, size), value, size)
    layer = layer.crop(layer.getbbox()).rotate(
        degrees, expand=True, resample=Image.Resampling.BICUBIC
    )
    x, y = xy
    image.paste(layer, (round(x - layer.width / 2), round(y - layer.height / 2)), layer)


def draw_rose(draw, box, compass, values, *, sectors=False):
    left, top, right, bottom = box
    cx, cy = (left + right) / 2, (top + bottom) / 2
    radius = min((right - left) * 0.40, (bottom - top) * 0.42)
    peak = max(values)
    step = max(1, ceil(peak / 10))
    maximum = max(step, ceil(peak / step) * step)

    def point(r, i):
        angle = i * pi / 8
        return cx + r * sin(angle), cy - r * cos(angle)

    if sectors:
        for i, value in enumerate(values):
            outer = radius * value / maximum
            draw.polygon(
                [(cx, cy), *[point(outer, i + j / 16) for j in range(-8, 9)]],
                fill="#ccdced",
                outline=BLUE,
                width=2,
            )
    for tick in range(step, maximum + 1, step):
        ring = [point(radius * tick / maximum, i) for i in range(16)]
        draw.line(ring + ring[:1], fill=GRID, width=2)
        x, y = ring[0]
        label(draw, (x - 10, y), f"{tick}%", 26, anchor="rm")
    for i, direction in enumerate(compass):
        draw.line([(cx, cy), point(radius, i)], fill=GRID, width=2)
        label(draw, point(radius + 40, i), direction, 32)
    label(draw, (cx - 10, cy), "0%", 26, anchor="rm")
    if not sectors:
        points = [point(radius * value / maximum, i) for i, value in enumerate(values)]
        draw.line(points + points[:1], fill=BLUE, width=5, joint="curve")


def short_dashes(draw, start, end, color, phase=0):
    x, y = start
    dx, dy = end[0] - x, end[1] - y
    length = hypot(dx, dy)
    if not length:
        return phase
    dash, period = 12, 20
    distance = -phase
    while distance < length:
        a = max(0, distance)
        b = min(length, distance + dash)
        if b > a:
            draw.line(
                (
                    x + dx * a / length,
                    y + dy * a / length,
                    x + dx * b / length,
                    y + dy * b / length,
                ),
                fill=color,
                width=6,
            )
        distance += period
    return (phase + length) % period


def draw_cartesian(image, box, labels, values, kind, *, approved_layout=False):
    draw = ImageDraw.Draw(image)
    left, top, right, bottom = box
    series = [column for _, column in values]
    unit_width = (right - left) / len(labels)
    centers = [left + (i + 0.5) * unit_width for i in range(len(labels))]
    dual = kind == "line"
    annual = kind == "annual"
    percent = kind in {"freq", "fit"}
    shared_peak = max((v for column in series for v in column if isfinite(v)), default=0)
    domains = []
    for index, column in enumerate(series):
        available = [v for v in column if isfinite(v)]
        step = (1 if index == 0 else 100) if dual else 2
        minimum = 0
        peak = max(available, default=0) if dual or annual else shared_peak
        if annual:
            span = max(peak - min(available), 0.2)
            step = next((s for s in (0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50) if span / 8 <= s), 100)
            minimum = max(0, floor((min(available) - step * 0.35) / step) * step)
        top_value = max(minimum + step, ceil(peak / step) * step)
        if approved_layout and kind in {"line", "freq"}:
            top_value += step
        domains.append((minimum, top_value, step))

    def y(value, index):
        low, high, _ = domains[index]
        return bottom - (value - low) / (high - low) * (bottom - top)

    for index, (low, high, step) in enumerate(domains[:2] if dual else domains[:1]):
        count = round((high - low) / step)
        label_interval = max(1, ceil(38 * count / (bottom - top)))
        for j in range(count + 1):
            tick = low + j * step
            pos = y(tick, index)
            axis_x = right if index else left
            draw.line((axis_x, pos, axis_x + (9 if index else -9), pos), fill=AXIS, width=2)
            if index == 0:
                draw.line((left, pos, right, pos), fill=GRID, width=2)
            if j % label_interval == 0 or j == count:
                caption = f"{tick:.2f}%" if percent else f"{tick:.2f}" if annual else f"{tick:g}"
                label(
                    draw,
                    (axis_x + (16 if index else -16), pos),
                    caption,
                    32,
                    anchor="lm" if index else "rm",
                )
    for x, name in zip(centers, labels, strict=True):
        if dual:
            draw.line((x, top, x, bottom), fill=GRID, width=2)
        draw.line((x, bottom, x, bottom + 8), fill=AXIS, width=2)
        if annual:
            rotated_label(image, (x - 10, bottom + 50), str(name), 45, 31)
        else:
            label(draw, (x, bottom + 30), str(name), 26 if len(labels) > 20 else 32)
    draw.rectangle(box, outline=AXIS, width=3)

    for index, column in enumerate(series):
        color = BLUE if index == 0 else GOLD if kind == "fit" else RED
        is_bar = annual or kind == "freq" or kind == "fit" and index == 0
        previous = None
        phase = 0
        for x, value in zip(centers, column, strict=True):
            if not isfinite(value):
                previous = None
                phase = 0
                continue
            height = y(value, index)
            if is_bar:
                width_fraction = (0.12 if approved_layout else 0.17) if kind == "freq" else 0.24
                half = min(62, unit_width * width_fraction)
                center = x + ((2 * index - 1) * half if kind == "freq" else 0)
                draw.rectangle((center - half, height, center + half, bottom), fill=color)
                continue
            if previous and dual and index == 1 and approved_layout:
                phase = short_dashes(draw, previous, (x, height), color, phase)
            elif previous and dual and index == 1:
                px, py = previous
                for part in (0, 2, 4, 6):
                    a, b = part / 8, (part + 1) / 8
                    draw.line(
                        (
                            px + (x - px) * a,
                            py + (height - py) * a,
                            px + (x - px) * b,
                            py + (height - py) * b,
                        ),
                        fill=color,
                        width=6,
                    )
            elif previous:
                draw.line([previous, (x, height)], fill=color, width=6)
            if dual:
                marker = (13 if index else 19) if approved_layout else 10
                if index:
                    draw.rectangle(
                        (x - marker, height - marker, x + marker, height + marker), fill=color
                    )
                else:
                    draw.polygon(
                        [
                            (x - marker, height),
                            (x, height - marker),
                            (x + marker, height),
                            (x, height + marker),
                        ],
                        fill=color,
                    )
            previous = (x, height)


def formal_figure(
    labels, series, kind, *, ratio, compass, direction, fit, stats, fit_label, approved_layout=False
):
    height = round(WIDTH / ratio)
    image = Image.new("RGB", (WIDTH, height), "white")
    draw = ImageDraw.Draw(image)
    if kind == "rose":
        draw_rose(draw, (26, 28, WIDTH - 26, height - 26), compass, series[0][1])
    elif kind == "fit":
        draw_rose(draw, (14, 70, 710, height - 58), compass, direction, sectors=True)
        draw.line((723, 62, 723, height - 63), fill=GRID, width=2)
        labels = [str(item) if i % 2 == 0 else "" for i, item in enumerate(labels)]
        plot_top = 150 if approved_layout else 184
        draw_cartesian(image, (905, plot_top, WIDTH - 55, height - 118), labels, series, kind)
        if fit_label:
            label(draw, (WIDTH - 55, 51), fit_label, anchor="rm")
        label(
            draw,
            (WIDTH - 55, 99 if fit_label else 86),
            f"A = {fit['c']:.2f} m/s    k = {fit['k']:.2f}",
            anchor="rm",
        )
        if not approved_layout:
            label(
                draw,
                (WIDTH - 55, 141),
                f"U = {stats['mean_speed']:.2f} m/s    P = {stats['power_density']:.2f} W/m²",
                30,
                anchor="rm",
            )
        rotated_label(image, (753, (height + 66) / 2), "频率（%）")
        label(draw, ((905 + WIDTH - 55) / 2, height - 45), "风速（m/s）")
    else:
        dual = kind == "line"
        annual = kind == "annual"
        main = series[:1] if annual else series
        if not annual:
            legend = ("风速", "风功率密度") if dual else ("风速频率", "风能频率")
            for index, name in enumerate(legend):
                x = (0.35 + index * 0.19) * WIDTH
                color = BLUE if index == 0 else RED
                if approved_layout and dual:
                    start, end = (x - 14, 63), (x + 26, 63)
                    if index:
                        short_dashes(draw, start, end, color)
                        draw.rectangle((x - 4, 54, x + 14, 72), fill=color)
                    else:
                        draw.line((start, end), fill=color, width=6)
                        draw.polygon(
                            [(x - 8, 63), (x + 5, 50), (x + 18, 63), (x + 5, 76)],
                            fill=color,
                        )
                else:
                    draw.rectangle((x, 53, x + 22, 73), fill=color)
                label(draw, (x + 31, 63), name, anchor="lm")
        left, top, right, bottom = (
            171,
            55 if annual else 118,
            WIDTH - (180 if dual else 64),
            height - (144 if annual else 112),
        )
        draw_cartesian(
            image, (left, top, right, bottom), labels, main, kind, approved_layout=approved_layout
        )
        rotated_label(
            image, (43, (top + bottom) / 2), "风速（m/s）" if annual or dual else "频率（%）"
        )
        if dual:
            rotated_label(image, (WIDTH - 43, (top + bottom) / 2), "风功率密度（W/m²）", 270)
        x_axis = (
            "年份" if annual else ("月份" if len(labels) == 12 else "时段") if dual else "风速区间"
        )
        label(draw, ((left + right) / 2, height - 32), x_axis)
    draw.rectangle((0, 0, WIDTH - 1, height - 1), outline="#000000", width=2)
    result = BytesIO()
    image.save(result, format="PNG")
    return result.getvalue()
