import { useEffect, useRef, useState } from "react";
import { api, downloadJson } from "./api";
import type { Run, RunOutput } from "./api";
import { useChartTextSize } from "./chartText";
import {
  EXCEL,
  frequencyAxisMaximum,
  frequencyTickStep,
  windAxisMaximum,
} from "./chartTheme";
import { RoseChart } from "./RoseChart";
import { AxisRange } from "./AxisRangeControl";
import { defaultAxisRange, getAxisRange } from "./axisRange";
import { FrequencyAxisTicks, WindAxisTicks } from "./WindAxisTicks";

const palette = EXCEL.series;
const seriesColor = (key: string, index: number) =>
  key === "fitted_frequency" ? EXCEL.weibull : palette[index % palette.length];
const labels: Record<string, string> = {
  channel: "通道",
  direction_name: "实测风向通道",
  direction_height: "风向高度 m",
  source_stage: "实测来源",
  height: "高度 m",
  period: "时段",
  count: "样本数",
  expected: "应测数",
  expected_count: "应测数",
  record_count: "记录数",
  valid_count: "有效数",
  raw_records: "原始记录数",
  raw_valid: "原始有效数",
  qc_valid: "质控有效数",
  retention_percent: "保留率 %",
  standard_completeness_percent: "应测完整率 %",
  hourly_standard_completeness_percent: "小时完整率 %",
  mean_speed: "平均风速 m/s",
  power_density: "风功率密度 W/m²",
  energy_density_wh_m2: "风能密度 Wh/m²",
  density: "空气密度 kg/m³",
  temperature_c: "气温 ℃",
  pressure_pa: "气压 Pa",
  frequency: "风频 %",
  energy_frequency: "风能频率 %",
  fitted_frequency: "Weibull频率 %",
  bin: "风速箱中心 m/s",
  label: "分箱 / 方位",
  mean: "平均TI",
  std: "TI标准差",
  characteristic: "特征TI",
  representative: "代表TI",
  sufficient_samples: "样本充足",
  alpha: "切变指数α",
  low: "高度1 m",
  high: "高度2 m",
  group: "统计组",
  r: "Pearson r",
  r_squared: "决定系数R²",
  p_value: "双侧p值",
  slope: "斜率",
  intercept: "截距",
  rmse: "RMSE m/s",
  sector: "扇区序号",
  month: "月份",
  window: "窗口 年",
  complete: "完整周年",
  concurrent: "测风同期",
  coverage_percent: "覆盖率 %",
  reason: "需补充条件",
  year: "年份",
  maximum_10min: "年最大10min m/s",
  decision: "判定",
  rule: "审核规则",
  value: "数值",
  reference: "参考条件",
  timestamp: "时间",
  effective_hours_3_25: "3–25m/s小时数",
  maximum: "最大值 m/s",
  minimum: "最小值 m/s",
  degrees: "中心方位 °",
  offset: "相对年序",
  quantity: "要素",
  meets_90_percent_at_selected_step: "本步长完整率≥90%",
};
function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number")
    return Number.isInteger(value)
      ? String(value)
      : Math.abs(value) < 0.0001 && value !== 0
        ? value.toExponential(3)
        : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
const numeric = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function DataTable({
  rows,
  footer,
  continuous = false,
  highlightBin,
  hiddenColumns,
}: {
  rows: Record<string, unknown>[];
  footer?: Record<string, unknown>;
  continuous?: boolean;
  highlightBin?: number;
  hiddenColumns?: string[];
}) {
  const [page, setPage] = useState(0);
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter(
    (key) =>
      key !== "points" &&
      key !== "through_origin" &&
      key !== "wind_year_deviation" &&
      !hiddenColumns?.includes(key),
  );
  const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / 60) - 1));
  const visibleRows = continuous
    ? rows
    : rows.slice(safePage * 60, (safePage + 1) * 60);
  const deviationMax = rows.reduce(
    (largest, row) =>
      numeric(row.wind_year_deviation)
        ? Math.max(largest, Math.abs(row.wind_year_deviation))
        : largest,
    2,
  );
  return (
    <>
      <div
        className={`ww-table-scroll${continuous ? " ww-continuous-table" : ""}`}
        tabIndex={continuous ? 0 : undefined}
        role={continuous ? "region" : undefined}
        aria-label={continuous ? "季度统计明细" : undefined}
      >
        <table className="ww-result-table">
          <thead>
            <tr>
              {keys.map((key) => (
                <th key={key}>
                  {key === "风年类型" ? (
                    <span className="ww-year-deviation">
                      <span>风年类型</span>
                      <span />
                      <span className="ww-year-zero">0%</span>
                    </span>
                  ) : (
                    (labels[key] ?? key)
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr
                key={i}
                className={
                  row.concurrent === true
                    ? "ww-concurrent-row"
                    : highlightBin !== undefined && row.bin === highlightBin
                      ? "ww-turbulence-reference-row"
                      : undefined
                }
              >
                {keys.map((key) => (
                  <td
                    key={key}
                    title={display(row[key])}
                    className={
                      key === "风年类型" ? "ww-wind-year-cell" : undefined
                    }
                  >
                    {key === "风年类型" && numeric(row.wind_year_deviation) ? (
                      <span className="ww-year-deviation">
                        <span>{display(row[key])}</span>
                        <span className="ww-year-percent">
                          {row.wind_year_deviation > 0 ? "+" : ""}
                          {row.wind_year_deviation.toFixed(1)}%
                        </span>
                        <span className="ww-year-track" aria-hidden="true">
                          <span
                            className={`ww-year-bar ${row.wind_year_deviation >= 0 ? "higher" : "lower"}${row[key] === "平风年" ? " typical" : ""}`}
                          >
                            <i
                              style={{
                                width:
                                  (100 * Math.abs(row.wind_year_deviation)) /
                                    deviationMax +
                                  "%",
                              }}
                            />
                          </span>
                        </span>
                      </span>
                    ) : (
                      display(row[key])
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {footer && (
              <tr className="ww-table-summary">
                {keys.map((key) => (
                  <td key={key}>{display(footer[key])}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
        {!rows.length && (
          <p className="ww-inline-note">该筛选下没有数据记录。</p>
        )}
      </div>
      {!continuous && rows.length > 60 && (
        <div className="ww-table-pages">
          <span>
            {rows.length}行 · 第{safePage + 1}/{Math.ceil(rows.length / 60)}页
          </span>
          <button
            className="ww-button"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            上一页
          </button>
          <button
            className="ww-button"
            disabled={(safePage + 1) * 60 >= rows.length}
            onClick={() => setPage(safePage + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </>
  );
}

function RosePlot({
  rows,
  energy = false,
  rose = "line",
  zoom = "1",
  title,
}: {
  rows: Record<string, unknown>[];
  energy?: boolean;
  rose?: string;
  zoom?: string;
  title?: string;
}) {
  return (
    <RoseChart
      rows={rows}
      energy={energy}
      rose={rose}
      zoom={zoom}
      title={title ?? (energy ? "风能方向频率" : "风向频率")}
    />
  );
}

function MovableMeanLabel({
  x,
  y,
  size,
  width,
  height,
  label,
}: {
  x: number;
  y: number;
  size: number;
  width: number;
  height: number;
  label: string;
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const move = (text: SVGTextElement, nextX: number, nextY: number) => {
    const textWidth = text.getBBox().width;
    setOffset({
      x: Math.min(width - 8, Math.max(textWidth + 8, nextX)) - x,
      y: Math.min(height - 8, Math.max(size + 4, nextY)) - y,
    });
  };
  const toSvg = (text: SVGTextElement, clientX: number, clientY: number) => {
    const matrix = text.ownerSVGElement?.getScreenCTM();
    return (
      matrix && new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
    );
  };
  return (
    <text
      x={x + offset.x}
      y={y + offset.y}
      textAnchor="end"
      fontSize={size}
      fill="#a9332b"
      stroke="white"
      strokeWidth="3"
      paintOrder="stroke"
      className="ww-movable-mean"
      tabIndex={0}
      aria-label={`${label}，拖动或使用方向键移动，按 Home 复位`}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        const point = toSvg(event.currentTarget, event.clientX, event.clientY);
        if (!point) return;
        drag.current = {
          id: event.pointerId,
          x: point.x - x - offset.x,
          y: point.y - y - offset.y,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const origin = drag.current;
        if (origin?.id !== event.pointerId) return;
        const point = toSvg(event.currentTarget, event.clientX, event.clientY);
        if (point)
          move(event.currentTarget, point.x - origin.x, point.y - origin.y);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 20 : 5;
        switch (event.key) {
          case "Home":
            setOffset({ x: 0, y: 0 });
            break;
          case "ArrowLeft":
            move(event.currentTarget, x + offset.x - step, y + offset.y);
            break;
          case "ArrowRight":
            move(event.currentTarget, x + offset.x + step, y + offset.y);
            break;
          case "ArrowUp":
            move(event.currentTarget, x + offset.x, y + offset.y - step);
            break;
          case "ArrowDown":
            move(event.currentTarget, x + offset.x, y + offset.y + step);
            break;
          default:
            return;
        }
        event.preventDefault();
      }}
    >
      {label}
    </text>
  );
}

function CartesianPlot({
  rows,
  outputId,
  means = [],
  bars = true,
  showConcurrent = true,
  compact = false,
  annualMinimum = 0,
  annualMaximum,
  annualCustomAxis = false,
  showMeanLabel = false,
}: {
  rows: Record<string, unknown>[];
  outputId: string;
  means?: Record<string, unknown>[];
  bars?: boolean;
  showConcurrent?: boolean;
  compact?: boolean;
  annualMinimum?: number;
  annualMaximum?: number;
  annualCustomAxis?: boolean;
  showMeanLabel?: boolean;
}) {
  const textSize = useChartTextSize();
  const isAnnual = outputId === "reference-years";
  const isTI = outputId === "turbulence";
  const isFrequency = outputId === "frequency" || outputId === "weibull";
  const isShear = outputId === "shear";
  const keys = isTI
    ? ["mean", "characteristic", "representative"]
    : isFrequency
      ? [
          "frequency",
          "energy_frequency",
          ...(outputId === "weibull" ? ["fitted_frequency"] : []),
        ]
      : isShear
        ? ["alpha"]
        : outputId === "density"
          ? ["density"]
          : ["mean_speed", ...(!isAnnual ? ["power_density"] : [])];
  const used = keys.filter((key) => rows.some((r) => numeric(r[key])));
  if (!used.length || !rows.length) return null;
  const tickSize = compact ? 17 : 13;
  const axisSize = textSize(tickSize);
  const frequencyTop = isFrequency
    ? frequencyAxisMaximum(
        Math.max(
          0,
          ...rows.flatMap((row) => used.map((key) => Number(row[key]) || 0)),
        ),
      )
    : 0;
  const extraHeight = Math.max(
    0,
    (frequencyTop / frequencyTickStep) * (axisSize + 5) - 190,
  );
  const dual = used.includes("mean_speed") && used.includes("power_density");
  const w = isAnnual
      ? Math.max(900, rows.length * axisSize * 1.5 + 160)
      : compact
        ? 480
        : 900,
    h = compact ? 250 + extraHeight : isAnnual ? 390 : 350 + extraHeight,
    left = compact ? 48 : dual ? Math.max(66, 5 * axisSize + 12) : 66,
    right = compact ? 433 : dual ? w - Math.max(70, 4 * axisSize + 16) : w - 70,
    top = compact ? 18 : dual ? 2 * axisSize + 22 : 35,
    bottom = (compact ? 215 : 285) + extraHeight;
  const rawMaximum = (key: string) =>
    isAnnual && annualMaximum !== undefined
      ? annualMaximum
      : Math.max(
          1e-6,
          ...rows.map((r) => Number(r[key]) || 0),
          ...(key === "mean_speed"
            ? means.map((r) => Number(r.mean_speed) || 0)
            : []),
        );
  const maxima = new Map(
    used.map((key) => {
      const maximum = rawMaximum(key);
      return [
        key,
        dual
          ? windAxisMaximum(key, maximum)
          : isAnnual && annualMaximum !== undefined
            ? maximum
            : maximum * 1.15,
      ];
    }),
  );
  const maxFor = (key: string) =>
    isFrequency ? frequencyTop : (maxima.get(key) ?? 1);
  const minFor = (key: string) =>
    dual
      ? 0
      : isAnnual
        ? annualMinimum
        : Math.min(0, ...rows.map((r) => Number(r[key]) || 0));
  const x = (i: number) => left + ((i + 0.5) / rows.length) * (right - left);
  const y = (value: number, key: string) =>
    bottom -
    ((value - minFor(key)) / (maxFor(key) - minFor(key))) * (bottom - top);
  const label = (row: Record<string, unknown>) =>
    String(row.period ?? row.bin ?? row.label ?? row.group ?? "");
  return (
    <figure className="ww-plot-figure">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="真实计算结果图"
        fontFamily={EXCEL.font}
        fontWeight="700"
        fontSize={textSize(tickSize)}
      >
        <rect width={w} height={h} fill="white" />
        <line x1={left} y1={top} x2={left} y2={bottom} stroke={EXCEL.axis} />
        <line
          x1={left}
          y1={bottom}
          x2={right}
          y2={bottom}
          stroke={EXCEL.axis}
        />
        {compact &&
          dual &&
          rows.map((_, i) => (
            <line
              key={`v-${i}`}
              x1={x(i)}
              x2={x(i)}
              y1={top}
              y2={bottom}
              stroke={EXCEL.grid}
            />
          ))}
        {dual ? (
          <WindAxisTicks left={left} right={right} maximum={maxFor} y={y} />
        ) : isFrequency ? (
          <FrequencyAxisTicks
            left={left}
            right={right}
            maximum={frequencyTop}
            y={(value) => y(value, used[0])}
          />
        ) : (
          [0, 1, 2, 3, 4].map((n) => (
            <g key={n}>
              <line
                x1={left}
                x2={right}
                y1={top + (n * (bottom - top)) / 4}
                y2={top + (n * (bottom - top)) / 4}
                stroke={EXCEL.grid}
              />
              <text
                x={left - 8}
                y={top + (n * (bottom - top)) / 4 + 4}
                textAnchor="end"
                fontSize={textSize(tickSize)}
                fill={EXCEL.text}
              >
                {(
                  maxFor(used[0]) -
                  (n / 4) * (maxFor(used[0]) - minFor(used[0]))
                ).toFixed(
                  isTI || isShear ? 3 : isAnnual && annualCustomAxis ? 2 : 1,
                )}
              </text>
            </g>
          ))
        )}
        {(!isAnnual || bars ? used : []).map((key, k) => (
          <g key={key}>
            {(isAnnual || isFrequency || outputId === "density") &&
            key !== "fitted_frequency" &&
            bars ? (
              rows.map(
                (row, i) =>
                  numeric(row[key]) &&
                  (!isAnnual || showConcurrent || !row.concurrent) && (
                    <rect
                      key={i}
                      x={
                        x(i) -
                        ((right - left) / rows.length) * 0.35 +
                        ((k * (right - left)) / rows.length) * 0.25
                      }
                      y={y(Number(row[key]), key)}
                      width={Math.max(
                        0.5,
                        ((right - left) / rows.length) *
                          (isFrequency ? 0.25 : 0.65),
                      )}
                      height={bottom - y(Number(row[key]), key)}
                      fill={
                        isAnnual && row.concurrent
                          ? "#e3b341"
                          : seriesColor(key, k)
                      }
                      opacity={row.complete === false ? 0.35 : 0.8}
                    >
                      <title>
                        {label(row)} · {labels[key]}：{display(row[key])}
                        {row.complete === false ? "（不完整周年）" : ""}
                      </title>
                    </rect>
                  ),
              )
            ) : (
              <>
                <polyline
                  fill="none"
                  stroke={seriesColor(key, k)}
                  strokeWidth={compact && dual ? 2.5 : EXCEL.lineWidth}
                  strokeDasharray={
                    dual && key === "power_density"
                      ? compact
                        ? "6 4"
                        : "1 2"
                      : undefined
                  }
                  points={rows
                    .map((row, i) =>
                      numeric(row[key])
                        ? `${x(i)},${y(Number(row[key]), key)}`
                        : "",
                    )
                    .filter(Boolean)
                    .join(" ")}
                />
                {rows.map((row, i) => {
                  if (!numeric(row[key])) return null;
                  const cx = x(i),
                    cy = y(Number(row[key]), key);
                  return compact && dual ? (
                    <g key={i}>
                      {k === 0 ? (
                        <rect
                          x={cx - 6}
                          y={cy - 6}
                          width="12"
                          height="12"
                          transform={`rotate(45 ${cx} ${cy})`}
                          fill={seriesColor(key, k)}
                        />
                      ) : (
                        <rect
                          x={cx - 5}
                          y={cy - 5}
                          width="10"
                          height="10"
                          fill={seriesColor(key, k)}
                        />
                      )}
                      <title>
                        {label(row)} · {labels[key]}：{display(row[key])}
                      </title>
                    </g>
                  ) : (
                    <circle
                      key={i}
                      cx={cx}
                      cy={cy}
                      r={EXCEL.marker}
                      fill={seriesColor(key, k)}
                    >
                      <title>
                        {label(row)} · {labels[key]}：{display(row[key])}
                      </title>
                    </circle>
                  );
                })}
              </>
            )}
          </g>
        ))}
        {means
          .filter((m) => numeric(m.mean_speed))
          .map((m, i) => (
            <g key={String(m.years ?? i)}>
              <line
                x1={left}
                x2={right}
                y1={y(Number(m.mean_speed), "mean_speed")}
                y2={y(Number(m.mean_speed), "mean_speed")}
                stroke="#c0392b"
                strokeWidth="2"
              />
              {isAnnual && showMeanLabel && (
                <MovableMeanLabel
                  x={right - 4}
                  y={Math.max(
                    axisSize + 4,
                    y(Number(m.mean_speed), "mean_speed") - 7,
                  )}
                  size={axisSize}
                  width={w}
                  height={h}
                  label={`${String(m.years)} 年中尺度均值 ${Number(m.mean_speed).toFixed(3)} m/s`}
                />
              )}
            </g>
          ))}
        {rows.map(
          (row, i) =>
            (isAnnual ||
              i % Math.max(1, Math.ceil(rows.length / (compact ? 8 : 13))) ===
                0) && (
              <text
                key={i}
                x={isAnnual ? 0 : x(i)}
                y={isAnnual ? 0 : bottom + 20}
                transform={
                  isAnnual
                    ? "translate(" +
                      x(i) +
                      " " +
                      (bottom + 13) +
                      ") rotate(-45)"
                    : undefined
                }
                textAnchor={isAnnual ? "end" : "middle"}
                fill={EXCEL.text}
                fontSize={axisSize}
              >
                {isAnnual ? label(row).slice(0, 4) : label(row)}
              </text>
            ),
        )}
        {!compact && (
          <>
            <text
              x={(left + right) / 2}
              y={h - 6}
              textAnchor="middle"
              fontSize={textSize(tickSize)}
              fill={EXCEL.text}
            >
              {outputId === "monthly" || outputId === "density"
                ? "月份"
                : outputId === "hourly" || outputId === "monthly-hourly"
                  ? "时段"
                  : outputId === "frequency"
                    ? "风速区间"
                    : outputId === "turbulence"
                      ? "湍流强度"
                      : isAnnual
                        ? "年份"
                        : ""}
            </text>
            {dual && (
              <text
                x={w - 14}
                y={top - axisSize - 12}
                textAnchor="end"
                fontSize={axisSize}
                fill={palette[1]}
              >
                风功率密度 (W/m²)
              </text>
            )}
            <text
              transform={`translate(${dual ? axisSize + 4 : 14} ${(top + bottom) / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize={textSize(tickSize)}
              fill={EXCEL.text}
            >
              {isAnnual
                ? "平均风速(m/s)"
                : isFrequency
                  ? "风速频率（%）"
                  : labels[used[0]]}
            </text>
          </>
        )}
      </svg>
      {!compact && (
        <div className="ww-plot-legend" aria-label="图例">
          {isAnnual ? (
            <>
              <span>
                <i className="box" style={{ backgroundColor: palette[0] }} />
                周年均值（蓝柱）
              </span>
              {bars && showConcurrent && (
                <span style={{ color: "#79570d" }}>
                  <i className="box" style={{ backgroundColor: "#e3b341" }} />
                  实测同期（黄柱）
                </span>
              )}
              {means.length > 0 && (
                <span>
                  <i style={{ borderColor: "#c0392b" }} />
                  中尺度均值线
                </span>
              )}
            </>
          ) : (
            used.map((key, i) => (
              <span key={key} style={{ color: seriesColor(key, i) }}>
                <i style={{ borderColor: seriesColor(key, i) }} />
                {labels[key]}
              </span>
            ))
          )}
        </div>
      )}
    </figure>
  );
}

export function ScatterPlot({ row }: { row: Record<string, unknown> }) {
  const textSize = useChartTextSize();
  const points = (row.points ?? []) as number[][];
  if (!points.length)
    return (
      <div className="ww-simple-empty">
        <p>没有同期有效样本</p>
      </div>
    );
  const w = 640,
    h = 430,
    L = 70,
    R = 610,
    T = Math.max(78, textSize(68) + 8),
    B = 366;
  const max = Math.max(1, ...points.flat()) * 1.08;
  const x = (v: number) => L + (v / max) * (R - L);
  const y = (v: number) => B - (v / max) * (B - T);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`${row.label}扇区同期散点图`}
      fontFamily={EXCEL.font}
      fontWeight="700"
      fontSize={textSize(13)}
    >
      <rect width={w} height={h} fill="white" />
      <rect
        x={L}
        y={T}
        width={R - L}
        height={B - T}
        fill="none"
        stroke={EXCEL.axis}
        strokeWidth="1"
      />
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line
            x1={L}
            x2={R}
            y1={y(f * max)}
            y2={y(f * max)}
            stroke={EXCEL.grid}
          />
          <line
            x1={x(f * max)}
            x2={x(f * max)}
            y1={T}
            y2={B}
            stroke={EXCEL.grid}
          />
          <text
            x={L - 6}
            y={y(f * max) + 3}
            fontSize={textSize(13)}
            textAnchor="end"
            fill={EXCEL.text}
          >
            {(f * max).toFixed(0)}
          </text>
          <text
            x={x(f * max)}
            y={B + 16}
            fontSize={textSize(13)}
            textAnchor="middle"
            fill={EXCEL.text}
          >
            {(f * max).toFixed(0)}
          </text>
        </g>
      ))}
      {points.map(([a, b], i) => (
        <circle
          key={i}
          cx={x(a)}
          cy={y(b)}
          r="2"
          fill={EXCEL.series[0]}
          opacity=".45"
        />
      ))}
      {numeric(row.slope) && (
        <>
          <line
            x1={x(Number(row.x_min))}
            y1={y(
              Number(row.slope) * Number(row.x_min) + Number(row.intercept),
            )}
            x2={x(Number(row.x_max))}
            y2={y(
              Number(row.slope) * Number(row.x_max) + Number(row.intercept),
            )}
            stroke={EXCEL.series[1]}
            strokeWidth="4"
            strokeDasharray="6 4"
          />
          <text
            x={L}
            y={textSize(23) + 3}
            fontSize={textSize(23)}
            fontWeight="700"
            fill={EXCEL.text}
          >
            y = {display(row.slope)}x {Number(row.intercept) < 0 ? "−" : "+"}{" "}
            {display(Math.abs(Number(row.intercept)))}
          </text>
          <text
            x={L}
            y={textSize(45) + 5}
            fontSize={textSize(16)}
            fill={EXCEL.text}
          >
            <tspan>r = {display(row.r)}</tspan>
            <tspan dx="20">R² = {display(row.r_squared)}</tspan>
            <tspan x={L} dy={textSize(19)}>
              p = {display(row.p_value)}
            </tspan>
            <tspan dx="20">n = {display(row.count)}</tspan>
          </text>
        </>
      )}
      <text
        x={(L + R) / 2}
        y={h - 6}
        textAnchor="middle"
        fontSize={textSize(13)}
        fill={EXCEL.text}
      >
        参考站风速(m/s)
      </text>
      <text
        transform={`translate(16 ${(T + B) / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize={textSize(13)}
        fill={EXCEL.text}
      >
        测风塔风速(m/s)
      </text>
    </svg>
  );
}

function exportSvg(svg: SVGSVGElement, filename: string) {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(copy)], {
      type: "image/svg+xml;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ShearPlots({
  rows,
  summary,
}: {
  rows: Record<string, unknown>[];
  summary?: Record<string, unknown>;
}) {
  const textSize = useChartTextSize();
  const profile = (summary?.profile ?? []) as {
    height: number;
    mean_speed: number;
  }[];
  const maxH = Math.max(1, ...profile.map((p) => p.height)) * 1.1;
  const maxV = Math.max(1, ...profile.map((p) => p.mean_speed)) * 1.2;
  const x = (v: number) => 65 + (v / maxV) * 700,
    y = (h: number) => 285 - (h / maxH) * 245;
  const curve = Array.from({ length: 60 }, (_, i) => (maxH * (i + 1)) / 60)
    .map(
      (h) =>
        `${x(Math.exp(Number(summary?.intercept)) * h ** Number(summary?.alpha))},${y(h)}`,
    )
    .join(" ");
  return (
    <>
      <h3>
        综合风廓线 · α={display(summary?.alpha)} · 对数拟合R²=
        {display(summary?.r_squared)}
      </h3>
      <svg
        viewBox="0 0 900 350"
        role="img"
        aria-label="同支臂实测风廓线与幂律拟合"
        fontFamily={EXCEL.font}
        fontWeight="700"
        fontSize={textSize(13)}
      >
        <rect width="900" height="350" fill="white" />
        <rect
          x="65"
          y="30"
          width="700"
          height="255"
          fill="none"
          stroke={EXCEL.axis}
          strokeWidth="1"
        />
        {[0, 1, 2, 3, 4].map((n) => (
          <g key={n}>
            <line
              x1="65"
              x2="765"
              y1={y((n * maxH) / 4)}
              y2={y((n * maxH) / 4)}
              stroke={EXCEL.grid}
            />
            <text
              x="56"
              y={y((n * maxH) / 4) + 4}
              textAnchor="end"
              fontSize={textSize(13)}
              fill={EXCEL.text}
            >
              {((n * maxH) / 4).toFixed(0)}
            </text>
            <text
              x={x((n * maxV) / 4)}
              y="306"
              textAnchor="middle"
              fontSize={textSize(13)}
              fill={EXCEL.text}
            >
              {((n * maxV) / 4).toFixed(1)}
            </text>
          </g>
        ))}
        <polyline
          points={curve}
          fill="none"
          stroke={EXCEL.series[1]}
          strokeDasharray="5 3"
          strokeWidth="2"
        />
        {profile.map((p) => (
          <circle
            key={p.height}
            cx={x(p.mean_speed)}
            cy={y(p.height)}
            r="5"
            fill={EXCEL.series[0]}
          >
            <title>
              {p.height}m：{p.mean_speed.toFixed(4)}m/s
            </title>
          </circle>
        ))}
        <text x="65" y="20" fontSize={textSize(13)} fill={EXCEL.text}>
          高度 m
        </text>
        <text
          x="450"
          y="333"
          fontSize={textSize(13)}
          textAnchor="middle"
          fill={EXCEL.text}
        >
          风速 m/s · 实测同期均值（绿点） / 幂律拟合（虚线）
        </text>
      </svg>
      <div className="ww-month-grid">
        {["月", "时"].map((prefix) => (
          <article key={prefix}>
            <h3>{prefix === "月" ? "逐月风切变" : "日内逐时风切变"}</h3>
            <CartesianPlot
              rows={rows
                .filter((r) => String(r.group).startsWith(prefix))
                .map((r) => ({ ...r, period: String(r.group).slice(1) }))}
              outputId="shear"
            />
          </article>
        ))}
      </div>
    </>
  );
}

export function BaseResultView({
  run,
  output,
  outputId,
  exportMode = false,
}: {
  run: Run;
  output: RunOutput;
  outputId: string;
  exportMode?: boolean;
}) {
  const [selectedChannel, setSelectedChannel] = useState("");
  const [month, setMonth] = useState("");
  const [windowValue, setWindowValue] = useState("");
  const [hiddenMeans, setHiddenMeans] = useState<string[]>([]);
  const [roseKind, setRoseKind] = useState<"wd" | "wpd">("wd");
  const [roseStyle, setRoseStyle] = useState("line");
  const [roseZoom, setRoseZoom] = useState("1");
  const [ltWindow, setLtWindow] = useState("30");
  const [ltBars, setLtBars] = useState(true);
  const [annualAxis, setAnnualAxis] = useState(defaultAxisRange);
  const [showMeanLabel, setShowMeanLabel] = useState(false);
  const [ltConcurrent, setLtConcurrent] = useState(true);
  const [ltLine, setLtLine] = useState(true);
  const [monthScope, setMonthScope] = useState("q1");
  const [monthPage, setMonthPage] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const allRows = output.rows ?? [];
  const channels = [
    ...new Set(allRows.map((r) => r.channel).filter(Boolean)),
  ].map(String);
  const channel = channels.includes(selectedChannel)
    ? selectedChannel
    : channels[0];
  const months = [
    ...new Set(
      allRows.map((r) => r.month).filter((v) => typeof v === "number" && v > 0),
    ),
  ].map(String);
  const windows = [
    ...new Set(allRows.map((r) => r.window).filter(Boolean)),
  ].map(String);
  const monthFilter = months.includes(month) ? month : months[0];
  const windowFilter = windows.includes(windowValue) ? windowValue : windows[0];
  const monthlyKey =
    outputId === "reference-rose" && windowFilter
      ? "/runs/" + run.id + "/reference-monthly-rose?window=" + windowFilter
      : "";
  const [monthlyRose, setMonthlyRose] = useState<{
    key: string;
    rows?: Record<string, unknown>[];
    error?: string;
  }>();
  useEffect(() => {
    if (!monthlyKey || exportMode) return;
    const controller = new AbortController();
    void api<Record<string, unknown>[]>(
      monthlyKey,
      undefined,
      controller.signal,
    )
      .then((rows) => {
        if (!controller.signal.aborted)
          setMonthlyRose({ key: monthlyKey, rows });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setMonthlyRose({ key: monthlyKey, error: String(error) });
      });
    return () => controller.abort();
  }, [exportMode, monthlyKey]);
  const currentMonthlyRose =
    monthlyRose?.key === monthlyKey ? monthlyRose : undefined;
  const monthlyRows =
    currentMonthlyRose?.rows ??
    (output.summary?.monthly_rose_rows as
      Record<string, unknown>[] | undefined);
  const rows = allRows.filter(
    (r) =>
      (!channel || r.channel === channel) &&
      (!months.length || String(r.month) === monthFilter) &&
      (!windows.length || String(r.window) === windowFilter),
  );
  const densityValues = rows
    .map((r) => Number(r.density))
    .filter((v) => Number.isFinite(v));
  const meanOf = (key: string) => {
    const values = rows.map((r) => Number(r[key])).filter(Number.isFinite);
    return values.length
      ? values.reduce((sum, v) => sum + v, 0) / values.length
      : undefined;
  };
  const densityFooter =
    outputId === "density" && densityValues.length
      ? {
          period: "平均",
          density:
            densityValues.reduce((sum, v) => sum + v, 0) / densityValues.length,
          temperature_c: meanOf("temperature_c"),
          pressure_pa: meanOf("pressure_pa"),
        }
      : undefined;
  const isRose = outputId.includes("rose");
  const isScatter = outputId === "correlation";
  const parameters = (
    (output.summary?.channels ?? []) as Record<string, unknown>[]
  ).find((p) => p.channel === channel);
  const means = (output.summary?.means ?? []) as Record<string, unknown>[];
  const meanColor = () => "#c0392b";
  const visibleMeans: Record<string, unknown>[] = means
    .filter((m) => !hiddenMeans.includes(String(m.years)))
    .map((m) => ({ ...m, color: meanColor() }));
  const isAnnual = outputId === "reference-years";
  const monthNumbers = Array.from({ length: 12 }, (_, index) => index + 1);
  const tableMonths = monthNumbers.filter(
    (m) =>
      monthScope === "all" ||
      Number(monthScope) === m ||
      monthScope === `q${Math.ceil(m / 3)}`,
  );
  const displayedMonth = tableMonths[monthPage] ?? tableMonths[0];
  const quarterly = monthScope.startsWith("q");
  const rowsForMonth = (m: number) =>
    rows.filter((row) => Number(String(row.period).slice(0, 2)) === m);
  const monthRanges = exportMode
    ? [1, 2, 3, 4].map((q) => monthNumbers.slice((q - 1) * 3, q * 3))
    : [quarterly ? tableMonths : [displayedMonth]];
  const activeWindow = means.some((m) => String(m.years) === ltWindow)
    ? ltWindow
    : String(means[0]?.years ?? 30);
  const annualRows = isAnnual
    ? rows.slice(-Math.max(1, Number(activeWindow) || 30))
    : rows;
  const baseline = means.find(
    (m) => String(m.years) === activeWindow,
  )?.mean_speed;
  const annualTable = isAnnual
    ? annualRows.map((row) => {
        const speed = row.mean_speed;
        const classified =
          row.complete === true &&
          numeric(baseline) &&
          baseline > 0 &&
          numeric(speed);
        return {
          ...row,
          wind_year_deviation: classified ? (speed / baseline - 1) * 100 : null,
          风年类型: !classified
            ? "—"
            : speed > baseline * 1.02
              ? "大风年"
              : speed < baseline * 0.98
                ? "小风年"
                : "平风年",
        };
      })
    : rows;
  const chartMeans: Record<string, unknown>[] = isAnnual
    ? ltLine
      ? means
          .filter((m) => String(m.years) === activeWindow)
          .map((m) => ({ ...m, color: meanColor() }))
      : []
    : visibleMeans;
  const annualValues = isAnnual
    ? [
        ...(ltBars
          ? annualRows.filter((row) => ltConcurrent || !row.concurrent)
          : []),
        ...chartMeans,
      ]
        .map((row) => row.mean_speed)
        .filter(numeric)
    : [];
  const annualDefaultUpper = isAnnual
    ? Math.max(
        1e-6,
        ...[...annualRows, ...chartMeans].map(
          (row) => Number(row.mean_speed) || 0,
        ),
      ) * 1.15
    : 1;
  const annualRange = getAxisRange(
    annualAxis,
    annualValues,
    0,
    annualDefaultUpper,
  );
  const exportPlots = () => {
    container.current
      ?.querySelectorAll("svg")
      .forEach((svg, i) =>
        exportSvg(svg, `${outputId}_${run.id.slice(0, 8)}_${i + 1}.svg`),
      );
  };
  return (
    <div className="ww-result-view" key={outputId}>
      <div className="ww-result-toolbar">
        <div className="ww-result-filters">
          {channels.length > 1 && (
            <label>
              通道
              <select
                value={channel}
                onChange={(e) => setSelectedChannel(e.target.value)}
              >
                {channels.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
          {months.length > 0 && (
            <label>
              月份
              <select
                value={monthFilter}
                onChange={(e) => setMonth(e.target.value)}
              >
                {months.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          )}
          {windows.length > 0 && (
            <label>
              窗口 年
              <select
                value={windowFilter}
                onChange={(e) => setWindowValue(e.target.value)}
              >
                {windows.map((w) => (
                  <option key={w}>{w}</option>
                ))}
              </select>
            </label>
          )}
          {isRose && outputId === "reference-rose" && (
            <label>
              风向图类型
              <select
                value={roseKind}
                onChange={(e) => setRoseKind(e.target.value as "wd" | "wpd")}
              >
                <option value="wd">风向分布</option>
                <option value="wpd">风能分布</option>
              </select>
            </label>
          )}
          {isRose && outputId === "reference-rose" && (
            <label>
              玫瑰图样式
              <select
                value={roseStyle}
                onChange={(e) => setRoseStyle(e.target.value)}
              >
                <option value="line">中心留白折线</option>
                <option value="filled">中心留白填充扇环</option>
              </select>
            </label>
          )}
          {isRose && outputId === "reference-rose" && (
            <label>
              图表缩放
              <select
                value={roseZoom}
                onChange={(e) => setRoseZoom(e.target.value)}
              >
                <option value="1">100%</option>
                <option value="1.25">125%</option>
                <option value="1.5">150%</option>
                <option value="2">200%</option>
              </select>
            </label>
          )}
        </div>
        <span
          className={`ww-status ${output.status === "ready" ? "ready" : "pending"}`}
        >
          {output.status === "ready" ? "真实计算成果" : "待补充条件"}
        </span>
      </div>
      {output.status !== "ready" ? (
        <div className="ww-simple-empty">
          <h3>该项尚不能计算</h3>
          <p>{output.reason}</p>
        </div>
      ) : (
        <>
          {isAnnual && means.length > 0 && (
            <div
              className="ww-lt-controls"
              role="group"
              aria-label="长期窗口与图形"
            >
              <span>统计窗口</span>
              <div className="ww-lt-windows">
                {means.map((m) => (
                  <button
                    type="button"
                    key={String(m.years)}
                    className={activeWindow === String(m.years) ? "active" : ""}
                    onClick={() => setLtWindow(String(m.years))}
                  >
                    {String(m.years)} 年
                  </button>
                ))}
              </div>
              <span className="ww-lt-divider" />
              <label>
                <input
                  type="checkbox"
                  checked={ltBars}
                  onChange={(e) => setLtBars(e.target.checked)}
                />
                柱状图
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={ltConcurrent}
                  disabled={!ltBars}
                  onChange={(e) => setLtConcurrent(e.target.checked)}
                />
                实测同期（黄柱）
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={ltLine}
                  onChange={(e) => setLtLine(e.target.checked)}
                />
                均值线
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showMeanLabel}
                  disabled={!ltLine}
                  onChange={(event) => setShowMeanLabel(event.target.checked)}
                />
                均值标注
              </label>
              {showMeanLabel && ltLine && (
                <small className="ww-mean-position-hint">图中标注可拖动</small>
              )}
              {!exportMode && annualValues.length > 0 && (
                <AxisRange
                  setting={annualAxis}
                  onChange={setAnnualAxis}
                  unit="m/s"
                  lowerDefault={0}
                  upperDefault={annualDefaultUpper}
                  invalid={annualRange.invalid}
                />
              )}
            </div>
          )}
          {!isAnnual && means.length > 0 && (
            <div
              className="ww-mean-toggles"
              role="group"
              aria-label="长期均值线显示"
            >
              <span>图上均值线</span>
              {means.map((m) => {
                const years = String(m.years);
                return (
                  <label key={years}>
                    <input
                      type="checkbox"
                      checked={!hiddenMeans.includes(years)}
                      onChange={() =>
                        setHiddenMeans((v) =>
                          v.includes(years)
                            ? v.filter((x) => x !== years)
                            : [...v, years],
                        )
                      }
                    />
                    {years} 年均值线
                  </label>
                );
              })}
              <small>只勾选需要的窗口，无需返回配置修改。</small>
            </div>
          )}
          <div
            ref={container}
            className={
              isRose
                ? `ww-rose-pair${outputId === "reference-rose" ? " ww-reference-rose" : ""}`
                : isScatter
                  ? "ww-scatter-grid"
                  : "ww-live-chart"
            }
          >
            {outputId === "monthly-hourly" ? (
              <>
                <div className="ww-plot-legend is-dual" aria-label="小图图例">
                  <span style={{ color: palette[0] }}>
                    <i className="diamond" style={{ background: palette[0] }} />
                    风速
                  </span>
                  <span style={{ color: palette[1] }}>
                    <i className="square" style={{ background: palette[1] }} />
                    风功率密度
                  </span>
                </div>
                <div className="ww-month-grid ww-quarter-grid">
                  {monthNumbers.map((m) => (
                    <article key={m}>
                      <h3>{m}月 · 日内风况</h3>
                      <CartesianPlot
                        outputId="hourly"
                        compact
                        rows={rowsForMonth(m).map((r) => ({
                          ...r,
                          period: String(r.period).slice(3),
                        }))}
                      />
                    </article>
                  ))}
                </div>
              </>
            ) : outputId === "shear" ? (
              <ShearPlots rows={rows} summary={output.summary} />
            ) : isRose ? (
              <>
                <RosePlot
                  rows={rows}
                  energy={roseKind === "wpd"}
                  rose={roseStyle}
                  zoom={roseZoom}
                  title={`长期累计${roseKind === "wpd" ? "风能" : "风向"} · ${roseStyle === "filled" ? "填充" : "折线"}`}
                />
                {monthlyKey && (
                  <section className="ww-reference-months">
                    <h3>
                      {windowFilter}年各月累计
                      {roseKind === "wpd" ? "风能" : "风向"}
                    </h3>
                    {monthlyRows ? (
                      <div className="ww-rose-month-grid">
                        {monthNumbers.map((m) => (
                          <article key={m}>
                            <RoseChart
                              compact
                              rows={monthlyRows.filter(
                                (row) => row.month === m,
                              )}
                              title={
                                m +
                                "月累计" +
                                (roseKind === "wpd" ? "风能" : "风向")
                              }
                              rose={roseStyle}
                              energy={roseKind === "wpd"}
                              zoom={roseZoom}
                            />
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p role="status">
                        {currentMonthlyRose?.error ?? "正在统计各月分布…"}
                      </p>
                    )}
                  </section>
                )}
              </>
            ) : isScatter ? (
              rows.map((row, i) => (
                <article key={i}>
                  <strong>
                    {String(row.label)} · n={display(row.count)}
                  </strong>
                  <ScatterPlot row={row} />
                  {row.reason ? (
                    <p className="ww-inline-note">{String(row.reason)}</p>
                  ) : (
                    !row.sufficient_samples && (
                      <p className="ww-inline-note">低样本：不足30对</p>
                    )
                  )}
                </article>
              ))
            ) : (
              <CartesianPlot
                rows={annualRows}
                outputId={outputId}
                means={chartMeans}
                bars={isAnnual ? ltBars : true}
                showConcurrent={ltConcurrent}
                annualMinimum={annualRange.lower}
                annualMaximum={annualRange.upper}
                annualCustomAxis={
                  annualAxis.mode !== "default" && !annualRange.invalid
                }
                showMeanLabel={showMeanLabel}
              />
            )}
          </div>
          {chartMeans.length > 0 && (
            <div className="ww-mean-legend" aria-label="均值线图例">
              {chartMeans.map((m) => (
                <span key={String(m.years)}>
                  <i style={{ borderColor: String(m.color) }} />
                  {String(m.years)} 年中尺度均值{" "}
                  {Number(m.mean_speed).toFixed(3)} m/s
                </span>
              ))}
            </div>
          )}
          {outputId === "weibull" && parameters && (
            <div className="ww-callout">
              形状参数 k={display(parameters.k)} · 尺度参数 c=
              {display(parameters.c)} m/s · 正风速样本{" "}
              {display(parameters.positive_count)} · 零值比例{" "}
              {display(parameters.zero_fraction)}。
              {String(parameters.note ?? "")}
            </div>
          )}
          {isRose && outputId === "reference-rose" && (
            <p className="ww-inline-note">
              风向与风能使用同期有效配对；静风频率和未配对数量详见参数记录，扇区加静风频率为100%。
            </p>
          )}
          <div className="ww-chart-actions">
            <a
              className="ww-button"
              href={`/api/v1/runs/${run.id}/tables/${outputId}.csv`}
            >
              下载完整数据（CSV）
            </a>
            <details className="ww-details">
              <summary>更多下载</summary>
              <div className="ww-chart-actions">
                <button className="ww-button" onClick={exportPlots}>
                  下载矢量图（SVG）
                </button>
                <button
                  className="ww-button"
                  onClick={() => downloadJson(run, `run_${run.id}.json`)}
                >
                  备份计算参数与结果（JSON）
                </button>
              </div>
            </details>
          </div>
          {means.map(
            (m) =>
              m.reason && (
                <p className="ww-callout" key={String(m.years)}>
                  {String(m.reason)}
                </p>
              ),
          )}
          {isAnnual && (
            <div className="ww-month-controls">
              <span>
                以所选 {activeWindow} 年中尺度均值为基准。偏差超过 +2%
                为大风年，低于 −2% 为小风年，其余为平风年。资料不足时显示“—”。
              </span>
            </div>
          )}
          {outputId === "monthly-hourly" ? (
            <>
              {!exportMode && (
                <div className="ww-month-controls" aria-label="日内统计范围">
                  <label>
                    表格月份{" "}
                    <select
                      value={monthScope}
                      onChange={(event) => {
                        setMonthScope(event.target.value);
                        setMonthPage(0);
                      }}
                    >
                      <option value="all">全部月份（12 张表）</option>
                      {[1, 2, 3, 4].map((q) => (
                        <option key={q} value={`q${q}`}>
                          第{q}季度
                        </option>
                      ))}
                      {monthNumbers.map((m) => (
                        <option key={m} value={m}>
                          {m}月
                        </option>
                      ))}
                    </select>
                  </label>
                  {monthScope === "all" && (
                    <>
                      <button
                        className="ww-button"
                        disabled={monthPage === 0}
                        onClick={() => setMonthPage(monthPage - 1)}
                      >
                        上一月
                      </button>
                      <span aria-live="polite">
                        第 {monthPage + 1} / {tableMonths.length} 张
                      </span>
                      <button
                        className="ww-button"
                        disabled={monthPage + 1 >= tableMonths.length}
                        onClick={() => setMonthPage(monthPage + 1)}
                      >
                        下一月
                      </button>
                    </>
                  )}
                </div>
              )}
              {monthRanges.map((months) => {
                const first = months[0];
                const last = months.at(-1);
                const reportRows = months.flatMap(rowsForMonth);
                return (
                  <section className="ww-statistics-period" key={first}>
                    <h3>
                      {first === last
                        ? `${first}月日内统计`
                        : `第${Math.ceil(first / 3)}季度日内统计（${first}–${last}月）`}
                    </h3>
                    <DataTable
                      rows={reportRows}
                      continuous={months.length > 1}
                    />
                  </section>
                );
              })}
            </>
          ) : (
            <DataTable
              rows={isAnnual ? annualTable : rows}
              hiddenColumns={isAnnual ? ["complete", "concurrent"] : undefined}
              highlightBin={outputId === "turbulence" ? 15 : undefined}
              footer={densityFooter}
            />
          )}
        </>
      )}
      <details className="ww-details">
        <summary>参数、数据来源与版本</summary>
        {run.methods?.[output.method] && (
          <div className="ww-callout">
            <strong>
              {run.standards?.find(
                (s) => s.id === run.methods?.[output.method].source,
              )?.name ?? "用户需求"}{" "}
              · {run.methods[output.method].clause}
            </strong>
            <p>{run.methods[output.method].formula}</p>
            <p>{run.methods[output.method].limits}</p>
          </div>
        )}
        <p>
          引擎 {run.engine_version} · 方法 {output.method} ·{" "}
          {new Date(run.created_at).toLocaleString()} · 运行 {run.id}
        </p>
        <pre>
          {JSON.stringify(
            {
              summary: output.summary,
              config: run.config,
              sources: run.sources,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}
