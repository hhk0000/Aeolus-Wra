"""NB/T 31147—2018 tables 5.3.6-1 and 5.3.6-2, W/m² upper boundaries."""

from bisect import bisect_right
from math import isfinite

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


def classify_power_density(height, power_density):
    result = {
        "height_m": height,
        "power_density": power_density,
        "grade": None,
        "threshold_heights_m": [],
    }
    if (
        not isfinite(height)
        or height < HEIGHTS[0]
        or not isfinite(power_density)
        or power_density < 0
    ):
        return result
    reference_height = min(height, HEIGHTS[-1])
    if reference_height in UPPER_BY_HEIGHT:
        limits = UPPER_BY_HEIGHT[reference_height]
        threshold_heights = [reference_height]
    else:
        above = bisect_right(HEIGHTS, reference_height)
        low, high = HEIGHTS[above - 1], HEIGHTS[above]
        fraction = (reference_height - low) / (high - low)
        limits = [
            a + fraction * (b - a)
            for a, b in zip(UPPER_BY_HEIGHT[low], UPPER_BY_HEIGHT[high], strict=True)
        ]
        threshold_heights = [low, high]
    result["threshold_heights_m"] = threshold_heights
    if power_density > limits[-1]:
        return result
    index = bisect_right(limits[:-1], power_density)
    low_limit = limits[index - 1] if index else 0
    high_limit = limits[index]
    return {
        **result,
        "grade": LEVELS[index],
        "lower_density": low_limit,
        "upper_density": high_limit,
    }
