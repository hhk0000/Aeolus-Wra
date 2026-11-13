import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getHealth } from "./api";
import SavedRunPreview from "./features/wind-workspace/SavedRunPreview";
import AnalysisWorkspace from "./features/wind-workspace/AnalysisWorkspace";
import {
  ResultsWorkspace,
  ReportOutline,
} from "./features/wind-workspace/ResultsWorkspace";
import {
  StandardsLibrary,
  ReviewWorkspace,
} from "./features/wind-workspace/StandardsLibrary";
import { createWorkspace } from "./features/wind-workspace/model";
import type { WorkspaceState } from "./features/wind-workspace/model";
import {
  loadWorkspaceCache,
  restoreCachedRuns,
  saveWorkspaceCache,
} from "./features/wind-workspace/cache";

const sections = [
  "项目管理中心",
  "分析配置",
  "图表可视化中心",
  "报告预览",
  "自动审查中心",
  "规范库",
];
const subtitles = [
  "每一段风的旅程，从这里开始。",
  "把分析思路，变成清晰的工作流。",
  "让数据里的规律，清晰可见。",
  "从分析到表达，让成果井然有序。",
  "多一层核查，多一份从容。",
  "让每一个结论，都有据可循。",
];
const icons = ["grid", "sliders", "chart", "file", "shield", "book"];
type Project = { name: string; region: string; type: string; demo: boolean };
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    sliders: (
      <>
        <path d="M6 3v18M18 3v18M12 3v18" />
        <path d="M3 8h6M9 16h6M15 10h6" />
      </>
    ),
    chart: (
      <>
        <path d="M3 3v18h18M7 16l4-6 4 3 6-9" />
      </>
    ),
    file: (
      <>
        <path d="M14 3H5v18h14V8zM14 3v6h5M8 13h8M8 17h6" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6" />
      </>
    ),
    book: (
      <>
        <path d="M12 5v16M12 5C8 2 3 4 3 4v15s5-2 9 2c4-4 9-2 9-2V4s-5-2-9 1z" />
      </>
    ),
    wind: (
      <>
        <path d="M3 8h13a3 3 0 1 0-3-3M3 12h17a2 2 0 1 1-2 2M3 16h7a3 3 0 1 1-3 3" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.grid}
    </svg>
  );
}
function WindScene() {
  return (
    <div className="landscape" aria-hidden="true">
      <div className="sun" />
      <div className="hill far" />
      <div className="hill near" />
      {[0, 1, 2].map((i) => (
        <div key={i} className={`windmill w${i}`}>
          <div className="pole" />
          <div className="rotor">
            {[0, 1, 2].map((j) => (
              <i key={j} style={{ transform: `rotate(${j * 120}deg)` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
export default function App() {
  const query = new URLSearchParams(window.location.search);
  return query.has("run") ? (
    <SavedRunPreview
      runId={query.get("run") ?? ""}
      correlationId={query.get("correlation") ?? ""}
      initialView={query.get("view") ?? "monthly"}
    />
  ) : (
    <WorkspaceApp />
  );
}

function WorkspaceApp() {
  const [page, setPage] = useState(0);
  const [pageHistory, setPageHistory] = useState<number[]>([]);
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("aeolus.projects.v1") ?? "null",
      );
      if (
        Array.isArray(saved) &&
        saved.length &&
        saved.every(
          (p) =>
            typeof p.name === "string" &&
            typeof p.region === "string" &&
            typeof p.type === "string",
        )
      )
        return saved;
    } catch {
      /* A corrupt browser cache must not prevent opening the application. */
    }
    return [
      {
        name: "张北风电场风资源评估",
        region: "河北 · 张家口",
        type: "陆上风电",
        demo: true,
      },
      {
        name: "沿海风电项目可行性研究",
        region: "江苏 · 盐城",
        type: "海上风电",
        demo: true,
      },
      {
        name: "山地风电场测风数据分析",
        region: "云南 · 曲靖",
        type: "陆上风电",
        demo: true,
      },
    ];
  });
  const [selected, setSelected] = useState(() =>
    Math.min(
      projects.length - 1,
      Math.max(0, Number(localStorage.getItem("aeolus.selected.v1")) || 0),
    ),
  );
  useEffect(() => {
    try {
      localStorage.setItem("aeolus.projects.v1", JSON.stringify(projects));
      localStorage.setItem("aeolus.selected.v1", String(selected));
    } catch {
      /* Configuration can still be exported. */
    }
  }, [projects, selected]);
  const [workspaces, setWorkspaces] =
    useState<Record<number, WorkspaceState>>(loadWorkspaceCache);
  const workspace = workspaces[selected] ?? createWorkspace();
  const updateWorkspace = (update: (s: WorkspaceState) => WorkspaceState) =>
    setWorkspaces((current) => ({
      ...current,
      [selected]: update(current[selected] ?? createWorkspace()),
    }));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部项目");
  const [modal, setModal] = useState(false);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [type, setType] = useState("陆上风电");
  const [notice, setNotice] = useState("");
  const [health, setHealth] = useState("连接检查中");
  useEffect(() => {
    let active = true;
    void restoreCachedRuns().then((restored) => {
      if (active)
        setWorkspaces((current) => {
          const next = { ...current };
          for (const [id, runs] of Object.entries(restored)) {
            const index = Number(id);
            if (!next[index]) continue;
            next[index] = {
              ...next[index],
              ...runs,
              analysisRuns: {
                ...runs.analysisRuns,
                ...next[index].analysisRuns,
              },
              longTermRuns: {
                ...runs.longTermRuns,
                ...next[index].longTermRuns,
              },
              correlationJobs: next[index].correlationJobs.map((job) => ({
                ...job,
                runs:
                  job.runs ??
                  runs.correlationJobs?.find((r) => r.id === job.id)?.runs,
              })),
              toolRuns: [
                ...new Map(
                  [...(runs.toolRuns ?? []), ...next[index].toolRuns].map(
                    (r) => [r.id, r],
                  ),
                ).values(),
              ],
            };
          }
          return next;
        });
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    try {
      saveWorkspaceCache(workspaces);
    } catch {
      const timer = window.setTimeout(
        () =>
          setNotice(
            "浏览器配置保存空间不足，请导出分析配置。计算数据和快照仍保留在本机服务。",
          ),
        0,
      );
      return () => window.clearTimeout(timer);
    }
  }, [workspaces]);
  useEffect(() => {
    const c = new AbortController();
    getHealth(c.signal)
      .then(() => setHealth("分析服务已连接"))
      .catch(() => setHealth("分析服务未连接"));
    return () => c.abort();
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    if (!modal) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [modal]);
  const current = projects[selected];
  const go = (i: number) => {
    if (i !== page) setPageHistory((v) => [...v, page]);
    setPage(i);
    setQuery("");
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => go(0)}>
          <span className="brand-icon">
            <Icon name="wind" size={27} />
          </span>
          <span>
            Aeolus<span className="brand-caption">风资源分析工作空间</span>
          </span>
        </a>
        <div className="workspace-label">
          工作空间 <span>⌘</span>
        </div>
        <nav aria-label="工作中心">
          {sections.map((s, i) => (
            <button
              key={s}
              className={`nav-item ${page === i ? "active" : ""}`}
              onClick={() => go(i)}
              aria-current={page === i ? "page" : undefined}
            >
              <Icon name={icons[i]} />
              {s}
              {page === i && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="small-icon">
            <Icon name="shield" />
          </span>
          <strong>让每一步分析有迹可循</strong>
          <p>
            从原始数据到工程结论，
            <br />
            构建属于你的风资源工作流。
          </p>
          <span className="version">界面预览 · v0.1</span>
        </div>
        <div className="profile">
          <div className="avatar">H</div>
          <div>
            <strong>我的工作空间</strong>
            <span>本地工作环境</span>
          </div>
          <span className="online-dot" />
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="ww-button"
            disabled={!pageHistory.length}
            onClick={() => {
              setPage(pageHistory.at(-1) ?? 0);
              setPageHistory((v) => v.slice(0, -1));
            }}
          >
            ← 返回
          </button>
          <span>
            Aeolus Wra <span className="slash">/</span>{" "}
            <strong>{sections[page]}</strong>
          </span>
          <div className="topbar-right">
            <span className="service">
              <i className={health === "分析服务已连接" ? "connected" : ""} />
              {health}
            </span>
            <span className="avatar mini">H</span>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR WIND, YOUR INSIGHT</div>
              <h1>{sections[page]}</h1>
              <p>{subtitles[page]}</p>
            </div>
            <div className="heading-actions">
              <span className="preview-badge">本机分析引擎 · V0.2</span>
              {page === 0 && (
                <button className="primary" onClick={() => setModal(true)}>
                  <Icon name="plus" size={17} />
                  新建项目
                </button>
              )}
            </div>
          </div>
          {page === 0 ? (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="hero-tag">
                    <span /> 风的价值，从洞察开始
                  </span>
                  <h2>
                    让每一缕风，
                    <br />
                    成为可见的可能。
                  </h2>
                  <p>
                    项目、数据、分析与成果，在一个空间自然衔接。
                    <br />
                    专注探索，让复杂的风资源分析变得井然有序。
                  </p>
                  <button onClick={() => go(1)}>
                    开启分析工作流 <Icon name="arrow" size={17} />
                  </button>
                </div>
                <WindScene />
                <span className="scene-caption">EXPLORE THE INVISIBLE.</span>
              </section>
              <div className="stats">
                {[
                  [
                    "项目空间",
                    String(projects.length).padStart(2, "0"),
                    "集中管理你的分析项目",
                    "grid",
                  ],
                  ["测风数据", "—", "等待接入真实测风数据", "wind"],
                  ["分析任务", "—", "按项目配置分析流程", "chart"],
                  ["成果报告", "—", "从图表到完整报告", "file"],
                ].map(([title, value, desc, icon], i) => (
                  <div className="stat" key={title}>
                    <div>
                      <span>{title}</span>
                      <strong>{value}</strong>
                      <small>{desc}</small>
                    </div>
                    <span className={`stat-icon tint${i}`}>
                      <Icon name={icon} />
                    </span>
                  </div>
                ))}
              </div>
              <div className="section-title">
                <div>
                  <h2>
                    我的项目 <span>{projects.length}</span>
                  </h2>
                  <p>有序组织，让每一次探索都有归处。</p>
                </div>
                <label className="search">
                  <Icon name="search" size={17} />
                  <input
                    aria-label="搜索项目"
                    placeholder="搜索项目名称或地区"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              <div className="filter-row">
                <div className="segments">
                  {["全部项目", "陆上风电", "海上风电"].map((s) => (
                    <button
                      className={filter === s ? "chosen" : ""}
                      key={s}
                      onClick={() => setFilter(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <span>按创建顺序排列</span>
              </div>
              <div className="project-grid">
                {projects
                  .map((p, i) => ({ ...p, index: i }))
                  .filter(
                    (p) =>
                      (filter === "全部项目" || filter === p.type) &&
                      (p.name + p.region).includes(query),
                  )
                  .map((p) => (
                    <button
                      className={`project-card project-${p.index % 3}`}
                      key={p.index}
                      onClick={() => {
                        setSelected(p.index);
                        go(1);
                      }}
                    >
                      <div className="project-art">
                        <WindScene />
                        <span className="project-tag">
                          {p.demo ? "示例项目" : "本地草稿"}
                        </span>
                        <span className="project-arrow">↗</span>
                      </div>
                      <div className="project-info">
                        <span className="project-type">{p.type}</span>
                        <h3>{p.name}</h3>
                        <p>{p.region || "地区待填写"}</p>
                        <div className="project-bottom">
                          <span>
                            <i /> {p.demo ? "探索示例工作流" : "等待导入数据"}
                          </span>
                          <span>进入项目 →</span>
                        </div>
                      </div>
                    </button>
                  ))}
                <button className="new-card" onClick={() => setModal(true)}>
                  <span>
                    <Icon name="plus" size={26} />
                  </span>
                  <strong>创建新的风资源项目</strong>
                  <p>从一个想法，开始新的探索</p>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="project-context">
                <span className="context-icon">
                  <Icon name="grid" />
                </span>
                <div>
                  <small>当前项目</small>
                  <select
                    aria-label="当前项目"
                    value={selected}
                    onChange={(e) => {
                      setSelected(Number(e.target.value));
                    }}
                  >
                    {projects.map((p, i) => (
                      <option key={i} value={i}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <span className="context-status">
                  {current.demo ? "示例工作空间" : "本地项目草稿"}
                </span>
              </div>
              {page === 1 && (
                <AnalysisWorkspace
                  projectName={projects[selected]?.name ?? "项目"}
                  state={workspace}
                  onChange={updateWorkspace}
                  onNotice={setNotice}
                  onOpenGallery={() => setPage(2)}
                />
              )}
              {page === 2 && (
                <ResultsWorkspace
                  state={workspace}
                  onChange={updateWorkspace}
                  onNotice={setNotice}
                  onConfigure={(tab) => {
                    updateWorkspace((current) => ({
                      ...current,
                      activeTab: tab,
                    }));
                    setPage(1);
                  }}
                />
              )}
              {page === 3 && <ReportOutline state={workspace} />}
              {page === 4 && <ReviewWorkspace state={workspace} />}
              {page === 5 && <StandardsLibrary />}
            </>
          )}
          <footer className="footer">
            <span>
              <Icon name="wind" size={15} /> AEOLUS WRA{" "}
              <span className="footer-divider">|</span> 让风的价值被看见
            </span>
            <span>原始数据留存 · 分析过程可追溯</span>
          </footer>
        </div>
      </main>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="关闭"
              onClick={() => setModal(false)}
            >
              ×
            </button>
            <span className="stat-icon tint0">
              <Icon name="plus" size={24} />
            </span>
            <h2 id="modal-title">开始一段新的探索</h2>
            <p className="muted">创建项目，组织你的测风数据与分析成果。</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setProjects([
                  ...projects,
                  {
                    name: name.trim(),
                    region: region.trim(),
                    type,
                    demo: false,
                  },
                ]);
                setSelected(projects.length);
                setModal(false);
                setName("");
                setRegion("");
                setNotice("本地项目已创建，配置保存在当前浏览器");
              }}
            >
              <label className="field">
                项目名称
                <input
                  autoFocus
                  required
                  maxLength={60}
                  pattern=".*\S.*"
                  placeholder="例如：张北风电场风资源评估"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="field">
                项目地区
                <input
                  maxLength={40}
                  placeholder="例如：河北 · 张家口"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                />
              </label>
              <label className="field">
                项目类型
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option>陆上风电</option>
                  <option>海上风电</option>
                </select>
              </label>
              <p className="form-note">
                项目配置保存在当前浏览器；导入文件和计算快照由本机服务保存。
              </p>
              <button className="primary wide" type="submit">
                创建项目 <Icon name="arrow" size={17} />
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
