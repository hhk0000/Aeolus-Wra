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

type ReductionItem = {
  key: string;
  label: string;
  value: string;
};

const DEFAULT_REDUCTIONS: ReductionItem[] = [
  { key: "air_density", label: "空气密度修正", value: "100" },
  { key: "outage", label: "受外界影响的停机", value: "95.89" },
  { key: "availability", label: "风机利用率", value: "96" },
  { key: "power_curve", label: "功率曲线修正", value: "96" },
  { key: "blade", label: "叶片污染影响", value: "98" },
  { key: "turbulence", label: "控制和湍流强度影响", value: "97" },
  { key: "electrical", label: "风电场内能量损耗", value: "97" },
  { key: "wake", label: "尾流折减修正", value: "100" },
  { key: "other", label: "其他影响因素", value: "95" },
  { key: "uncertainty", label: "风资源不确定性", value: "97" },
];

type Assessment = {
  source?: Source;
  energy?: { id: string; name: string };
  pressure?: { id: string; name: string };
  pressureStation?: number;
  place?: string;
  pressureOverride?: string;
  thunderstorm?: boolean;
  thunderstormYear?: number;
  thunderstormC1?: string;
  thunderstormC2?: string;
  multiplier: string;
  density: string;
  windShear?: string;
  hubHeight?: string;
  meanTemperature?: string;
  factor: string;
  reductions?: Record<string, string>;
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
  combined: boolean,
) {
  return (
    (combined
      ? source?.density_period
      : year === undefined
        ? undefined
        : source?.density_by_year?.[year]) ??
    source?.density_period ??
    source?.density_constant ??
    undefined
  );
}

function isothermalHubDensity(
  sourceDensity: number,
  deltaH: number,
  temperatureC: number,
) {
  if (!Number.isFinite(sourceDensity) || sourceDensity <= 0) return undefined;
  if (deltaH === 0) return sourceDensity;
  const tK = temperatureC + 273.15;
  if (tK <= 0) return undefined;
  return sourceDensity * Math.exp((-9.80665 * deltaH) / (287.05 * tK));
}

function computeCombinedReduction(reductions: Record<string, string> | undefined) {
  let product = 1;
  for (const item of DEFAULT_REDUCTIONS) {
    const raw = reductions?.[item.key] ?? item.value;
    const val = Number(raw);
    if (!Number.isFinite(val) || val <= 0 || val > 100) return undefined;
    product *= val / 100;
  }
  return product * 100;
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
    adopted_method?: string | null;
    thunderstorm?: {
      year: number;
      height: number;
      sample_size: number;
      site_speed: number;
      standard_speed: number;
    } | null;
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
  windShear: "",
  multiplier: "5",
  factor: "75.00",
  thunderstorm: false,
  thunderstormC1: "1.189",
  thunderstormC2: "0.556",
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
      ? "正在匹配风压…"
      : (pressureLookup.error ??
        (pressureStation?.level
          ? `${pressureLevels[pressureStation.level]} · ${pressureStation.province ?? ""}${pressureStation.name} · ${pressureStation.pressure} kN/m²`
          : "未匹配到风压，可手动填写基本风压"))
    : legacyPressureStation
      ? `${legacyPressureStation.name} · ${legacyPressureStation.pressure} kN/m²`
      : "填写省市区县自动匹配";
  const pressureOverride =
    state.pressureOverride === undefined || state.pressureOverride.trim() === ""
      ? undefined
      : Number(state.pressureOverride);
  const multiplier = Number(state.multiplier);
  const windowYears = source?.window_years ?? source?.annual?.length ?? 0;
  const combinedWindow = windowYears > 1 && windowYears < 10;
  const selectedAnalysisYear = combinedWindow ? undefined : state.analysisYear;
  const analysisYear = selectedAnalysisYear ?? source?.year;
  const analysisYears = source?.start_year
    ? (source.annual ?? []).map((_, index) => source.start_year! + index)
    : [];
  const stormYear = combinedWindow
    ? (state.thunderstormYear ?? analysisYears[analysisYears.length - 1])
    : analysisYear;
  const c1 = Number(state.thunderstormC1);
  const c2 = Number(state.thunderstormC2);
  const stormReady =
    !!source &&
    stormYear !== undefined &&
    analysisYears.includes(stormYear) &&
    Number.isFinite(c1) &&
    c1 > 0 &&
    !!state.thunderstormC2?.trim() &&
    Number.isFinite(c2);
  const analysisStart = combinedWindow ? source?.start_year : analysisYear;
  const analysisEnd = combinedWindow ? source?.end_year : analysisYear;

  const autoDensity = identifiedDensity(source, analysisYear, combinedWindow);
  const densityText =
    state.density !== ""
      ? state.density
      : autoDensity !== undefined
        ? autoDensity.toFixed(3)
        : "";
  const density = Number(densityText);

  const hubHeightText =
    state.hubHeight !== undefined && state.hubHeight !== ""
      ? state.hubHeight
      : source
        ? String(source.height)
        : "";
  const hubHeight = hubHeightText ? Number(hubHeightText) : undefined;
  const needsExtrapolation =
    !!source &&
    hubHeight !== undefined &&
    Number.isFinite(hubHeight) &&
    hubHeight !== source.height;

  const windShearText = state.windShear ?? "";
  const windShear =
    windShearText.trim() !== "" ? Number(windShearText) : undefined;

  const sourceTemperature = combinedWindow
    ? (source?.temperature_period ?? undefined)
    : analysisYear === undefined
      ? undefined
      : source?.temperature_by_year?.[analysisYear];
  const effectiveTemperature = sourceTemperature ?? 15.0;
  const hubDensityPreview =
    source && hubHeight !== undefined && Number.isFinite(hubHeight)
      ? isothermalHubDensity(
          density,
          hubHeight - source.height,
          effectiveTemperature,
        )
      : undefined;

  const combinedFactorNum = computeCombinedReduction(state.reductions);
  const combinedFactorText =
    combinedFactorNum !== undefined
      ? combinedFactorNum.toFixed(2)
      : state.factor;

  const latText =
    state.lat !== ""
      ? state.lat
      : source?.coordinates.lat !== undefined
        ? String(source.coordinates.lat)
        : "";
  const lonText =
    state.lon !== ""
      ? state.lon
      : source?.coordinates.lon !== undefined
        ? String(source.coordinates.lon)
        : "";

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
      // Ignore storage quota errors
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
              error: "无法读取风压库，请手动填写基本风压",
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
        setState((current) =>
          current.source?.id === sourceId
            ? { ...current, source: fresh, runId: undefined }
            : current,
        );
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
    void api<Result>(
      "/reports/assessment/runs/" + runId,
      undefined,
      controller.signal,
    )
      .then((saved) => {
        if (controller.signal.aborted) return;
        setResultError("");
        setResult(saved);
      })
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setResultError(cause.message);
      });
    return () => controller.abort();
  }, [page, state.runId]);

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

  const yearMean =
    analysisYear !== undefined && source?.start_year !== undefined
      ? source.annual?.[analysisYear - source.start_year]
      : undefined;
  const deviation =
    yearMean !== undefined && source?.mean_speed
      ? (yearMean / source.mean_speed - 1) * 100
      : source?.deviation;

  const canRun =
    !!source &&
    analysisYear !== undefined &&
    analysisYears.includes(analysisYear) &&
    Number.isFinite(density) &&
    density > 0 &&
    density < 3 &&
    hubHeight !== undefined &&
    Number.isFinite(hubHeight) &&
    hubHeight > 0 &&
    (!needsExtrapolation ||
      (windShear !== undefined &&
        Number.isFinite(windShear) &&
        windShear >= -1 &&
        windShear <= 2)) &&
    Number.isFinite(multiplier) &&
    multiplier > 0 &&
    combinedFactorNum !== undefined &&
    (!state.thunderstorm || stormReady) &&
    (pressureOverride === undefined ||
      (Number.isFinite(pressureOverride) && pressureOverride > 0));

  const exportPressure = pressureOverride ?? pressureStation?.pressure;
  const canExport = exportPressure !== undefined && exportPressure > 0;
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
      density: "",
      hubHeight: undefined,
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
          hubHeight: String(next.height),
          runId: undefined,
          analysisYear: undefined,
          lat:
            next.coordinates.lat !== undefined
              ? String(next.coordinates.lat)
              : "",
          lon:
            next.coordinates.lon !== undefined
              ? String(next.coordinates.lon)
              : "",
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
    thunderstorm: state.thunderstorm
      ? {
          year: stormYear,
          c1,
          c2,
        }
      : undefined,
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
        mean_temperature_c: needsExtrapolation
          ? effectiveTemperature
          : undefined,
        wind_shear_exponent: windShear,
        analysis_year: selectedAnalysisYear,
        extreme: extremeOptions,
      });
      setResult(undefined);
      setResultError("");
      change({
        runId: run.id,
        factor: combinedFactorText,
        weibullMethod: undefined,
      });
      onNavigate(2);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!templateUrl || !source || !state.runId || busy || !canExport) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("source_id", source.id);
      form.set("density", String(density));
      if (hubHeight !== undefined) form.set("hub_height_m", String(hubHeight));
      if (needsExtrapolation) {
        form.set("mean_temperature_c", String(effectiveTemperature));
      }
      if (windShear !== undefined) form.set("wind_shear_exponent", String(windShear));
      if (selectedAnalysisYear !== undefined) {
        form.set("analysis_year", String(selectedAnalysisYear));
      }
      form.set("factor", combinedFactorText);
      form.set("project", project);
      if (state.weibullMethod && state.weibullMethod !== "mle") {
        form.set("weibull_method", state.weibullMethod);
      }
      form.set("extreme", JSON.stringify(extremeOptions));
      if (state.energy) form.set("energy_id", state.energy.id);
      if (latText.trim()) form.set("lat", latText.trim());
      if (lonText.trim()) form.set("lon", lonText.trim());
      if (state.alt.trim()) form.set("alt", state.alt.trim());
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
            {tab === 0 && (
              <div className="ww-assessment-upload-section">
                <div className="ww-assessment-upload-grid">
                  <div className="ww-upload-card">
                    <label className="field">
                      <strong>测风数据</strong>
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
                    {source && (
                      <div className="ww-upload-card-meta">
                        <div>
                          <span>{source.name}</span>
                          <small>
                            {source.height} m ·{" "}
                            {source.interval_minutes === 10 ? "10 min" : "1 h"}{" "}
                            · {source.first.slice(0, 10)} 至{" "}
                            {source.last.slice(0, 10)}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="ww-button project-delete-confirm"
                          disabled={busy}
                          onClick={() => removeDialog.current?.showModal()}
                        >
                          删除
                        </button>
                      </div>
                    )}
                    {source?.coverage_error && (
                      <p className="ww-error" role="alert">
                        {source.coverage_error}
                      </p>
                    )}
                  </div>

                  <div className="ww-upload-card">
                    <label className="field">
                      <strong>发电量计算表</strong>
                      <input
                        type="file"
                        accept=".xlsx,.csv,.tsv,.txt"
                        disabled={busy}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          void upload(file, "energy");
                        }}
                      />
                    </label>
                    {state.energy && (
                      <div className="ww-upload-card-meta">
                        <div>
                          <span>{state.energy.name}</span>
                        </div>
                        <button
                          type="button"
                          className="ww-button"
                          disabled={busy}
                          onClick={() => change({ energy: undefined })}
                        >
                          移除
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {busy && (
                  <p className="ww-inline-note" role="status">
                    正在读取资料…
                  </p>
                )}

                {source?.year && (
                  <div className="ww-report-actions">
                    <button
                      className="ww-button primary"
                      type="button"
                      onClick={() => setTab(1)}
                    >
                      进入风资源分析
                    </button>
                  </div>
                )}

                {source && (
                  <dialog
                    ref={removeDialog}
                    className="modal ww-concurrent-task-dialog"
                    aria-labelledby="assessment-remove-title"
                  >
                    <h2 id="assessment-remove-title">删除测风数据</h2>
                    <p>
                      从当前工作区移除「{source.name}」，并清空当前分析结果。
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
                )}
              </div>
            )}

            {tab === 1 && (
              <form
                className="ww-assessment-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void analyze();
                }}
              >
                {!source?.year && (
                  <p className="ww-inline-note">
                    请先在「数据资料」上传测风数据。
                  </p>
                )}
                <fieldset disabled={busy} className="ww-assessment-rows">
                  {/* 第 1 行：项目地点 + 中尺度数据经纬度 + 海拔高度 */}
                  <div className="ww-form-row ww-row-4">
                    <label>
                      项目地点（匹配风压）
                      <input
                        type="text"
                        maxLength={120}
                        placeholder="如：河北省 张家口市 怀来县"
                        value={state.place ?? place}
                        onChange={(event) =>
                          change({
                            place: event.target.value,
                            pressureOverride: undefined,
                            runId: undefined,
                          })
                        }
                      />
                      <small className="ww-inline-note">{pressureNote}</small>
                    </label>
                    <label>
                      纬度（°）
                      <input
                        type="number"
                        step="any"
                        min="-90"
                        max="90"
                        placeholder="如 31.35"
                        value={latText}
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
                        placeholder="如 121.90"
                        value={lonText}
                        onChange={(event) =>
                          change({ lon: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      海拔高度（m）
                      <input
                        type="number"
                        step="any"
                        min="-500"
                        max="9000"
                        placeholder="如 15"
                        value={state.alt}
                        onChange={(event) =>
                          change({ alt: event.target.value })
                        }
                      />
                    </label>
                  </div>

                  {/* 第 2 行：分析年 */}
                  <div className="ww-form-row ww-row-2">
                    <label>
                      分析年
                      {combinedWindow ? (
                        <input
                          type="text"
                          readOnly
                          value={
                            analysisStart && analysisEnd
                              ? `${analysisStart}–${analysisEnd} 年（合并完整自然年）`
                              : "—"
                          }
                        />
                      ) : (
                        <select
                          aria-label="分析年"
                          disabled={busy || !source?.year}
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
                          <option value="">
                            {source?.year
                              ? `自动推荐（${source.year} 年）`
                              : "请先上传测风数据"}
                          </option>
                          {analysisYears.map((year) => (
                            <option key={year} value={year}>
                              {year} 年
                            </option>
                          ))}
                        </select>
                      )}
                      {source?.year && (
                        <small className="ww-inline-note">
                          资料期 {source.start_year}–{source.end_year} 年（共{" "}
                          {windowYears} 年）
                          {!combinedWindow &&
                            deviation !== undefined &&
                            ` · 较多年均值偏差 ${deviation.toFixed(2)}%`}
                        </small>
                      )}
                    </label>
                    <div className="ww-row-status-box">
                      <span>50 年基本风压（kN/m²）</span>
                      <div className="ww-inline-input-group">
                        <input
                          type="number"
                          step="any"
                          min="0.01"
                          placeholder="自动匹配或手填"
                          value={
                            state.pressureOverride ??
                            pressureStation?.pressure ??
                            ""
                          }
                          onChange={(event) =>
                            change({
                              pressureOverride: event.target.value,
                              runId: undefined,
                            })
                          }
                        />
                        {state.pressureOverride !== undefined && (
                          <button
                            type="button"
                            className="ww-button"
                            onClick={() =>
                              change({
                                pressureOverride: undefined,
                                runId: undefined,
                              })
                            }
                          >
                            恢复自动
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 第 3 行：风切变 */}
                  <div className="ww-form-row ww-row-1">
                    <label>
                      风切变指数
                      <input
                        type="number"
                        step="any"
                        min="-1"
                        max="2"
                        required={needsExtrapolation}
                        placeholder="如 0.15（轮毂高度与导入高度不同时按风切变公式外推）"
                        value={windShearText}
                        onChange={(event) => {
                          setResult(undefined);
                          change({
                            windShear: event.target.value,
                            runId: undefined,
                          });
                        }}
                      />
                    </label>
                  </div>

                  {/* 第 4 行：中尺度数据空气密度 */}
                  <div className="ww-form-row ww-row-1">
                    <label>
                      中尺度数据空气密度（kg/m³）
                      <input
                        aria-label="空气密度"
                        required
                        type="number"
                        step="any"
                        min="0.001"
                        max="2.999"
                        placeholder="源文件含温压或密度时自动按国标计算填入，也可手填"
                        value={densityText}
                        onChange={(event) => {
                          setResult(undefined);
                          setResultError("");
                          change({
                            density: event.target.value,
                            runId: undefined,
                          });
                        }}
                      />
                      <small className="ww-inline-note">
                        {autoDensity !== undefined && state.density === ""
                          ? `已按中尺度数据自动计算填入（${autoDensity.toFixed(3)} kg/m³）`
                          : source
                            ? `对应导入高度 ${source.height} m`
                            : "请填写中尺度数据空气密度"}
                      </small>
                    </label>
                  </div>

                  {/* 第 5 行：左 轮毂高度，右 轮毂高度处的空气密度 */}
                  <div className="ww-form-row ww-row-2">
                    <label>
                      轮毂高度（m）
                      <input
                        type="number"
                        min="1"
                        step="any"
                        required
                        placeholder={source ? `${source.height}` : "如 125"}
                        value={hubHeightText}
                        onChange={(event) => {
                          setResult(undefined);
                          change({
                            hubHeight: event.target.value,
                            runId: undefined,
                          });
                        }}
                      />
                      <small className="ww-inline-note">
                        {needsExtrapolation
                          ? `导入高度 ${source?.height} m ≠ 轮毂高度，将按风切变推算风速`
                          : "与导入高度一致，直接使用导入风速"}
                      </small>
                    </label>
                    <label>
                      轮毂高度处空气密度（kg/m³）
                      <input
                        type="text"
                        readOnly
                        value={
                          hubDensityPreview !== undefined
                            ? hubDensityPreview.toFixed(3)
                            : "—"
                        }
                      />
                      <small className="ww-inline-note">
                        {needsExtrapolation
                          ? "按等温近似法由中尺度空气密度推算"
                          : "同高不做外推"}
                      </small>
                    </label>
                  </div>

                  {/* 第 6 行：五倍平均风速法计算倍数 + 五日雷暴法可选开关 */}
                  <div className="ww-form-row ww-row-2">
                    <label>
                      五倍平均风速法计算倍数
                      <input
                        required
                        type="number"
                        step="any"
                        min="0.1"
                        value={state.multiplier}
                        onChange={(event) =>
                          change({
                            multiplier: event.target.value,
                            runId: undefined,
                          })
                        }
                      />
                    </label>
                    <div className="ww-thunderstorm-box">
                      <label className="ww-checkbox-inline">
                        <input
                          type="checkbox"
                          checked={state.thunderstorm ?? false}
                          onChange={(event) =>
                            change({
                              thunderstorm: event.target.checked,
                              runId: undefined,
                            })
                          }
                        />
                        <span>启用五日雷暴法（1 h / 10 min 均可计算）</span>
                      </label>
                      {state.thunderstorm && (
                        <div className="ww-thunderstorm-params">
                          {combinedWindow && (
                            <label>
                              计算年
                              <select
                                value={stormYear ?? ""}
                                onChange={(event) =>
                                  change({
                                    thunderstormYear: event.target.value
                                      ? Number(event.target.value)
                                      : undefined,
                                    runId: undefined,
                                  })
                                }
                              >
                                {analysisYears.map((year) => (
                                  <option key={year} value={year}>
                                    {year} 年
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <label>
                            系数 C₁
                            <input
                              type="number"
                              step="any"
                              value={state.thunderstormC1 ?? "1.189"}
                              onChange={(event) =>
                                change({
                                  thunderstormC1: event.target.value,
                                  runId: undefined,
                                })
                              }
                            />
                          </label>
                          <label>
                            系数 C₂
                            <input
                              type="number"
                              step="any"
                              value={state.thunderstormC2 ?? "0.556"}
                              onChange={(event) =>
                                change({
                                  thunderstormC2: event.target.value,
                                  runId: undefined,
                                })
                              }
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 第 7 行：发电量折减系数（折叠表，末行综合折减系数加粗） */}
                  <details className="ww-assessment-collapse">
                    <summary>
                      <span>发电量折减系数</span>
                      <strong>综合折减系数：{combinedFactorText}%</strong>
                    </summary>
                    <div className="ww-reduction-table-wrap">
                      <table className="ww-result-table ww-reduction-table">
                        <thead>
                          <tr>
                            <th>折减项目</th>
                            <th>折减系数（%）</th>
                          </tr>
                        </thead>
                        <tbody>
                          {DEFAULT_REDUCTIONS.map((item) => (
                            <tr key={item.key}>
                              <td>{item.label}</td>
                              <td>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  max="100"
                                  aria-label={item.label}
                                  value={
                                    state.reductions?.[item.key] ?? item.value
                                  }
                                  onChange={(event) => {
                                    const nextReductions = {
                                      ...(state.reductions ?? {}),
                                      [item.key]: event.target.value,
                                    };
                                    const nextFactor =
                                      computeCombinedReduction(nextReductions);
                                    change({
                                      reductions: nextReductions,
                                      factor:
                                        nextFactor !== undefined
                                          ? nextFactor.toFixed(2)
                                          : state.factor,
                                    });
                                  }}
                                />
                              </td>
                            </tr>
                          ))}
                          <tr className="ww-reduction-total">
                            <td>
                              <strong>综合折减系数</strong>
                            </td>
                            <td>
                              <strong>{combinedFactorText}%</strong>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </details>

                  {/* 折叠图表显隐选项，保持页面简洁 */}
                  <details className="ww-assessment-collapse ww-assessment-collapse-subtle">
                    <summary>
                      <span>结果图表显示选项</span>
                      <small>
                        已选 {titles.length - state.hidden.length} /{" "}
                        {titles.length} 项
                      </small>
                    </summary>
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
                  </details>

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
            )}

            {tab === 2 && (
              <div className="ww-assessment-longterm">
                {!source?.year ? (
                  <p className="ww-inline-note">
                    {source?.coverage_error ||
                      "请先在「数据资料」上传测风数据。"}
                  </p>
                ) : (
                  <>
                    <div className="ww-assessment-summary-bar">
                      <span>
                        资料期 {source.start_year}–{source.end_year} 年（
                        {windowYears} 年）
                      </span>
                      <span>
                        多年平均风速 {source.mean_speed?.toFixed(2)} m/s
                      </span>
                      <span>
                        {combinedWindow
                          ? "合并完整自然年分析"
                          : `推荐代表年：${source.year} 年`}
                      </span>
                    </div>
                    <div className="ww-table-scroll">
                      <table className="ww-result-table">
                        <thead>
                          <tr>
                            <th>自然年</th>
                            <th>平均风速（m/s）</th>
                            <th>较多年均值偏差</th>
                          </tr>
                        </thead>
                        <tbody>
                          {source.annual?.map((value, index) => {
                            const year = (source.start_year ?? 0) + index;
                            return (
                              <tr key={year}>
                                <td>
                                  {year}
                                  {!combinedWindow && year === analysisYear
                                    ? "（当前分析年）"
                                    : ""}
                                  {!combinedWindow &&
                                  year === source.year &&
                                  year !== analysisYear
                                    ? "（推荐）"
                                    : ""}
                                </td>
                                <td>{value.toFixed(2)}</td>
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
              </div>
            )}
            {errorNotice}
          </section>
        </div>
      </div>
    );

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
        <div className="ww-gallery-filter ww-assessment-topbar">
          <div className="ww-assessment-topbar-meta">
            <strong>结果数据</strong>
            {result && (
              <span>
                {result.analysis_start_year !== undefined &&
                result.analysis_end_year !== undefined &&
                result.analysis_start_year !== result.analysis_end_year
                  ? `${result.analysis_start_year}–${result.analysis_end_year}`
                  : result.year}{" "}
                年 · 轮毂 {result.hub_height_m ?? result.height} m
                {result.density_adjustment
                  ? ` · 密度 ${result.density_adjustment.hub_density.toFixed(3)} kg/m³`
                  : ""}
                {result.window_years
                  ? ` · 基准资料 ${result.window_years} 年`
                  : ""}
                {result.interval_minutes
                  ? ` · ${result.interval_minutes === 10 ? "10 min" : "1 h"}`
                  : ""}
              </span>
            )}
          </div>
          <div className="ww-assessment-topbar-actions">
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
            <button
              className="ww-button primary"
              type="button"
              onClick={() => onNavigate(3)}
            >
              生成评估报告
            </button>
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
                <h2>{active}</h2>
                {isWeibull &&
                  result?.weibull_charts &&
                  (chart || Object.keys(result.weibull_charts).length > 0) && (
                    <label>
                      拟合算法
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
            {active === "风速和风功率密度月变化图" &&
              result?.power_density_grade && (
                <p className="ww-inline-note">
                  风功率密度等级：
                  <strong>
                    {result.power_density_grade.grade
                      ? `${result.power_density_grade.grade} 级`
                      : "待复核"}
                  </strong>
                </p>
              )}
            {resultError ? (
              <p role="alert">{resultError}</p>
            ) : !state.runId ? (
              <p className="ww-inline-note">完成风资源分析后查看结果。</p>
            ) : !result ? (
              <p role="status">正在读取计算结果…</p>
            ) : !active ? (
              <p className="ww-inline-note">请在分析配置选择要显示的图表。</p>
            ) : active === "五十年极大风速" && result.extreme ? (
              <ExtremeWindResult result={result.extreme} />
            ) : !chart ? (
              <p className="ww-inline-note">当前资料无法生成这张图。</p>
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
                    <p className="ww-inline-note">
                      {result.interval_minutes === 10 ? "10 min" : "1 h"} 序列 ·
                      正风速样本{" "}
                      {chart.fit.positive_count.toLocaleString("zh-CN")} 条 ·
                      零风速比例{" "}
                      {(Number(chart.fit.zero_fraction) * 100).toFixed(2)}%
                    </p>
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
      <div className="ww-assessment-export-header">
        <div>
          <h2>风资源评估报告</h2>
          {template && (
            <p className="ww-inline-note">
              内置模板：{template.title} · v{template.version}
            </p>
          )}
        </div>
        {templateUrl && (
          <a className="ww-button" href={templateUrl + "/source"}>
            下载内置模板
          </a>
        )}
      </div>

      {source?.year && (
        <div className="ww-assessment-export-meta">
          <div>
            <span>测风数据</span>
            <strong>{source.name}</strong>
          </div>
          <div>
            <span>分析期</span>
            <strong>
              {analysisStart === analysisEnd
                ? `${analysisStart} 年`
                : `${analysisStart}–${analysisEnd} 年`}
            </strong>
          </div>
          <div>
            <span>轮毂高度 / 空气密度</span>
            <strong>
              {hubHeight ?? source.height} m ·{" "}
              {hubDensityPreview !== undefined
                ? `${hubDensityPreview.toFixed(3)} kg/m³`
                : "—"}
            </strong>
          </div>
          <div>
            <span>综合折减系数</span>
            <strong>{combinedFactorText}%</strong>
          </div>
        </div>
      )}

      {!state.runId && (
        <p className="ww-inline-note">
          请先在「风资源分析」完成配置并运行分析。
        </p>
      )}
      {state.runId && !canExport && (
        <p className="ww-inline-note">
          请先在「风资源分析」确认 50 年基本风压后再导出。
        </p>
      )}

      <div className="ww-report-actions">
        <button
          className="ww-button primary"
          type="button"
          disabled={!templateUrl || !state.runId || busy || !canExport}
          onClick={() => void download()}
        >
          {busy ? "正在生成报告…" : "生成 Word 评估报告"}
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
        <span>场址空气密度 {result.density.toFixed(3)} kg/m³</span>
      </div>
      <div className="ww-table-scroll ww-assessment-table ww-extreme-table">
        <table className="ww-result-table" aria-label="极大风速估算方法对比">
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
                  {(result.mean_speed_used ?? result.mean_speed).toFixed(2)} m/s
                  × {result.multiplier}
                </strong>
                <small>平均风速保留两位小数后乘倍数</small>
              </td>
              <td>{result.site_speed.toFixed(2)}</td>
              <td>{result.multiplier_standard.toFixed(2)}</td>
            </tr>
            {result.thunderstorm && (
              <tr>
                <th scope="row">五日雷暴法</th>
                <td>
                  {result.thunderstorm.year} 年 · {result.thunderstorm.height} m
                  · {result.thunderstorm.sample_size} 组五日最大风速
                </td>
                <td>{result.thunderstorm.site_speed.toFixed(2)}</td>
                <td>{result.thunderstorm.standard_speed.toFixed(2)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
