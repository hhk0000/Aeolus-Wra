import { useEffect, useState } from "react";
import { getHealth } from "./api";

type Connection =
  | { status: "checking" }
  | { status: "connected"; version: string }
  | { status: "failed"; message: string };

const stages = [
  {
    number: "01",
    title: "数据导入",
    detail: "原始文件留存 · 时间与传感器映射",
  },
  { number: "02", title: "质量控制", detail: "缺测分析 · 异常标记 · 处理记录" },
  { number: "03", title: "风况分析", detail: "风速统计 · 风向分布 · 有效率" },
  { number: "04", title: "成果归档", detail: "图表导出 · 参数快照 · 版本追溯" },
];

export default function App() {
  const [connection, setConnection] = useState<Connection>({
    status: "checking",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    let active = true;

    getHealth(controller.signal)
      .then((health) => {
        if (active)
          setConnection({ status: "connected", version: health.version });
      })
      .catch((error: unknown) => {
        if (active) {
          setConnection({
            status: "failed",
            message:
              error instanceof Error && error.name !== "AbortError"
                ? error.message
                : "连接超时，请检查后端服务是否启动。",
          });
        }
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  function reconnect() {
    setConnection({ status: "checking" });
    setAttempt((value) => value + 1);
  }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Aeolus-Wra 首页">
          <span className="brand-mark" aria-hidden="true">
            ↗
          </span>
          <span>
            AEOLUS<span className="brand-sub">WIND RESOURCE ANALYSIS</span>
          </span>
        </a>
        <span className="nav-label">工作空间</span>
        <nav aria-label="主导航">
          <a className="nav-item active" href="/" aria-current="page">
            <span aria-hidden="true">◈</span> 工作台
          </a>
          <span className="nav-item muted">
            <span aria-hidden="true">▤</span> 工程与数据 <small>待开发</small>
          </span>
          <span className="nav-item muted">
            <span aria-hidden="true">⌁</span> 分析成果 <small>待开发</small>
          </span>
        </nav>
        <div className="sidebar-footer">
          <span className="local-dot" /> 本地开发环境
          <span>数据留在本地，计算可追溯。</span>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <span>
            工作空间 <span className="breadcrumb">/ 工作台</span>
          </span>
          <span className="environment">LOCAL · T0</span>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">WIND RESOURCE WORKSPACE</p>
              <h1>风资源工作台</h1>
              <p className="subtitle">从每一条测风记录，走向可靠的工程结论。</p>
            </div>
            <span className="phase-badge">开发基线 · 0.1</span>
          </div>

          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <p className="eyebrow">让分析过程清晰可循</p>
              <h2 id="hero-title">
                把风的数据，
                <br />
                连接成完整的分析。
              </h2>
              <p>
                导入、质控、统计、归档。
                <br />
                每一步保留依据，每一次计算可以复现。
              </p>
              <a className="hero-link" href="#roadmap">
                查看开发路线 <span aria-hidden="true">↗</span>
              </a>
            </div>
            <div className="wind-art" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="orbit orbit-three" />
              <div className="turbine">
                <i className="mast" />
                <i className="blade blade-one" />
                <i className="blade blade-two" />
                <i className="blade blade-three" />
                <i className="hub" />
              </div>
              <span className="art-caption">AEOLUS / 让风的价值被看见</span>
            </div>
          </section>

          <section className="status-panel" aria-labelledby="system-title">
            <div>
              <h2 id="system-title">服务连接</h2>
              <p>检查前端与分析 API 的实际连接状态</p>
            </div>
            <div className="connection" role="status" aria-live="polite">
              <span className={`status-dot ${connection.status}`} />
              {connection.status === "connected"
                ? `API 已连接 · v${connection.version}`
                : connection.status === "checking"
                  ? "正在检查连接…"
                  : "API 连接失败"}
            </div>
            <button
              className="secondary-button"
              onClick={reconnect}
              disabled={connection.status === "checking"}
            >
              重新检查
            </button>
            {connection.status === "failed" && (
              <p className="connection-error">{connection.message}</p>
            )}
          </section>

          <section
            id="roadmap"
            className="roadmap"
            aria-labelledby="roadmap-title"
          >
            <div className="section-heading">
              <h2 id="roadmap-title">首版分析流程</h2>
              <span>以下功能正在规划，尚未开放</span>
            </div>
            <div className="stage-grid">
              {stages.map((stage) => (
                <article className="stage-card" key={stage.number}>
                  <div className="stage-top">
                    <span>{stage.number}</span>
                    <span className="planned">待开发</span>
                  </div>
                  <h3>{stage.title}</h3>
                  <p>{stage.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="empty-state">
            <span className="empty-symbol" aria-hidden="true">
              ＋
            </span>
            <div>
              <h2>从第一份测风数据开始</h2>
              <p>下一步将开放单塔 CSV 导入、字段映射与原始文件留存。</p>
            </div>
            <span className="next-tag">下一里程碑 T1</span>
          </section>
          <footer className="page-footer">
            <span>AEOLUS-WRA · 风资源自动化分析平台</span>
            <span>当前健康检查仅验证 API 响应</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
