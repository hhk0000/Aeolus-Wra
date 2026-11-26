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
  tickLength: 5,
  text: "#404040",
  grid: "#D9D9D9",
  axis: "#808080",
  plotBorder: "#808080",
  marker: 3,
  diamondSize: 8,
  squareSize: 7,
  lineWidth: 2.2,
  roseLineWidth: 2.6,
};

export function excelSvgProps() {
  return {
    fontFamily: EXCEL.font,
    fontSize: EXCEL.tickSize,
    fontWeight: 700,
    fill: EXCEL.text,
  } as const;
}
