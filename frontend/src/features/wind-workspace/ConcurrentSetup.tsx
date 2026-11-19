import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api";
import type { Channel, Dataset } from "./api";
import { localInput } from "./autoSetup";
import { ConcurrentCharts } from "./ConcurrentCharts";
import type { ConcurrentComparison } from "./ConcurrentCharts";
import { sourceLabel } from "./model";
import type { WorkspaceViewProps } from "./model";

type Quantity = "speed" | "direction";
type Choice = { fileId?: string; speed?: string; direction?: string };
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
          <ConcurrentCharts key={result.id} result={result} />
        </section>
      )}
    </div>
  );
}
