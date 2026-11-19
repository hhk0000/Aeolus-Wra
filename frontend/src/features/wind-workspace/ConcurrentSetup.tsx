import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api";
import type { Channel, Dataset } from "./api";
import { localInput } from "./autoSetup";
import { useChartTextSize } from "./chartText";
import { EXCEL, excelSvgProps } from "./chartTheme";
import { sourceLabel } from "./model";
import type { WorkspaceViewProps } from "./model";

type Quantity = "speed" | "direction";
type Choice = { fileId?: string; speed?: string; direction?: string };
type Point = [number, number | null, number | null, number, number];
type Series = {
  paired: number;
  counts: [number, number];
  visible: number;
  points: Point[];
};
export type ConcurrentComparison = {
  id: string;
  start: number;
  end: number;
  timezone: string;
  config: { paired_only: boolean; aggregation: "hourly" | "native" };
  metrics: Partial<Record<Quantity, Series>>;
};
const quantities: Quantity[] = ["speed", "direction"];
const captions = { speed: "风速", direction: "风向" };

function channels(dataset: Dataset | undefined, quantity: Quantity) {
  return (dataset?.channels ?? [])
    .filter((c) => c.quantity === quantity && c.statistic === "mean")
    .sort((a, b) => b.height - a.height);
}

function resolve(available: Channel[], picked: string | undefined) {
  return picked === "" || available.some((channel) => channel.id === picked)
    ? picked
    : (available[0]?.id ?? "");
}

function ConcurrentChart({
  metric,
  result,
}: {
  metric: Quantity;
  result: ConcurrentComparison;
}) {
  const label = captions[metric];
  const series = result.metrics[metric];
  const textSize = useChartTextSize();
  if (!series)
    return (
      <section>
        <h3>{label}同期</h3>
        <p>未选择{label}通道。</p>
      </section>
    );
  const points = series.points;
  const speedMax = Math.max(
    1,
    ...points.flatMap((p) => [p[1] ?? 0, p[2] ?? 0]),
  );
  const max = metric === "direction" ? 360 : Math.ceil(speedMax);
  const axisSize = textSize(16);
  const timeSize = textSize(15);
  const topPadding = axisSize + 14;
  const panelGap = Math.max(43, axisSize + 16);
  const left = Math.max(78, axisSize * 2.6),
    right = 685,
    panelHeight = 99;
  const dateY = topPadding + 2 * panelHeight + panelGap + timeSize + 5;
  const ticks = timeSize > 24 ? [0, 1] : [0, 1 / 3, 2 / 3, 1];
  const x = (time: number) =>
    left +
    ((right - left) * (time - result.start)) / (result.end - result.start);
  const color = metric === "speed" ? EXCEL.series[0] : "#35696d";
  return (
    <section>
      <h3>{label}同期</h3>
      <p>
        A 有效 {series.counts[0]} · B 有效 {series.counts[1]} · 同期{" "}
        {series.paired} 条
      </p>
      {series.visible > points.length && (
        <p>图中抽样显示 {points.length} 点，计数使用全部数据。</p>
      )}
      {points.length ? (
        <svg
          viewBox={`0 0 705 ${dateY + timeSize + 18}`}
          role="img"
          aria-label={label + "同期，A 在上，B 在下"}
          {...excelSvgProps()}
        >
          {([0, 1] as const).map((side) => {
            const top = topPadding + side * (panelHeight + panelGap);
            const y = (value: number) => top + panelHeight * (1 - value / max);
            let previousSegment: number | undefined;
            const path = points
              .map((p) => {
                const value = side ? p[2] : p[1];
                const segment = side ? p[4] : p[3];
                if (value === null) return "";
                const coordinate = x(p[0]) + " " + y(value);
                const command =
                  previousSegment === segment
                    ? "L" + coordinate
                    : "M" + coordinate + "h0.01";
                previousSegment = segment;
                return command;
              })
              .join(" ");
            return (
              <g key={side}>
                <text x={left} y={top - 8} fontSize={axisSize}>
                  {side ? "B" : "A"} · {label}（
                  {metric === "speed" ? "m/s" : "°"}）
                </text>
                {(axisSize > 24 ? [0, 2, 4] : [0, 1, 2, 3, 4]).map((tick) => (
                  <g key={tick}>
                    <line
                      x1={left}
                      x2={right}
                      y1={y((tick * max) / 4)}
                      y2={y((tick * max) / 4)}
                      stroke={EXCEL.grid}
                    />
                    <text
                      x={left - 8}
                      y={y((tick * max) / 4) + 4}
                      textAnchor="end"
                      fontSize={axisSize}
                    >
                      {Number(((tick * max) / 4).toFixed(1))}
                    </text>
                  </g>
                ))}
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </g>
            );
          })}
          {ticks.map((step) => {
            const time = result.start + step * (result.end - result.start);
            const iso = localInput(
              new Date(time * 1000).toISOString(),
              result.timezone,
            );
            const caption =
              result.end - result.start >= 365 * 86400
                ? iso.slice(0, 10)
                : iso.slice(5).replace("T", " ");
            return (
              <text
                key={step}
                x={x(time)}
                y={dateY}
                textAnchor={
                  step === 0 ? "start" : step === 1 ? "end" : "middle"
                }
                fontSize={timeSize}
              >
                {caption}
              </text>
            );
          })}
          <text
            x="380"
            y={dateY + timeSize + 10}
            textAnchor="middle"
            fontSize={textSize(12)}
          >
            {result.timezone}
          </text>
        </svg>
      ) : (
        <p>所选时间范围内没有符合条件的{label}记录。</p>
      )}
    </section>
  );
}

export function ConcurrentCharts({ result }: { result: ConcurrentComparison }) {
  return (
    <div className="ww-concurrent-grid ww-concurrent-charts">
      {quantities.map((metric) => (
        <ConcurrentChart key={metric} result={result} metric={metric} />
      ))}
    </div>
  );
}

export default function ConcurrentSetup({
  state,
  onChange,
  onNotice,
}: WorkspaceViewProps) {
  const files = state.files.filter((file) => file.dataset);
  const [a, setA] = useState<Choice>({});
  const [b, setB] = useState<Choice>({});
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [paired, setPaired] = useState(true);
  const [alignment, setAlignment] = useState("");
  const [result, setResult] = useState<ConcurrentComparison>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileA =
    files.find((f) => f.id === a.fileId) ??
    files.find((f) => f.kind === "qc") ??
    files[0];
  const fileB =
    files.find((f) => f.id === b.fileId) ??
    files.find((f) => f.kind === "reference" && f.id !== fileA?.id) ??
    files.find((f) => f.id !== fileA?.id) ??
    fileA;
  const datasetA = fileA?.dataset;
  const datasetB = fileB?.dataset;
  const timezone = datasetA?.options.timezone ?? "Asia/Shanghai";
  const sameStep =
    datasetA?.options.interval_minutes === datasetB?.options.interval_minutes;
  const aggregation = sameStep ? alignment || "native" : "hourly";
  const timestamps =
    datasetA && datasetB
      ? {
          start: (paired ? Math.max : Math.min)(
            Date.parse(datasetA.start),
            Date.parse(datasetB.start),
          ),
          end: (paired ? Math.min : Math.max)(
            Date.parse(datasetA.end_exclusive),
            Date.parse(datasetB.end_exclusive),
          ),
        }
      : undefined;
  const validPeriod =
    timestamps &&
    Number.isFinite(timestamps.start) &&
    Number.isFinite(timestamps.end) &&
    timestamps.start < timestamps.end;
  const dateValue = (key: "start" | "end") =>
    validPeriod && timestamps
      ? localInput(new Date(timestamps[key]).toISOString(), timezone)
      : "";
  const channelConfig = (dataset: Dataset, choice: Choice) => ({
    dataset_id: dataset.id,
    speed_channel: resolve(channels(dataset, "speed"), choice.speed) || null,
    direction_channel:
      resolve(channels(dataset, "direction"), choice.direction) || null,
  });
  async function calculate(event: FormEvent) {
    event.preventDefault();
    if (!fileA || !fileB || !datasetA || !datasetB) return;
    setBusy(true);
    setError("");
    try {
      const requestedStart = start || dateValue("start");
      const requestedEnd = end || dateValue("end");
      const target = channelConfig(datasetA, a);
      const reference = channelConfig(datasetB, b);
      const comparison = await api<ConcurrentComparison>("/concurrent", {
        a: target,
        b: reference,
        start: requestedStart,
        end: requestedEnd,
        aggregation,
        timezone,
        paired_only: paired,
      });
      const sources = (
        [
          [fileA, datasetA, target],
          [fileB, datasetB, reference],
        ] as const
      ).map(([file, dataset, config]) => ({
        label: sourceLabel(file, state),
        channels: [config.speed_channel, config.direction_channel]
          .map((id) => dataset.channels.find((channel) => channel.id === id))
          .flatMap((channel) =>
            channel
              ? [
                  `${captions[channel.quantity === "direction" ? "direction" : "speed"]} ${channel.height} m · ${channel.name}`,
                ]
              : [],
          ),
      }));
      onChange((current) => ({
        ...current,
        concurrentJobs: [
          ...(current.concurrentJobs ?? []),
          {
            id: comparison.id,
            start: requestedStart,
            end: requestedEnd,
            sources,
          },
        ],
      }));
      setResult(comparison);
      onNotice("同期分析已保存，可在图表中心的「同期对比」查看。");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ww-concurrent-analysis">
      <section className="ww-panel">
        <h2>同期分析</h2>
        <p>选择两份测风塔或中尺度数据，按统一时间轴对比风速和风向。</p>
        {files.length ? (
          <form onSubmit={(event) => void calculate(event)}>
            <fieldset disabled={busy} className="ww-report-controls">
              <div className="ww-concurrent-grid">
                {[
                  { side: "A", file: fileA, choice: a, set: setA },
                  { side: "B", file: fileB, choice: b, set: setB },
                ].map(({ side, file, choice, set }) => (
                  <fieldset className="ww-report-controls" key={side}>
                    <legend>数据 {side}</legend>
                    <label>
                      数据源 {side}
                      <select
                        value={file?.id ?? ""}
                        onChange={(event) =>
                          set({ fileId: event.target.value })
                        }
                      >
                        {files.map((item) => (
                          <option key={item.id} value={item.id}>
                            {sourceLabel(item, state)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {quantities.map((quantity) => {
                      const options = channels(file?.dataset, quantity);
                      return (
                        <label key={quantity}>
                          {captions[quantity]}高度 {side}
                          <select
                            value={resolve(options, choice[quantity])}
                            onChange={(event) =>
                              set({ ...choice, [quantity]: event.target.value })
                            }
                          >
                            <option value="">
                              {options.length ? "不分析此要素" : "无可用通道"}
                            </option>
                            {options.map((channel) => (
                              <option key={channel.id} value={channel.id}>
                                {channel.height} m · {channel.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </fieldset>
                ))}
              </div>
              <div className="ww-fields ww-fields-three">
                <label>
                  开始时间
                  <input
                    type="datetime-local"
                    required
                    value={start || dateValue("start")}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </label>
                <label>
                  结束时间（不含）
                  <input
                    type="datetime-local"
                    required
                    value={end || dateValue("end")}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </label>
                <label>
                  时间对齐
                  <select
                    value={aggregation}
                    onChange={(e) => setAlignment(e.target.value)}
                  >
                    <option value="native" disabled={!sameStep}>
                      按原始步长配对
                    </option>
                    <option value="hourly">按完整小时配对</option>
                  </select>
                </label>
              </div>
              <p className="ww-inline-note">
                时间按 {timezone} 显示。不同数据步长按完整小时对齐。
              </p>
              <div className="ww-chart-actions">
                <label>
                  <input
                    type="checkbox"
                    checked={paired}
                    onChange={(e) => setPaired(e.target.checked)}
                  />
                  仅显示双方同时有数据的时刻
                </label>
                <button type="submit" className="ww-button primary">
                  开始同期分析
                </button>
              </div>
            </fieldset>
          </form>
        ) : (
          <p>请先在数据资料中导入并识别所需文件。</p>
        )}
        {busy && <p role="status">正在对齐两个数据源…</p>}
        {error && (
          <p role="alert" className="ww-error">
            {error}
          </p>
        )}
      </section>
      {result && (
        <section className="ww-panel">
          <ConcurrentCharts result={result} />
        </section>
      )}
    </div>
  );
}
