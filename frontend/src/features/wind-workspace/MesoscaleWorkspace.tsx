import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Plot } from "./InteractiveResultView";
import { RoseChart } from "./RoseChart";
import { weibullMethods, type WeibullMethod } from "./weibullMethods";

type Source = {
  id: string;
  name: string;
  height: number;
  first: string;
  last: string;
  coordinates: { lat?: number; lon?: number };
  coverage_error?: string | null;
  start_year?: number;
  end_year?: number;
  window_years?: number;
  interval_minutes?: number;
  density_period?: number | null;
  year?: number;
  mean_speed?: number;
  annual?: number[];
  deviation?: number;
  density_by_year?: Record<string, number>;
  density_constant?: number | null;
  temperature_by_year?: Record<string, number>;
  temperature_period?: number | null;
};
type Assessment = {
  source?: Source;
  energy?: { id: string; name: string };
  pressure?: { id: string; name: string };
  pressureStation?: number;
  place?: string;
  pressureOverride?: string;
  multiplier: string;
  density: string;
  hubHeight?: string;
  meanTemperature?: string;
  factor: string;
  manualLocation: boolean;
  lat: string;
  lon: string;
  alt: string;
  runId?: string;
  weibullMethod?: WeibullMethod;
  analysisYear?: number;
  hidden: string[];
};
type PressureStation = {
  name: string;
  province?: string;
  level?: "county" | "city" | "province";
  manual?: boolean;
  pressure: number;
};
type PressureLibrary = {
  id: string;
  name: string;
  stations: PressureStation[];
};
const pressureLevels = {
  county: "区县匹配",
  city: "市级匹配",
  province: "省级参考站",
};
function identifiedDensity(
  source: Source | undefined,
  year: number | undefined,
) {
  return (
    (source?.window_years && source.window_years < 20
      ? source.density_period
      : year === undefined
        ? undefined
        : source?.density_by_year?.[year]) ??
    source?.density_constant ??
    undefined
  );
}

type Result = {
  year: number;
  height: number;
  hub_height_m?: number;
  density_adjustment?: {
    source_height_m: number;
    hub_height_m: number;
    source_density: number;
    hub_density: number;
    mean_temperature_c: number;
    temperature_source: "file" | "manual";
  } | null;
  power_density_grade?: {
    grade: string | null;
    threshold_heights_m?: number[];
  };
  interval_minutes?: number;
  monthly_roses?: Record<
    "frequency" | "energy_frequency",
    Record<string, unknown>[][]
  >;
  window_years?: number;
  analysis_start_year?: number;
  analysis_end_year?: number;
  extreme?: {
    station: (PressureStation & { library: string }) | null;
    mean_speed: number;
    mean_speed_used?: number;
    density: number;
    multiplier: number;
    site_speed: number;
    multiplier_standard: number;
    pressure_standard: number | null;
    pressure_site?: number | null;
    adopted: number | null;
  };
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
  weibull_charts?: Partial<Record<WeibullMethod, Result["charts"][number]>>;
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
  multiplier: "5",
  factor: "75",
  manualLocation: false,
  lat: "",
  lon: "",
  alt: "",
  hidden: [],
};

export default function MesoscaleWorkspace({
  project,
  region,
  workspaceId,
  page,
  onNavigate,
}: {
  project: string;
  region: string;
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
  const [pressureLibrary, setPressureLibrary] = useState<PressureLibrary>();
  const [pressureLookup, setPressureLookup] = useState<{
    place: string;
    station?: PressureStation | null;
    error?: string;
  }>();
  const [template, setTemplate] = useState<Template>();
  const [error, setError] = useState("");
  const [resultError, setResultError] = useState("");
  const [busy, setBusy] = useState(false);
  const removeDialog = useRef<HTMLDialogElement>(null);
  const source = state.source;
  const sourceId = source?.id;
  const pressureId = state.pressure?.id;
  const place = (
    state.place ?? (state.pressureStation === undefined ? region : "")
  )
    .trim()
    .slice(0, 120);
  const pressureStations =
    pressureLibrary?.id === pressureId ? pressureLibrary?.stations : undefined;
  const legacyPressureStation =
    state.pressureStation === undefined
      ? undefined
      : pressureStations?.[state.pressureStation];
  const pressureStation = place
    ? pressureLookup?.place === place
      ? pressureLookup.station
      : undefined
    : legacyPressureStation;
  const pressureNote = place
    ? pressureLookup?.place !== place
      ? "正在匹配地点…"
      : (pressureLookup.error ??
        (pressureStation?.level
          ? `${pressureLevels[pressureStation.level]} · ${pressureStation.province}${pressureStation.name} · ${pressureStation.pressure} kN/m²`
          : "未匹配到风压，可补充地区或在风资源分析手填。"))
    : legacyPressureStation
      ? `此前选定 · ${legacyPressureStation.name} · ${legacyPressureStation.pressure} kN/m²`
      : "填写省、市、区县后自动匹配。";
  const pressureOverride =
    state.pressureOverride === undefined
      ? undefined
      : Number(state.pressureOverride);
  const multiplier = Number(state.multiplier);
  const windowYears = source?.window_years ?? source?.annual?.length ?? 0;
  const shortWindow = windowYears > 0 && windowYears < 20;
  const selectedAnalysisYear = shortWindow ? undefined : state.analysisYear;
  const analysisYear = selectedAnalysisYear ?? source?.year;
  const analysisStart = shortWindow ? source?.start_year : analysisYear;
  const analysisEnd = shortWindow ? source?.end_year : analysisYear;
  const sourceDensity = identifiedDensity(source, analysisYear);
  const density = sourceDensity ?? Number(state.density);
  const hubHeight = state.hubHeight ? Number(state.hubHeight) : undefined;
  const needsDensityAdjustment =
    !!source && hubHeight !== undefined && hubHeight !== source.height;
  const sourceTemperature = shortWindow
    ? (source?.temperature_period ?? undefined)
    : analysisYear === undefined
      ? undefined
      : source?.temperature_by_year?.[analysisYear];
  const manualTemperature = state.meanTemperature
    ? Number(state.meanTemperature)
    : undefined;
  const analysisTemperature = manualTemperature ?? sourceTemperature;
  const needsSourceRefresh =
    !!sourceId &&
    (source?.density_by_year === undefined ||
      source.temperature_by_year === undefined ||
      source.window_years === undefined ||
      source.interval_minutes === undefined);

  useEffect(() => {
    try {
      localStorage.setItem(storage, JSON.stringify(state));
    } catch {
      // Open pages can still use the assessment while storage is unavailable.
    }
  }, [state, storage]);
  useEffect(() => {
    if (!place) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void api<{ station: PressureStation | null }>(
        "/reports/assessment/pressure-match?place=" + encodeURIComponent(place),
        undefined,
        controller.signal,
      )
        .then(({ station }) => {
          if (!controller.signal.aborted) setPressureLookup({ place, station });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setPressureLookup({
              place,
              error: "无法读取风压库，请稍后重试或手填。",
            });
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [place]);
  useEffect(() => {
    if (!pressureId || pressureLibrary?.id === pressureId) return;
    const controller = new AbortController();
    void api<PressureLibrary>(
      "/reports/assessment/files/pressure/" + pressureId,
      undefined,
      controller.signal,
    )
      .then(setPressureLibrary)
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [pressureId, pressureLibrary?.id]);
  useEffect(() => {
    if (!sourceId || !needsSourceRefresh) return;
    const controller = new AbortController();
    void api<Source>(
      "/reports/assessment/files/source/" + sourceId,
      undefined,
      controller.signal,
    )
      .then((fresh) => {
        if (controller.signal.aborted) return;
        setState((current) => {
          if (current.source?.id !== sourceId) return current;
          const previousYear = current.analysisYear ?? current.source?.year;
          const previousDensity =
            identifiedDensity(current.source, previousYear) ??
            Number(current.density);
          const nextYear = current.analysisYear ?? fresh.year;
          const automatic = identifiedDensity(fresh, nextYear);
          return {
            ...current,
            source: fresh,
            runId:
              previousYear !== nextYear ||
              (automatic !== undefined && automatic !== previousDensity)
                ? undefined
                : current.runId,
          };
        });
      })
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [sourceId, needsSourceRefresh]);
  useEffect(() => {
    if (page !== 2 || !state.runId) return;
    const controller = new AbortController();
    const runId = state.runId;
    const chosenYear = selectedAnalysisYear;
    void api<Result>(
      "/reports/assessment/runs/" + runId,
      undefined,
      controller.signal,
    )
      .then(async (saved) => {
        if (controller.signal.aborted) return;
        const usesReportImages = saved.charts.some((chart) => !chart.rows);
        if (
          (!saved.tables ||
            usesReportImages ||
            saved.extreme?.mean_speed_used === undefined ||
            !saved.monthly_roses ||
            !saved.weibull_charts ||
            saved.power_density_grade?.threshold_heights_m === undefined) &&
          sourceId &&
          density > 0 &&
          density < 3
        ) {
          const refreshed = await api<{ id: string }>(
            "/reports/assessment/runs",
            {
              source_id: sourceId,
              density,
              hub_height_m: hubHeight,
              mean_temperature_c: needsDensityAdjustment
                ? manualTemperature
                : undefined,
              analysis_year: chosenYear,
              extreme: {
                multiplier,
                pressure_library_id: pressureId,
                pressure_station_index: state.pressureStation,
                place,
                pressure_override: pressureOverride,
              },
            },
            controller.signal,
          );
          if (!controller.signal.aborted) {
            setState((current) =>
              current.runId === runId &&
              current.source?.id === sourceId &&
              current.analysisYear === chosenYear &&
              (identifiedDensity(
                current.source,
                current.analysisYear ?? current.source?.year,
              ) ?? Number(current.density)) === density
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
  }, [
    page,
    state.runId,
    sourceId,
    density,
    hubHeight,
    manualTemperature,
    needsDensityAdjustment,
    selectedAnalysisYear,
    multiplier,
    pressureId,
    state.pressureStation,
    place,
    pressureOverride,
  ]);
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

  const analysisYears = source?.start_year
    ? (source.annual ?? []).map((_, index) => source.start_year! + index)
    : [];
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
    density > 0 &&
    density < 3 &&
    (hubHeight === undefined ||
      (hubHeight > 0 && Number.isFinite(hubHeight))) &&
    (!needsDensityAdjustment ||
      (analysisTemperature !== undefined &&
        analysisTemperature >= -100 &&
        analysisTemperature <= 100)) &&
    Number.isFinite(multiplier) &&
    multiplier > 0 &&
    (pressureOverride === undefined ||
      (Number.isFinite(pressureOverride) && pressureOverride > 0));
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
      meanTemperature: undefined,
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
          density: "",
          runId: undefined,
          analysisYear: undefined,
          meanTemperature: undefined,
          manualLocation: false,
          lat: "",
          lon: "",
          alt: "",
        });
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const extremeOptions = {
    multiplier,
    pressure_library_id: pressureId,
    pressure_station_index: state.pressureStation,
    place,
    pressure_override: pressureOverride,
  };

  async function analyze() {
    if (!source || !canRun || busy) return;
    setBusy(true);
    setError("");
    try {
      const run = await api<{ id: string }>("/reports/assessment/runs", {
        source_id: source.id,
        density,
        hub_height_m: hubHeight,
        mean_temperature_c: needsDensityAdjustment
          ? manualTemperature
          : undefined,
        analysis_year: selectedAnalysisYear,
        extreme: extremeOptions,
      });
      setResult(undefined);
      setResultError("");
      change({ runId: run.id, weibullMethod: undefined });
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
      form.set("density", String(density));
      if (hubHeight !== undefined) form.set("hub_height_m", String(hubHeight));
      if (needsDensityAdjustment && manualTemperature !== undefined) {
        form.set("mean_temperature_c", String(manualTemperature));
      }
      if (selectedAnalysisYear !== undefined) {
        form.set("analysis_year", String(selectedAnalysisYear));
      }
      form.set("factor", state.factor);
      form.set("project", project);
      if (state.weibullMethod && state.weibullMethod !== "mle") {
        form.set("weibull_method", state.weibullMethod);
      }
      form.set("extreme", JSON.stringify(extremeOptions));
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
      anchor.download = project
        ? project + "风资源评估报告.docx"
        : "风资源评估报告.docx";
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

  const period = source?.year &&
    analysisStart !== undefined &&
    analysisEnd !== undefined && (
      <div className="ww-assessment-period">
        {!shortWindow && (
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
                  meanTemperature: undefined,
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
        )}
        <p className="ww-inline-note" role="status">
          分析时段 {analysisStart}-01-01 00:00 至 {analysisEnd + 1}-01-01
          00:00（不含终点） · {source.height} m ·{" "}
          {source.interval_minutes === 10 ? "10 min" : "1 h"}
        </p>
      </div>
    );

  if (page === 1) {
    const stepDone = [!!source?.year, !!state.runId, !!source?.year];
    const selectedChartCount = titles.length - state.hidden.length;
    return (
      <div className="ww-workspace ww-assessment">
        <div className="ww-workspace-board">
          <div className="ww-workspace-toolbar">
            <div
              className="ww-primary-tabs"
              role="tablist"
              aria-orientation="vertical"
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
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <b className="ww-step-title">{title}</b>
                  {stepDone[index] && (
                    <i className="ww-step-ready" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          </div>
          <section
            id="assessment-panel"
            role="tabpanel"
            aria-labelledby={"assessment-tab-" + tab}
            className="ww-panel ww-assessment-panel"
          >
            <div className="ww-assessment-head">
              <h2>{tabs[tab]}</h2>
              {source?.year && tab === 0 && (
                <span className="ww-status ready">已识别资料</span>
              )}
              {state.runId && tab === 1 && (
                <span className="ww-status ready">成果已生成</span>
              )}
            </div>
            {tab === 0 && (
              <div className="ww-assessment-stack">
                <div className="ww-assessment-group">
                  <div className="ww-assessment-group-head">
                    <h3>中尺度数据</h3>
                    <span>ERA5 / 格林威治 · 10 min 或 1 h TXT</span>
                  </div>
                  <label
                    className={`ww-assessment-dropzone${busy ? " is-busy" : ""}`}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const file = event.dataTransfer.files?.[0];
                      if (file) void upload(file, "source");
                    }}
                  >
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
                    <strong>
                      {busy
                        ? "正在解析资料…"
                        : source
                          ? "点击或拖入新 TXT 替换当前资料"
                          : "点击选择或拖入中尺度 TXT"}
                    </strong>
                  </label>
                  {source && (
                    <div className="ww-assessment-file">
                      <div>
                        <strong>{source.name}</strong>
                        <div className="ww-meta-pills">
                          <span>{source.height} m</span>
                          <span>
                            {source.interval_minutes === 10 ? "10 min" : "1 h"}
                          </span>
                          <span>
                            {source.first.slice(0, 10)} 至{" "}
                            {source.last.slice(0, 10)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="ww-button is-compact is-danger"
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
                </div>

                <div className="ww-assessment-group">
                  <div className="ww-assessment-group-head">
                    <h3>项目地点</h3>
                  </div>
                  <label className="field">
                    省 / 市 / 区县（匹配 50 年基本风压）
                    <input
                      type="text"
                      maxLength={120}
                      disabled={busy}
                      placeholder="例如：河北省 张家口市 怀来县"
                      value={state.place ?? place}
                      aria-describedby="assessment-pressure-location-note"
                      onChange={(event) =>
                        change({
                          place: event.target.value,
                          pressureOverride: undefined,
                          runId: undefined,
                        })
                      }
                    />
                  </label>
                  <p
                    id="assessment-pressure-location-note"
                    className="ww-inline-note"
                    role="status"
                  >
                    {pressureNote}
                  </p>
                </div>

                {source?.year && (
                  <div className="ww-assessment-actions">
                    <button
                      className="ww-button primary"
                      type="button"
                      onClick={() => setTab(1)}
                    >
                      进入风资源分析
                    </button>
                  </div>
                )}
              </div>
            )}
            {tab === 1 && (
              <div className="ww-assessment-stack">
                {source?.year ? (
                  <div className="ww-assessment-summary-strip">
                    {period}
                    <p className="ww-inline-note">
                      {source.start_year}–{source.end_year} 年 · 共{" "}
                      {windowYears} 年资料
                      {shortWindow
                        ? windowYears === 1
                          ? " · 直接分析该年"
                          : " · 合并全部完整自然年统计"
                        : ` · 选定 ${analysisYear} 年 · 偏差 ${deviation?.toFixed(2)}% · ${
                            selectedAnalysisYear !== undefined
                              ? "手动选择"
                              : Math.abs(deviation ?? 0) > 2
                                ? "无平风年，采用最小偏差年"
                                : "平风年中偏差最小"
                          }`}
                    </p>
                  </div>
                ) : (
                  <div className="ww-simple-empty">
                    <p>
                      请先在「01
                      数据资料」上传覆盖至少一个完整自然年的中尺度资料。
                    </p>
                    <button
                      type="button"
                      className="ww-button"
                      onClick={() => setTab(0)}
                    >
                      前往上传资料
                    </button>
                  </div>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void analyze();
                  }}
                >
                  <fieldset
                    disabled={busy}
                    className="ww-report-controls ww-assessment-stack"
                  >
                    <div className="ww-assessment-group">
                      <div className="ww-assessment-group-head">
                        <h3>基础气象与高度</h3>
                      </div>
                      <div className="ww-fields ww-fields-two">
                        <label>
                          源层空气密度（kg/m³）
                          <input
                            aria-label="空气密度"
                            aria-describedby="assessment-density-note"
                            required
                            readOnly={sourceDensity !== undefined}
                            type="number"
                            step="any"
                            min="0.001"
                            max="2.999"
                            value={
                              sourceDensity === undefined
                                ? state.density
                                : Number(sourceDensity.toPrecision(10))
                            }
                            onChange={(event) => {
                              setResult(undefined);
                              setResultError("");
                              change({
                                density: event.target.value,
                                runId: undefined,
                              });
                            }}
                          />
                          {sourceDensity !== undefined && (
                            <small
                              id="assessment-density-note"
                              className="ww-inline-note"
                            >
                              源文件自动识别
                            </small>
                          )}
                        </label>
                        <label>
                          轮毂高度（m）
                          <input
                            type="number"
                            min="0.01"
                            step="any"
                            placeholder={
                              source ? `默认 ${source.height} m` : undefined
                            }
                            value={state.hubHeight ?? ""}
                            onChange={(event) => {
                              setResult(undefined);
                              change({
                                hubHeight: event.target.value,
                                runId: undefined,
                              });
                            }}
                          />
                          {needsDensityAdjustment && (
                            <small className="ww-inline-note">
                              源层 {source?.height} m，按 GB/T 18710
                              式（B3）折算密度
                            </small>
                          )}
                        </label>
                        {needsDensityAdjustment && (
                          <label className="ww-wide">
                            分析期平均气温（℃）
                            <input
                              type="number"
                              min="-100"
                              max="100"
                              step="any"
                              required={sourceTemperature === undefined}
                              value={state.meanTemperature ?? ""}
                              placeholder={
                                sourceTemperature === undefined
                                  ? "请输入同期平均气温"
                                  : `源文件 ${sourceTemperature.toFixed(2)} ℃`
                              }
                              onChange={(event) => {
                                setResult(undefined);
                                change({
                                  meanTemperature: event.target.value,
                                  runId: undefined,
                                });
                              }}
                            />
                            {sourceTemperature === undefined && (
                              <small className="ww-inline-note">
                                源文件缺气温列，请手填以折算轮毂密度
                              </small>
                            )}
                          </label>
                        )}
                      </div>
                    </div>

                    <div className="ww-assessment-group">
                      <div className="ww-assessment-group-head">
                        <h3>极值风压与发电量</h3>
                      </div>
                      <div className="ww-fields ww-fields-three">
                        <div className="ww-field-with-action">
                          <label>
                            <span className="ww-label-row">
                              <span>50 年基本风压（kN/m²）</span>
                              {state.pressureOverride !== undefined && (
                                <button
                                  type="button"
                                  className="ww-text-button ww-inline-reset"
                                  onClick={() =>
                                    change({
                                      pressureOverride: undefined,
                                      runId: undefined,
                                    })
                                  }
                                >
                                  恢复自动值
                                </button>
                              )}
                            </span>
                            <input
                              type="number"
                              step="any"
                              value={
                                state.pressureOverride ??
                                pressureStation?.pressure ??
                                ""
                              }
                              aria-describedby="assessment-pressure-note"
                              onChange={(event) =>
                                change({
                                  pressureOverride: event.target.value,
                                  runId: undefined,
                                })
                              }
                            />
                            <small
                              id="assessment-pressure-note"
                              className="ww-inline-note"
                            >
                              {state.pressureOverride !== undefined &&
                                "手填覆盖 · "}
                              {pressureNote}
                            </small>
                          </label>
                        </div>
                        <label>
                          平均风速倍数
                          <input
                            required
                            type="number"
                            step="any"
                            value={state.multiplier}
                            onChange={(event) =>
                              change({
                                multiplier: event.target.value,
                                runId: undefined,
                              })
                            }
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
                      </div>
                      <div className="ww-energy-upload-row">
                        <label className="ww-button is-compact ww-file-trigger">
                          <input
                            type="file"
                            accept=".xlsx,.csv,.tsv,.txt"
                            onChange={(event) =>
                              void upload(event.target.files?.[0], "energy")
                            }
                          />
                          {state.energy
                            ? "更换机组发电量表"
                            : "上传机组发电量表"}
                        </label>
                        {state.energy ? (
                          <div className="ww-energy-file-pill">
                            <span>{state.energy.name}</span>
                            <button
                              type="button"
                              className="ww-text-button"
                              onClick={() => change({ energy: undefined })}
                            >
                              移除
                            </button>
                          </div>
                        ) : (
                          <span className="ww-inline-note">
                            可选 · XLSX / CSV / TSV
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="ww-assessment-group">
                      <div className="ww-assessment-group-head">
                        <h3>选点坐标与展示模块</h3>
                        <span>
                          已选 {selectedChartCount} / {titles.length} 项图表
                        </span>
                      </div>
                      {source && !automaticLocation && (
                        <label className="ww-checkbox-line">
                          <input
                            type="checkbox"
                            checked={state.manualLocation}
                            onChange={(event) =>
                              change({ manualLocation: event.target.checked })
                            }
                          />
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
                        className="ww-assessment-output-grid"
                      >
                        {titles.map((title) => {
                          const checked = !state.hidden.includes(title);
                          return (
                            <label
                              key={title}
                              className={checked ? "is-checked" : ""}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
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
                              <span>{shortTitles[title]}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div className="ww-assessment-actions">
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
                          查看结果
                        </button>
                      )}
                    </div>
                  </fieldset>
                </form>
              </div>
            )}
            {tab === 2 && (
              <div className="ww-assessment-stack">
                {!source?.year ? (
                  <div className="ww-simple-empty">
                    <p>
                      {source?.coverage_error ||
                        "上传中尺度资料后自动识别自然年窗口和代表年。"}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="ww-assessment-summary-strip">{period}</div>
                    <div className="ww-inline-metrics ww-assessment-kpis">
                      <div>
                        <span>基准资料期</span>
                        <strong>
                          {source.start_year}–{source.end_year} 年
                        </strong>
                      </div>
                      <div>
                        <span>有效年数</span>
                        <strong>{windowYears} 年</strong>
                      </div>
                      <div>
                        <span>资料期平均风速</span>
                        <strong>
                          {source.mean_speed?.toFixed(3) ?? "—"} m/s
                        </strong>
                      </div>
                      <div>
                        <span>{shortWindow ? "统计口径" : "当前分析年"}</span>
                        <strong>
                          {shortWindow
                            ? "完整资料期"
                            : `${analysisYear} 年${deviation !== undefined ? `（${deviation >= 0 ? "+" : ""}${deviation.toFixed(2)}%）` : ""}`}
                        </strong>
                      </div>
                    </div>
                    <div className="ww-table-scroll ww-assessment-table">
                      <table className="ww-result-table">
                        <thead>
                          <tr>
                            <th>自然年</th>
                            <th>平均风速（m/s）</th>
                            <th>较资料期均值偏差</th>
                          </tr>
                        </thead>
                        <tbody>
                          {source.annual?.map((value, index) => {
                            const year = (source.start_year ?? 0) + index;
                            const isCurrent =
                              !shortWindow && year === analysisYear;
                            const isRecommended =
                              !shortWindow &&
                              year === source.year &&
                              year !== analysisYear;
                            const dev =
                              (value / (source.mean_speed ?? 1) - 1) * 100;
                            return (
                              <tr
                                key={year}
                                className={
                                  isCurrent ? "ww-assessment-total" : undefined
                                }
                              >
                                <td>
                                  {year}
                                  {isCurrent && (
                                    <span className="ww-year-badge is-active">
                                      当前分析年
                                    </span>
                                  )}
                                  {isRecommended && (
                                    <span className="ww-year-badge">推荐</span>
                                  )}
                                </td>
                                <td>{value.toFixed(3)}</td>
                                <td>
                                  {dev >= 0 ? "+" : ""}
                                  {dev.toFixed(2)}%
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
            {errorNotice}
          </section>
        </div>
      </div>
    );
  }

  if (page === 2) {
    const shown = titles.filter((title) => !state.hidden.includes(title));
    const active = shown.includes(chosen) ? chosen : shown[0];
    const defaultChart = result?.charts.find((entry) => entry.title === active);
    const isWeibull = active === "威布尔分布图";
    const preferredMethod = state.weibullMethod ?? "mle";
    const alternate = isWeibull
      ? result?.weibull_charts?.[preferredMethod]
      : undefined;
    const chart = alternate ?? defaultChart;
    const method = alternate ? preferredMethod : "mle";
    const statistics = active ? result?.tables?.[active] : undefined;
    return (
      <div className="ww-results ww-assessment">
        <div className="ww-gallery-filter">
          <div className="ww-assessment-filter-info">
            <strong>结果数据</strong>
            {result && (
              <div className="ww-meta-pills">
                <span>
                  {result.analysis_start_year !== undefined &&
                  result.analysis_end_year !== undefined &&
                  result.analysis_start_year !== result.analysis_end_year
                    ? `${result.analysis_start_year}–${result.analysis_end_year}`
                    : result.year}{" "}
                  年
                </span>
                <span>{result.height} m 风速层</span>
                {result.density_adjustment && (
                  <span>
                    轮毂 {result.density_adjustment.hub_height_m} m ·{" "}
                    {result.density_adjustment.hub_density.toFixed(4)} kg/m³
                  </span>
                )}
                {result.window_years && (
                  <span>基准 {result.window_years} 年</span>
                )}
                {result.interval_minutes && (
                  <span>
                    {result.interval_minutes === 10 ? "10 min" : "1 h"}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="ww-gallery-tools">
            <button
              className="ww-button is-compact ww-configure-jump"
              type="button"
              onClick={() => {
                setTab(1);
                onNavigate(1);
              }}
            >
              调整配置
            </button>
            {state.runId && (
              <button
                className="ww-button is-compact primary"
                type="button"
                onClick={() => onNavigate(3)}
              >
                导出报告
              </button>
            )}
          </div>
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
            {active && (
              <div className="ww-assessment-chart-heading">
                <div className="ww-assessment-chart-title">
                  <h2>{active}</h2>
                  {active === "风速和风功率密度月变化图" &&
                    result?.power_density_grade && (
                      <span className="ww-status ready">
                        风功率密度等级{" "}
                        {result.power_density_grade.grade
                          ? `${result.power_density_grade.grade} 级`
                          : "待复核"}
                      </span>
                    )}
                </div>
                {isWeibull &&
                  result?.weibull_charts &&
                  (chart || Object.keys(result.weibull_charts).length > 0) && (
                    <label className="ww-method-picker">
                      <span>拟合算法</span>
                      <select
                        value={method}
                        onChange={(event) =>
                          change({
                            weibullMethod: event.target.value as WeibullMethod,
                          })
                        }
                      >
                        {Object.entries(weibullMethods).map(
                          ([value, label]) => (
                            <option
                              key={value}
                              value={value}
                              disabled={
                                value === "mle"
                                  ? !defaultChart
                                  : !result.weibull_charts?.[
                                      value as WeibullMethod
                                    ]
                              }
                            >
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}
              </div>
            )}
            {resultError ? (
              <p className="ww-error" role="alert">
                {resultError}
              </p>
            ) : !state.runId ? (
              <div className="ww-simple-empty">
                <p>完成风资源分析后即可在此查阅全部图表与统计表。</p>
                <button
                  type="button"
                  className="ww-button primary"
                  onClick={() => {
                    setTab(1);
                    onNavigate(1);
                  }}
                >
                  前往开启分析
                </button>
              </div>
            ) : !result ? (
              <p role="status">正在读取计算结果…</p>
            ) : !active ? (
              <p>请在分析配置选择要显示的图表。</p>
            ) : active === "五十年极大风速" && result.extreme ? (
              <ExtremeWindResult result={result.extreme} />
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
                      fitMethod={
                        chart.plot === "weibull"
                          ? method === "mle"
                            ? "二参数最大似然法（MLE）"
                            : weibullMethods[method]
                          : undefined
                      }
                    />
                  ) : chart.image ? (
                    <img
                      src={"data:image/png;base64," + chart.image}
                      alt={chart.title}
                    />
                  ) : null}
                </div>
                {chart.plot === "weibull" &&
                  typeof chart.fit?.positive_count === "number" && (
                    <div className="ww-meta-pills ww-weibull-meta">
                      <span>
                        {result.interval_minutes === 10 ? "10 min" : "1 h"}{" "}
                        原序列
                      </span>
                      <span>
                        正风速拟合样本{" "}
                        {chart.fit.positive_count.toLocaleString("zh-CN")} 条
                      </span>
                      <span>
                        零风速比例{" "}
                        {(Number(chart.fit.zero_fraction) * 100).toFixed(2)}%
                      </span>
                    </div>
                  )}
                {chart.plot === "rose" && result.monthly_roses && (
                  <section className="ww-assessment-monthly-roses">
                    <h3>
                      {chart.energy
                        ? "各月风能频率玫瑰图"
                        : "各月风向频率玫瑰图"}
                    </h3>
                    <div className="ww-rose-month-grid">
                      {result.monthly_roses[
                        chart.energy ? "energy_frequency" : "frequency"
                      ].map((rows, i) =>
                        rows.length ? (
                          <RoseChart
                            key={i}
                            title={`${i + 1} 月`}
                            rows={rows}
                            energy={chart.energy}
                            compact
                          />
                        ) : (
                          <div key={i} className="ww-simple-empty">
                            <strong>{i + 1} 月</strong>
                            <p>有效资料不足</p>
                          </div>
                        ),
                      )}
                    </div>
                  </section>
                )}
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
          </section>
        </div>
      </div>
    );
  }

  return (
    <section className="ww-panel ww-assessment ww-assessment-export-card">
      <div className="ww-assessment-head">
        <h2>风资源评估报告</h2>
        {template && (
          <span className="ww-status ready">
            {template.title} · v{template.version}
          </span>
        )}
      </div>
      <div className="ww-inline-metrics ww-assessment-kpis">
        <div>
          <span>数据源文件</span>
          <strong>{source?.name ?? "尚未上传"}</strong>
        </div>
        <div>
          <span>分析期与高度</span>
          <strong>
            {source?.year
              ? `${analysisStart === analysisEnd ? analysisStart : `${analysisStart}–${analysisEnd}`} 年 · ${source.height} m`
              : "待识别"}
          </strong>
        </div>
        <div>
          <span>基准资料</span>
          <strong>{windowYears ? `${windowYears} 年` : "—"}</strong>
        </div>
        <div>
          <span>导出状态</span>
          <strong>{state.runId ? "成果已就绪" : "请先运行分析"}</strong>
        </div>
      </div>
      {!state.runId && (
        <p className="ww-inline-note">
          请在「分析配置」上传资料、核对空气密度并运行分析后再生成报告。
        </p>
      )}
      <div className="ww-assessment-actions">
        <button
          className="ww-button primary"
          type="button"
          disabled={!templateUrl || !state.runId || busy}
          onClick={() => void download()}
        >
          {busy ? "正在生成报告…" : "生成 Word 半成品"}
        </button>
        {templateUrl && (
          <a className="ww-button" href={templateUrl + "/source"}>
            下载空白模板
          </a>
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
      </div>
      {errorNotice}
    </section>
  );
}

function ExtremeWindResult({
  result,
}: {
  result: NonNullable<Result["extreme"]>;
}) {
  const station = result.station;
  const pressureSource = station?.manual
    ? "手动填写"
    : station
      ? [
          station.level && pressureLevels[station.level],
          (station.province ?? "") + station.name,
        ]
          .filter(Boolean)
          .join(" · ")
      : "待补充基本风压";
  return (
    <>
      <div className="ww-extreme-summary">
        <div>
          <span>前期采用值 · 标准空气密度</span>
          <strong>
            {result.adopted === null
              ? "待确定"
              : `${result.adopted.toFixed(2)} m/s`}
          </strong>
        </div>
        <span>场址空气密度 {result.density} kg/m³</span>
      </div>
      <div className="ww-table-scroll ww-assessment-table ww-extreme-table">
        <table
          className="ww-result-table"
          aria-label="两种极大风速估算方法对比"
        >
          <thead>
            <tr>
              <th scope="col">方法</th>
              <th scope="col">计算依据</th>
              <th scope="col">
                场址密度风速
                <br />
                m/s
              </th>
              <th scope="col">
                标准密度风速
                <br />
                m/s
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">风压法</th>
              <td>
                {station && <strong>{station.pressure} kN/m²</strong>}
                <small>{pressureSource}</small>
              </td>
              <td>{result.pressure_site?.toFixed(2) ?? "—"}</td>
              <td>{result.pressure_standard?.toFixed(2) ?? "—"}</td>
            </tr>
            <tr>
              <th scope="row">平均风速倍数法</th>
              <td>
                <strong>
                  {(result.mean_speed_used ?? result.mean_speed).toFixed(
                    result.mean_speed_used === undefined ? 6 : 2,
                  )}{" "}
                  m/s × {result.multiplier}
                </strong>
                <small>
                  {result.mean_speed_used === undefined
                    ? "历史结果使用原始均值"
                    : "平均风速保留两位小数后乘倍数"}
                </small>
              </td>
              <td>{result.site_speed.toFixed(2)}</td>
              <td>{result.multiplier_standard.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="ww-inline-note">
        {result.adopted === null && "待补齐风压法结果后取两种方法的较大值。"}
        风压法的场址值由参考风速按场址密度反算，沿用站点基准高度。标准空气密度取
        1.225 kg/m³。
      </p>
    </>
  );
}
