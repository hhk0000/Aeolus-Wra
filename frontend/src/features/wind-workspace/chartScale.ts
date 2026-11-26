export type NiceScale = {
  min: number;
  max: number;
  step: number;
  ticks: number[];
};

const NICE_MULTIPLIERS = [1, 2, 2.5, 5, 10];

function roundClean(value: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  return Number(value.toPrecision(12));
}

function niceStepAtLeast(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const exp = Math.floor(Math.log10(rawStep));
  const base = 10 ** exp;
  const fraction = rawStep / base;
  for (const mult of NICE_MULTIPLIERS) {
    if (fraction <= mult + 1e-9) {
      return roundClean(mult * base);
    }
  }
  return roundClean(10 * base);
}

/**
 * Compute Excel-like nice axis ticks with clean 1 / 2 / 2.5 / 5 * 10^n major units.
 * Respects fixed bounds when the user explicitly configures a custom range.
 */
export function computeNiceScale(
  minVal: number,
  maxVal: number,
  options?: {
    targetSteps?: number;
    fixedMin?: boolean;
    fixedMax?: boolean;
    integerOnly?: boolean;
  },
): NiceScale {
  const targetSteps = Math.max(2, options?.targetSteps ?? 5);
  const fixedMin = options?.fixedMin ?? false;
  const fixedMax = options?.fixedMax ?? false;
  const integerOnly = options?.integerOnly ?? false;

  const safeMin = Number.isFinite(minVal) ? minVal : 0;
  const safeMax = Number.isFinite(maxVal) ? maxVal : safeMin + 1;

  if (fixedMin && fixedMax && safeMax > safeMin) {
    const step = (safeMax - safeMin) / targetSteps;
    const ticks = Array.from({ length: targetSteps + 1 }, (_, i) =>
      roundClean(safeMin + i * step),
    );
    return { min: safeMin, max: safeMax, step, ticks };
  }

  const span = Math.max(safeMax - safeMin, Math.abs(safeMax) * 0.1, 1e-6);
  // Add a small headroom when max is not fixed so top data points don't hug the border.
  const paddedMax = fixedMax ? safeMax : safeMax + span * 0.04;
  const rawSpan = Math.max(paddedMax - safeMin, 1e-6);

  let step = niceStepAtLeast(rawSpan / targetSteps);
  if (integerOnly && step < 1) {
    step = 1;
  }

  const lo = fixedMin
    ? safeMin
    : roundClean(Math.floor(safeMin / step + 1e-9) * step);
  let steps = Math.max(2, Math.ceil((paddedMax - lo) / step - 1e-9));

  // Keep grid count close to Excel's crisp 4..6 intervals.
  while (steps > targetSteps + 2) {
    step = niceStepAtLeast(step * 1.25);
    if (integerOnly && step < 1) step = 1;
    steps = Math.max(2, Math.ceil((paddedMax - lo) / step - 1e-9));
  }

  const hi = fixedMax ? safeMax : roundClean(lo + steps * step);
  const ticks = Array.from({ length: steps + 1 }, (_, i) =>
    roundClean(lo + i * step),
  );
  return { min: lo, max: hi, step, ticks };
}

/**
 * Compute synchronized left and right nice scales sharing the exact same number
 * of horizontal grid intervals (default 5, matching Excel dual-axis charts).
 */
export function computeDualNiceScales(
  leftMin: number,
  leftMax: number,
  rightMin: number,
  rightMax: number,
  intervals = 5,
): { left: NiceScale; right: NiceScale } {
  const fitFixedIntervals = (loVal: number, hiVal: number): NiceScale => {
    const safeLo = Number.isFinite(loVal) ? Math.min(0, loVal) : 0;
    const safeHi = Number.isFinite(hiVal) ? Math.max(safeLo + 1e-6, hiVal) : 1;
    const paddedHi = safeHi + (safeHi - safeLo) * 0.05;
    const step = niceStepAtLeast((paddedHi - safeLo) / intervals);
    const lo = roundClean(Math.floor(safeLo / step + 1e-9) * step);
    const hi = roundClean(lo + intervals * step);
    const ticks = Array.from({ length: intervals + 1 }, (_, i) =>
      roundClean(lo + i * step),
    );
    return { min: lo, max: hi, step, ticks };
  };

  return {
    left: fitFixedIntervals(leftMin, leftMax),
    right: fitFixedIntervals(rightMin, rightMax),
  };
}

/**
 * Compute Excel-like integer percentage rings for wind rose / radar charts.
 */
export function computeRoseNiceScale(rawMax: number): NiceScale {
  const safeMax = Math.max(1, Number.isFinite(rawMax) ? rawMax : 5);
  const candidates = [1, 2, 5, 10, 15, 20, 25, 50];
  let step = 5;
  for (const c of candidates) {
    if (Math.ceil(safeMax / c) <= 6) {
      step = c;
      break;
    }
  }
  const steps = Math.max(3, Math.ceil(safeMax / step));
  const max = steps * step;
  const ticks = Array.from({ length: steps }, (_, i) => (i + 1) * step);
  return { min: 0, max, step, ticks };
}

/**
 * Format tick values following wind-measurement-reference.xlsx conventions:
 * - wind speed: 1 decimal ("0.0")
 * - wind power density: integer ("0")
 * - frequency / general: minimal clean decimals based on step size
 */
export function formatAxisTick(
  value: number,
  step: number,
  kind?: "speed" | "power" | "density" | "frequency" | "ti" | "shear" | "auto",
): string {
  const clean = Math.abs(value) < 1e-9 ? 0 : value;
  if (kind === "power") return clean.toFixed(0);
  if (kind === "speed") return clean.toFixed(step < 0.1 ? 2 : 1);
  if (kind === "density") {
    return clean.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 2);
  }
  if (kind === "ti" || kind === "shear") {
    return clean.toFixed(step < 0.01 ? 3 : 2);
  }
  if (kind === "frequency") {
    return clean.toFixed(step < 1 ? 2 : 1);
  }
  if (step >= 1 && Math.abs(clean - Math.round(clean)) < 1e-6) {
    return clean.toFixed(0);
  }
  if (step >= 0.1) return clean.toFixed(1);
  if (step >= 0.01) return clean.toFixed(2);
  return clean.toFixed(3);
}
