import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { activateTower } from "./autoSetup";
import { OUTPUTS, SOURCE_TYPES, outputStatus } from "./model";
import type {
  OutputSpec,
  ConcurrentJob,
  SourceKind,
  WorkspaceTab,
  WorkspaceViewProps,
} from "./model";
import { ResultView } from "./ResultView";
import WorkspaceReportExport from "./WorkspaceReportExport";
import { ChartTextScale } from "./chartText";
import { api } from "./api";
import { ConcurrentCharts } from "./ConcurrentCharts";
import type { ConcurrentComparison } from "./ConcurrentCharts";
import "./workspace.css";

const readingKey = "aeolus.chartReading";
const readingDefault = { chart: 100, axis: 125, table: 110 };
type ReadingSettings = typeof readingDefault;
const readingControls = [
  ["chart", "图幅", 60, 160],
  ["axis", "坐标轴与图内字号", 75, 220],
  ["table", "表格字号", 80, 175],
] as const;

function loadReadingSettings(): ReadingSettings {
  const settings = { ...readingDefault };
  try {
    const saved = JSON.parse(localStorage.getItem(readingKey) ?? "{}");
    for (const [key, , min, max] of readingControls) {
      const value = saved?.[key];
      if (typeof value === "number" && Number.isFinite(value))
        settings[key] = Math.min(max, Math.max(min, value));
    }
  } catch {
    return settings;
  }
  return settings;
}

interface ResultsProps extends WorkspaceViewProps {
  onConfigure: (tab: WorkspaceTab) => void;
  projectId?: number;
  concurrentJobId?: string;
}
type GalleryFilter = SourceKind | "all" | "correlation" | "concurrent";
const gallerySelection = new Map<
  number,
  { filter: GalleryFilter; activeId: string; pairIndex: number }
>();

function ConcurrentGalleryResult({ job }: { job: ConcurrentJob }) {
  const [result, setResult] = useState<ConcurrentComparison>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api<ConcurrentComparison>(
      `/concurrent/${job.id}`,
      undefined,
      controller.signal,
    )
      .then(setResult)
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [job.id, attempt]);
  return (
    <>
      <h2>{job.title || "同期分析结果对比"}</h2>
      <p>
        {job.start.replace("T", " ")} → {job.end.replace("T", " ")}（终点不含）
      </p>
      <div className="ww-concurrent-grid ww-concurrent-sources">
        {job.sources.map((source, index) => (
          <section key={index}>
            <h3>{index === 0 ? "数据 A" : "数据 B"}</h3>
            <p>{source.label}</p>
            {source.channels.map((channel) => (
              <p key={channel}>{channel}</p>
            ))}
          </section>
        ))}
      </div>
      {result ? (
        <>
          <p className="ww-inline-note">
            {result.config.aggregation === "hourly"
              ? "完整小时对齐"
              : "原始步长对齐"}
            {" · "}
            {result.config.paired_only
              ? "仅保留双方同时有数据的时刻"
              : "保留任一侧有数据的时刻"}
          </p>
          <ConcurrentCharts result={result} />
        </>
      ) : error ? (
        <div className="ww-chart-actions">
          <p role="alert">{error}</p>
          <button
            type="button"
            className="ww-button"
            onClick={() => {
              setError("");
              setAttempt((previous) => previous + 1);
            }}
          >
            重新载入
          </button>
        </div>
      ) : (
        <p role="status">正在加载同期分析结果…</p>
      )}
    </>
  );
}

export function ResultsWorkspace({
  state,
  onChange,
  onConfigure,
  projectId,
  concurrentJobId,
}: ResultsProps) {
  const requested = state.concurrentJobs?.find(
    (job) => job.id === concurrentJobId,
  );
  const selection = requested
    ? { filter: "concurrent" as const, activeId: requested.id, pairIndex: 0 }
    : projectId === undefined
      ? undefined
      : gallerySelection.get(projectId);
  const [filter, setFilter] = useState<GalleryFilter>(
    selection?.filter ?? "all",
  );
  const [activeId, setActiveId] = useState(selection?.activeId ?? "");
  const [pairIndex, setPairIndex] = useState(selection?.pairIndex ?? 0);
  useEffect(() => {
    if (projectId !== undefined)
      gallerySelection.set(projectId, { filter, activeId, pairIndex });
  }, [projectId, filter, activeId, pairIndex]);
  const [reading, setReading] = useState(loadReadingSettings);
  useEffect(() => {
    try {
      localStorage.setItem(readingKey, JSON.stringify(reading));
    } catch {
      // Reading controls still apply for this visit.
    }
  }, [reading]);
  const styles = {
    "--ww-plot-scale": reading.chart / 100,
    "--ww-table-scale": reading.table / 100,
  } as CSSProperties;
  const selected = OUTPUTS.filter((o) => state.selectedOutputs.includes(o.id));
  const filtered = selected.flatMap<OutputSpec>((o) => {
    if (o.id === "completeness" && filter === "raw")
      return [
        {
          ...o,
          id: "raw-records",
          kind: "raw",
          required: ["raw"],
          title: "实测数据完整率",
          description: "按原始有效记录数和应测数统计",
        },
      ];
    if (o.id === "completeness" && filter === "qc")
      return [
        {
          ...o,
          title: "实测有效数据完整率",
          description: "按质控有效记录数和同期原始记录数统计",
        },
      ];
    return filter === "all" || o.kind === filter ? [o] : [];
  });
  const gallery = useRef<HTMLDivElement>(null);
  const filterBar = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = filterBar.current;
    const root = gallery.current;
    if (!bar || !root) return;
    const update = () =>
      root.style.setProperty("--ww-filter-height", `${bar.offsetHeight}px`);
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const panel = stage.current;
    if (!requested || !panel) return;
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ block: "start" });
  }, [requested]);
  function showStage() {
    const panel = stage.current;
    const bar = filterBar.current;
    if (!panel || !bar) return;
    const navigationBottom = bar.getBoundingClientRect().bottom;
    if (panel.getBoundingClientRect().top < navigationBottom)
      window.scrollBy({
        top: panel.getBoundingClientRect().top - navigationBottom - 12,
      });
  }
  const active = filtered.find((o) => o.id === activeId) ?? filtered[0];
  const tower = state.towers.find((t) => t.id === state.activeTowerId)!;
  const run =
    active?.kind === "reference"
      ? state.longTermRuns[tower.id]
      : state.analysisRuns[tower.id];
  const outputMap = {
    ...(state.analysisRuns[tower.id]?.outputs ?? {}),
    ...(state.longTermRuns[tower.id]?.outputs ?? {}),
  };
  const computed = selected.filter(
    (o) => outputMap[o.id]?.status === "ready",
  ).length;
  const output = active && run?.outputs[active.id];
  const job =
    state.correlationJobs.find((j) => j.id === activeId) ??
    state.correlationJobs[0];
  const pairRun =
    job?.runs?.[Math.min(pairIndex, (job?.runs?.length ?? 1) - 1)];
  const concurrentJobs = state.concurrentJobs ?? [];
  const concurrentJob =
    concurrentJobs.find((entry) => entry.id === activeId) ??
    concurrentJobs.at(-1);
  const taskDialog = useRef<HTMLDialogElement>(null);
  const [taskAction, setTaskAction] = useState<"rename" | "delete">("rename");
  const [editingTask, setEditingTask] = useState<ConcurrentJob>();
  const [taskTitle, setTaskTitle] = useState("");
  useEffect(() => {
    if (editingTask && !taskDialog.current?.open)
      taskDialog.current?.showModal();
  }, [editingTask]);
  function editTask(task: ConcurrentJob, action: "rename" | "delete") {
    setEditingTask(task);
    setTaskAction(action);
    setTaskTitle(task.title || `同期分析 ${concurrentJobs.indexOf(task) + 1}`);
  }
  function confirmTask() {
    if (!editingTask) return;
    const id = editingTask.id;
    const name = taskTitle.trim();
    if (taskAction === "rename" && !name) return;
    onChange((current) => ({
      ...current,
      concurrentJobs:
        taskAction === "rename"
          ? (current.concurrentJobs ?? []).map((entry) =>
              entry.id === id ? { ...entry, title: name } : entry,
            )
          : (current.concurrentJobs ?? []).filter((entry) => entry.id !== id),
    }));
    if (taskAction === "delete" && activeId === id) setActiveId("");
    taskDialog.current?.close();
  }
  const groupCount =
    filter === "concurrent"
      ? concurrentJobs.length
      : filter === "correlation"
        ? state.correlationJobs.length
        : filtered.length;
  return (
    <div className="ww-results" ref={gallery} style={styles}>
      <section className="ww-results-hero">
        <div className="ww-results-hero-copy">
          <h2>风资源计算成果</h2>
          <p>图、表与运行快照引用同一组数据与参数；修改配置后请重新计算。</p>
        </div>
        <div className="ww-results-hero-stats">
          <div>
            <strong>{tower.name}</strong>
            <span>当前测风塔</span>
          </div>
          <div>
            <strong>
              {computed}
              <i>/{selected.length}</i>
            </strong>
            <span>成果可用</span>
          </div>
          <button className="ww-button" onClick={() => onConfigure("analysis")}>
            调整分析配置 →
          </button>
        </div>
      </section>
      <div className="ww-gallery-filter" ref={filterBar}>
        <div role="group" aria-label="图表来源筛选">
          {(
            [
              ["all", "全部"],
              ...SOURCE_TYPES.map((s) => [s.id, s.shortLabel]),
              ["correlation", "相关性"],
              ["concurrent", "同期对比"],
            ] as [typeof filter, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              className={filter === id ? "active" : ""}
              onClick={() => {
                setFilter(id);
                setActiveId("");
                setPairIndex(0);
                showStage();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ww-gallery-tools">
          <span className="ww-gallery-count">共 {groupCount} 组</span>
          <details className="ww-reading-settings">
            <summary>图幅与字号</summary>
            <div className="ww-reading-drawer">
              {readingControls.map(([key, label, min, max]) => (
                <label key={key}>
                  <span>{label}</span>
                  <output>{reading[key]}%</output>
                  <input
                    aria-label={label}
                    type="range"
                    min={min}
                    max={max}
                    step="1"
                    value={reading[key]}
                    onChange={(event) =>
                      setReading({
                        ...reading,
                        [key]: Number(event.target.value),
                      })
                    }
                  />
                </label>
              ))}
              <button type="button" onClick={() => setReading(readingDefault)}>
                恢复默认
              </button>
            </div>
          </details>
          <label>
            测风塔
            <select
              aria-label="图表测风塔"
              value={state.activeTowerId}
              onChange={(e) =>
                onChange((current) => activateTower(current, e.target.value))
              }
            >
              {state.towers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="ww-gallery-layout">
        <aside className="ww-chart-list">
          {filter === "concurrent"
            ? concurrentJobs.map((entry, i) => (
                <button
                  key={entry.id}
                  className={concurrentJob?.id === entry.id ? "active" : ""}
                  onClick={() => {
                    setActiveId(entry.id);
                    showStage();
                  }}
                >
                  <span>
                    <strong>{entry.title || `同期分析 ${i + 1}`}</strong>
                    <small>
                      {entry.start.slice(0, 10)} → {entry.end.slice(0, 10)}
                    </small>
                  </span>
                </button>
              ))
            : filter === "correlation"
              ? state.correlationJobs.map((j, i) => (
                  <button
                    key={j.id}
                    className={job?.id === j.id ? "active" : ""}
                    onClick={() => {
                      setActiveId(j.id);
                      setPairIndex(0);
                      showStage();
                    }}
                  >
                    <span>
                      <strong>相关性任务 {i + 1}</strong>
                      <small>
                        {j.pairs.length}组高度对 · {j.sectors}扇区
                      </small>
                    </span>
                  </button>
                ))
              : filtered.map((o) => (
                  <button
                    key={o.id}
                    className={active?.id === o.id ? "active" : ""}
                    onClick={() => {
                      setActiveId(o.id);
                      showStage();
                    }}
                  >
                    <span className={`ww-mini-source ${o.kind}`} />
                    <span>
                      <strong>{o.title}</strong>
                      <small>{o.form}</small>
                    </span>
                    <span className="ww-chevron">›</span>
                  </button>
                ))}
          {filter === "concurrent" && concurrentJob && (
            <div
              className="ww-concurrent-task-actions"
              aria-label="管理当前同期任务"
              role="group"
            >
              <button
                type="button"
                onClick={() => editTask(concurrentJob, "rename")}
              >
                编辑标题
              </button>
              <button
                type="button"
                onClick={() => editTask(concurrentJob, "delete")}
              >
                删除任务
              </button>
            </div>
          )}
        </aside>
        <ChartTextScale.Provider value={reading.axis / 100}>
          <section
            className="ww-panel ww-chart-stage"
            ref={stage}
            tabIndex={-1}
          >
            {filter === "concurrent" ? (
              concurrentJob ? (
                <ConcurrentGalleryResult
                  key={concurrentJob.id}
                  job={concurrentJob}
                />
              ) : (
                <div className="ww-simple-empty">
                  <h3>还没有同期分析结果</h3>
                  <button
                    className="ww-button"
                    onClick={() => onConfigure("concurrent")}
                  >
                    前往同期分析 →
                  </button>
                </div>
              )
            ) : filter === "correlation" ? (
              job ? (
                <>
                  <div className="ww-section-heading">
                    <div>
                      <h2>同期相关性散点图组</h2>
                      <p>{job.sourceLabels.join(" ↔ ")}</p>
                    </div>
                  </div>
                  <div className="ww-correlation-caption">
                    <label>
                      高度对（Y ↔ X）
                      <select
                        value={Math.min(pairIndex, job.pairs.length - 1)}
                        onChange={(e) => setPairIndex(Number(e.target.value))}
                      >
                        {job.pairs.map(([a, b], i) => (
                          <option key={i} value={i}>
                            {a}m ↔ {b}m
                          </option>
                        ))}
                      </select>
                    </label>
                    <span>
                      {job.start} → {job.end}（终点不含）
                    </span>
                  </div>
                  {pairRun ? (
                    <ResultView
                      key={pairRun.id}
                      outputId="correlation"
                      output={pairRun.outputs.correlation}
                      run={pairRun}
                    />
                  ) : (
                    <div className="ww-simple-empty">
                      <p>此任务尚无拟合结果。</p>
                      <button
                        className="ww-button"
                        onClick={() => onConfigure("correlation")}
                      >
                        执行相关性计算
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="ww-simple-empty">
                  <h3>还没有相关性任务</h3>
                  <button
                    className="ww-button"
                    onClick={() => onConfigure("correlation")}
                  >
                    配置并计算相关性 →
                  </button>
                </div>
              )
            ) : active ? (
              <>
                <div className="ww-section-heading">
                  <div>
                    <span className={`ww-source-chip ${active.kind}`}>
                      {
                        SOURCE_TYPES.find((s) => s.id === active.kind)!
                          .shortLabel
                      }
                    </span>
                    <h2>{active.title}</h2>
                    <p>
                      {tower.name} · {active.description}
                    </p>
                  </div>
                </div>
                {run?.warnings?.map((warning, i) => (
                  <p key={i} className="ww-callout">
                    {warning}
                  </p>
                ))}
                {output && run ? (
                  <ResultView
                    key={`${run.id}-${active.id}-${filter === "qc" ? "qc" : ""}`}
                    output={output}
                    outputId={active.id}
                    run={run}
                    towerName={tower.name}
                    qcCompletenessOnly={filter === "qc"}
                  />
                ) : (
                  <div className="ww-simple-empty">
                    <span className="ww-empty-plot-icon">⌁</span>
                    <h3>{outputStatus(active, state)}</h3>
                    <p>解析数据并执行计算后显示真实图表。</p>
                    <button
                      className="ww-button"
                      onClick={() =>
                        onConfigure(
                          active.kind === "reference"
                            ? "long-term"
                            : "analysis",
                        )
                      }
                    >
                      前往配置与计算 →
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="ww-simple-empty">
                <p>尚未选择此分类的图表。</p>
              </div>
            )}
          </section>
        </ChartTextScale.Provider>
      </div>
      <dialog
        ref={taskDialog}
        className="modal ww-concurrent-task-dialog"
        aria-labelledby="ww-concurrent-task-heading"
        onClose={() => setEditingTask(undefined)}
      >
        <h2 id="ww-concurrent-task-heading">
          {taskAction === "rename" ? "编辑同期任务标题" : "删除同期任务"}
        </h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            confirmTask();
          }}
        >
          {taskAction === "rename" ? (
            <label className="field">
              标题
              <input
                autoFocus
                required
                maxLength={60}
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
              />
            </label>
          ) : (
            <p>
              从本项目移除「{taskTitle}」。原始测风资料和本机计算记录会保留。
            </p>
          )}
          <div className="project-delete-actions">
            <button
              type="button"
              className="ww-button"
              autoFocus={taskAction === "delete"}
              onClick={() => taskDialog.current?.close()}
            >
              取消
            </button>
            <button
              type="submit"
              className={
                taskAction === "rename"
                  ? "ww-button primary"
                  : "ww-button project-delete-confirm"
              }
              disabled={taskAction === "rename" && !taskTitle.trim()}
            >
              {taskAction === "rename" ? "保存标题" : "确认删除"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

export function ReportOutline({
  state,
  onChange,
  projectName,
  onAnalyze,
}: {
  state: WorkspaceViewProps["state"];
  onChange: WorkspaceViewProps["onChange"];
  projectName: string;
  onAnalyze: () => void;
}) {
  const [chapter, setChapter] = useState<2 | 5>(2);
  return (
    <div className="ww-report-layout">
      <aside className="ww-panel ww-report-navigation">
        <h2>章节与模板</h2>
        <button
          aria-pressed={chapter === 2}
          className={chapter === 2 ? "active" : ""}
          onClick={() => setChapter(2)}
        >
          <b>02</b>
          <span>
            风资源分析<small>计算图表与 Word 模板</small>
          </span>
        </button>
        <button
          aria-pressed={chapter === 5}
          className={chapter === 5 ? "active" : ""}
          onClick={() => setChapter(5)}
        >
          <b>05</b>
          <span>
            第五章模板<small>待提供</small>
          </span>
        </button>
      </aside>
      <section className="ww-panel ww-report-paper">
        <h2>{chapter === 2 ? "第二章 · 风资源分析" : "第五章 · 固定模板"}</h2>
        {chapter === 2 ? (
          <>
            <label className="ww-report-tower">
              测风塔
              <select
                value={state.activeTowerId}
                onChange={(event) => {
                  const id = event.target.value;
                  onChange((current) => activateTower(current, id));
                }}
              >
                {state.towers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <WorkspaceReportExport
              key={state.activeTowerId}
              state={state}
              projectName={projectName}
            />
            {!state.analysisRuns[state.activeTowerId] && (
              <button className="ww-button" onClick={onAnalyze}>
                前往风资源分析
              </button>
            )}
          </>
        ) : (
          <div className="ww-simple-empty">
            <span className="ww-empty-plot-icon">▤</span>
            <h3>等待第五章模板</h3>
            <p>接入你提供的表格形式和描述方式后，再确定填充字段与引用关系。</p>
          </div>
        )}
      </section>
    </div>
  );
}
