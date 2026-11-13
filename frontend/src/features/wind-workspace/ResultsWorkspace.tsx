import { useState } from "react";
import { activateTower } from "./autoSetup";
import { OUTPUTS, SOURCE_TYPES, outputStatus } from "./model";
import type { SourceKind, WorkspaceTab, WorkspaceViewProps } from "./model";
import { ResultView } from "./ResultView";
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
  const output = active && run?.outputs[active.id];
  const job =
    state.correlationJobs.find((j) => j.id === activeId) ??
    state.correlationJobs[0];
  const pairRun =
    job?.runs?.[Math.min(pairIndex, (job?.runs?.length ?? 1) - 1)];
  return (
    <div className="ww-results">
      <div className="ww-section-heading">
        <div>
          <span className="ww-overline">CHART & TABLE COLLECTION</span>
          <h2>风资源计算成果</h2>
          <p>图、表与运行快照引用同一组数据与参数；修改配置后请重新计算。</p>
        </div>
        <button className="ww-button" onClick={() => onConfigure("analysis")}>
          调整分析配置 →
        </button>
      </div>
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
}: {
  state: WorkspaceViewProps["state"];
}) {
  const [chapter, setChapter] = useState<2 | 5>(2);
  return (
    <div className="ww-report-layout">
      <aside className="ww-panel ww-report-navigation">
        <span className="ww-overline">REPORT SECTIONS</span>
        <h2>章节与模板</h2>
        <button
          aria-pressed={chapter === 2}
          className={chapter === 2 ? "active" : ""}
          onClick={() => setChapter(2)}
        >
          <b>02</b>
          <span>
            风资源分析<small>图表、表格与固定描述</small>
          </span>
        </button>
        <button
          aria-pressed={chapter === 5}
          className={chapter === 5 ? "active" : ""}
          onClick={() => setChapter(5)}
        >
          <b>05</b>
          <span>
            第五章模板<small>固定表格与套话，待提供</small>
          </span>
        </button>
        <p>报告格式和描述方式以你后续提供的模板为准。</p>
      </aside>
      <section className="ww-panel ww-report-paper">
        <span className="ww-overline">TEMPLATE CONNECTION</span>
        <h2>{chapter === 2 ? "第二章 · 风资源分析" : "第五章 · 固定模板"}</h2>
        <div className="ww-report-notice">
          模板尚未提供 · 当前展示内容组织与成果关联
        </div>
        {chapter === 2 ? (
          <>
            <p className="ww-report-intro">
              原始资料、质控统计、结果风况和长期参考分别关联到报告内容，保持图、表和描述的数据来源一致。
            </p>
            <div className="ww-template-slots">
              {SOURCE_TYPES.map((source) => (
                <article key={source.id}>
                  <span>{source.number}</span>
                  <div>
                    <h3>{source.outputs}</h3>
                    <p>来源：{source.shortLabel}</p>
                    <small>
                      已选{" "}
                      {
                        OUTPUTS.filter(
                          (output) =>
                            output.kind === source.id &&
                            state.selectedOutputs.includes(output.id),
                        ).length
                      }{" "}
                      组成果 · 等待真实计算与模板
                    </small>
                  </div>
                  <b>待关联</b>
                </article>
              ))}
            </div>
            <div className="ww-callout">
              固定描述将由确认后的表格和计算结果填充，当前不生成未经计算的结论。
            </div>
          </>
        ) : (
          <div className="ww-simple-empty">
            <span className="ww-empty-plot-icon">▤</span>
            <h3>等待第五章模板</h3>
            <p>接入你提供的表格形式和描述方式后，再确定填充字段与引用关系。</p>
            <span className="ww-quiet-tag">本轮预留位置，不展开第五章计算</span>
          </div>
        )}
      </section>
    </div>
  );
}
