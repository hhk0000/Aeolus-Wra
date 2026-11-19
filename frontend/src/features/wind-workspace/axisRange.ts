export type AxisRangeSetting = {
  mode: "default" | "auto" | "custom";
  lower: string;
  upper: string;
};

export const defaultAxisRange: AxisRangeSetting = {
  mode: "default",
  lower: "",
  upper: "",
};

export function getAxisRange(
  setting: AxisRangeSetting,
  values: number[],
  defaultLower: number,
  defaultUpper: number,
) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const fallback = { lower: defaultLower, upper: defaultUpper, invalid: false };
  if (!values.length || setting.mode === "default") return fallback;
  if (setting.mode === "custom") {
    const lower = setting.lower ? Number(setting.lower) : defaultLower;
    const upper = setting.upper ? Number(setting.upper) : defaultUpper;
    if (
      !Number.isFinite(lower) ||
      !Number.isFinite(upper) ||
      lower < 0 ||
      lower > minimum ||
      upper < maximum ||
      upper <= lower
    ) {
      return { ...fallback, invalid: true };
    }
    return { lower, upper, invalid: false };
  }
  const padding = Math.max((maximum - minimum) * 0.15, 0.01);
  return {
    lower: Math.max(0, Math.floor((minimum - padding) * 100) / 100),
    upper: Math.ceil((maximum + padding) * 100) / 100,
    invalid: false,
  };
}
