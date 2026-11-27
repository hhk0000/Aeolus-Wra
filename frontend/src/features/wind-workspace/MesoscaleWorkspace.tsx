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
  year_selection_enabled?: boolean;
  year_coverage?: {
    year: number;
    valid_count: number;
    expected_count: number;
  }[];
  interval_minutes?: number;
  missing_speed_count?: number;
  missing_direction_count?: number | null;
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
  thunderstorm?: boolean;
  thunderstormSource?: Source;
  thunderstormYear?: number;
  thunderstormC1?: string;
  thunderstormC2?: string;
  multiplier: string;
  density: string;
  hubHeight?: string;
  meanTemperature?: string;
  windShearExponent?: string;
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
    (source?.year_selection_enabled === false
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
    wind_shear?: {
      source_height_m: number;
      hub_height_m: number;
      source_mean_speed: number;
      exponent: number;
    };
    density: number;
    multiplier: number;
    site_speed: number;
    multiplier_standard: number;
    pressure_standard: number | null;
    pressure_site?: number | null;
    adopted: number | null;
    adopted_method?: string | null;
    wind_speed_class?: string | null;
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
  const canSelectYear = source?.year_selection_enabled ?? windowYears >= 10;
  const selectedAnalysisYear =
    canSelectYear &&
    state.analysisYear !== undefined &&
    state.analysisYear >= (source?.start_year ?? Infinity) &&
    state.analysisYear <= (source?.end_year ?? -Infinity)
      ? state.analysisYear
      : undefined;
  const analysisYear = selectedAnalysisYear ?? source?.year;
  const combinedWindow = !canSelectYear && windowYears > 1;
  const stormSource =
    source?.interval_minutes === 10 ? source : state.thunderstormSource;
  const stormYears =
    stormSource?.year_coverage
      ?.filter(
        ({ valid_count, expected_count }) => valid_count === expected_count,
      )
      .map(({ year }) => year) ??
    (stormSource?.annual ?? []).map(
      (_, index) => (stormSource?.start_year ?? 0) + index,
    );
  const stormYear = combinedWindow ? state.thunderstormYear : analysisYear;
  const c1 = Number(state.thunderstormC1);
  const c2 = Number(state.thunderstormC2);
  const stormReady =
    !!stormSource &&
    stormSource.height === source?.height &&
    stormYear !== undefined &&
    stormYears.includes(stormYear) &&
    Number.isFinite(c1) &&
    c1 > 0 &&
    !!state.thunderstormC2?.trim() &&
    Number.isFinite(c2);
  const analysisStart = combinedWindow ? source?.start_year : analysisYear;
  const analysisEnd = combinedWindow ? source?.end_year : analysisYear;
  const sourceDensity = identifiedDensity(source, analysisYear);
  const density = sourceDensity ?? Number(state.density);
  const hubHeight = state.hubHeight ? Number(state.hubHeight) : undefined;
  const needsDensityAdjustment =
    !!source && hubHeight !== undefined && hubHeight !== source.height;
  const windShearExponent =
    needsDensityAdjustment && state.windShearExponent?.trim()
      ? Number(state.windShearExponent)
      : undefined;
  const sourceTemperature = combinedWindow
    ? (source?.temperature_period ?? undefined)
    : analysisYear === undefined
      ? undefined
      : source?.temperature_by_year?.[analysisYear];
  const manualTemperature = state.meanTemperature
    ? Number(state.meanTemperature)
    : undefined;
  const analysisTemperature = manualTemperature ?? sourceTemperature;
  // Display the same B.3 conversion as the analysis service; requests still carry source density.
  const hubDensityPreview =
    needsDensityAdjustment &&
    analysisTemperature !== undefined &&
    analysisTemperature >= -100 &&
    analysisTemperature <= 100 &&
    density > 0 &&
    density < 3
      ? density *
        Math.exp(
          (-0.034 * (hubHeight - source.height)) / (analysisTemperature + 273),
        )
      : undefined;
  const annualDeviations = source?.mean_speed
    ? (source.annual ?? []).map(
        (speed) => (speed / source.mean_speed! - 1) * 100,
      )
    : [];
  const maxDeviation = Math.max(0.01, ...annualDeviations.map(Math.abs));
  const needsSourceRefresh =
    !!sourceId &&
    (source?.density_by_year === undefined ||
      source.temperature_by_year === undefined ||
      source.window_years === undefined ||
      source.interval_minutes === undefined ||
      source.missing_speed_count === undefined ||
      source.year_coverage === undefined);

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
      void api<{
        station: PressureStation | null;
        candidate_provinces: string[];
      }>(
        "/reports/assessment/pressure-match?place=" + encodeURIComponent(place),
        undefined,
        controller.signal,
      )
        .then(({ station, candidate_provinces }) => {
          if (!controller.signal.aborted) {
            setPressureLookup({
              place,
              station,
              error: candidate_provinces?.length
                ? `地点存在重名，请补充省份（${candidate_provinces.join("、")}）。`
                : undefined,
            });
          }
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
          const keepManualYear =
            fresh.year_selection_enabled &&
            current.analysisYear !== undefined &&
            current.analysisYear >= (fresh.start_year ?? Infinity) &&
            current.analysisYear <= (fresh.end_year ?? -Infinity);
          const manualYear = keepManualYear ? current.analysisYear : undefined;
          const nextYear = manualYear ?? fresh.year;
          const automatic = identifiedDensity(fresh, nextYear);
          return {
            ...current,
            source: fresh,
            analysisYear: manualYear,
            runId:
              previousYear !== nextYear ||
              current.source?.start_year !== fresh.start_year ||
              current.source?.end_year !== fresh.end_year ||
              current.source?.year_selection_enabled !==
                fresh.year_selection_enabled ||
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
              wind_shear_exponent: windShearExponent,
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
    windShearExponent,
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
        analysisTemperature <= 100 &&
        Number.isFinite(windShearExponent))) &&
    Number.isFinite(multiplier) &&
    multiplier > 0 &&
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
      meanTemperature: undefined,
      manualLocation: false,
      lat: "",
      lon: "",
      alt: "",
    });
  }

  async function upload(
    file: File | undefined,
    kind: "source" | "energy" | "thunderstorm",
  ) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      if (kind === "energy") {
        change({ energy: await api("/reports/assessment/files/energy", form) });
      } else if (kind === "thunderstorm") {
        const next = await api<Source>(
          "/reports/assessment/files/thunderstorm",
          form,
        );
        change({
          thunderstormSource: next,
          thunderstormYear: undefined,
          runId: undefined,
        });
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
    thunderstorm: state.thunderstorm
      ? {
          source_id:
            source?.interval_minutes === 10 ? undefined : stormSource?.id,
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
        wind_shear_exponent: windShearExponent,
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
    if (!templateUrl || !source || !state.runId || busy || !canExport) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("source_id", source.id);
      form.set("run_id", state.runId);
      form.set("density", String(density));
      if (hubHeight !== undefined) form.set("hub_height_m", String(hubHeight));
      if (windShearExponent !== undefined) {
        form.set("wind_shear_exponent", String(windShearExponent));
      }
      if (needsDensityAdjustment && manualTemperature !== undefined) {
        form.set("mean_temperature_c", String(manualTemperature));
      }
      if (selectedAnalysisYear !== undefined) {
        form.set("analysis_year", String(selectedAnalysisYear));
      }
      form.set("factor", state.factor || "75");
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
        <div className="ww-assessment-period-controls">
          {canSelectYear && (
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
          {tab === 1 && source && !automaticLocation && (
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
        </div>
        <p className="ww-inline-note" role="status">
          分析时段 {analysisStart}-01-01 00:00 至 {analysisEnd + 1}-01-01
          00:00（不含终点） · {source.height} m ·{" "}
          {source.interval_minutes === 10 ? "10 min" : "1 h"}
        </p>
        {tab === 1 && (automaticLocation || state.manualLocation) && (
          <div className="ww-fields ww-fields-three">
            <label>
              纬度（°）
              <input
                type="number"
                step="any"
                min="-90"
                max="90"
                readOnly={automaticLocation}
                value={automaticLocation ? source!.coordinates.lat : state.lat}
                onChange={(event) => change({ lat: event.target.value })}
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
                value={automaticLocation ? source!.coordinates.lon : state.lon}
                onChange={(event) => change({ lon: event.target.value })}
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
                onChange={(event) => change({ alt: event.target.value })}
              />
            </label>
          </div>
        )}
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
                  中尺度数据（10 分钟或逐小时 TXT）
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
                <label className="field">
                  项目地点（用于匹配风压）
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
                {busy && <p role="status">正在读取资料…</p>}
                {source && (
                  <div className="ww-assessment-file">
                    <div>
                      <strong>{source.name}</strong>
                      <p>
                        {source.height} m ·{" "}
                        {source.interval_minutes === 10 ? "10 min" : "1 h"} ·{" "}
                        {source.first.slice(0, 10)} 至{" "}
                        {source.last.slice(0, 10)}
                      </p>
                      {Boolean(
                        source.missing_speed_count ||
                        source.missing_direction_count,
                      ) && (
                        <p className="ww-inline-note">
                          缺测记录 · 风速 {source.missing_speed_count ?? 0} 条 ·
                          风向 {source.missing_direction_count ?? 0} 条
                        </p>
                      )}
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
                {source?.year_coverage && (
                  <details>
                    <summary>自然年有效风速覆盖率</summary>
                    <p className="ww-inline-note">
                      覆盖率达到 95%
                      的自然年可用于风资源分析。五日雷暴法须有完整的 10
                      分钟资料。
                    </p>
                    <div className="ww-table-scroll">
                      <table className="ww-result-table">
                        <thead>
                          <tr>
                            <th>自然年</th>
                            <th>有效条数 / 应有条数</th>
                            <th>覆盖率</th>
                            <th>是否纳入基准资料期</th>
                          </tr>
                        </thead>
                        <tbody>
                          {source.year_coverage.map(
                            ({ year, valid_count, expected_count }) => (
                              <tr key={year}>
                                <td>{year}</td>
                                <td>
                                  {valid_count.toLocaleString("zh-CN")} /{" "}
                                  {expected_count.toLocaleString("zh-CN")}
                                </td>
                                <td>
                                  {(
                                    (100 * valid_count) /
                                    expected_count
                                  ).toFixed(2)}
                                  %
                                </td>
                                <td>
                                  {valid_count * 100 < expected_count * 95
                                    ? "未达 95%"
                                    : year >= (source.start_year ?? Infinity) &&
                                        year <= (source.end_year ?? -Infinity)
                                      ? "已纳入"
                                      : "在基准期外"}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </details>
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
                {period || <p>请先上传覆盖至少一个完整自然年的中尺度资料。</p>}
                {source?.year && (
                  <p className="ww-inline-note">
                    {source.start_year}–{source.end_year} 年 · 共 {windowYears}{" "}
                    年资料
                    {!canSelectYear
                      ? windowYears === 1
                        ? " · 直接分析该年"
                        : " · 合并资料期内全部达标自然年统计"
                      : ` · 选定 ${analysisYear} 年 · 偏差 ${deviation?.toFixed(2)}% · ${
                          selectedAnalysisYear !== undefined
                            ? "手动选择"
                            : Math.abs(deviation ?? 0) > 2
                              ? "无平风年，采用最小偏差年"
                              : "平风年中偏差最小"
                        }`}
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
                        {needsDensityAdjustment
                          ? "源风速层空气密度（kg/m³）"
                          : "轮毂高度处空气密度（kg/m³）"}
                        <input
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
                        <small
                          id="assessment-density-note"
                          className="ww-inline-note"
                        >
                          {sourceDensity !== undefined
                            ? "从源文件自动识别"
                            : needsDensityAdjustment
                              ? "用于源层统计和轮毂密度换算"
                              : "请填写轮毂高度处空气密度"}
                        </small>
                      </label>
                      <label>
                        轮毂高度（m）
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          value={state.hubHeight || source?.height || ""}
                          onChange={(event) => {
                            setResult(undefined);
                            change({
                              hubHeight: event.target.value,
                              runId: undefined,
                            });
                          }}
                        />
                        <small className="ww-inline-note">
                          {needsDensityAdjustment
                            ? `源风速层为 ${source?.height} m，按式（B3）折算密度。`
                            : source
                              ? "默认填入导入数据识别的最高风速层，可手动修改。"
                              : "导入数据后自动填入识别高度。"}
                        </small>
                      </label>
                      {needsDensityAdjustment && (
                        <label>
                          轮毂高度处空气密度（kg/m³）
                          <input
                            readOnly
                            value={hubDensityPreview?.toFixed(3) ?? ""}
                            placeholder="填写源层密度和同期气温后自动折算"
                          />
                        </label>
                      )}
                      {needsDensityAdjustment && (
                        <label>
                          风切变指数
                          <input
                            type="number"
                            step="any"
                            required
                            value={state.windShearExponent ?? ""}
                            onChange={(event) => {
                              setResult(undefined);
                              change({
                                windShearExponent: event.target.value,
                                runId: undefined,
                              });
                            }}
                          />
                          <small className="ww-inline-note">
                            用于把极值计算所用风速换算到轮毂高度。
                          </small>
                        </label>
                      )}
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
                          <small className="ww-inline-note">
                            {sourceTemperature === undefined
                              ? "未识别到同期气温，填写后可计算轮毂空气密度。"
                              : "留空使用源文件统计值，也可手动覆盖。"}
                          </small>
                        </label>
                      )}
                      <label>
                        综合折减系数（%）
                        <input
                          placeholder="75"
                          type="number"
                          step="any"
                          min="0.01"
                          max="100"
                          value={state.factor}
                          onChange={(event) =>
                            change({ factor: event.target.value })
                          }
                        />
                        <small className="ww-inline-note">
                          手动填写，留空按 75% 计算。
                        </small>
                      </label>
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
                        <small className="ww-inline-note">
                          默认 5，可按项目依据调整。
                        </small>
                      </label>
                      <div>
                        <label>
                          50 年基本风压（kN/m²）
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
                              "当前采用手填值 · "}
                            {pressureNote}
                          </small>
                        </label>
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
                            恢复自动值
                          </button>
                        )}
                      </div>
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
                    <fieldset className="ww-report-controls">
                      <legend>50 年一遇最大风速</legend>
                      <p className="ww-inline-note">
                        采用风压法和平均风速倍数法。
                      </p>
                      <label>
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
                        使用五日雷暴法
                      </label>
                      {state.thunderstorm && (
                        <div className="ww-fields ww-fields-two">
                          {source?.interval_minutes !== 10 && (
                            <label className="ww-wide">
                              10 分钟实测风速 TXT
                              <input
                                type="file"
                                accept=".txt"
                                onChange={(event) =>
                                  void upload(
                                    event.target.files?.[0],
                                    "thunderstorm",
                                  )
                                }
                              />
                              <small className="ww-inline-note">
                                {stormSource?.name ??
                                  "请上传分析高度一致的完整自然年资料。"}
                                {stormSource &&
                                  stormSource.height !== source?.height &&
                                  " · 风速层高度与分析高度不一致"}
                              </small>
                            </label>
                          )}
                          {combinedWindow ? (
                            <label className="ww-wide">
                              五日雷暴法分析年
                              <select
                                value={state.thunderstormYear ?? ""}
                                onChange={(event) =>
                                  change({
                                    thunderstormYear: event.target.value
                                      ? Number(event.target.value)
                                      : undefined,
                                    runId: undefined,
                                  })
                                }
                              >
                                <option value="">请选择完整自然年</option>
                                {stormYears.map((year) => (
                                  <option key={year} value={year}>
                                    {year} 年
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            <p className="ww-wide ww-inline-note">
                              随分析年取 {analysisYear ?? "—"} 年。
                              {stormSource &&
                                stormYear !== undefined &&
                                !stormYears.includes(stormYear) &&
                                " 已选资料未覆盖该自然年。"}
                            </p>
                          )}
                          <label>
                            系数 C₁
                            <input
                              type="number"
                              step="any"
                              value={state.thunderstormC1 ?? ""}
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
                              value={state.thunderstormC2 ?? ""}
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
                    </fieldset>
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
                      {source.start_year}–{source.end_year} 年均值（
                      {windowYears} 年资料） {source.mean_speed?.toFixed(3)}{" "}
                      m/s。
                      {!canSelectYear
                        ? "按达标资料期计算。"
                        : `推荐分析年为 ${source.year} 年。`}
                    </p>
                    <div className="ww-table-scroll">
                      <table className="ww-result-table ww-assessment-year-table">
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
                            const current =
                              !combinedWindow && year === analysisYear;
                            const offset = annualDeviations[index] ?? 0;
                            return (
                              <tr
                                key={year}
                                className={
                                  current ? "is-analysis-year" : undefined
                                }
                              >
                                <th scope="row">
                                  {year}
                                  {current ? "（当前分析年）" : ""}
                                  {canSelectYear &&
                                  year === source.year &&
                                  year !== analysisYear
                                    ? "（推荐）"
                                    : ""}
                                </th>
                                <td>{value.toFixed(3)}</td>
                                <td>
                                  <span className="ww-assessment-deviation">
                                    <span>
                                      {offset > 0 ? "+" : ""}
                                      {offset.toFixed(2)}%
                                    </span>
                                    <span
                                      className="ww-year-track"
                                      aria-hidden="true"
                                    >
                                      <span
                                        className={`ww-year-bar ${offset < 0 ? "lower" : "higher"}${offset !== 0 && Math.abs(offset) <= 2 ? " typical" : ""}`}
                                      >
                                        <i
                                          style={{
                                            width: `${(100 * Math.abs(offset)) / maxDeviation}%`,
                                          }}
                                        />
                                      </span>
                                    </span>
                                  </span>
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
          <strong>结果数据</strong>
          {result && (
            <span>
              {result.analysis_start_year !== undefined &&
              result.analysis_end_year !== undefined &&
              result.analysis_start_year !== result.analysis_end_year
                ? `${result.analysis_start_year}–${result.analysis_end_year}`
                : result.year}{" "}
              年 · {result.height} m
              {result.density_adjustment &&
                `风速层 · 轮毂 ${result.density_adjustment.hub_height_m} m · 密度 ${result.density_adjustment.hub_density.toFixed(6)} kg/m³`}
              {result.window_years
                ? ` · 基准资料 ${result.window_years} 年`
                : ""}
              {result.interval_minutes
                ? ` · ${result.interval_minutes === 10 ? "10 min" : "1 h"}`
                : ""}
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
                  风功率密度等级{" "}
                  {result.power_density_grade.grade
                    ? `${result.power_density_grade.grade} 级`
                    : "待复核"}
                </p>
              )}
            {resultError ? (
              <p role="alert">{resultError}</p>
            ) : !state.runId ? (
              <p>完成风资源分析后查看结果。</p>
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
                    <p className="ww-inline-note">
                      {result.interval_minutes === 10 ? "10 min" : "1 h"} 原序列
                      · 正风速拟合样本{" "}
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
          {source.name} ·{" "}
          {analysisStart === analysisEnd
            ? analysisStart
            : `${analysisStart}–${analysisEnd}`}{" "}
          年 · {source.height} m · 基准资料 {windowYears} 年
        </p>
      )}
      {!state.runId && <p>请在分析配置上传资料、填写空气密度并运行分析。</p>}
      {state.runId && !canExport && (
        <p>请在分析配置中填写 50 年基本风压后再导出。</p>
      )}
      <div className="ww-report-actions">
        <button
          className="ww-button primary"
          type="button"
          disabled={!templateUrl || !state.runId || busy || !canExport}
          onClick={() => void download()}
        >
          {busy ? "正在生成报告…" : "导出报告"}
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
        <span>场址空气密度 {result.density} kg/m³</span>
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
                  {(result.mean_speed_used ?? result.mean_speed).toFixed(
                    result.mean_speed_used === undefined ? 6 : 2,
                  )}{" "}
                  m/s × {result.multiplier}
                </strong>
                <small>
                  {result.wind_shear
                    ? `以 ${result.wind_shear.source_height_m} m 风速为基准，按风切变指数 ${result.wind_shear.exponent} 换算至 ${result.wind_shear.hub_height_m} m，均值保留两位小数后乘倍数`
                    : result.mean_speed_used === undefined
                      ? "历史结果使用原始均值"
                      : "平均风速保留两位小数后乘倍数"}
                </small>
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
      <p className="ww-inline-note">
        {result.adopted === null
          ? "待补齐风压法结果后进行比选。"
          : result.adopted_method &&
            `场址风速最大值来自${result.adopted_method}，折算后作为前期采用值。`}
        {result.adopted !== null &&
          (result.wind_speed_class
            ? `按参考风速初判为 IEC ${result.wind_speed_class} 类及以上。`
            : "超过 I 类参考风速，须由设计者按 S 类确定参数。")}
        风压法的场址值由参考风速按场址密度反算，沿用站点基准高度。标准空气密度取
        1.225 kg/m³。
      </p>
    </>
  );
}
