import { useEffect, useState } from "react";
import { api, downloadJson } from "./api";
import type { Run, RunOutput } from "./api";
import { BaseResultView, DataTable } from "./BaseResultView";
import ReportExport from "./ReportExport";
import { addReportChart } from "./chartReports";

type Row = Record<string, unknown>;
const colors = [
  "#2c7a63",
  "#d49a46",
  "#657fbd",
  "#bb6777",
  "#825dac",
  "#3a9ca2",
];
const names: Record<string, string> = {
  mean_speed: "WS",
  power_density: "WPD",
  density: "空气密度",
  frequency: "风速频率",
  energy_frequency: "风能频率",
  fitted_frequency: "Weibull",
  mean: "平均TI",
  std: "TI标准差",
  characteristic: "特征TI",
  representative: "代表TI",
};

function Plot({
  rows,
  fields,
  title,
  density = false,
  rose = "",
  energy = false,
  zoom = "1",
}: {
  rows: Row[];
  fields: string[];
  title: string;
  density?: boolean;
  rose?: string;
  energy?: boolean;
  zoom?: string;
}) {
  const [hover, setHover] = useState("");
  const w = rose ? 900 : 800,
    h = rose ? 640 : 330,
    L = 65,
    R = 725,
    T = 35,
    B = 270;
  const cx = rose ? 450 : 400,
    cy = rose ? 310 : 165;
  const base = 80,
    maxR = 200;
  const point = (a: number, r: number) => [
    cx + Math.sin((a * Math.PI) / 180) * r,
    cy - Math.cos((a * Math.PI) / 180) * r,
  ];
  const roseKey = energy ? "energy_frequency" : "frequency";
  const max =
    Math.max(0.001, ...rows.map((r) => Number(r[roseKey]) || 0)) * 1.1;
  const rp = (r: Row) =>
    point(Number(r.degrees), base + (Number(r[roseKey]) / max) * maxR);
  const limits = (f: string) => {
    const shared = fields.includes("power_density") ? [f] : fields;
    const vals = rows
      .flatMap((r) =>
        shared.map((key) => (r[key] == null ? NaN : Number(r[key]))),
      )
      .filter(Number.isFinite);
    const lo = density ? 0.5 : Math.min(0, ...vals);
    const hi = density
      ? Math.ceil(Math.max(...vals) * 20) / 20
      : Math.max(0.001, ...vals) * 1.1;
    return [lo, hi];
  };
  const x = (i: number) => L + ((i + 0.5) / Math.max(1, rows.length)) * (R - L);
  const y = (v: number, f: string) => {
    const [lo, hi] = limits(f);
    return B - ((v - lo) / (hi - lo || 1)) * (B - T);
  };
  return (
    <figure style={{ margin: 0 }}>
      <figcaption>{title}</figcaption>
      <div className="ww-plot-scroll">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={title}
          style={{
            width: `${Math.max(1, Number(zoom) || 1) * 100}%`,
            minWidth: rose ? 560 : 480,
            background: "white",
          }}
        >
          <text x="65" y="20" fontSize="12">
            {hover || title}
          </text>
          {rose ? (
            <>
              {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                const r = base + t * maxR;
                const tick = [
                  cx + Math.sin(Math.PI / 4) * (r + 6),
                  cy - Math.cos(Math.PI / 4) * (r + 6),
                ];
                return (
                  <g key={t}>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill="none"
                      stroke="#dce5df"
                      strokeDasharray="3 3"
                    />
                    <text x={tick[0]} y={tick[1]} fontSize="10" fill="#7f9487">
                      {(max * t).toFixed(1)}%
                    </text>
                  </g>
                );
              })}
              {rows.map((r, i) => {
                const a = Number(r.degrees),
                  da = 180 / rows.length;
                const r1 = base + (Number(r[roseKey]) / max) * maxR;
                const p1 = point(a - da, r1),
                  p2 = point(a + da, r1),
                  p3 = point(a + da, base),
                  p4 = point(a - da, base),
                  label = point(a, base + maxR + 22);
                return (
                  <g
                    key={i}
                    onMouseEnter={() =>
                      setHover(`${r.label}: ${Number(r[roseKey]).toFixed(2)}%`)
                    }
                  >
                    <line
                      x1={cx}
                      y1={cy}
                      x2={label[0]}
                      y2={label[1]}
                      stroke="#edf0ee"
                    />
                    {rose === "filled" && (
                      <path
                        d={`M${p1} A${r1},${r1} 0 0 1 ${p2} L${p3} A${base},${base} 0 0 0 ${p4} Z`}
                        fill="#326f35"
                      />
                    )}
                    <text
                      x={label[0]}
                      y={label[1]}
                      textAnchor="middle"
                      fontSize="11"
                    >
                      {a}°
                    </text>
                  </g>
                );
              })}
              {rose === "line" && (
                <polygon
                  points={rows.map((r) => rp(r).join(",")).join(" ")}
                  fill="none"
                  stroke="#326f35"
                  strokeWidth="2"
                />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={base}
                fill="#f6f7f6"
                stroke="#a5b5aa"
              />
            </>
          ) : (
            <>
              {[0, 1, 2, 3, 4].map((i) => (
                <g key={i}>
                  <line
                    x1={L}
                    x2={R}
                    y1={T + (i * (B - T)) / 4}
                    y2={T + (i * (B - T)) / 4}
                    stroke="#e4ebe6"
                  />
                  {fields.slice(0, 2).map((f, j) => {
                    const [lo, hi] = limits(f);
                    return (
                      <text
                        key={f}
                        x={j ? R + 6 : L - 6}
                        y={T + (i * (B - T)) / 4}
                        textAnchor={j ? "start" : "end"}
                        fill={colors[j]}
                        fontSize="10"
                      >
                        {(hi - (i * (hi - lo)) / 4).toFixed(density ? 2 : 2)}
                      </text>
                    );
                  })}
                </g>
              ))}
              {fields.map((f, j) => (
                <g key={f}>
                  {["frequency", "energy_frequency"].includes(f) &&
                    rows.map((r, i) => (
                      <rect
                        key={`bar-${i}`}
                        x={x(i) - 6 + j * 5}
                        y={y(Number(r[f]), f)}
                        width="5"
                        height={B - y(Number(r[f]), f)}
                        fill={colors[j % colors.length]}
                      >
                        <title>{Number(r[f]).toFixed(3)}%</title>
                      </rect>
                    ))}
                  <polyline
                    points={rows
                      .map((r, i) =>
                        r[f] != null ? `${x(i)},${y(Number(r[f]), f)}` : "",
                      )
                      .filter(Boolean)
                      .join(" ")}
                    fill="none"
                    stroke={colors[j % colors.length]}
                    strokeWidth="2"
                  />
                  {rows.map(
                    (r, i) =>
                      r[f] != null && (
                        <circle
                          key={i}
                          cx={x(i)}
                          cy={y(Number(r[f]), f)}
                          r="3"
                          fill={colors[j % colors.length]}
                          onMouseEnter={() =>
                            setHover(
                              `${r.period ?? r.bin ?? r.label}: ${names[f] ?? f}=${Number(r[f]).toFixed(4)}`,
                            )
                          }
                        >
                          <title>{Number(r[f]).toFixed(4)}</title>
                        </circle>
                      ),
                  )}
                  <text
                    x={65 + j * 135}
                    y="320"
                    fill={colors[j % colors.length]}
                    fontSize="11"
                  >
                    {names[f] ?? f}
                  </text>
                </g>
              ))}
              {rows.map(
                (r, i) =>
                  i % Math.max(1, Math.ceil(rows.length / 24)) === 0 && (
                    <text
                      key={i}
                      x={x(i)}
                      y="292"
                      textAnchor="middle"
                      fontSize="9"
                    >
                      {String(r.period ?? r.bin ?? r.label ?? "")}
                    </text>
                  ),
              )}
            </>
          )}
        </svg>
      </div>
    </figure>
  );
}

export function InteractiveResultView({
  run: original,
  output: initial,
  outputId,
  exportMode = false,
}: {
  run: Run;
  output: RunOutput;
  outputId: string;
  exportMode?: boolean;
}) {
  const turbulence = outputId === "turbulence";
  const [directions, setDirections] = useState<
    { id: string; name: string; height: number }[]
  >([]);
  const [layers, setLayers] = useState<{ id: string; height: number }[]>([]);
  useEffect(() => {
    let active = true;
    const id = original.config.qc_id;
    if (typeof id === "string")
      void api<{
        channels: {
          id: string;
          height: number;
          quantity: string;
          statistic: string;
        }[];
      }>(`/datasets/${id}`)
        .then((d) => {
          if (active)
            setLayers(
              d.channels.filter(
                (c) => c.quantity === "speed" && c.statistic === "mean",
              ),
            );
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [original]);
  useEffect(() => {
    let active = true;
    const id = original.config.result_id;
    if (typeof id === "string")
      void api<{
        channels: {
          id: string;
          name: string;
          height: number;
          quantity: string;
          statistic: string;
        }[];
      }>(`/datasets/${id}`)
        .then((d) => {
          if (active)
            setDirections(
              d.channels.filter(
                (c) => c.quantity === "direction" && c.statistic === "mean",
              ),
            );
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [original]);
  const [run, setRun] = useState(original),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [all, setAll] = useState(exportMode),
    [channel, setChannel] = useState("");
  const [hidden, setHidden] = useState<string[]>(() =>
      turbulence ? ["mean", "std", "characteristic"] : [],
    ),
    [rose, setRose] = useState("line"),
    [zoom, setZoom] = useState("1"),
    [month, setMonth] = useState("1");
  const [method, setMethod] = useState(
      String(run.config.weibull_method ?? "mle"),
    ),
    [sectors, setSectors] = useState(Number(run.config.sectors ?? 16));
  const [iec, setIec] = useState(true),
    [low, setLow] = useState(""),
    [high, setHigh] = useState("");
  const output = run.outputs[outputId] ?? initial;
  const rows = output.rows ?? [];
  const channels = [
    ...new Set(rows.map((r) => String(r.channel ?? "")).filter(Boolean)),
  ];
  const preferred = rows.reduce<Row>(
    (best, row) =>
      Number(row.height ?? 0) > Number(best.height ?? 0) ? row : best,
    rows[0] ?? {},
  ).channel;
  const selected =
    (channels.includes(channel) ? channel : "") ||
    (typeof preferred === "string" ? preferred : channels[0]) ||
    "";
  const isRose = outputId.includes("rose"),
    completeness = ["raw-records", "completeness"].includes(outputId);
  const fields = turbulence
    ? ["mean", "std", "characteristic", "representative"]
    : outputId === "density"
      ? ["density"]
      : ["frequency", "weibull"].includes(outputId)
        ? [
            "frequency",
            "energy_frequency",
            ...(outputId === "weibull" ? ["fitted_frequency"] : []),
          ]
        : ["mean_speed", "power_density"];
  const toggle = (f: string) =>
    setHidden((v) => (v.includes(f) ? v.filter((x) => x !== f) : [...v, f]));
  async function recalculate(changes: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const next = await api<Run>(
        outputId === "correlation" ? "/correlations" : "/analysis",
        { ...run.config, ...changes },
      );
      setRun(next);
    } catch (e) {
      setError((e as Error).message);
      setMethod(String(run.config.weibull_method ?? "mle"));
      setSectors(Number(run.config.sectors ?? 16));
    } finally {
      setBusy(false);
    }
  }
  async function choosePair(a: string, b: string) {
    if (!a || !b) return;
    const ids = [a, b].map((z) => layers.filter((c) => c.height === Number(z)));
    if (Number(a) >= Number(b) || ids.some((v) => v.length !== 1)) {
      setError("请选择低层小于高层、且每层通道唯一的组合。");
      return;
    }
    await recalculate({ shear_channels: ids.map((v) => v[0].id) });
  }
  const config = {
    outputId,
    all,
    channel: selected,
    hidden,
    rose,
    month,
    weibullMethod: method,
    sectors,
    iec,
    low,
    high,
    runId: run.id,
  };
  function exportReport() {
    const charts = document
      .getElementById(`interactive-${outputId}`)
      ?.querySelectorAll("svg");
    const html = `<!doctype html><meta charset="utf-8"><title>风资源图表报告</title><style>body{font-family:Microsoft YaHei;margin:32px}svg{max-width:100%;page-break-inside:avoid}pre{white-space:pre-wrap}</style><h1>风资源图表报告</h1><p>当前配置；未调整选项使用默认值。统计基准365天/52560个十分钟格，实际日历时段另列。</p><pre>${JSON.stringify(config, null, 2).replaceAll("<", "&lt;")}</pre>${Array.from(
      charts ?? [],
    )
      .filter((s) => s.getBoundingClientRect().height > 0)
      .map((s) => s.outerHTML)
      .join(
        "",
      )}<pre>${JSON.stringify(run.config, null, 2).replaceAll("<", "&lt;")}</pre>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([html], { type: "text/html;charset=utf-8" }),
    );
    a.download = `wind-report-${outputId}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function exportImages() {
    document
      .getElementById(`interactive-${outputId}`)
      ?.querySelectorAll("svg")
      .forEach((svg, i) => {
        if (!svg.getBoundingClientRect().height) return;
        const url = URL.createObjectURL(
          new Blob([svg.outerHTML], { type: "image/svg+xml;charset=utf-8" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `${outputId}-${method}-${sectors}-${i + 1}.svg`;
        a.click();
        URL.revokeObjectURL(url);
      });
  }
  function addToReport() {
    const html = Array.from(
      document
        .getElementById(`interactive-${outputId}`)
        ?.querySelectorAll("svg") ?? [],
    )
      .filter((s) => s.getBoundingClientRect().height > 0)
      .map((s) => s.outerHTML)
      .join("");
    addReportChart(
      `${output.title} · ${method} · ${sectors}扇区`,
      html,
      config,
    );
  }
  if (completeness) {
    const basis = 365 * 144;
    const data = (run.outputs.completeness?.rows ?? rows)
      .filter((r) => r.quantity === "speed" || r.raw_records !== undefined)
      .filter(
        (r) =>
          !r.channel ||
          String(r.channel).includes("Avg") ||
          !String(r.channel).includes("_"),
      );
    const towerId = String(
      run.sources?.qc?.tower_id ?? run.sources?.raw?.tower_id ?? "",
    );
    const sources = [
      {
        source: "原始数据",
        get: (r: Row) => Number(r.raw_valid ?? r.valid_count ?? 0),
        expected: (r: Row) => Number(r.expected ?? r.expected_count ?? basis),
      },
      {
        source: "质控数据",
        get: (r: Row) => Number(r.qc_valid ?? r.valid_count ?? 0),
        expected: (r: Row) => Number(r.raw_records ?? r.record_count ?? basis),
      },
    ];
    const merged = data.flatMap((r) =>
      sources.map((s) => ({
        塔号: towerId,
        数据来源: s.source,
        通道: r.channel,
        应测数据: s.expected(r),
        实测数据: s.get(r),
        缺失数据: Math.max(0, s.expected(r) - s.get(r)),
        完整率: `${((100 * s.get(r)) / s.expected(r)).toFixed(2)}%`,
      })),
    );
    const annual = data.map((r) => {
      const valid = Number(r.annual_valid ?? r.qc_valid ?? r.valid_count ?? 0);
      const expected = Number(r.annual_expected ?? basis);
      return {
        塔号: towerId,
        数据来源: "完整年（365天基准）",
        通道: r.channel,
        应测数据: expected,
        实测数据: valid,
        缺失数据: Math.max(0, expected - valid),
        完整率: `${((100 * valid) / expected).toFixed(2)}%`,
      };
    });
    return (
      <div>
        <section>
          <h3>测风数据完整率统计</h3>
          <DataTable rows={merged} />
        </section>
        <section>
          <h3>完整年有效数据完整率（365天基准）</h3>
          <DataTable rows={annual} />
        </section>
        <p>
          同一张表按“数据来源”区分原始与质控口径；完整年按365天、每日144条，超出基准的记录保留，完整率可超过100%。日历覆盖缺口与365天数据量判据分别记录。
        </p>
      </div>
    );
  }
  const custom = [
    "monthly",
    "hourly",
    "frequency",
    "weibull",
    "density",
    "turbulence",
    "annual-rose",
    "monthly-rose",
  ].includes(outputId);
  return (
    <div id={`interactive-${outputId}`}>
      {!exportMode && (
        <ReportExport
          run={run}
          renderOutput={(id, entry) => (
            <InteractiveResultView
              run={run}
              output={entry}
              outputId={id}
              exportMode
            />
          )}
        />
      )}
      <div className="ww-panel">
        <button className="ww-button" onClick={addToReport}>
          加入报告（保留当前算法与显示配置）
        </button>
        {isRose && (
          <label>
            风向高度
            <select
              disabled={busy}
              value={String(run.config.direction_channel ?? "")}
              onChange={(e) =>
                void recalculate({ direction_channel: e.target.value })
              }
            >
              {directions.map((c) => (
                <option key={c.id} value={c.id}>
                  WD-{c.height}m · {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="ww-button" onClick={exportImages}>
          导出当前交互图SVG
        </button>
        <div className="ww-fields ww-fields-three">
          {channels.length > 0 && (
            <label>
              通道
              <select
                value={selected}
                onChange={(e) => setChannel(e.target.value)}
              >
                {channels.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
          {custom && (
            <label>
              <input
                type="checkbox"
                checked={all}
                disabled={busy}
                onChange={(e) => {
                  setAll(e.target.checked);
                  if (isRose && run.kind === "analysis") {
                    void recalculate({
                      result_channels: [],
                      rose_all_directions: e.target.checked,
                    });
                    return;
                  }
                  if (
                    e.target.checked &&
                    run.kind === "analysis" &&
                    Array.isArray(run.config.result_channels) &&
                    run.config.result_channels.length > 0
                  )
                    void recalculate({ result_channels: [] });
                }}
              />
              全部高度分图
            </label>
          )}
          {run.kind === "analysis" && (
            <button
              className="ww-button"
              disabled={busy}
              onClick={() => void recalculate({ result_channels: [] })}
            >
              载入全部高度并重算
            </button>
          )}
          {outputId === "weibull" && (
            <label>
              拟合算法
              <select
                disabled={busy}
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                  void recalculate({ weibull_method: e.target.value });
                }}
              >
                <option value="mle">最大似然 MLE（默认）</option>
                <option value="least-squares">累计概率线性最小二乘</option>
                <option value="moments">矩估计</option>
                <option value="energy">均速与能量匹配</option>
              </select>
            </label>
          )}
          {(outputId === "correlation" || isRose) && (
            <label>
              方位扇区
              <select
                value={sectors}
                disabled={busy}
                onChange={(e) => {
                  setSectors(Number(e.target.value));
                  void recalculate({ sectors: Number(e.target.value) });
                }}
              >
                {[1, 8, 12, 16, 36]
                  .filter((n) => !isRose || n > 1)
                  .map((n) => (
                    <option key={n}>{n}</option>
                  ))}
              </select>
            </label>
          )}
          {isRose && (
            <>
              {custom && (
                <>
                  <label>
                    玫瑰图样式
                    <select
                      value={rose}
                      onChange={(e) => setRose(e.target.value)}
                    >
                      <option value="line">中心留白折线</option>
                      <option value="filled">中心留白填充扇环</option>
                    </select>
                  </label>
                  <label>
                    图表缩放
                    <select
                      value={zoom}
                      onChange={(e) => setZoom(e.target.value)}
                    >
                      <option value="1">100%</option>
                      <option value="1.25">125%</option>
                      <option value="1.5">150%</option>
                      <option value="2">200%</option>
                    </select>
                  </label>
                </>
              )}
              {outputId === "monthly-rose" && (
                <label>
                  月份
                  <select
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i}>{i + 1}</option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          {turbulence && (
            <label>
              <input
                type="checkbox"
                checked={iec}
                onChange={(e) => setIec(e.target.checked)}
              />
              IEC 61400-1 第3版 A/B/C 参考曲线
            </label>
          )}
          {outputId === "shear" && (
            <>
              <label>
                低层m
                <select
                  disabled={busy}
                  value={low}
                  aria-label="低层m"
                  onChange={(e) => {
                    setLow(e.target.value);
                    void choosePair(e.target.value, high);
                  }}
                >
                  <option value="">请选择高度</option>
                  {layers.map((c) => (
                    <option key={c.id} value={c.height}>
                      {c.height}m
                    </option>
                  ))}
                </select>
              </label>
              <label>
                高层m
                <select
                  disabled={busy}
                  value={high}
                  aria-label="高层m"
                  onChange={(e) => {
                    setHigh(e.target.value);
                    void choosePair(low, e.target.value);
                  }}
                >
                  <option value="">请选择高度</option>
                  {layers.map((c) => (
                    <option key={c.id} value={c.height}>
                      {c.height}m
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="ww-button"
                onClick={async () => {
                  try {
                    const d = await api<{
                      channels: {
                        id: string;
                        height: number;
                        quantity: string;
                        statistic: string;
                      }[];
                    }>(`/datasets/${run.config.qc_id}`);
                    const ids = [Number(low), Number(high)].map((h) =>
                      d.channels.filter(
                        (c) =>
                          c.height === h &&
                          c.quantity === "speed" &&
                          c.statistic === "mean",
                      ),
                    );
                    if (
                      Number(low) >= Number(high) ||
                      ids.some((c) => c.length !== 1)
                    )
                      throw new Error("请选择两个不同高度且通道唯一的实测层。");
                    await recalculate({
                      shear_channels: ids.map((c) => c[0].id),
                    });
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                选择高度对并重算
              </button>
            </>
          )}
        </div>
        {custom && (
          <div className="ww-result-toolbar">
            {fields.map((f) => (
              <label key={f}>
                <input
                  type="checkbox"
                  checked={!hidden.includes(f)}
                  onChange={() => toggle(f)}
                />
                {names[f]}
              </label>
            ))}
          </div>
        )}
        {busy && <p role="status">正在计算，完成后更新图表…</p>}
        {error && <p role="alert">{error}</p>}
        <button
          className="ww-button"
          onClick={() => downloadJson(config, `chart-${outputId}.json`)}
        >
          导出当前图表配置
        </button>{" "}
        <button className="ww-button" onClick={exportReport}>
          导出本图报告（HTML）
        </button>
      </div>
      {custom && output.status === "ready" ? (
        <>
          {(all ? (channels.length ? channels : [""]) : [selected]).map((c) => {
            let subset = rows.filter(
              (r) =>
                (!c || r.channel === c) &&
                (!isRose ||
                  outputId !== "monthly-rose" ||
                  Number(r.month) === Number(month)),
            );
            const height = subset[0]?.height ?? "";
            if (turbulence && iec) {
              subset = subset.map((r) => {
                const v = Number(r.bin);
                return {
                  ...r,
                  IEC_A: v > 0 ? 0.16 * (0.75 + 5.6 / v) : null,
                  IEC_B: v > 0 ? 0.14 * (0.75 + 5.6 / v) : null,
                  IEC_C: v > 0 ? 0.12 * (0.75 + 5.6 / v) : null,
                };
              });
            }
            const densityValues = subset
              .map((r) => Number(r.density))
              .filter((v) => Number.isFinite(v));
            const meanOf = (key: string) => {
              const values = subset
                .map((r) => Number(r[key]))
                .filter(Number.isFinite);
              return values.length
                ? values.reduce((sum, v) => sum + v, 0) / values.length
                : undefined;
            };
            const densityFooter =
              outputId === "density" && densityValues.length
                ? {
                    period: "平均",
                    density:
                      densityValues.reduce((sum, v) => sum + v, 0) /
                      densityValues.length,
                    temperature_c: meanOf("temperature_c"),
                    pressure_pa: meanOf("pressure_pa"),
                  }
                : undefined;
            return (
              <section className="ww-panel" key={c}>
                <h3>{c || output.title}</h3>
                {outputId === "weibull" && (
                  <p>
                    拟合方法：{method} · k=
                    {Number(
                      ((output.summary?.channels ?? []) as Row[]).find(
                        (v) => v.channel === c,
                      )?.k,
                    ).toFixed(4)}{" "}
                    · c=
                    {Number(
                      ((output.summary?.channels ?? []) as Row[]).find(
                        (v) => v.channel === c,
                      )?.c,
                    ).toFixed(4)}{" "}
                    m/s
                  </p>
                )}
                {!isRose && (
                  <div className="ww-result-toolbar">
                    {fields.map((f) => (
                      <label key={f}>
                        <input
                          type="checkbox"
                          checked={!hidden.includes(c + f)}
                          onChange={() => toggle(c + f)}
                        />
                        {names[f]}-{String(height)}m
                      </label>
                    ))}
                  </div>
                )}
                {isRose ? (
                  (rose === "both" ? ["line", "filled"] : [rose]).map(
                    (style) => (
                      <div className="ww-rose-stack" key={style}>
                        <Plot
                          rows={subset}
                          fields={[]}
                          title={`WD-${String(subset[0]?.direction_height ?? output.summary?.direction_height ?? height)}m · ${style}`}
                          rose={style}
                          zoom={zoom}
                        />
                        <Plot
                          rows={subset}
                          fields={[]}
                          title={`WPD-${height}m · ${style}`}
                          rose={style}
                          energy
                          zoom={zoom}
                        />
                      </div>
                    ),
                  )
                ) : (
                  <Plot
                    rows={subset}
                    fields={[
                      ...fields.filter(
                        (f) => !hidden.includes(f) && !hidden.includes(c + f),
                      ),
                      ...(turbulence && iec
                        ? ["IEC_A", "IEC_B", "IEC_C"].filter(
                            (f) => !hidden.includes(f),
                          )
                        : []),
                    ]}
                    title={`${fields.includes("mean_speed") ? `WS-${height}m / WPD-${height}m` : output.title}`}
                    density={outputId === "density"}
                  />
                )}
                <DataTable rows={subset} footer={densityFooter} />
              </section>
            );
          })}
          {turbulence && iec && (
            <p className="ww-inline-note">
              IEC参考为代表湍流曲线 Iref·(0.75+5.6/V)，A/B/C的Iref为
              0.16/0.14/0.12；S类按项目要求暂不显示。默认显示代表TI，可在上方勾选平均、特征或标准差湍流。
              {["IEC_A", "IEC_B", "IEC_C"].map((f) => (
                <label key={f}>
                  <input
                    type="checkbox"
                    checked={!hidden.includes(f)}
                    onChange={() => toggle(f)}
                  />
                  {f}
                </label>
              ))}
            </p>
          )}
        </>
      ) : (
        <BaseResultView run={run} output={output} outputId={outputId} />
      )}
      {custom && (
        <details>
          <summary>原始统计表、参数与SVG/CSV导出</summary>
          <BaseResultView run={run} output={output} outputId={outputId} />
        </details>
      )}
    </div>
  );
}
