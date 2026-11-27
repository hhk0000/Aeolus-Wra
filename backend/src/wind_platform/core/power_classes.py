"""Published height-specific classes; never infer the class from mean wind speed."""

import math
from bisect import bisect_right

from wind_platform.core.calculations import CalculationError

GB_THRESHOLDS = {
    10: [100, 150, 200, 250, 300, 400, 1000],
    30: [160, 240, 320, 400, 480, 640, 1600],
    50: [200, 300, 400, 500, 600, 800, 2000],
}
NB_THRESHOLDS = {
    10: [55, 70, 85, 100, 150, 200, 250, 300, 400, 1000],
    30: [90, 110, 140, 160, 240, 320, 400, 480, 640, 1600],
    50: [110, 140, 170, 200, 300, 400, 500, 600, 800, 2000],
    70: [120, 160, 200, 240, 350, 460, 570, 690, 910, 2180],
    80: [130, 170, 210, 250, 370, 490, 600, 740, 970, 2350],
    90: [140, 180, 220, 270, 400, 520, 650, 770, 1000, 2450],
    100: [150, 190, 230, 280, 410, 540, 670, 800, 1070, 2570],
    120: [160, 200, 250, 300, 450, 580, 720, 880, 1140, 2750],
}


def power_class(height_m: float, density_wm2: float, basis="national-first") -> dict:
    if not math.isfinite(density_wm2) or density_wm2 < 0:
        raise CalculationError("风功率密度须为非负有限值。")
    if basis not in {"national-first", "industry"}:
        raise CalculationError("风功率分级依据无效。")
    use_gb = basis == "national-first" and height_m in GB_THRESHOLDS
    table = GB_THRESHOLDS if use_gb else NB_THRESHOLDS
    source = "GB/T18710-2002 表4" if use_gb else "NB/T31147-2018 表5.3.6"
    if height_m not in table:
        return {"class": None, "source": source, "note": "该高度未列入分级表，不自动插值或换算。"}
    thresholds = table[height_m]
    labels = (
        [str(n) for n in range(1, 8)] if use_gb else ["D-1", "D-2", "D-3", *map(str, range(1, 8))]
    )
    index = bisect_right(thresholds, density_wm2)
    if density_wm2 == thresholds[-1]:
        index -= 1
    return {
        "class": labels[index] if index < len(labels) else None,
        "source": source,
        "note": "以年平均风功率密度判级，界限左闭右开、最高上限含端点；非表列高度不推断。",
    }
