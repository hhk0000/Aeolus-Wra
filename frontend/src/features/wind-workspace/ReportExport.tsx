import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import type { Run, RunOutput } from "./api";
import { readCharts, removeReportChart } from "./chartReports";
import { reportSnapshot } from "./reportSnapshot";
import type { ReportSection } from "./reportSnapshot";
import { downloadWord, downloadHtml } from "./reportDownload";

export interface ReportRun {
  run: Run;
  label?: string;
}

export default function ReportExport({
  runs,
  renderOutput,
  title = "风资源分析报告",
  expanded = false,
}: {
  runs: ReportRun[];
  renderOutput: (run: Run, id: string, output: RunOutput) => ReactNode;
  title?: string;
  expanded?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [template, setTemplate] = useState<File | null>(null);
  const [customTemplate, setCustomTemplate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [allSaved, setAllSaved] = useState(readCharts);
  const controlId = useId();
  const entries = runs.flatMap(({ run, label }) =>
    Object.entries(run.outputs)
      .filter(
        ([id, output]) =>
          output.status === "ready" &&
          !(
            id === "raw-records" && run.outputs.completeness?.status === "ready"
          ),
      )
      .map(([outputId, output]) => ({
        id: run.id + "/" + outputId,
        run,
        outputId,
        output,
        title: [label, output.title].filter(Boolean).join(" · "),
      })),
  );
  const saved = allSaved.filter((chart) =>
    runs.some(
      ({ run }) =>
        run.id === chart.config.sourceRunId || run.id === chart.config.runId,
    ),
  );
  useEffect(() => {
    const refresh = () => setAllSaved(readCharts());
    window.addEventListener("aeolus-report-change", refresh);
    return () => window.removeEventListener("aeolus-report-change", refresh);
  }, []);

  const chosenSaved = saved.filter((chart) => selected.includes(chart.id));
  const chosenEntries = entries.filter((entry) => selected.includes(entry.id));
  const defaults = chosenSaved.length + chosenEntries.length === 0;
  const chosen = defaults ? entries : chosenEntries;
  function select(id: string) {
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((key) => key !== id)
        : [...previous, id],
    );
    setStatus("");
  }

  async function save(format: "docx" | "html") {
    setError("");
    setStatus("");
    if (format === "docx" && customTemplate && !template) {
      setError("请选择 Word 模板，或切换到内置风资源章节。");
      return;
    }
    setBusy(true);
    try {
      setStatus("正在整理选定成果…");
      const { renderToStaticMarkup } = await import("react-dom/server");
      const sections: ReportSection[] = [];
      for (const { run, outputId, output, title: sectionTitle } of chosen) {
        const fragment = document.createElement("template");
        fragment.innerHTML = renderToStaticMarkup(
          renderOutput(run, outputId, output),
        );
        sections.push({
          run_id: run.id,
          output_id: outputId,
          title: sectionTitle,
          html: reportSnapshot(fragment.content, sectionTitle),
        });
      }
      for (const chart of chosenSaved) {
        sections.push({
          run_id: String(chart.config.runId),
          output_id: String(chart.config.outputId),
          title: chart.title,
          html: chart.html,
        });
      }
      if (format === "docx")
        await downloadWord(
          title,
          sections,
          customTemplate ? template : null,
          setStatus,
        );
      else downloadHtml(title, sections);
      setStatus(
        `已生成 ${sections.length} 项成果的 ${format === "docx" ? "Word" : "HTML"} 报告。`,
      );
    } catch (e) {
      setStatus("");
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const controls = (
    <fieldset disabled={busy} className="ww-report-controls">
      <legend>报告内容</legend>
      <p>
        默认导出当前范围内全部已计算成果。勾选后只导出所选项，可同时选择默认成果和图上保存的配置。
      </p>
      <div className="ww-output-grid">
        {entries.map((entry) => (
          <label key={entry.id}>
            <input
              type="checkbox"
              checked={selected.includes(entry.id)}
              onChange={() => select(entry.id)}
            />
            {entry.title}
          </label>
        ))}
        {saved.map((chart) => (
          <div className="ww-saved-report" key={chart.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(chart.id)}
                onChange={() => select(chart.id)}
              />
              {chart.title}（图上保存的配置）
            </label>
            <button
              type="button"
              aria-label={`移除 ${chart.title}`}
              onClick={() => removeReportChart(chart.id)}
            >
              移除
            </button>
          </div>
        ))}
      </div>
      <p className="ww-inline-note">
        分页统计表导出当前页并标明节选范围；完整明细可在图表中心下载 CSV。
      </p>
      <div className="ww-report-template">
        <label htmlFor={controlId}>Word 模板</label>
        <select
          id={controlId}
          value={customTemplate ? "file" : "default"}
          onChange={(event) => {
            setCustomTemplate(event.target.value === "file");
            setError("");
          }}
        >
          <option value="default">内置风资源章节</option>
          <option value="file">使用我的 .docx 模板</option>
        </select>
        {customTemplate && (
          <>
            <input
              type="file"
              aria-label="选择 Word 模板"
              accept=".docx"
              onChange={(event) => {
                setTemplate(event.target.files?.[0] ?? null);
                setError("");
              }}
            />
            <small>
              请在模板正文的插入位置单独写一段 <code>{"{{风资源分析}}"}</code>
              ，保存后选择该文件。
            </small>
          </>
        )}
      </div>
      <div className="ww-report-actions">
        <button
          type="button"
          disabled={busy || !entries.length}
          className="ww-button primary"
          onClick={() => void save("docx")}
        >
          导出 Word 报告
        </button>
        <button
          type="button"
          disabled={busy || !entries.length}
          className="ww-button"
          onClick={() => void save("html")}
        >
          导出 HTML 报告
        </button>
        <span>共 {chosen.length + chosenSaved.length} 项</span>
      </div>
    </fieldset>
  );
  const feedback = (
    <>
      {status && <p role="status">{status}</p>}
      {error && (
        <p role="alert" className="ww-error">
          {error}
        </p>
      )}
    </>
  );
  if (expanded)
    return (
      <div>
        {controls}
        {feedback}
      </div>
    );
  return (
    <details className="ww-panel">
      <summary>报告导出配置（不勾选则使用全部默认成果）</summary>
      {controls}
      {feedback}
    </details>
  );
}
