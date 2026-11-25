import { useEffect, useState } from "react";
import { api, downloadJson, runTowerName } from "./api";
import type { Run, RunOutput } from "./api";
import { BaseResultView, DataTable } from "./BaseResultView";
import ReportExport from "./ReportExport";
import { useChartTextSize } from "./chartText";
import { EXCEL } from "./chartTheme";
import { RoseChart } from "./RoseChart";
import { addReportCharts, removeReportCharts } from "./chartReports";
import { reportSnapshot } from "./reportSnapshot";
import { AxisRange } from "./AxisRangeControl";
import { defaultAxisRange, getAxisRange } from "./axisRange";
import { isHistoricalHourlyResult } from "./model";

type Row = Record<string, unknown>;
type RoseMetric = "direction" | "energy" | "both";
type RoseSession = {
  run: Run;
  metric: RoseMetric;
  all: boolean;
  channel: string;
  measuredChannel: string;
  sectors: number;
  rose: string;
  zoom: string;
  month: string;
};
const roseSessions = new Map<string, RoseSession>();
const measuredRuns = new Map<string, Run>();
const pendingMeasuredRuns = new Map<string, Promise<Run>>();

function rememberRose<T>(cache: Map<string, T>, key: string, value: T) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > 16) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}
function loadMeasuredRun(key: string, id: string, sectors: number) {
  const pending = pendingMeasuredRuns.get(key);
  if (pending) return pending;
  const request = api<Run>(`/runs/${id}/measured-direction`, { sectors })
    .then((result) => {
      rememberRose(measuredRuns, key, result);
      return result;
    })
    .finally(() => pendingMeasuredRuns.delete(key));
  pendingMeasuredRuns.set(key, request);
  return request;
}
const colors = EXCEL.series;
const iecFields = ["IEC_A", "IEC_B", "IEC_C"];
function seriesColor(field: string, index: number) {
  if (["power_density", "energy_frequency"].includes(field)) return colors[1];
  if (["mean_speed", "frequency"].includes(field)) return colors[0];
  if (field === "fitted_frequency") return EXCEL.weibull;
  const tiIndex = [
    "representative",
    ...iecFields,
    "mean",
    "std",
    "characteristic",
  ].indexOf(field);
  if (tiIndex === 6) return "#595959";
  return colors[(tiIndex < 0 ? index : tiIndex) % colors.length];
}
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
  IEC_A: "IEC A",
  IEC_B: "IEC B",
  IEC_C: "IEC C",
};

export function Plot({
  rows,
  fields,
  title,
  density = false,
  densityMinimum = 0.5,
  densityMaximum,
  densityBars = false,
  rose = "",
  energy = false,
  zoom = "1",
  outputId = "",
  fit,
}: {
  rows: Row[];
  fields: string[];
  title: string;
  density?: boolean;
  densityMinimum?: number;
  densityMaximum?: number;
  densityBars?: boolean;
  rose?: string;
  energy?: boolean;
  zoom?: string;
  outputId?: string;
  fit?: Row;
}) {
  const textSize = useChartTextSize();
  const [hover, setHover] = useState("");
  const dualAxis =
    fields.includes("power_density") && fields.includes("mean_speed");
  const axisSize = textSize(13);
  const w = rose ? 900 : dualAxis ? 900 : 800,
    h = rose ? 680 : dualAxis ? 540 : 340,
    L = dualAxis ? Math.max(90, 5 * axisSize + 12) : 65,
    R = dualAxis ? w - Math.max(90, 4 * axisSize + 16) : 725,
    T = fit ? 54 : dualAxis ? 3 * axisSize + 24 : 35,
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
    const lo = density ? densityMinimum : Math.min(0, ...vals);
    const hi = density
      ? (densityMaximum ??
        Math.max(lo + 0.01, Math.ceil(Math.max(...vals) * 20) / 20))
      : Math.max(0.001, ...vals) * 1.1;
    return [lo, hi];
  };
  const x = (i: number) => L + ((i + 0.5) / Math.max(1, rows.length)) * (R - L);
  const y = (v: number, f: string) => {
    const [lo, hi] = limits(f);
    return B - ((v - lo) / (hi - lo || 1)) * (B - T);
  };
  const highlightedBin =
    outputId === "turbulence"
      ? rows.findIndex((row) => Number(row.bin) === 15)
      : -1;
  const isBar = (field: string) =>
    (densityBars && field === "density") ||
    ["frequency", "energy_frequency"].includes(field);
  return (
    <figure className="ww-interactive-plot">
      <figcaption>{title}</figcaption>
      <div className="ww-plot-scroll">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={title}
          fontFamily={EXCEL.font}
          fontWeight="700"
          fontSize={textSize(13)}
          style={{
            width: `calc(${Math.max(1, Number(zoom) || 1) * 100}% * var(--ww-plot-scale, 1))`,
            background: "white",
          }}
        >
          <text
            x={L}
            y={dualAxis ? axisSize + 4 : 20}
            fontSize={axisSize}
            fill={EXCEL.text}
          >
            {hover}
          </text>
          {fit && typeof fit.k === "number" && typeof fit.c === "number" && (
            <text
              x={R}
              y={textSize(17) + 5}
              textAnchor="end"
              fontSize={textSize(17)}
              fill={EXCEL.text}
            >
              k = {fit.k.toFixed(4)} · A = {fit.c.toFixed(4)} m/s
            </text>
          )}
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
                    <text
                      x={tick[0]}
                      y={tick[1]}
                      fontSize={textSize(10)}
                      fill="#52665b"
                    >
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
                          fill={seriesColor(f, j)}
                          fontSize={textSize(13)}
                        >
                          {(hi - (i * (hi - lo)) / 4).toFixed(
                            density && hi - lo < 0.04 ? 3 : 2,
                          )}
                        </text>
                      );
                    },
                  )}
                </g>
              ))}
              {fields.map((f, j) => (
                <g key={f}>
                  {isBar(f) &&
                    rows.map((r, i) => {
                      if (
                        density &&
                        (r[f] == null || !Number.isFinite(Number(r[f])))
                      )
                        return null;
                      const barW =
                        ((R - L) / Math.max(1, rows.length)) *
                        (density ? 0.66 : 0.34);
                      return (
                        <rect
                          key={`bar-${i}`}
                          x={
                            density
                              ? x(i) - barW / 2
                              : x(i) -
                                barW +
                                (f === "energy_frequency" ? barW : 0)
                          }
                          y={y(Number(r[f]), f)}
                          width={barW * (density ? 1 : 0.9)}
                          height={Math.max(0, B - y(Number(r[f]), f))}
                          fill={seriesColor(f, j)}
                        >
                          <title>
                            {Number(r[f]).toFixed(density ? 4 : 3)}
                            {density ? " kg/m³" : "%"}
                          </title>
                        </rect>
                      );
                    })}
                  {!isBar(f) && (
                    <>
                      <polyline
                        points={rows
                          .map((r, i) =>
                            r[f] != null ? `${x(i)},${y(Number(r[f]), f)}` : "",
                          )
                          .filter(Boolean)
                          .join(" ")}
                        fill="none"
                        stroke={seriesColor(f, j)}
                        strokeWidth={dualAxis ? 3 : EXCEL.lineWidth}
                        strokeDasharray={
                          f === "power_density" ? "6 4" : undefined
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
                                  fill={seriesColor(f, j)}
                                />
                              ) : (
                                <rect
                                  x={x(i) - 5}
                                  y={y(Number(r[f]), f) - 5}
                                  width="10"
                                  height="10"
                                  fill={seriesColor(f, j)}
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
                              fill={seriesColor(f, j)}
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
              {highlightedBin >= 0 &&
                fields.map((field, index) => {
                  const value = rows[highlightedBin][field];
                  if (
                    iecFields.includes(field) ||
                    value == null ||
                    !Number.isFinite(Number(value))
                  )
                    return null;
                  const color = seriesColor(field, index);
                  const pointLabel = `15 m/s · ${names[field] ?? field}=${Number(value).toFixed(4)}`;
                  return (
                    <circle
                      key={field}
                      cx={x(highlightedBin)}
                      cy={y(Number(value), field)}
                      r="6"
                      fill={color}
                      stroke="white"
                      strokeWidth="2"
                      aria-label={pointLabel}
                      onMouseEnter={() => setHover(pointLabel)}
                    >
                      <title>{pointLabel}</title>
                    </circle>
                  );
                })}
              {rows.map(
                (r, i) =>
                  i % Math.max(1, Math.ceil(rows.length / 24)) === 0 && (
                    <text
                      key={i}
                      x={x(i)}
                      y={B + 22}
                      textAnchor="middle"
                      fontSize={textSize(13)}
                      fill={i === highlightedBin ? "#235e9a" : EXCEL.text}
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
                fontSize={textSize(13)}
                fill={EXCEL.text}
              >
                {outputId === "monthly" || outputId === "density"
                  ? "月份"
                  : outputId === "hourly" || outputId === "monthly-hourly"
                    ? "时段"
                    : outputId === "frequency"
                      ? "风速区间"
                      : outputId === "turbulence"
                        ? "风速 (m/s)"
                        : outputId === "weibull"
                          ? "风速(m/s)"
                          : ""}
              </text>
              <text
                transform={`translate(${dualAxis ? axisSize + 4 : 16} ${(T + B) / 2}) rotate(-90)`}
                textAnchor="middle"
                fontSize={textSize(13)}
                fill={fields.length ? seriesColor(fields[0], 0) : EXCEL.text}
              >
                {outputId === "turbulence"
                  ? "湍流强度"
                  : fields[0] === "mean_speed"
                    ? "风速 (m/s)"
                    : fields[0] === "power_density"
                      ? "风功率密度 (W/m²)"
                      : (names[fields[0]] ?? "")}
              </text>
              {dualAxis && (
                <text
                  x={w - 14}
                  y={T - axisSize - 12}
                  textAnchor="end"
                  fontSize={axisSize}
                  fill={colors[1]}
                >
                  风功率密度 (W/m²)
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
              const box = isBar(f);
              const shape = dualAxis
                ? j === 0
                  ? "diamond"
                  : "square"
                : box
                  ? "box"
                  : "";
              const color = seriesColor(f, j);
              return (
                <span key={f} style={{ color }}>
                  <i
                    className={shape}
                    style={
                      box || dualAxis
                        ? { backgroundColor: color }
                        : { borderColor: color }
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
  qcCompletenessOnly = false,
  exportMode = false,
}: {
  run: Run;
  output: RunOutput;
  outputId: string;
  towerName?: string;
  qcCompletenessOnly?: boolean;
  exportMode?: boolean;
}) {
  const turbulence = outputId === "turbulence";
  const localRose = ["annual-rose", "monthly-rose"].includes(outputId);
  const roseKey = localRose && !exportMode ? original.id + "/" + outputId : "";
  const remembered = roseSessions.get(roseKey);
  const [directions, setDirections] = useState<
    { id: string; name: string; height: number }[]
  >([]);
  const [layers, setLayers] = useState<{ id: string; height: number }[]>([]);
  useEffect(() => {
    if (outputId !== "shear" || exportMode) return;
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
  }, [original, outputId, exportMode]);
  const [run, setRun] = useState(remembered?.run ?? original),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [reportNotice, setReportNotice] = useState("");
  const [addedReportIds, setAddedReportIds] = useState<string[]>([]);
  const [all, setAll] = useState(
      remembered?.all ?? (exportMode && outputId !== "monthly-rose"),
    ),
    [channel, setChannel] = useState(remembered?.channel ?? "");
  const [seriesVisibility, setSeriesVisibility] = useState<
      Record<string, boolean>
    >({}),
    [rose, setRose] = useState(remembered?.rose ?? "line"),
    [zoom, setZoom] = useState(remembered?.zoom ?? "1"),
    [month, setMonth] = useState(remembered?.month ?? "all");
  const [visibleIec, setVisibleIec] = useState(iecFields);
  const [densityAxis, setDensityAxis] = useState(defaultAxisRange);
  const [densityType, setDensityType] = useState("line");
  const [minimumSamples, setMinimumSamples] = useState(
    String(run.config.turbulence_minimum_samples ?? 20),
  );
  const [method, setMethod] = useState(
      String(run.config.weibull_method ?? "mle"),
    ),
    [sectors, setSectors] = useState(
      remembered?.sectors ?? Number(run.config.sectors ?? 16),
    );
  const measurementSnapshot = original.kind === "measured-direction";
  const [roseMetric, setRoseMetric] = useState<RoseMetric>(
    remembered?.metric ??
      (!exportMode && outputId === "annual-rose"
        ? "both"
        : !exportMode || measurementSnapshot
          ? "direction"
          : "energy"),
  );
  const compareRose = localRose && roseMetric === "both";
  const measured = localRose && roseMetric !== "energy";
  useEffect(() => {
    const id = original.config.result_id;
    if (!localRose || measured || exportMode || typeof id !== "string") return;
    let active = true;
    api<{
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
  }, [original, localRose, measured, exportMode]);
  const [measuredResponse, setMeasuredResponse] = useState<{
    sectors: number;
    run?: Run;
    error?: string;
  }>();
  const [measuredChannel, setMeasuredChannel] = useState(
    remembered?.measuredChannel ?? "",
  );
  const [retry, setRetry] = useState(0);
  const measuredKey = original.id + "/" + sectors;
  useEffect(() => {
    if (roseKey)
      rememberRose(roseSessions, roseKey, {
        run,
        metric: roseMetric,
        all,
        channel,
        measuredChannel,
        sectors,
        rose,
        zoom,
        month,
      });
  }, [
    roseKey,
    run,
    roseMetric,
    all,
    channel,
    measuredChannel,
    sectors,
    rose,
    zoom,
    month,
  ]);
  useEffect(() => {
    if (
      !measured ||
      measurementSnapshot ||
      exportMode ||
      measuredRuns.has(measuredKey)
    )
      return;
    let active = true;
    loadMeasuredRun(measuredKey, original.id, sectors)
      .then((result) => {
        if (active) setMeasuredResponse({ sectors, run: result });
      })
      .catch((cause: Error) => {
        if (active) setMeasuredResponse({ sectors, error: cause.message });
      });
    return () => {
      active = false;
    };
  }, [
    measured,
    measurementSnapshot,
    exportMode,
    original.id,
    sectors,
    measuredKey,
    retry,
  ]);
  const originalShear = Array.isArray(original.config.shear_channels)
    ? (original.config.shear_channels as string[])
    : [];
  const originalProfile = (initial.summary?.profile ?? []) as {
    height: number;
  }[];
  const [low, setLow] = useState(() =>
      originalProfile.length === 2 ? String(originalProfile[0].height) : "",
    ),
    [high, setHigh] = useState(() =>
      originalProfile.length === 2 ? String(originalProfile[1].height) : "",
    );
  const [shearMode, setShearMode] = useState(
    originalProfile.length === 2 ? "pair" : "profile",
  );
  const chartRun =
    measured && !measurementSnapshot
      ? (measuredRuns.get(measuredKey) ??
        (measuredResponse?.sectors === sectors
          ? measuredResponse.run
          : undefined))
      : run;
  const output =
    (exportMode ? initial : chartRun?.outputs[outputId]) ??
    (measured
      ? {
          title: "实测风向频率",
          method: "measured-direction-frequency",
          status: "unavailable" as const,
          reason:
            measuredResponse?.sectors === sectors
              ? measuredResponse.error
              : "正在统计实测风向…",
        }
      : initial);
  const rows = output.rows ?? [];
  const channels = [
    ...new Set(rows.map((r) => String(r.channel ?? "")).filter(Boolean)),
  ];
  const preferred = rows.reduce<Row>(
    (best, row) =>
      Number(row.height ?? 0) > Number(best.height ?? 0) ? row : best,
    rows[0] ?? {},
  ).channel;
  const channelChoice = measured ? measuredChannel : channel;
  const selected =
    (channels.includes(channelChoice) ? channelChoice : "") ||
    (typeof preferred === "string" ? preferred : channels[0]) ||
    "";
  const energyRows = run.outputs["annual-rose"]?.rows ?? [];
  const measuredHeight = rows.find((row) => row.channel === selected)?.height;
  const pairedEnergy = energyRows.reduce<Row | undefined>((best, row) => {
    if (!best) return row;
    const score = (item: Row) =>
      item.direction_height === measuredHeight ? 1 : 0;
    return score(row) > score(best) ||
      (score(row) === score(best) && Number(row.height) > Number(best.height))
      ? row
      : best;
  }, undefined);
  const peerRows =
    compareRose && pairedEnergy && Number(run.config.sectors ?? 16) === sectors
      ? energyRows.filter(
          (row) =>
            row.channel === pairedEnergy.channel &&
            row.direction_height === pairedEnergy.direction_height &&
            row.direction_channel === pairedEnergy.direction_channel,
        )
      : [];
  const energyTitle = pairedEnergy
    ? "风能 · WPD-" +
      pairedEnergy.height +
      "m / WD-" +
      pairedEnergy.direction_height +
      "m"
    : "风能";
  const maxRose = Math.max(
    0,
    ...rows
      .filter((row) => row.channel === selected)
      .map((row) => Number(row.frequency) || 0),
    ...peerRows.map((row) => Number(row.energy_frequency) || 0),
  );
  const isRose = outputId.includes("rose"),
    rawCompleteness = outputId === "raw-records",
    completeness = rawCompleteness || outputId === "completeness";
  const fields = turbulence
    ? ["mean", "std", "characteristic", "representative", ...iecFields]
    : outputId === "density"
      ? ["density"]
      : ["frequency", "weibull"].includes(outputId)
        ? [
            "frequency",
            "energy_frequency",
            ...(outputId === "weibull" ? ["fitted_frequency"] : []),
          ]
        : ["mean_speed", "power_density"];
  const seriesKey = (c: string, f: string) => JSON.stringify([c, f]);
  const isVisible = (c: string, f: string) =>
    iecFields.includes(f)
      ? visibleIec.includes(f)
      : (seriesVisibility[seriesKey(c, f)] ??
        (!turbulence || !["mean", "std", "characteristic"].includes(f)));
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
      setMinimumSamples(String(run.config.turbulence_minimum_samples ?? 20));

      setSectors(Number(run.config.sectors ?? 16));
    } finally {
      setBusy(false);
    }
  }
  async function calculateShear() {
    if (shearMode === "profile") {
      if (originalShear.length < 2) {
        setError("请先在风资源分析配置中选择用于回归的实测高度。");
        return;
      }
      await recalculate({ shear_channels: originalShear });
      return;
    }
    const a = low,
      b = high;
    const ids = [a, b].map((z) => layers.filter((c) => c.height === Number(z)));
    if (!a || !b || Number(a) >= Number(b) || ids.some((v) => v.length !== 1)) {
      setError("请选择低层小于高层、且每层通道唯一的组合。");
      return;
    }
    await recalculate({ shear_channels: ids.map((v) => v[0].id) });
  }
  const config = {
    outputId,
    all,
    channel: selected,
    seriesVisibility,
    visibleIec,
    minimumSamples: run.config.turbulence_minimum_samples ?? 20,
    rose,
    month,
    weibullMethod: String(run.config.weibull_method ?? "mle"),
    sectors,
    low,
    high,
    shearMode,
    roseMetric,
    runId: chartRun?.id ?? run.id,
    sourceRunId: original.id,
    resultAggregation: run.config.aggregation,
  };
  const historicalHourly = isHistoricalHourlyResult(run, outputId);
  function exportReport() {
    const charts = document
      .getElementById(`interactive-${outputId}`)
      ?.querySelectorAll("svg");
    const html = `<!doctype html><meta charset="utf-8"><title>风资源图表报告</title><style>body{font-family:${EXCEL.font};margin:32px}svg{max-width:100%;page-break-inside:avoid}pre{white-space:pre-wrap}</style><h1>风资源图表报告</h1><p>当前配置；未调整选项使用默认值。统计基准365天/52560个十分钟格，实际日历时段另列。</p><pre>${JSON.stringify(config, null, 2).replaceAll("<", "&lt;")}</pre>${Array.from(
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
  function addToReport() {
    const root = document.getElementById(`interactive-${outputId}`);
    if (!root) return;
    const title = [
      output.title,
      outputId === "weibull" && config.weibullMethod,
      (outputId === "correlation" || isRose) && `${sectors}扇区`,
      isRose &&
        outputId !== "reference-rose" &&
        (rose === "line" ? "折线" : "填充"),
      outputId === "monthly-rose" &&
        (month === "all" ? "全年和各月" : `${month}月`),
      all ? "全部高度" : custom && selected,
    ]
      .filter(Boolean)
      .join(" · ");
    try {
      const peer = root.querySelector("[data-rose-energy-peer]");
      const entries = [
        {
          title,
          html: reportSnapshot(root, output.title, "[data-rose-energy-peer]"),
          config: compareRose ? { ...config, roseMetric: "direction" } : config,
        },
      ];
      if (peer && peerRows.length) {
        entries.push({
          title: energyTitle,
          html: reportSnapshot(peer, energyTitle),
          config: { ...config, roseMetric: "energy", runId: run.id },
        });
      }
      setAddedReportIds(addReportCharts(entries));
      setReportNotice("已加入报告，可在“报告导出配置”中选择。");
    } catch {
      setReportNotice("");
      setError(
        "浏览器未能保存图表配置，请在报告导出配置中移除不用的图表，或缩小当前图表选择后重试。",
      );
    }
  }
  if (completeness && output.status === "ready") {
    const data = rawCompleteness
      ? rows
      : rows.filter((r) => r.raw_records !== undefined);
    const towerId = runTowerName(run, towerName);
    const annualDays = Number(run.config.annual_days ?? 365);
    const tables = [
      {
        title: "实测数据完整率",
        valid: (r: Row) => (rawCompleteness ? r.valid_count : r.raw_valid),
        expected: (r: Row) => (rawCompleteness ? r.expected_count : r.expected),
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
        {(rawCompleteness
          ? tables.slice(0, 1)
          : qcCompletenessOnly
            ? tables.slice(1, 2)
            : tables
        ).map((t) => (
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
        {!rawCompleteness && !qcCompletenessOnly && (
          <p>
            实测完整率使用原始有效数和应测数，实测有效完整率使用质控有效数和同期原始记录数。完整年按{" "}
            {annualDays} 天及数据步长计数，10 分钟数据每天 144
            条。缺少分析时段或有效分母的单元格显示为“—”。
          </p>
        )}
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
  const hasChartSettings =
    (custom && outputId !== "density") ||
    ["correlation", "shear"].includes(outputId);
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
      <div className="ww-panel ww-chart-controls">
        <div className="ww-chart-actions">
          <button
            className="ww-button"
            disabled={busy || output.status !== "ready" || historicalHourly}
            onClick={addToReport}
          >
            加入报告
          </button>
          {addedReportIds.length > 0 && (
            <button
              className="ww-button"
              onClick={() => {
                try {
                  removeReportCharts(addedReportIds);
                  setAddedReportIds([]);
                  setReportNotice("已撤销加入报告。");
                } catch {
                  setError("未能撤销，请在报告导出配置中重试。");
                }
              }}
            >
              撤销加入
            </button>
          )}
          <details className="ww-details">
            <summary>更多导出</summary>
            <div className="ww-chart-actions">
              <button
                className="ww-button"
                onClick={exportReport}
                disabled={historicalHourly}
              >
                本图报告（HTML）
              </button>
              <button
                className="ww-button"
                onClick={() => downloadJson(config, `chart-${outputId}.json`)}
              >
                图表设置备份（JSON）
              </button>
            </div>
          </details>
        </div>
        {reportNotice && <p role="status">{reportNotice}</p>}
        {hasChartSettings && (
          <div className="ww-fields ww-fields-three">
            {localRose && (
              <label>
                显示内容
                <select
                  value={roseMetric}
                  onChange={(event) => {
                    const metric = event.target.value as typeof roseMetric;
                    setRoseMetric(metric);
                    if (metric === "both") setAll(false);
                    if (
                      metric !== "direction" &&
                      sectors !== Number(run.config.sectors ?? 16)
                    )
                      void recalculate({ sectors });
                  }}
                >
                  {outputId === "annual-rose" && (
                    <option value="both">风向与风能对照</option>
                  )}
                  <option value="direction">实测风向</option>
                  <option value="energy">风能分布</option>
                </select>
              </label>
            )}
            {localRose && !measured && (
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
            {custom && channels.length > 1 && (
              <label>
                {measured
                  ? "实测风向高度"
                  : localRose
                    ? "风能计算风速通道"
                    : "通道"}
                <select
                  value={selected}
                  disabled={all}
                  onChange={(e) =>
                    (measured ? setMeasuredChannel : setChannel)(e.target.value)
                  }
                >
                  {channels.map((c) => (
                    <option key={c} value={c}>
                      {measured
                        ? (() => {
                            const row = rows.find(
                              (entry) => entry.channel === c,
                            );
                            return `WD-${row?.height}m · ${row?.direction_name}`;
                          })()
                        : c}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {custom && outputId !== "density" && !compareRose && (
              <label>
                <input
                  type="checkbox"
                  checked={all}
                  disabled={busy}
                  onChange={(e) => {
                    setAll(e.target.checked);
                    if (measured) return;
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
                {measured ? "全部实测风向高度" : "全部高度分图"}
              </label>
            )}
            {turbulence && !exportMode && (
              <>
                <div
                  className="ww-iec-options"
                  role="group"
                  aria-label="IEC 参考线（所有高度）"
                >
                  {iecFields.map((field) => (
                    <label key={field}>
                      <input
                        type="checkbox"
                        checked={visibleIec.includes(field)}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setVisibleIec((previous) =>
                            checked
                              ? [...previous, field]
                              : previous.filter((item) => item !== field),
                          );
                        }}
                      />
                      {names[field]}
                    </label>
                  ))}
                </div>
                <form
                  className="ww-turbulence-threshold"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void recalculate({
                      turbulence_minimum_samples: Number(minimumSamples),
                    });
                  }}
                >
                  <label>
                    样本充足阈值（条/风速档）
                    <input
                      type="number"
                      min={1}
                      step={1}
                      required
                      value={minimumSamples}
                      disabled={busy}
                      onChange={(e) => setMinimumSamples(e.target.value)}
                    />
                  </label>
                  <button type="submit" className="ww-button" disabled={busy}>
                    应用阈值
                  </button>
                </form>
              </>
            )}
            {outputId === "weibull" && (
              <>
                <label>
                  拟合算法
                  <select
                    disabled={busy}
                    value={method}
                    onChange={(e) => {
                      setMethod(e.target.value);
                      setError("");
                    }}
                  >
                    <option value="mle">最大似然 MLE（默认）</option>
                    <option value="least-squares">累计概率线性最小二乘</option>
                    <option value="moments">矩估计</option>
                    <option value="energy">均速与能量匹配</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="ww-button"
                  disabled={busy}
                  onClick={() => void recalculate({ weibull_method: method })}
                >
                  开始计算
                </button>
              </>
            )}
            {(outputId === "correlation" || (isRose && custom)) && (
              <label>
                方位扇区
                <select
                  value={sectors}
                  disabled={busy}
                  onChange={(e) => {
                    setSectors(Number(e.target.value));
                    if (!measured || compareRose)
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
                        <option value="line">雷达折线</option>
                        <option value="filled">填充雷达</option>
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
                      <option value="all">全年及各月</option>
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i} value={i + 1}>
                          {i + 1}月
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {outputId === "shear" && (
              <>
                <label>
                  计算方法
                  <select
                    disabled={busy}
                    value={shearMode}
                    onChange={(e) => setShearMode(e.target.value)}
                  >
                    <option value="profile">幂律回归（使用配置高度）</option>
                    <option value="pair">两高度幂律（指定高度对）</option>
                  </select>
                </label>
                {shearMode === "pair" && (
                  <>
                    <label>
                      低层（m）
                      <select
                        disabled={busy}
                        value={low}
                        onChange={(e) => setLow(e.target.value)}
                      >
                        <option value="">请选择高度</option>
                        {[...new Set(layers.map((layer) => layer.height))].map(
                          (height) => (
                            <option key={height} value={height}>
                              {height} m
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      高层（m）
                      <select
                        disabled={busy}
                        value={high}
                        onChange={(e) => setHigh(e.target.value)}
                      >
                        <option value="">请选择高度</option>
                        {[...new Set(layers.map((layer) => layer.height))].map(
                          (height) => (
                            <option key={height} value={height}>
                              {height} m
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  </>
                )}
                <button
                  type="button"
                  className="ww-button"
                  disabled={busy}
                  onClick={() => void calculateShear()}
                >
                  开始计算
                </button>
              </>
            )}
          </div>
        )}
        {measured &&
          !chartRun &&
          measuredResponse?.sectors === sectors &&
          measuredResponse.error && (
            <div className="ww-chart-actions">
              <p role="alert">{measuredResponse.error}</p>
              <button
                className="ww-button"
                type="button"
                onClick={() => {
                  setMeasuredResponse(undefined);
                  setRetry((previous) => previous + 1);
                }}
              >
                重新载入风向
              </button>
            </div>
          )}
        {busy && <p role="status">正在计算，完成后更新图表…</p>}
        {error && <p role="alert">{error}</p>}
      </div>
      {measured &&
      !chartRun &&
      !exportMode &&
      !(measuredResponse?.sectors === sectors && measuredResponse.error) ? (
        <div className="ww-simple-empty" role="status">
          正在统计实测风向…
        </div>
      ) : custom && output.status === "ready" ? (
        <>
          {(all ? (channels.length ? channels : [""]) : [selected]).map((c) => {
            let subset = rows.filter(
              (r) =>
                (!c || r.channel === c) &&
                (!isRose ||
                  outputId !== "monthly-rose" ||
                  month === "all" ||
                  Number(r.month) === Number(month)),
            );
            const height = subset[0]?.height ?? "";
            const roseLabel = measured
              ? `风向 · WD-${height}m`
              : `风能 · WPD-${height}m`;
            const showRoseYear = outputId === "monthly-rose" && month === "all";
            const yearRoseRows = showRoseYear
              ? (chartRun?.outputs["annual-rose"]?.rows?.filter(
                  (row) => row.channel === c,
                ) ?? [])
              : [];

            if (turbulence) {
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
              .map((r) => (r.density == null ? NaN : Number(r.density)))
              .filter((v) => Number.isFinite(v));
            const densityDefaultUpper = Math.max(
              0.51,
              Math.ceil(Math.max(...densityValues) * 20) / 20,
            );
            const densityRange = getAxisRange(
              densityAxis,
              densityValues,
              0.5,
              densityDefaultUpper,
            );
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
              <section className="ww-panel ww-tier-chart" key={c}>
                <h3>
                  {measured
                    ? String(subset[0]?.direction_name ?? output.title)
                    : c || output.title}
                </h3>
                <div
                  className={
                    all && !showRoseYear ? "ww-chart-table-pair" : undefined
                  }
                >
                  <div>
                    {isRose ? (
                      <div
                        className={
                          compareRose ? "ww-rose-comparison" : "ww-rose-stack"
                        }
                      >
                        <RoseChart
                          rows={showRoseYear ? yearRoseRows : subset}
                          title={showRoseYear ? `全年${roseLabel}` : roseLabel}
                          rose={rose}
                          zoom={zoom}
                          energy={!measured}
                          radialMax={compareRose ? maxRose : undefined}
                        />
                        {compareRose && (
                          <div data-rose-energy-peer>
                            {peerRows.length ? (
                              <RoseChart
                                rows={peerRows}
                                title={energyTitle}
                                rose={rose}
                                zoom={zoom}
                                energy
                                radialMax={maxRose}
                              />
                            ) : (
                              <p>
                                {busy
                                  ? "正在更新风能分布…"
                                  : "本次计算没有可用的风能分布。"}
                              </p>
                            )}
                          </div>
                        )}
                        {showRoseYear && (
                          <div className="ww-rose-month-grid">
                            {Array.from(
                              { length: 12 },
                              (_, index) => index + 1,
                            ).map((m) => (
                              <RoseChart
                                compact
                                key={m}
                                rows={subset.filter(
                                  (row) => Number(row.month) === m,
                                )}
                                title={`${m}月 · ${roseLabel}`}
                                rose={rose}
                                energy={!measured}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        {!exportMode && fields.length > 1 && (
                          <div
                            className="ww-result-toolbar ww-series-options"
                            role="group"
                            aria-label="图上线条"
                          >
                            {fields
                              .filter((f) => !iecFields.includes(f))
                              .map((f) => (
                                <label key={f}>
                                  <input
                                    type="checkbox"
                                    checked={isVisible(c, f)}
                                    onChange={(event) => {
                                      const checked = event.target.checked;
                                      setSeriesVisibility((previous) => ({
                                        ...previous,
                                        [seriesKey(c, f)]: checked,
                                      }));
                                    }}
                                  />
                                  {names[f] ?? f.replace("_", " ")}
                                </label>
                              ))}
                          </div>
                        )}
                        {!exportMode &&
                          outputId === "density" &&
                          densityValues.length > 0 && (
                            <div className="ww-density-controls">
                              <AxisRange
                                setting={densityAxis}
                                onChange={setDensityAxis}
                                unit="kg/m³"
                                lowerDefault={0.5}
                                upperDefault={densityDefaultUpper}
                                invalid={densityRange.invalid}
                              />
                              <label>
                                图表类型
                                <select
                                  aria-label="空气密度图表类型"
                                  value={densityType}
                                  onChange={(event) =>
                                    setDensityType(event.target.value)
                                  }
                                >
                                  <option value="line">折线图</option>
                                  <option value="bar">柱状图</option>
                                </select>
                              </label>
                            </div>
                          )}
                        <Plot
                          rows={subset}
                          fields={fields.filter((f) => isVisible(c, f))}
                          title={
                            fields.includes("mean_speed")
                              ? `WS-${height}m / WPD-${height}m`
                              : output.title
                          }
                          outputId={outputId}
                          density={outputId === "density"}
                          densityMinimum={densityRange.lower}
                          densityMaximum={densityRange.upper}
                          densityBars={densityType === "bar"}
                          fit={
                            outputId === "weibull"
                              ? (
                                  (output.summary?.channels ?? []) as Row[]
                                ).find((v) => v.channel === c)
                              : undefined
                          }
                        />
                      </>
                    )}
                  </div>
                  <div>
                    <DataTable
                      rows={subset}
                      footer={densityFooter}
                      highlightBin={turbulence ? 15 : undefined}
                    />
                  </div>
                </div>
              </section>
            );
          })}
        </>
      ) : (
        <BaseResultView
          run={chartRun ?? run}
          output={output}
          outputId={outputId}
          exportMode={exportMode}
        />
      )}
      {custom &&
        (!localRose ? (
          <details>
            <summary>原始统计表、参数与SVG/CSV导出</summary>
            <BaseResultView
              run={chartRun ?? run}
              output={output}
              outputId={outputId}
            />
          </details>
        ) : (
          chartRun &&
          output.status === "ready" &&
          !exportMode && (
            <a
              className="ww-button"
              href={`/api/v1/runs/${chartRun.id}/tables/${outputId}.csv`}
            >
              下载完整数据（CSV）
            </a>
          )
        ))}
    </div>
  );
}
