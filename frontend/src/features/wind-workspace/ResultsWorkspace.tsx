import { useState } from "react";
import { activateTower } from "./autoSetup";
import { OUTPUTS, SOURCE_TYPES, outputStatus } from "./model";
import type { SourceKind, WorkspaceTab, WorkspaceViewProps } from "./model";
import { ResultView } from "./ResultView";
import WorkspaceReportExport from "./WorkspaceReportExport";
import TowerComparison from "./TowerComparison";
import "./workspace.css";

interface ResultsProps extends WorkspaceViewProps {
  onConfigure: (tab: WorkspaceTab) => void;
}
export function ResultsWorkspace({
  state,
  onChange,
  onConfigure,
}: ResultsProps) {
  const [filter, setFilter] = useState<SourceKind | "all" | "correlation">(
    "all",
  );
  const [activeId, setActiveId] = useState("");
  const [pairIndex, setPairIndex] = useState(0);
  const [compare, setCompare] = useState(false);
  const selected = OUTPUTS.filter((o) => state.selectedOutputs.includes(o.id));
  const filtered = selected.filter(
    (o) => filter === "all" || o.kind === filter,
  );
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
  if (compare)
    return <TowerComparison state={state} onBack={() => setCompare(false)} />;
  return (
    <div className="ww-results">
      <section className="ww-results-hero">
        <div className="ww-results-hero-copy">
          <span className="ww-overline">CHART & TABLE COLLECTION</span>
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
      <div className="ww-gallery-filter">
        <div role="group" aria-label="图表来源筛选">
          {(
            [
              ["all", "全部"],
              ...SOURCE_TYPES.map((s) => [s.id, s.shortLabel]),
              ["correlation", "相关性"],
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
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ww-gallery-tools">
          <button type="button" onClick={() => setCompare(true)}>
            多塔对比
          </button>
          <span className="ww-gallery-count">共 {filtered.length} 组</span>
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
          {filter === "correlation"
            ? state.correlationJobs.map((j, i) => (
                <button
                  key={j.id}
                  className={job?.id === j.id ? "active" : ""}
                  onClick={() => {
                    setActiveId(j.id);
                    setPairIndex(0);
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
                  onClick={() => setActiveId(o.id)}
                >
                  <span className={`ww-mini-source ${o.kind}`} />
                  <span>
                    <strong>{o.title}</strong>
                    <small>{o.form}</small>
                  </span>
                  <span className="ww-chevron">›</span>
                </button>
              ))}
        </aside>
        <section className="ww-panel ww-chart-stage">
          {filter === "correlation" ? (
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
                    {SOURCE_TYPES.find((s) => s.id === active.kind)!.shortLabel}
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
                  key={`${run.id}-${active.id}`}
                  output={output}
                  outputId={active.id}
                  run={run}
                  towerName={tower.name}
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
                        active.kind === "reference" ? "long-term" : "analysis",
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
      </div>
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
