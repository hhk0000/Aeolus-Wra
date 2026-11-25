import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Plot } from "./InteractiveResultView";
import { RoseChart } from "./RoseChart";

type Source = {
  id: string;
  name: string;
  height: number;
  first: string;
  last: string;
  coordinates: { lat?: number; lon?: number };
  coverage_error?: string;
  start_year?: number;
  end_year?: number;
  year?: number;
  mean_speed?: number;
  annual?: number[];
  deviation?: number;
};
type Assessment = {
  source?: Source;
  energy?: { id: string; name: string };
  density: string;
  factor: string;
  manualLocation: boolean;
  lat: string;
  lon: string;
  alt: string;
  runId?: string;
  analysisYear?: number;
  hidden: string[];
};
type Result = {
  year: number;
  height: number;
  tables?: Record<
    string,
    {
      headers: string[];
      rows: string[][];
      summary_rows?: number;
    }
  >;
  charts: {
    title: string;
    image?: string;
    plot?: string;
    rows?: Record<string, unknown>[];
    fields?: string[];
    energy?: boolean;
    fit?: Record<string, unknown>;
  }[];
};
type Template = { id: string; version: string; title: string };

const tabs = ["数据资料", "风资源分析", "长期参考"];
const titles = [
  "风速和风功率密度月变化图",
  "风速和风功率密度日变化图",
  "风速和风能频率图",
  "风向频率玫瑰图",
  "风能频率玫瑰图",
  "威布尔分布图",
  "五十年极大风速",
];
const shortTitles = Object.fromEntries(
  titles.map((title, index) => [
    title,
    [
      "风速与功率密度月变化",
      "风速与功率密度日变化",
      "风速与风能频率",
      "风向频率玫瑰图",
      "风能频率玫瑰图",
      "威布尔分布",
      "五十年极大风速",
    ][index],
  ]),
);
const initial: Assessment = {
  density: "",
  factor: "75",
  manualLocation: false,
  lat: "",
  lon: "",
  alt: "",
  hidden: [],
};

export default function MesoscaleWorkspace({
  project,
  workspaceId,
  page,
  onNavigate,
}: {
  project: string;
  workspaceId: number;
  page: number;
  onNavigate: (page: number) => void;
}) {
  const storage = "aeolus.assessment.v1." + workspaceId;
  const [state, setState] = useState<Assessment>(() => {
    try {
      return {
        ...initial,
        ...JSON.parse(localStorage.getItem(storage) ?? "{}"),
      };
    } catch {
      return initial;
    }
  });
  const [tab, setTab] = useState(0);
  const [chosen, setChosen] = useState(titles[0]);
  const [result, setResult] = useState<Result>();
  const [template, setTemplate] = useState<Template>();
  const [error, setError] = useState("");
  const [resultError, setResultError] = useState("");
  const [busy, setBusy] = useState(false);
  const removeDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storage, JSON.stringify(state));
    } catch {
      // Open pages can still use the assessment while storage is unavailable.
    }
  }, [state, storage]);
  useEffect(() => {
    if (page !== 2 || !state.runId) return;
    const controller = new AbortController();
    const runId = state.runId;
    const sourceId = state.source?.id;
    const density = Number(state.density);
    const analysisYear = state.analysisYear;
    void api<Result>(
      "/reports/assessment/runs/" + runId,
      undefined,
      controller.signal,
    )
      .then(async (saved) => {
        if (controller.signal.aborted) return;
        const usesReportImages = saved.charts.some((chart) => !chart.rows);
        if (
          (!saved.tables || usesReportImages) &&
          sourceId &&
          density > 0 &&
          density < 3
        ) {
          const refreshed = await api<{ id: string }>(
            "/reports/assessment/runs",
            {
              source_id: sourceId,
              density,
              analysis_year: analysisYear,
            },
            controller.signal,
          );
          if (!controller.signal.aborted) {
            setState((current) =>
              current.runId === runId &&
              current.source?.id === sourceId &&
              Number(current.density) === density &&
              current.analysisYear === analysisYear
                ? { ...current, runId: refreshed.id }
                : current,
            );
          }
          return;
        }
        setResultError("");
        setResult(saved);
      })
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setResultError(cause.message);
      });
    return () => controller.abort();
  }, [page, state.runId, state.source?.id, state.density, state.analysisYear]);
  useEffect(() => {
    if (page !== 3) return;
    const controller = new AbortController();
    void api<Template[]>("/reports/templates", undefined, controller.signal)
      .then((list) => setTemplate(list.find((item) => item.id === "mesoscale")))
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [page]);

  const source = state.source;
  const analysisYears = source?.start_year
    ? (source.annual ?? []).map((_, index) => source.start_year! + index)
    : [];
  const analysisYear = state.analysisYear ?? source?.year;
  const yearMean =
    analysisYear !== undefined && source?.start_year !== undefined
      ? source.annual?.[analysisYear - source.start_year]
      : undefined;
  const deviation =
    yearMean !== undefined && source?.mean_speed
      ? (yearMean / source.mean_speed - 1) * 100
      : source?.deviation;
  const automaticLocation =
    source?.coordinates.lat !== undefined &&
    source?.coordinates.lon !== undefined;
  const canRun =
    analysisYear !== undefined &&
    analysisYears.includes(analysisYear) &&
    Number(state.density) > 0 &&
    Number(state.density) < 3;
  const templateUrl =
    template &&
    "/api/v1/reports/templates/" + template.id + "/" + template.version;

  function change(values: Partial<Assessment>) {
    setState((current) => ({ ...current, ...values }));
  }

  function removeSource() {
    removeDialog.current?.close();
    setError("");
    setResultError("");
    setResult(undefined);
    change({
      source: undefined,
      runId: undefined,
      analysisYear: undefined,
      manualLocation: false,
      lat: "",
      lon: "",
      alt: "",
    });
  }

  async function upload(file: File | undefined, kind: "source" | "energy") {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      if (kind === "energy") {
        change({ energy: await api("/reports/assessment/files/energy", form) });
      } else {
        const next = await api<Source>(
          "/reports/assessment/files/source",
          form,
        );
        setResult(undefined);
        change({
          source: next,
          runId: undefined,
          analysisYear: undefined,
          manualLocation: false,
          lat: "",
          lon: "",
          alt: "",
        });
        if (next.year) setTab(1);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    if (!source || !canRun || busy) return;
    setBusy(true);
    setError("");
    try {
      const run = await api<{ id: string }>("/reports/assessment/runs", {
        source_id: source.id,
        density: Number(state.density),
        analysis_year: state.analysisYear,
      });
      setResult(undefined);
      setResultError("");
      change({ runId: run.id });
      onNavigate(2);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!templateUrl || !source || !state.runId || busy) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("source_id", source.id);
      form.set("density", state.density);
      if (state.analysisYear !== undefined) {
        form.set("analysis_year", String(state.analysisYear));
      }
      form.set("factor", state.factor);
      form.set("project", project);
      if (state.energy) form.set("energy_id", state.energy.id);
      if (automaticLocation || state.manualLocation) {
        form.set(
          "lat",
          automaticLocation ? String(source.coordinates.lat) : state.lat,
        );
        form.set(
          "lon",
          automaticLocation ? String(source.coordinates.lon) : state.lon,
        );
        form.set("alt", state.alt);
      }
      const response = await fetch(templateUrl + "/export", {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          typeof body?.detail === "string"
            ? body.detail
            : "无法生成报告，请检查分析配置。",
        );
      }
      const href = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = (project || "风资源评估") + "中尺度风资源分析报告.docx";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 30000);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const errorNotice = error && (
    <p className="ww-error" role="alert">
      {error}
    </p>
  );

  const period = source?.year && analysisYear !== undefined && (
    <div className="ww-assessment-period">
      <label className="field">
        分析年
        <select
          aria-label="分析年"
          disabled={busy}
          value={state.analysisYear ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            setError("");
            setResult(undefined);
            setResultError("");
            change({
              analysisYear: value ? Number(value) : undefined,
              runId: undefined,
            });
          }}
        >
          <option value="">自动推荐（{source.year} 年）</option>
          {analysisYears.map((year) => (
            <option key={year} value={year}>
              {year} 年
            </option>
          ))}
        </select>
      </label>
      <p className="ww-inline-note" role="status">
        分析时段 {analysisYear}-01-01 00:00 至 {analysisYear + 1}-01-01
        00:00（不含终点） · {source.height} m
      </p>
    </div>
  );

  if (page === 1)
    return (
      <div className="ww-workspace ww-assessment">
        <div className="ww-workspace-board">
          <div className="ww-workspace-toolbar">
            <div
              className="ww-primary-tabs"
              role="tablist"
              aria-label="资源评估配置"
            >
              {tabs.map((title, index) => (
                <button
                  key={title}
                  type="button"
                  role="tab"
                  id={"assessment-tab-" + index}
                  aria-controls="assessment-panel"
                  aria-selected={tab === index}
                  className={tab === index ? "active" : ""}
                  onClick={() => {
                    setTab(index);
                    setError("");
                  }}
                >
                  {title}
                </button>
              ))}
            </div>
          </div>
          <section
            id="assessment-panel"
            role="tabpanel"
            aria-labelledby={"assessment-tab-" + tab}
            className="ww-panel"
          >
            <h2>{tabs[tab]}</h2>
            {tab === 0 && (
              <>
                <label className="field">
                  中尺度数据（逐小时 TXT）
                  <input
                    type="file"
                    accept=".txt"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      void upload(file, "source");
                    }}
                  />
                </label>
                <p className="ww-inline-note">
                  支持 ERA5 和格林威治，自动识别风速、风向和高度。
                </p>
                {busy && <p role="status">正在读取资料…</p>}
                {source && (
                  <div className="ww-assessment-file">
                    <div>
                      <strong>{source.name}</strong>
                      <p>
                        {source.height} m · {source.first.slice(0, 10)} 至{" "}
                        {source.last.slice(0, 10)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="ww-button project-delete-confirm"
                      disabled={busy}
                      onClick={() => removeDialog.current?.showModal()}
                    >
                      删除资料
                    </button>
                    <dialog
                      ref={removeDialog}
                      className="modal ww-concurrent-task-dialog"
                      aria-labelledby="assessment-remove-title"
                    >
                      <h2 id="assessment-remove-title">删除中尺度资料</h2>
                      <p>
                        从当前工作区移除「{source.name}
                        」，并清空当前分析结果。原始文件和历史计算记录会保留。
                      </p>
                      <div className="project-delete-actions">
                        <button
                          type="button"
                          className="ww-button"
                          autoFocus
                          onClick={() => removeDialog.current?.close()}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="ww-button project-delete-confirm"
                          onClick={removeSource}
                        >
                          确认删除
                        </button>
                      </div>
                    </dialog>
                  </div>
                )}
                {source?.coverage_error && (
                  <p className="ww-error" role="alert">
                    {source.coverage_error}
                  </p>
                )}
                {source?.year && (
                  <button
                    className="ww-button primary"
                    type="button"
                    onClick={() => setTab(1)}
                  >
                    继续风资源分析
                  </button>
                )}
              </>
            )}
            {tab === 1 && (
              <>
                {period || <p>请先上传覆盖 20 个完整自然年的中尺度资料。</p>}
                {source?.year && (
                  <p className="ww-inline-note">
                    {source.start_year}–{source.end_year} 年基准 · 选定{" "}
                    {analysisYear} 年 · 偏差 {deviation?.toFixed(2)}%
                    {state.analysisYear !== undefined
                      ? " · 手动选择"
                      : Math.abs(deviation ?? 0) > 2
                        ? " · 无平风年，采用最小偏差年"
                        : " · 平风年中偏差最小"}
                  </p>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void analyze();
                  }}
                >
                  <fieldset disabled={busy} className="ww-report-controls">
                    <div className="ww-fields ww-fields-two">
                      <label>
                        轮毂高度空气密度（kg/m³）
                        <input
                          required
                          type="number"
                          step="any"
                          min="0.001"
                          max="2.999"
                          value={state.density}
                          onChange={(event) => {
                            setResult(undefined);
                            setResultError("");
                            change({
                              density: event.target.value,
                              runId: undefined,
                            });
                          }}
                        />
                      </label>
                      <label>
                        综合修正系数（%）
                        <input
                          required
                          type="number"
                          step="any"
                          min="0.01"
                          max="100"
                          value={state.factor}
                          onChange={(event) =>
                            change({ factor: event.target.value })
                          }
                        />
                      </label>
                      <label className="ww-wide">
                        机组发电量表（可选，XLSX、CSV 或 TSV）
                        <input
                          type="file"
                          accept=".xlsx,.csv,.tsv,.txt"
                          onChange={(event) =>
                            void upload(event.target.files?.[0], "energy")
                          }
                        />
                      </label>
                    </div>
                    {state.energy && (
                      <p>
                        {state.energy.name}{" "}
                        <button
                          type="button"
                          className="ww-button"
                          onClick={() => change({ energy: undefined })}
                        >
                          移除机组表
                        </button>
                      </p>
                    )}
                    {source && !automaticLocation && (
                      <label>
                        <input
                          type="checkbox"
                          checked={state.manualLocation}
                          onChange={(event) =>
                            change({ manualLocation: event.target.checked })
                          }
                        />{" "}
                        手动填写中尺度选点位置
                      </label>
                    )}
                    {(automaticLocation || state.manualLocation) && (
                      <div className="ww-fields ww-fields-three">
                        <label>
                          纬度（°）
                          <input
                            type="number"
                            step="any"
                            min="-90"
                            max="90"
                            readOnly={automaticLocation}
                            value={
                              automaticLocation
                                ? source!.coordinates.lat
                                : state.lat
                            }
                            onChange={(event) =>
                              change({ lat: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          经度（°）
                          <input
                            type="number"
                            step="any"
                            min="-180"
                            max="180"
                            readOnly={automaticLocation}
                            value={
                              automaticLocation
                                ? source!.coordinates.lon
                                : state.lon
                            }
                            onChange={(event) =>
                              change({ lon: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          海拔（m）
                          <input
                            type="number"
                            step="any"
                            min="-500"
                            max="9000"
                            value={state.alt}
                            placeholder="输入选点海拔"
                            onChange={(event) =>
                              change({ alt: event.target.value })
                            }
                          />
                        </label>
                      </div>
                    )}
                    <div
                      role="group"
                      aria-label="结果图表选项"
                      className="ww-output-grid"
                    >
                      {titles.map((title) => (
                        <label key={title}>
                          <input
                            type="checkbox"
                            checked={!state.hidden.includes(title)}
                            onChange={(event) =>
                              change({
                                hidden: event.target.checked
                                  ? state.hidden.filter(
                                      (item) => item !== title,
                                    )
                                  : [...state.hidden, title],
                              })
                            }
                          />
                          {title}
                        </label>
                      ))}
                    </div>
                    <div className="ww-report-actions">
                      <button
                        className="ww-button primary"
                        disabled={!canRun || busy}
                      >
                        {busy ? "正在计算…" : "开启风资源分析"}
                      </button>
                      {state.runId && (
                        <button
                          type="button"
                          className="ww-button"
                          onClick={() => onNavigate(2)}
                        >
                          查看已有结果
                        </button>
                      )}
                    </div>
                  </fieldset>
                </form>
              </>
            )}
            {tab === 2 && (
              <>
                {period}
                {!source?.year ? (
                  <p>
                    {source?.coverage_error ||
                      "上传中尺度资料后自动识别自然年窗口和代表年。"}
                  </p>
                ) : (
                  <>
                    <p>
                      {source.start_year}–{source.end_year} 年平均风速{" "}
                      {source.mean_speed?.toFixed(3)} m/s。推荐分析年为{" "}
                      {source.year} 年。
                    </p>
                    <div className="ww-table-scroll">
                      <table className="ww-result-table">
                        <thead>
                          <tr>
                            <th>自然年</th>
                            <th>平均风速（m/s）</th>
                            <th>较长期均值偏差</th>
                          </tr>
                        </thead>
                        <tbody>
                          {source.annual?.map((value, index) => {
                            const year = (source.start_year ?? 0) + index;
                            return (
                              <tr key={year}>
                                <td>
                                  {year}
                                  {year === analysisYear
                                    ? "（当前分析年）"
                                    : ""}
                                  {year === source.year && year !== analysisYear
                                    ? "（推荐）"
                                    : ""}
                                </td>
                                <td>{value.toFixed(3)}</td>
                                <td>
                                  {(
                                    (value / (source.mean_speed ?? 1) - 1) *
                                    100
                                  ).toFixed(2)}
                                  %
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
            {errorNotice}
          </section>
        </div>
      </div>
    );

  if (page === 2) {
    const shown = titles.filter((title) => !state.hidden.includes(title));
    const active = shown.includes(chosen) ? chosen : shown[0];
    const chart = result?.charts.find((entry) => entry.title === active);
    const statistics = active ? result?.tables?.[active] : undefined;
    return (
      <div className="ww-results ww-assessment">
        <div className="ww-gallery-filter">
          <strong>结果数据</strong>
          {result && (
            <span>
              {result.year} 年 · {result.height} m
            </span>
          )}
        </div>
        <div className="ww-gallery-layout">
          <aside
            className="ww-chart-list ww-assessment-nav"
            aria-label="资源评估成果"
          >
            {shown.map((title) => (
              <button
                key={title}
                type="button"
                className={title === active ? "active" : ""}
                aria-label={title}
                title={title}
                aria-current={title === active ? "true" : undefined}
                onClick={() => setChosen(title)}
              >
                <strong>{shortTitles[title]}</strong>
              </button>
            ))}
          </aside>
          <section className="ww-panel ww-chart-stage">
            {active && <h2>{active}</h2>}
            {active === "五十年极大风速" ? (
              <p>待接入计算算法。</p>
            ) : resultError ? (
              <p role="alert">{resultError}</p>
            ) : !state.runId ? (
              <p>完成风资源分析后查看结果。</p>
            ) : !result ? (
              <p role="status">正在读取计算结果…</p>
            ) : !active ? (
              <p>请在分析配置选择要显示的图表。</p>
            ) : !chart ? (
              <p>当前资料无法生成这张图。</p>
            ) : (
              <>
                <div className="ww-assessment-plot">
                  {chart.rows && chart.plot === "rose" ? (
                    <RoseChart
                      rows={chart.rows}
                      title={chart.title}
                      energy={chart.energy}
                    />
                  ) : chart.rows && chart.fields ? (
                    <Plot
                      rows={chart.rows}
                      fields={chart.fields}
                      title={chart.title}
                      outputId={chart.plot}
                      fit={chart.fit}
                    />
                  ) : chart.image ? (
                    <img
                      src={"data:image/png;base64," + chart.image}
                      alt={chart.title}
                    />
                  ) : null}
                </div>
                {statistics && (
                  <div className="ww-table-scroll ww-assessment-table">
                    <table className="ww-result-table">
                      <caption>报告统计表</caption>
                      <colgroup>
                        {statistics.headers.map((header) => (
                          <col key={header} />
                        ))}
                      </colgroup>
                      <thead>
                        <tr>
                          {statistics.headers.map((header) => (
                            <th scope="col" key={header}>
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {statistics.rows.map(([label, ...values], index) => (
                          <tr
                            key={label}
                            className={
                              index >=
                              statistics.rows.length -
                                (statistics.summary_rows ?? 0)
                                ? "ww-assessment-total"
                                : undefined
                            }
                          >
                            <th scope="row">{label}</th>
                            {values.map((value, column) => (
                              <td key={column}>{value}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            <button
              className="ww-button"
              type="button"
              onClick={() => {
                setTab(1);
                onNavigate(1);
              }}
            >
              调整分析配置
            </button>
          </section>
        </div>
      </div>
    );
  }

  return (
    <section className="ww-panel ww-assessment">
      <h2>风资源评估报告</h2>
      {templateUrl && (
        <p>
          {template.title} · {template.version}{" "}
          <a href={templateUrl + "/source"}>下载模板</a>
        </p>
      )}
      {source?.year && (
        <p>
          {source.name} · {analysisYear} 分析年 · {source.height} m
        </p>
      )}
      {!state.runId && <p>请在分析配置上传资料、填写空气密度并运行分析。</p>}
      <div className="ww-report-actions">
        <button
          className="ww-button primary"
          type="button"
          disabled={!templateUrl || !state.runId || busy}
          onClick={() => void download()}
        >
          {busy ? "正在生成报告…" : "生成 Word 半成品"}
        </button>
        <button
          className="ww-button"
          type="button"
          onClick={() => {
            setTab(1);
            onNavigate(1);
          }}
        >
          调整分析配置
        </button>
      </div>
      {errorNotice}
    </section>
  );
}
