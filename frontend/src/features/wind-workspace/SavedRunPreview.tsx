import { useEffect, useState } from "react";
import { api } from "./api";
import type { Dataset, Run } from "./api";
import { ResultView } from "./ResultView";
import "./workspace.css";

const validId = (value: string) => /^[0-9a-f]{32}$/.test(value);
const stageNames: Record<string, string> = {
  raw: "原始数据",
  qc: "质控数据",
  result: "结果数据",
  reference: "长期参考数据",
};

function timeLabel(value: unknown, timezone?: string) {
  if (typeof value !== "string" || !value) return "未指定";
  if (!timezone || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    return value.replace("T", " ");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

interface LoadedRun {
  runs: Run[];
  datasets: Dataset[];
  notices: string[];
}

export default function SavedRunPreview({
  runId,
  correlationId,
  initialView,
}: {
  runId: string;
  correlationId: string;
  initialView: string;
}) {
  const [loaded, setLoaded] = useState<LoadedRun>();
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(initialView);
  const invalid = !validId(runId) || (correlationId && !validId(correlationId));

  useEffect(() => {
    if (invalid) return;
    let active = true;
    async function load() {
      try {
        const main = await api<Run>(`/runs/${runId}`);
        const runs = [main];
        const notices: string[] = [];
        if (correlationId && correlationId !== runId) {
          try {
            runs.push(await api<Run>(`/runs/${correlationId}`));
          } catch (e) {
            notices.push(`相关性快照未能加载：${(e as Error).message}`);
          }
        }
        const ids = [
          ...new Set(
            runs.flatMap((run) => [
              ...Object.values(run.sources ?? {}).map((s) => s.id),
              ...["target_id", "reference_id", "direction_id"].map(
                (key) => run.config[key],
              ),
            ]),
          ),
        ].filter((id): id is string => typeof id === "string" && validId(id));
        const responses = await Promise.allSettled(
          ids.map((id) => api<Dataset>(`/datasets/${id}`)),
        );
        const datasets = responses.flatMap((response, index) => {
          if (response.status === "fulfilled") return [response.value];
          notices.push(
            `数据集 ${ids[index]} 的资料未能加载；计算快照仍可查看。`,
          );
          return [];
        });
        if (active) setLoaded({ runs, datasets, notices });
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [runId, correlationId, invalid]);

  const outputs =
    loaded?.runs.flatMap((run) =>
      Object.entries(run.outputs).map(([id, output]) => ({
        key: `${run.id}:${id}`,
        id,
        run,
        output,
      })),
    ) ?? [];
  const current =
    outputs.find((entry) => entry.key === selected || entry.id === selected) ??
    outputs.find((entry) => entry.id === "monthly") ??
    outputs[0];
  const main = loaded?.runs[0];
  const resultDataset = loaded?.datasets.find(
    (dataset) => dataset.id === main?.sources?.result?.id,
  );
  const timezone = resultDataset?.options.timezone;
  const windSummary = main?.outputs.monthly?.summary;
  const windChannels = (windSummary?.channels ?? []) as Record<
    string,
    unknown
  >[];
  const density = main?.outputs.density?.summary;

  return (
    <main
      className="ww-results"
      style={{ maxWidth: 1600, margin: "0 auto", padding: "32px 24px" }}
    >
      <header className="ww-section-heading">
        <div>
          <span className="ww-overline">AEOLUS · SAVED CALCULATION</span>
          <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>风资源分析结果</h1>
          <p>查看本机保存的计算图表、原始来源与参数。</p>
        </div>
        <button className="ww-button" onClick={() => window.history.back()}>
          返回上一页
        </button>
        <a className="ww-button" href="/">
          返回项目工作区 →
        </a>
      </header>

      {invalid || error ? (
        <section className="ww-panel" role="alert">
          <h2>无法打开计算结果</h2>
          <p>{invalid ? "计算标识无效，请使用本机生成的结果链接。" : error}</p>
        </section>
      ) : !loaded ? (
        <section className="ww-panel" aria-live="polite">
          正在读取本机计算快照…
        </section>
      ) : (
        <>
          <section className="ww-panel" aria-label="计算来源与时段">
            <p className="ww-callout">
              完整年数据量默认按365天、52,560条十分钟记录判定。日历覆盖范围单独列示；跨闰日的周年边界差异不再直接判为365天数据量不足。
            </p>
            <div className="ww-section-heading">
              <div>
                <h2>计算来源与统计时段</h2>
                <p>
                  本次统计：{timeLabel(main?.config.start, timezone)} →{" "}
                  {timeLabel(main?.config.end, timezone)}（终点不含）
                </p>
                {resultDataset && (
                  <p>
                    结果文件实际覆盖：{timeLabel(resultDataset.start, timezone)}{" "}
                    → {timeLabel(resultDataset.end_exclusive, timezone)}
                    （终点不含） · {resultDataset.row_count.toLocaleString()}条
                  </p>
                )}
                {timezone && (
                  <p>
                    时间基准：{timezone}（依据导入时的选择，源文件声明仍需核实）
                  </p>
                )}
                <p>
                  {main?.config.aggregation === "hourly"
                    ? "结果统计：完整小时均值"
                    : main?.config.aggregation === "10min"
                      ? "结果统计：十分钟序列"
                      : `计算类型：${main?.kind}`}{" "}
                  · 引擎版本 {main?.engine_version}
                </p>
              </div>
              <span className="ww-status ready">已保存计算快照</span>
            </div>
            {[...new Set(loaded.runs.flatMap((run) => run.warnings ?? []))].map(
              (warning, index) => (
                <div key={index} className="ww-callout" role="note">
                  {warning}
                </div>
              ),
            )}
            {loaded.notices.map((notice, index) => (
              <p key={index} className="ww-callout">
                {notice}
              </p>
            ))}
            <details>
              <summary>查看各文件覆盖范围与导入时间基准</summary>
              {loaded.datasets.map((dataset) => (
                <div key={dataset.id} style={{ marginTop: 14 }}>
                  <strong style={{ overflowWrap: "anywhere", fontSize: 12 }}>
                    {stageNames[dataset.stage] ?? dataset.stage} ·{" "}
                    {dataset.filename}
                  </strong>
                  <p>
                    {timeLabel(dataset.start, dataset.options.timezone)} →{" "}
                    {timeLabel(dataset.end_exclusive, dataset.options.timezone)}
                    （终点不含） · {dataset.row_count.toLocaleString()}条 ·{" "}
                    {dataset.options.interval_minutes}分钟步长
                  </p>
                  <p>导入时选择的时间基准：{dataset.options.timezone}</p>
                </div>
              ))}
              {!loaded.datasets.length && (
                <p>此快照未关联可读取的数据集资料。</p>
              )}
            </details>
          </section>

          {windChannels.map((channel) => (
            <section key={String(channel.channel)} className="ww-panel">
              <h2>{String(channel.channel)} · 实际有效时段汇总</h2>
              <div className="ww-review-summary">
                <article>
                  <strong>{Number(channel.mean_speed).toFixed(3)}</strong>
                  <span>平均风速 m/s · {String(channel.count)}个有效样本</span>
                </article>
                <article>
                  <strong>{Number(channel.power_density).toFixed(2)}</strong>
                  <span>
                    风功率密度 W/m² · {String(windSummary?.step_minutes)}
                    分钟统计
                  </span>
                </article>
                <article>
                  <strong>{Number(windSummary?.density).toFixed(4)}</strong>
                  <span>计算使用的固定空气密度 kg/m³</span>
                </article>
              </div>
              {typeof density?.note === "string" && <p>{density.note}</p>}
            </section>
          ))}

          <div className="ww-gallery-layout">
            <nav className="ww-chart-list" aria-label="计算成果列表">
              {outputs.map((entry) => (
                <button
                  key={entry.key}
                  className={current?.key === entry.key ? "active" : ""}
                  aria-pressed={current?.key === entry.key}
                  onClick={() => setSelected(entry.key)}
                >
                  <span>
                    <strong>{entry.output.title}</strong>
                    <small>
                      {entry.output.status === "ready"
                        ? "已计算"
                        : "待补充条件"}
                    </small>
                  </span>
                  <span className="ww-chevron">›</span>
                </button>
              ))}
            </nav>
            <section className="ww-panel ww-chart-stage">
              {current ? (
                <>
                  <div className="ww-section-heading">
                    <div>
                      <span className="ww-overline">
                        CHART & TABLE COLLECTION
                      </span>
                      <h2>{current.output.title}</h2>
                    </div>
                  </div>
                  <ResultView
                    key={current.key}
                    run={current.run}
                    outputId={current.id}
                    output={current.output}
                  />
                </>
              ) : (
                <p>此快照没有计算成果。</p>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
