export type AxisMinimumSetting = {
  mode: "default" | "auto" | "custom";
  custom: string;
};

export function getAxisMinimum(
  setting: AxisMinimumSetting,
  values: number[],
  fallback: number,
) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const custom = Number(setting.custom);
  const invalid =
    setting.mode === "custom" &&
    (!setting.custom.trim() ||
      !Number.isFinite(custom) ||
      custom < 0 ||
      custom > minimum);
  if (!values.length || setting.mode === "default" || invalid) {
    return { lower: fallback, invalid };
  }
  if (setting.mode === "custom") return { lower: custom, invalid };
  const padding = Math.max((maximum - minimum) * 0.15, 0.01);
  return {
    lower: Math.max(0, Math.floor((minimum - padding) * 100) / 100),
    invalid,
  };
}
