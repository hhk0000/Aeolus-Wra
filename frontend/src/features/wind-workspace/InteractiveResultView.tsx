import { useEffect, useState } from "react";
import { api, downloadJson, runTowerName } from "./api";
import type { Run, RunOutput } from "./api";
import { BaseResultView, DataTable } from "./BaseResultView";
import ReportExport from "./ReportExport";
import { EXCEL } from "./chartTheme";
import { RoseChart } from "./RoseChart";
import { addReportChart } from "./chartReports";
import { reportSnapshot } from "./reportSnapshot";

type Row = Record<string, unknown>;
const colors = EXCEL.series;
const names: Record<string, string> = {
  mean_speed: "风速",
  power_density: "风功率密度",
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
  outputId = "",
}: {
  rows: Row[];
  fields: string[];
  title: string;
  density?: boolean;
  rose?: string;
  energy?: boolean;
  zoom?: string;
  outputId?: string;
}) {
  const [hover, setHover] = useState("");
  const dualAxis = fields.includes("power_density");
  const w = rose ? 900 : dualAxis ? 900 : 800,
    h = rose ? 680 : dualAxis ? 540 : 340,
    L = dualAxis ? 90 : 65,
    R = dualAxis ? 810 : 725,
    T = dualAxis ? 40 : 35,
    B = dualAxis ? 440 : 275;
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
          fontFamily={EXCEL.font}
          fontSize={EXCEL.tickSize}
          style={{
            width: `${Math.max(1, Number(zoom) || 1) * 100}%`,
            minWidth: rose ? 560 : 480,
            background: "white",
          }}
        >
          <text x="65" y="20" fontSize={EXCEL.tickSize} fill={EXCEL.text}>
            {hover}
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
              <rect
                x={L}
                y={T}
                width={R - L}
                height={B - T}
                fill="none"
                stroke={EXCEL.axis}
                strokeWidth="1"
              />
              {dualAxis &&
                rows.map((_, i) => (
                  <line
                    key={`v-${i}`}
                    x1={x(i)}
                    x2={x(i)}
                    y1={T}
                    y2={B}
                    stroke={EXCEL.grid}
                    strokeWidth="1"
                  />
                ))}
              {[0, 1, 2, 3, 4].map((i) => (
                <g key={i}>
                  <line
                    x1={L}
                    x2={R}
                    y1={T + (i * (B - T)) / 4}
                    y2={T + (i * (B - T)) / 4}
                    stroke={EXCEL.grid}
                    strokeWidth="1"
                  />
                  {(dualAxis ? fields.slice(0, 2) : fields.slice(0, 1)).map(
                    (f, j) => {
                      const [lo, hi] = limits(f);
                      return (
                        <text
                          key={f}
                          x={j ? R + 6 : L - 6}
                          y={T + (i * (B - T)) / 4}
                          textAnchor={j ? "start" : "end"}
                          fill={colors[j]}
                          fontSize={dualAxis ? 12 : EXCEL.tickSize}
                        >
                          {(hi - (i * (hi - lo)) / 4).toFixed(density ? 2 : 2)}
                        </text>
                      );
                    },
                  )}
                </g>
              ))}
              {fields.map((f, j) => (
                <g key={f}>
                  {["frequency", "energy_frequency"].includes(f) &&
                    rows.map((r, i) => {
                      const barW = ((R - L) / Math.max(1, rows.length)) * 0.34;
                      return (
                        <rect
                          key={`bar-${i}`}
                          x={x(i) - barW + j * barW}
                          y={y(Number(r[f]), f)}
                          width={barW * 0.9}
                          height={B - y(Number(r[f]), f)}
                          fill={j === 0 ? colors[0] : colors[1]}
                        >
                          <title>{Number(r[f]).toFixed(3)}%</title>
                        </rect>
                      );
                    })}
                  {!["frequency", "energy_frequency"].includes(f) && (
                    <>
                      <polyline
                        points={rows
                          .map((r, i) =>
                            r[f] != null ? `${x(i)},${y(Number(r[f]), f)}` : "",
                          )
                          .filter(Boolean)
                          .join(" ")}
                        fill="none"
                        stroke={colors[j % colors.length]}
                        strokeWidth={dualAxis ? 3 : EXCEL.lineWidth}
                        strokeDasharray={
                          dualAxis && j === 1 ? "6 4" : undefined
                        }
                      />
                      {rows.map(
                        (r, i) =>
                          r[f] != null &&
                          (dualAxis ? (
                            <g
                              key={i}
                              onMouseEnter={() =>
                                setHover(
                                  `${r.period ?? r.bin ?? r.label}: ${names[f] ?? f}=${Number(r[f]).toFixed(4)}`,
                                )
                              }
                            >
                              {j === 0 ? (
                                <rect
                                  x={x(i) - 7}
                                  y={y(Number(r[f]), f) - 7}
                                  width="14"
                                  height="14"
                                  transform={`rotate(45 ${x(i)} ${y(Number(r[f]), f)})`}
                                  fill={colors[j % colors.length]}
                                />
                              ) : (
                                <rect
                                  x={x(i) - 5}
                                  y={y(Number(r[f]), f) - 5}
                                  width="10"
                                  height="10"
                                  fill={colors[j % colors.length]}
                                />
                              )}
                              <title>{Number(r[f]).toFixed(4)}</title>
                            </g>
                          ) : (
                            <circle
                              key={i}
                              cx={x(i)}
                              cy={y(Number(r[f]), f)}
                              r={EXCEL.marker}
                              fill={colors[j % colors.length]}
                              onMouseEnter={() =>
                                setHover(
                                  `${r.period ?? r.bin ?? r.label}: ${names[f] ?? f}=${Number(r[f]).toFixed(4)}`,
                                )
                              }
                            >
                              <title>{Number(r[f]).toFixed(4)}</title>
                            </circle>
                          )),
                      )}
                    </>
                  )}
                </g>
              ))}
              {rows.map(
                (r, i) =>
                  i % Math.max(1, Math.ceil(rows.length / 24)) === 0 && (
                    <text
                      key={i}
                      x={x(i)}
                      y={B + 22}
                      textAnchor="middle"
                      fontSize={EXCEL.tickSize + (dualAxis ? 2 : 0)}
                    >
                      {String(r.period ?? r.bin ?? r.label ?? "")}
                      {outputId === "monthly" ? "月" : ""}
                    </text>
                  ),
              )}
            </>
          )}
          {!rose && (
            <>
              <text
                x={(L + R) / 2}
                y={h - 4}
                textAnchor="middle"
                fontSize={EXCEL.tickSize}
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
                        : outputId === "weibull"
                          ? "风速(m/s)"
                          : ""}
              </text>
              <text
                transform={`translate(16 ${(T + B) / 2}) rotate(-90)`}
                textAnchor="middle"
                fontSize={EXCEL.tickSize}
                fill={EXCEL.text}
              >
                {fields.includes("power_density")
                  ? "风速(m/s)"
                  : (names[fields[0]] ?? "")}
              </text>
              {fields.includes("power_density") && (
                <text
                  transform={`translate(${w - 8} ${(T + B) / 2}) rotate(90)`}
                  textAnchor="middle"
                  fontSize={EXCEL.tickSize}
                  fill={colors[1]}
                >
                  风功率密度(W/m²)
                </text>
              )}
            </>
          )}
        </svg>
        {fields.length > 0 && (
          <div
            className={`ww-plot-legend${dualAxis ? " is-dual" : ""}`}
            aria-label="图例"
          >
            {fields.map((f, j) => {
              const box = [
                "frequency",
                "energy_frequency",
                "fitted_frequency",
              ].includes(f);
              const shape = dualAxis ? (j === 0 ? "diamond" : "square") : box;
              return (
                <span key={f}>
                  <i
                    className={shape ? String(shape) : ""}
                    style={
                      box || dualAxis
                        ? { background: colors[j % colors.length] }
                        : { borderColor: colors[j % colors.length] }
                    }
                  />
                  {names[f] ?? f}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </figure>
  );
}

export function InteractiveResultView({
  run: original,
  output: initial,
  outputId,
  towerName,
  exportMode = false,
}: {
  run: Run;
  output: RunOutput;
  outputId: string;
  towerName?: string;
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
  const [reportNotice, setReportNotice] = useState("");
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
    completeness = outputId === "completeness";
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
    sourceRunId: original.id,
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
    const root = document.getElementById(`interactive-${outputId}`);
    if (!root) return;
    const title = [
      output.title,
      outputId === "weibull" && method,
      (outputId === "correlation" || isRose) && `${sectors}扇区`,
      isRose &&
        outputId !== "reference-rose" &&
        (rose === "line" ? "折线" : "填充"),
      outputId === "monthly-rose" && `${month}月`,
      all ? "全部高度" : custom && selected,
    ]
      .filter(Boolean)
      .join(" · ");
    try {
      addReportChart(title, reportSnapshot(root, output.title), config);
      setReportNotice("已加入报告，可在“报告导出配置”中选择。");
    } catch {
      setReportNotice("");
      setError(
        "浏览器未能保存图表配置，请在报告导出配置中移除不用的图表，或缩小当前图表选择后重试。",
      );
    }
  }
  if (completeness && output.status === "ready") {
    const data = rows.filter((r) => r.raw_records !== undefined);
    const towerId = runTowerName(run, towerName);
    const annualDays = Number(run.config.annual_days ?? 365);
    const tables = [
      {
        title: "实测数据完整率",
        valid: (r: Row) => r.raw_valid,
        expected: (r: Row) => r.expected,
      },
      {
        title: "实测有效数据完整率",
        valid: (r: Row) => r.qc_valid,
        expected: (r: Row) => r.raw_records,
      },
      {
        title: `完整年有效数据完整率（${annualDays}天基准）`,
        valid: (r: Row) => r.annual_valid,
        expected: (r: Row) => r.annual_expected,
      },
    ];
    return (
      <div>
        {tables.map((t) => (
          <section key={t.title}>
            <h3>{t.title}</h3>
            <DataTable
              rows={data.map((r) => {
                const expected = t.expected(r);
                const valid = t.valid(r);
                return {
                  塔号: towerId,
                  通道: r.channel,
                  应测数据: expected,
                  实测数据: valid,
                  缺失数据:
                    typeof expected === "number" && typeof valid === "number"
                      ? Math.max(0, expected - valid)
                      : null,
                  完整率:
                    typeof expected === "number" &&
                    expected > 0 &&
                    typeof valid === "number"
                      ? `${((100 * valid) / expected).toFixed(2)}%`
                      : null,
                };
              })}
            />
          </section>
        ))}
        <p>
          实测完整率使用原始有效数和应测数，实测有效完整率使用质控有效数和同期原始记录数。完整年按{" "}
          {annualDays} 天及数据步长计数，10 分钟数据每天 144
          条。缺少分析时段或有效分母的单元格显示为“—”。
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
          runs={[{ run: original }]}
          renderOutput={(reportRun, id, entry) => (
            <InteractiveResultView
              run={reportRun}
              towerName={towerName}
              output={entry}
              outputId={id}
              exportMode
            />
          )}
        />
      )}
      <div className="ww-panel">
        <button
          className="ww-button"
          disabled={busy || output.status !== "ready"}
          onClick={addToReport}
        >
          加入报告（保留当前算法与显示配置）
        </button>
        {reportNotice && <p role="status">{reportNotice}</p>}
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
                        <RoseChart
                          rows={subset}
                          title={`WD-${String(subset[0]?.direction_height ?? output.summary?.direction_height ?? height)}m · ${style}`}
                          rose={style}
                          zoom={zoom}
                        />
                        <RoseChart
                          rows={subset}
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
                    outputId={outputId}
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
