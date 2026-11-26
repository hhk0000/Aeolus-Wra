"""NB/T 31147—2018 tables 5.3.6-1 and 5.3.6-2, W/m² upper boundaries."""

from bisect import bisect_right

LEVELS = ("D-1", "D-2", "D-3", "1", "2", "3", "4", "5", "6", "7")
UPPER_BY_HEIGHT = {
    10: (55, 70, 85, 100, 150, 200, 250, 300, 400, 1000),
    30: (90, 110, 140, 160, 240, 320, 400, 480, 640, 1600),
    50: (110, 140, 170, 200, 300, 400, 500, 600, 800, 2000),
    70: (120, 160, 200, 240, 350, 460, 570, 690, 910, 2180),
    80: (130, 170, 210, 250, 370, 490, 600, 740, 970, 2350),
    90: (140, 180, 220, 270, 400, 520, 650, 770, 1000, 2450),
    100: (150, 190, 230, 280, 410, 540, 670, 800, 1070, 2570),
    120: (160, 200, 250, 300, 450, 580, 720, 880, 1140, 2750),
}
HEIGHTS = tuple(UPPER_BY_HEIGHT)


def classify_power_density(height, power_density, *, combined=False):
    period = "分析期" if combined else "年"
    prefix = f"{height:g} m 风速层{period}平均风功率密度为 {power_density:.2f} W/m²"
    result = {"height_m": height, "power_density": power_density, "grade": None}
    if not HEIGHTS[0] <= height <= HEIGHTS[-1]:
        return {**result, "description": f"{prefix}。高度超出表列 10～120 m 范围，等级待复核。"}
    if height in UPPER_BY_HEIGHT:
        limits = UPPER_BY_HEIGHT[height]
        method = f"按 NB/T 31147—2018 表 5.3.6-{'1' if height <= 70 else '2'}查表"
    else:
        above = bisect_right(HEIGHTS, height)
        low, high = HEIGHTS[above - 1], HEIGHTS[above]
        fraction = (height - low) / (high - low)
        limits = [
            a + fraction * (b - a)
            for a, b in zip(UPPER_BY_HEIGHT[low], UPPER_BY_HEIGHT[high], strict=True)
        ]
        method = f"参考 NB/T 31147—2018 表列 {low} m、{high} m 阈值线性插值"
    if power_density > limits[-1]:
        return {
            **result,
            "description": f"{prefix}。超过 7 级上限 {limits[-1]:g} W/m²，等级待复核。",
        }
    index = bisect_right(limits[:-1], power_density)
    low_limit = limits[index - 1] if index else 0
    high_limit = limits[index]
    grade = LEVELS[index]
    right_bracket = "]" if index == len(LEVELS) - 1 else ")"
    return {
        **result,
        "grade": grade,
        "description": (
            f"{prefix}，{method}，为 {grade} 级"
            f"（区间 [{low_limit:g}, {high_limit:g}{right_bracket} W/m²）。"
        ),
    }
