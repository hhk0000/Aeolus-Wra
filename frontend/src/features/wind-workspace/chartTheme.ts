/** Excel/chart-template visual tokens used by every wind chart. */
/**
 * 图表当前确认的默认样式（2026-11-16）。用户未指定新样式时沿用；
 * 用户明确要求其他配色/字号时按用户要求调整，不要自行引入未要求的颜色。
 * 默认：风速 #4F81BD、风功率 #C0504D（虚线）；宋体 10；边框 #808080；
 * 网格 #D9D9D9；图例置顶。详见 .local/handoffs/2026-11-14/图表格式基线.md
 */
export const EXCEL = {
  series: ["#4F81BD", "#C0504D", "#9BBB59", "#8064A2", "#4BACC6", "#F79646"],
  weibull: "#b68400",
  font: '"Times New Roman", SimSun, "宋体", serif',
  tickSize: 11,
  text: "#404040",
  grid: "#D9D9D9",
  axis: "#808080",
  plotBorder: "#808080",
  marker: 3,
  lineWidth: 2,
};

export function excelSvgProps() {
  return {
    fontFamily: EXCEL.font,
    fontSize: EXCEL.tickSize,
    fontWeight: 700,
    fill: EXCEL.text,
  } as const;
}

export const windAxes = ["mean_speed", "power_density"] as const;
const powerAxisIntervals = 10;

export function windAxisMaximum(field: string, maximum: number) {
  if (field === "power_density") {
    return Math.max(1, Math.ceil(maximum / 100)) * 100;
  }
  return field === "mean_speed" ? Math.max(1, Math.ceil(maximum)) : maximum;
}

export function windAxisStep(
  field: (typeof windAxes)[number],
  maximum: number,
) {
  return field === "power_density"
    ? Math.max(10, maximum / powerAxisIntervals)
    : 1;
}

export const frequencyTickStep = 2;

export function frequencyAxisMaximum(maximum: number) {
  return Math.max(
    frequencyTickStep,
    Math.ceil(maximum / frequencyTickStep) * frequencyTickStep,
  );
}
