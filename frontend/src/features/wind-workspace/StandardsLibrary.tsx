import { useEffect, useState } from "react";
import { api } from "./api";
import type { Registry } from "./api";
import type { WorkspaceState } from "./model";
import "./workspace.css";

export function StandardsLibrary() {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    let active = true;
    api<Registry>("/standards")
      .then((r) => {
        if (active) setRegistry(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="ww-workspace">
      <div className="ww-section-heading">
        <div>
          <span className="ww-overline">STANDARDS & METHODS</span>
          <h2>规范与算法依据</h2>
          <p>
            国家标准优先，行业规范补充，企业方法单独标识。在线状态核验日期：
            {registry?.verified_on ?? "读取中"}。
          </p>
        </div>
        <input
          aria-label="搜索算法或条款"
          className="ww-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索算法、来源或条款"
        />
      </div>
      {error && <p className="ww-error">{error}</p>}
      <div className="ww-standard-cards">
        {registry?.standards.map((s) => (
          <article className="ww-panel" key={s.id}>
            <span className="ww-quiet-tag">{s.level}</span>
            <h3>{s.name}</h3>
            <p>{s.title}</p>
            <small>{s.status}</small>
            {s.url && (
              <a href={s.url} target="_blank" rel="noreferrer">
                查看官方状态 ↗
              </a>
            )}
          </article>
        ))}
      </div>
      <p className="ww-callout">
        {registry?.notice ?? "正在从本机计算服务读取方法注册表…"}
      </p>
      <div className="ww-method-list">
        {registry?.methods
          .filter((m) =>
            `${m.title} ${m.source} ${m.clause}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((m) => (
            <article className="ww-panel" key={m.id}>
              <div className="ww-section-heading">
                <div>
                  <h3>{m.title}</h3>
                  <p>
                    {registry.standards.find((s) => s.id === m.source)?.name ??
                      "用户需求"}{" "}
                    · {m.clause}
                  </p>
                </div>
                <span
                  className={`ww-status ${m.status === "implemented" ? "ready" : "pending"}`}
                >
                  {m.status === "implemented"
                    ? "已实现 · 条件适用"
                    : m.status === "awaiting-template"
                      ? "等待报告模板"
                      : "需人工 / 专题复核"}
                </span>
              </div>
              <code className="ww-formula">{m.formula}</code>
              <p>{m.limits}</p>
              <small>
                方法 {m.id} · v{m.version} · 数据阶段 {m.stage}
              </small>
            </article>
          ))}
      </div>
    </div>
  );
}

export function ReviewWorkspace({ state }: { state: WorkspaceState }) {
  const runs = [
    ...Object.values(state.analysisRuns),
    ...Object.values(state.longTermRuns),
    ...state.toolRuns,
    ...state.correlationJobs.flatMap((job) => job.runs ?? []),
  ];
  const outputs = runs.flatMap((run) =>
    Object.entries(run.outputs).map(([id, output]) => ({ id, output, run })),
  );
  return (
    <div className="ww-workspace">
      <div className="ww-section-heading">
        <div>
          <span className="ww-overline">REVIEW & TRACEABILITY</span>
          <h2>计算条件与成果核查</h2>
          <p>展示真实运行中的缺项、警示和版本；不自动替代项目审查结论。</p>
        </div>
        <span className="ww-quiet-tag">{runs.length}次运行快照</span>
      </div>
      <div className="ww-review-summary">
        <article>
          <strong>{state.files.filter((f) => f.dataset).length}</strong>
          <span>已解析资料</span>
        </article>
        <article>
          <strong>
            {outputs.filter((o) => o.output.status === "ready").length}
          </strong>
          <span>可用输出</span>
        </article>
        <article>
          <strong>
            {outputs.filter((o) => o.output.status !== "ready").length}
          </strong>
          <span>缺项 / 待补条件</span>
        </article>
      </div>
      {!runs.length && (
        <div className="ww-panel ww-simple-empty">
          <h3>还没有运行记录</h3>
          <p>
            在分析配置中解析数据并执行计算后，这里会显示本次运行的核查信息。
          </p>
        </div>
      )}
      {runs.flatMap((r) =>
        (r.warnings ?? []).map((w, i) => (
          <p className="ww-callout" key={`${r.id}-${i}`}>
            {w}
          </p>
        )),
      )}
      <div className="ww-method-list">
        {outputs.map(({ id, output, run }) => (
          <article className="ww-panel" key={`${run.id}-${id}`}>
            <div className="ww-section-heading">
              <h3>{output.title}</h3>
              <span
                className={`ww-status ${output.status === "ready" ? "ready" : "pending"}`}
              >
                {output.status === "ready" ? "计算已完成" : "待补充条件"}
              </span>
            </div>
            <p>
              {output.reason ??
                "结果可查阅，适用性与输入质量仍需结合方法条件核对。"}
            </p>
            <small>
              {new Date(run.created_at).toLocaleString()} · 引擎{" "}
              {run.engine_version} · 方法 {output.method} · 运行{" "}
              {run.id.slice(0, 12)}
            </small>
          </article>
        ))}
      </div>
      <div className="ww-callout">
        现场布设、仪器检定与变更一致性、复杂地形推算、极端风况与台风专题、最终报告审签需要相应资料与人工复核。
      </div>
    </div>
  );
}
