import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Run, RunOutput } from "./api";
import { readCharts } from "./chartReports";
import type { SavedChart } from "./chartReports";

export default function ReportExport({
  run,
  renderOutput,
}: {
  run: Run;
  renderOutput: (id: string, output: RunOutput) => ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const entries = Object.entries(run.outputs).filter(
    ([, o]) => o.status === "ready",
  );
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<SavedChart[]>(readCharts);
  useEffect(() => {
    const refresh = () => setSaved(readCharts());
    window.addEventListener("aeolus-report-change", refresh);
    return () => window.removeEventListener("aeolus-report-change", refresh);
  }, []);
  async function save() {
    try {
      const { renderToStaticMarkup } = await import("react-dom/server");
      const chosen = entries.filter(
        ([id]) => !selected.length || selected.includes(id),
      );
      const chosenSaved = saved.filter((c) => selected.includes(c.id));
      const content = chosenSaved.length
        ? chosenSaved
            .map(
              (c) =>
                `<h2>${c.title.replaceAll("<", "&lt;")}</h2>${c.html}<pre>${JSON.stringify(c.config, null, 2).replaceAll("<", "&lt;")}</pre>`,
            )
            .join("")
        : chosen
            .map(([id, output]) =>
              renderToStaticMarkup(
                <section>
                  <h2>{output.title}</h2>
                  {renderOutput(id, output)}
                </section>,
              ),
            )
            .join("");
      const html = `<!doctype html><meta charset="utf-8"><title>风资源分析报告</title><style>body{font-family:Microsoft YaHei;margin:36px;color:#243e30}svg{width:100%;max-height:600px}table{border-collapse:collapse;font-size:11px;width:100%}td,th{border:1px solid #ccd7d0;padding:6px}button,a,.ww-table-pages{display:none}section{break-before:page}pre{white-space:pre-wrap;overflow-wrap:anywhere}.ww-scatter-grid,.ww-month-grid{display:grid;grid-template-columns:1fr 1fr}</style><h1>风资源分析报告</h1><p>未勾选时导出全部已计算成果。默认16扇区、MLE，具体算法及统计参数以本次运行快照为准。完整年数据量基准365天；时间覆盖范围另行说明。</p>${content}`;
      const a = document.createElement("a");
      const url = URL.createObjectURL(
        new Blob([html], { type: "text/html;charset=utf-8" }),
      );
      a.href = url;
      a.download = `wind-resource-report-${run.id}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <details className="ww-panel">
      <summary>报告导出配置（不勾选则使用全部默认成果）</summary>
      <p>
        导出可打印的独立HTML图表报告。图上的自定义样式使用“导出本图报告”；完整原始表格另可导出CSV。
      </p>
      <div className="ww-output-grid">
        {saved.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              onChange={(e) =>
                setSelected((v) =>
                  e.target.checked ? [...v, c.id] : v.filter((x) => x !== c.id),
                )
              }
            />
            {c.title}（图上保存的配置）
          </label>
        ))}
        {entries.map(([id, o]) => (
          <label key={id}>
            <input
              type="checkbox"
              checked={selected.includes(id)}
              onChange={(e) =>
                setSelected((v) =>
                  e.target.checked ? [...v, id] : v.filter((x) => x !== id),
                )
              }
            />
            {o.title}
          </label>
        ))}
      </div>
      <button className="ww-button" onClick={save}>
        导出选定报告 / 默认报告
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
