import { useRef, useState } from "react";
import { downloadJson } from "./api";
import type { Run, RunOutput } from "./api";

const palette = ["#2c7a63", "#d49a46", "#657fbd", "#bb6777"];
const labels: Record<string, string> = {
  channel: "通道",
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
const numeric = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value);

export function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  const [page, setPage] = useState(0);
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter(
    (key) => key !== "points" && key !== "through_origin",
  );
  const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / 60) - 1));
  return (
    <>
      <div className="ww-table-scroll">
        <table className="ww-result-table">
          <thead>
            <tr>
              {keys.map((key) => (
                <th key={key}>{labels[key] ?? key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(safePage * 60, (safePage + 1) * 60).map((row, i) => (
              <tr key={i}>
                {keys.map((key) => (
                  <td key={key} title={display(row[key])}>
                    {display(row[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="ww-inline-note">该筛选下没有数据记录。</p>
        )}
      </div>
      {rows.length > 60 && (
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
}: {
  rows: Record<string, unknown>[];
  energy?: boolean;
}) {
  const key = energy ? "energy_frequency" : "frequency";
  const max = Math.max(1, ...rows.map((r) => Number(r[key]) || 0));
  const point = (deg: number, r: number) => [
    200 + Math.sin((deg * Math.PI) / 180) * r,
    175 - Math.cos((deg * Math.PI) / 180) * r,
  ];
  return (
    <svg
      viewBox="0 0 400 350"
      role="img"
      aria-label={energy ? "风能玫瑰图" : "风向玫瑰图"}
      fontFamily="Microsoft YaHei, sans-serif"
    >
      <rect width="400" height="350" fill="white" />
      <text x="200" y="22" textAnchor="middle" fill="#33483f" fontSize="13">
        {energy ? "风能方向频率 %" : "风向频率 %"}
      </text>
      {[0.25, 0.5, 0.75, 1].map((fraction) => (
        <g key={fraction}>
          <circle
            cx="200"
            cy="175"
            r={fraction * 120}
            fill="none"
            stroke="#e2e9e5"
          />
          <text x="205" y={175 - fraction * 120} fill="#82918a" fontSize="9">
            {(max * fraction).toFixed(1)}
          </text>
        </g>
      ))}
      {rows.map((row, i) => {
        const deg = Number(row.degrees);
        const end = point(deg, (Number(row[key] ?? 0) / max) * 120);
        const label = point(deg, 143);
        return (
          <g key={i}>
            <line
              x1="200"
              y1="175"
              x2={point(deg, 120)[0]}
              y2={point(deg, 120)[1]}
              stroke="#edf0ee"
            />
            <line
              x1="200"
              y1="175"
              x2={end[0]}
              y2={end[1]}
              stroke={energy ? palette[1] : palette[0]}
              strokeWidth={Math.min(20, 180 / rows.length)}
            />
            <text
              x={label[0]}
              y={label[1] + 3}
              textAnchor="middle"
              fontSize="10"
              fill="#5f7168"
            >
              {String(row.label)}
            </text>
            <title>
              {String(row.label)}：{display(row[key])}%
            </title>
          </g>
        );
      })}
    </svg>
  );
}

function CartesianPlot({
  rows,
  outputId,
  means = [],
}: {
  rows: Record<string, unknown>[];
  outputId: string;
  means?: Record<string, unknown>[];
}) {
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
  const w = 900,
    h = 350,
    left = 66,
    right = 830,
    top = 35,
    bottom = 285;
  const maxFor = (key: string) =>
    Math.max(
      1e-6,
      ...rows.map((r) => Number(r[key]) || 0),
      ...(key === "mean_speed"
        ? means.map((r) => Number(r.mean_speed) || 0)
        : []),
    ) * 1.15;
  const minFor = (key: string) =>
    Math.min(0, ...rows.map((r) => Number(r[key]) || 0));
  const x = (i: number) => left + ((i + 0.5) / rows.length) * (right - left);
  const y = (value: number, key: string) =>
    bottom -
    ((value - minFor(key)) / (maxFor(key) - minFor(key))) * (bottom - top);
  const dual = used.includes("power_density");
  const label = (row: Record<string, unknown>) =>
    String(row.period ?? row.bin ?? row.label ?? row.group ?? "");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="真实计算结果图"
      fontFamily="Microsoft YaHei, sans-serif"
    >
      <rect width={w} height={h} fill="white" />
      {[0, 1, 2, 3, 4].map((n) => (
        <g key={n}>
          <line
            x1={left}
            x2={right}
            y1={top + (n * (bottom - top)) / 4}
            y2={top + (n * (bottom - top)) / 4}
            stroke="#e6ece8"
          />
          <text
            x={left - 8}
            y={top + (n * (bottom - top)) / 4 + 4}
            textAnchor="end"
            fontSize="11"
            fill="#78887f"
          >
            {(
              maxFor(used[0]) -
              (n / 4) * (maxFor(used[0]) - minFor(used[0]))
            ).toFixed(isTI || isShear ? 3 : 1)}
          </text>
          {dual && (
            <text
              x={right + 8}
              y={top + (n * (bottom - top)) / 4 + 4}
              fontSize="11"
              fill={palette[1]}
            >
              {(maxFor("power_density") * (1 - n / 4)).toFixed(0)}
            </text>
          )}
        </g>
      ))}
      {used.map((key, k) => (
        <g key={key}>
          {(isAnnual || isFrequency || outputId === "density") &&
          key !== "fitted_frequency" ? (
            rows.map(
              (row, i) =>
                numeric(row[key]) && (
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
                    fill={row.concurrent ? "#c65757" : palette[k]}
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
                stroke={palette[k]}
                strokeWidth="2.3"
                points={rows
                  .map((row, i) =>
                    numeric(row[key])
                      ? `${x(i)},${y(Number(row[key]), key)}`
                      : "",
                  )
                  .filter(Boolean)
                  .join(" ")}
              />
              {rows.map(
                (row, i) =>
                  numeric(row[key]) && (
                    <circle
                      key={i}
                      cx={x(i)}
                      cy={y(Number(row[key]), key)}
                      r="2.5"
                      fill={palette[k]}
                    >
                      <title>
                        {label(row)} · {labels[key]}：{display(row[key])}
                      </title>
                    </circle>
                  ),
              )}
            </>
          )}
        </g>
      ))}
      {means
        .filter((m) => numeric(m.mean_speed))
        .map((m, i) => (
          <g key={i}>
            <line
              x1={left}
              x2={right}
              y1={y(Number(m.mean_speed), "mean_speed")}
              y2={y(Number(m.mean_speed), "mean_speed")}
              stroke={palette[(i + 1) % palette.length]}
              strokeDasharray="6 4"
            />
            <text
              x={right - 4}
              y={y(Number(m.mean_speed), "mean_speed") - 5}
              textAnchor="end"
              fontSize="10"
              fill={palette[(i + 1) % palette.length]}
            >
              {String(m.years)}年均值 {Number(m.mean_speed).toFixed(3)}
            </text>
          </g>
        ))}
      {rows.map(
        (row, i) =>
          i % Math.max(1, Math.ceil(rows.length / 13)) === 0 && (
            <text
              key={i}
              x={x(i)}
              y={bottom + 20}
              textAnchor="middle"
              fill="#718278"
              fontSize={isAnnual ? 9 : 11}
            >
              {isAnnual ? label(row).slice(0, 4) : label(row)}
            </text>
          ),
      )}
      <text x={left} y="16" fontSize="11" fill={palette[0]}>
        {labels[used[0]]}
      </text>
      {dual && (
        <text x={right} y="16" textAnchor="end" fontSize="11" fill={palette[1]}>
          右轴：风功率密度 W/m²
        </text>
      )}
      {used.map((key, i) => (
        <g key={key}>
          <line
            x1={left + i * 220}
            x2={left + 20 + i * 220}
            y1="329"
            y2="329"
            stroke={palette[i]}
            strokeWidth="3"
          />
          <text x={left + 27 + i * 220} y="333" fontSize="11" fill="#62756a">
            {isAnnual ? "周年均值（绿柱）/ 测风同期（红柱）" : labels[key]}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function ScatterPlot({ row }: { row: Record<string, unknown> }) {
  const points = (row.points ?? []) as number[][];
  if (!points.length)
    return (
      <div className="ww-simple-empty">
        <p>没有同期有效样本</p>
      </div>
    );
  const max = Math.max(1, ...points.flat()) * 1.1;
  const x = (v: number) => 35 + (v / max) * 220,
    y = (v: number) => 235 - (v / max) * 205;
  return (
    <svg
      viewBox="0 0 280 280"
      role="img"
      aria-label={`${row.label}扇区同期散点图`}
      fontFamily="Microsoft YaHei, sans-serif"
    >
      <rect width="280" height="280" fill="white" />
      <path d="M35 25V235H260" fill="none" stroke="#acbbb2" />
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line
            x1="35"
            x2="255"
            y1={y(f * max)}
            y2={y(f * max)}
            stroke="#ecf0ed"
          />
          <text
            x="30"
            y={y(f * max) + 3}
            fontSize="8"
            textAnchor="end"
            fill="#84968b"
          >
            {(f * max).toFixed(0)}
          </text>
          <text
            x={x(f * max)}
            y="248"
            fontSize="8"
            textAnchor="middle"
            fill="#84968b"
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
          r="1.6"
          fill="#43856c"
          opacity=".35"
        />
      ))}
      {numeric(row.slope) && (
        <line
          x1={x(Number(row.x_min))}
          y1={y(Number(row.slope) * Number(row.x_min) + Number(row.intercept))}
          x2={x(Number(row.x_max))}
          y2={y(Number(row.slope) * Number(row.x_max) + Number(row.intercept))}
          stroke="#d49343"
          strokeWidth="1.8"
        />
      )}
      <text x="145" y="269" fontSize="10" textAnchor="middle" fill="#657b6d">
        X 参考风速 m/s
      </text>
      <text x="7" y="17" fontSize="10" fill="#657b6d">
        Y 目标风速 m/s
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
        fontFamily="Microsoft YaHei, sans-serif"
      >
        <rect width="900" height="350" fill="white" />
        {[0, 1, 2, 3, 4].map((n) => (
          <g key={n}>
            <line
              x1="65"
              x2="765"
              y1={y((n * maxH) / 4)}
              y2={y((n * maxH) / 4)}
              stroke="#e4ebe6"
            />
            <text
              x="56"
              y={y((n * maxH) / 4) + 4}
              textAnchor="end"
              fontSize="10"
              fill="#7c9081"
            >
              {((n * maxH) / 4).toFixed(0)}
            </text>
            <text
              x={x((n * maxV) / 4)}
              y="306"
              textAnchor="middle"
              fontSize="10"
              fill="#7c9081"
            >
              {((n * maxV) / 4).toFixed(1)}
            </text>
          </g>
        ))}
        <polyline
          points={curve}
          fill="none"
          stroke="#cf9a55"
          strokeDasharray="5 3"
          strokeWidth="2"
        />
        {profile.map((p) => (
          <circle
            key={p.height}
            cx={x(p.mean_speed)}
            cy={y(p.height)}
            r="5"
            fill="#347a5b"
          >
            <title>
              {p.height}m：{p.mean_speed.toFixed(4)}m/s
            </title>
          </circle>
        ))}
        <text x="65" y="20" fontSize="11" fill="#789281">
          高度 m
        </text>
        <text x="450" y="333" fontSize="11" textAnchor="middle" fill="#789281">
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
}: {
  run: Run;
  output: RunOutput;
  outputId: string;
}) {
  const [selectedChannel, setSelectedChannel] = useState("");
  const [month, setMonth] = useState("");
  const [windowValue, setWindowValue] = useState("");
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
  const rows = allRows.filter(
    (r) =>
      (!channel || r.channel === channel) &&
      (!months.length || String(r.month) === monthFilter) &&
      (!windows.length || String(r.window) === windowFilter),
  );
  const isRose = outputId.includes("rose");
  const isScatter = outputId === "correlation";
  const parameters = (
    (output.summary?.channels ?? []) as Record<string, unknown>[]
  ).find((p) => p.channel === channel);
  const means = (output.summary?.means ?? []) as Record<string, unknown>[];
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
          <div
            ref={container}
            className={
              isRose
                ? "ww-rose-pair"
                : isScatter
                  ? "ww-scatter-grid"
                  : "ww-live-chart"
            }
          >
            {outputId === "monthly-hourly" ? (
              <div className="ww-month-grid">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <article key={m}>
                    <h3>{m}月 · 日内风况</h3>
                    <CartesianPlot
                      outputId="hourly"
                      rows={rows
                        .filter(
                          (r) => Number(String(r.period).slice(0, 2)) === m,
                        )
                        .map((r) => ({
                          ...r,
                          period: String(r.period).slice(3),
                        }))}
                    />
                  </article>
                ))}
              </div>
            ) : outputId === "shear" ? (
              <ShearPlots rows={rows} summary={output.summary} />
            ) : isRose ? (
              <>
                <RosePlot rows={rows} />
                <RosePlot rows={rows} energy />
              </>
            ) : isScatter ? (
              rows.map((row, i) => (
                <article key={i}>
                  <strong>
                    {String(row.label)} · n={display(row.count)}
                  </strong>
                  <ScatterPlot row={row} />
                  <small>
                    r {display(row.r)} · R² {display(row.r_squared)} · p{" "}
                    {display(row.p_value)}
                  </small>
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
              <CartesianPlot rows={rows} outputId={outputId} means={means} />
            )}
          </div>
          {outputId === "weibull" && parameters && (
            <div className="ww-callout">
              形状参数 k={display(parameters.k)} · 尺度参数 c=
              {display(parameters.c)} m/s · 正风速样本{" "}
              {display(parameters.positive_count)} · 零值比例{" "}
              {display(parameters.zero_fraction)}。
              {String(parameters.note ?? "")}
            </div>
          )}
          {isRose && (
            <p className="ww-inline-note">
              风向与风能使用同期有效配对；静风频率和未配对数量详见参数记录，扇区加静风频率为100%。
            </p>
          )}
          <div className="ww-result-toolbar">
            <span>图表显示当前筛选；CSV导出本项全部通道和时段。</span>
            <div>
              <button className="ww-button" onClick={exportPlots}>
                导出当前SVG
              </button>
              <a
                className="ww-button"
                href={`/api/v1/runs/${run.id}/tables/${outputId}.csv`}
              >
                导出CSV
              </a>
              <button
                className="ww-button"
                onClick={() => downloadJson(run, `run_${run.id}.json`)}
              >
                运行快照JSON
              </button>
            </div>
          </div>
          {means.map(
            (m) =>
              m.reason && (
                <p className="ww-callout" key={String(m.years)}>
                  {String(m.reason)}
                </p>
              ),
          )}
          <DataTable rows={rows} />
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
