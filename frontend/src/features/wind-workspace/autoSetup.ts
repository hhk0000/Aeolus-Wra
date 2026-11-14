import { useEffect, useRef } from "react";
import { api, means } from "./api";
import type { Channel, Dataset } from "./api";
import { createWorkspace, suggestHeaderMetadata } from "./model";
import type { SourceFile, Tower, WorkspaceState } from "./model";

export const DEFAULT_TIMEZONE = "Etc/GMT-8";
/** Scroll a validation message into view (and focus it) whenever it appears. */
export function useErrorFocus<T extends HTMLElement>(message: string) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!message) return;
    const node = ref.current;
    if (!node) return;
    const id = window.requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.focus?.({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [message]);
  return ref;
}
export function localInput(value: string, timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function dateTimeInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00` : value;
}
export function nextAnniversary(value: string) {
  const stamp = new Date(dateTimeInput(value) + "Z");
  const year = stamp.getUTCFullYear() + 1,
    month = stamp.getUTCMonth();
  const day = Math.min(
    stamp.getUTCDate(),
    new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
  );
  stamp.setUTCDate(1);
  stamp.setUTCFullYear(year);
  stamp.setUTCMonth(month);
  stamp.setUTCDate(day);
  return stamp.toISOString().slice(0, 16);
}

export async function autoParseSource(
  source: SourceFile,
  timezone: string,
): Promise<SourceFile> {
  const server = source.server!;
  const detected = server.detected;
  const channels = server.suggestions.filter(
    (m) =>
      m.quantity && m.statistic && m.height !== null && m.unit && !m.ambiguous,
  );
  if (!channels.length)
    throw new Error("未识别到可用通道，请展开导入设置补充字段映射。");
  if (!detected?.interval_minutes)
    throw new Error("数据步长未识别，请展开导入设置补充。");
  const dataset = await api<Dataset>(`/files/${server.id}/parse`, {
    header_line: server.header_line,
    data_line: server.data_line,
    delimiter: server.delimiter,
    timestamp_column: detected.timestamp_column,
    time_column: detected.time_column,
    timezone: detected.timezone || timezone || DEFAULT_TIMEZONE,
    interval_minutes: detected.interval_minutes,
    timestamp_position: detected.timestamp_position,
    channels: channels.map(
      ({ index, quantity, statistic, height, unit, arm }) => ({
        index,
        quantity,
        statistic,
        height,
        unit,
        arm,
      }),
    ),
  });
  const unrecognized = server.suggestions.filter(
    (m) =>
      m.index !== detected.timestamp_column &&
      m.index !== detected.time_column &&
      (!m.quantity || m.ambiguous) &&
      !/gust/i.test(server.headers[m.index]),
  );
  const notes = [...(detected.warnings ?? [])];
  if (unrecognized.length)
    notes.push(`${unrecognized.length}列未自动导入，可展开导入设置查看。`);
  return { ...source, dataset, warning: notes.join(" ") };
}

function highest(channels: Channel[]) {
  return [...channels].sort(
    (a, b) => b.height - a.height || b.valid_count - a.valid_count,
  )[0];
}
function heights(data: Dataset, quantity: string) {
  return [...new Set(means(data, quantity).map((c) => c.height))]
    .sort((a, b) => b - a)
    .join(", ");
}
function shearLayers(data: Dataset) {
  const groups = new Map<string, Channel[]>();
  for (const c of means(data)) {
    if (!c.arm.trim()) continue;
    const arm = c.arm.trim().toUpperCase();
    groups.set(arm, [...(groups.get(arm) ?? []), c]);
  }
  const selected =
    [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  return selected
    .filter((c) => selected.filter((s) => s.height === c.height).length === 1)
    .sort((a, b) => a.height - b.height)
    .map((c) => c.id);
}

/** Fill new defaults while preserving values the user changed after detection. */
export function applySourceDefaults(
  state: WorkspaceState,
  source: SourceFile,
  selectNew = true,
): WorkspaceState {
  const data = source.dataset;
  if (!data) return state;
  if (source.kind === "reference") {
    if (
      !selectNew &&
      state.longTerm.fileId &&
      state.longTerm.fileId !== source.id
    )
      return state;
    const speed = highest(means(data));
    const direction = highest(means(data, "direction"));
    return {
      ...state,
      longTerm: {
        ...state.longTerm,
        fileId: source.id,
        height:
          !selectNew && state.longTerm.height
            ? state.longTerm.height
            : speed
              ? String(speed.height)
              : "",
        timezone: data.options.timezone,
        directionChannel:
          !selectNew && state.longTerm.directionChannel
            ? state.longTerm.directionChannel
            : (direction?.id ?? ""),
      },
    };
  }
  const index = state.towers.findIndex((t) => t.id === source.towerId);
  if (index < 0) return state;
  const tower = { ...state.towers[index] };
  const previous = { ...state.autoValues?.[tower.id] };
  function fill(key: keyof Tower, value: string) {
    if (!value) return;
    if (
      !tower[key] ||
      tower[key] === previous[key] ||
      (key === "name" && /^测风塔\s*\d+$/.test(tower.name))
    )
      tower[key] = value;
    previous[key] = value;
  }
  const rawPresent = state.files.some(
    (f) => f.kind === "raw" && f.towerId === tower.id && f.dataset,
  );
  if (source.kind === "raw" || !rawPresent) {
    const header = suggestHeaderMetadata(source.preview);
    const coord = (name: string, positive: string, negative: string) => {
      const m = source.preview.match(
        new RegExp(
          `^${name}\\s*[:：=]\\s*([${positive}${negative}])?\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*(?:°|([${positive}${negative}]))?\\s*$`,
          "im",
        ),
      );
      return m
        ? String(
            m[1]?.toUpperCase() === negative || m[3]?.toUpperCase() === negative
              ? -Math.abs(Number(m[2]))
              : Number(m[2]),
          )
        : "";
    };
    fill(
      "latitude",
      coord("(?:Latitude|纬度)", "N", "S") || header.latitude || "",
    );
    fill(
      "longitude",
      coord("(?:Longitude|经度)", "E", "W") || header.longitude || "",
    );
    fill("altitude", header.altitude || "");
    fill(
      "name",
      header.name || source.file.name.match(/-(\d{6})_/u)?.[1] || "",
    );
    for (const [key, quantity] of [
      ["speedHeights", "speed"],
      ["directionHeights", "direction"],
      ["temperatureHeights", "temperature"],
      ["pressureHeights", "pressure"],
    ] as const)
      fill(key, heights(data, quantity));
    fill("timezone", data.options.timezone);
    fill("intervalMinutes", String(data.options.interval_minutes));
  }
  if (source.kind === "raw") {
    fill("observedStart", localInput(data.start, data.options.timezone));
    fill("observedEnd", localInput(data.end_exclusive, data.options.timezone));
  }
  if (source.kind === "result") {
    fill("analysisStart", localInput(data.start, data.options.timezone));
    fill("analysisEnd", localInput(data.end_exclusive, data.options.timezone));
    const top = highest(means(data));
    if (top) fill("hubHeight", String(top.height));
    fill("timezone", data.options.timezone);
  }
  const analysis = { ...state.analysis };
  const key =
    source.kind === "raw"
      ? "rawFileId"
      : source.kind === "qc"
        ? "qcFileId"
        : "resultFileId";
  const selectedFile = state.files.find(
    (f) =>
      f.id === analysis[key] &&
      f.kind === source.kind &&
      f.towerId === tower.id,
  );
  const reset = selectNew || !selectedFile;
  if (
    tower.id === state.activeTowerId &&
    (reset || analysis[key] === source.id)
  ) {
    analysis[key] = source.id;
    if (source.kind === "qc") {
      const temperature = highest(means(data, "temperature")),
        pressure = highest(means(data, "pressure"));
      if (reset || !analysis.temperatureChannel)
        analysis.temperatureChannel = temperature?.id ?? "";
      if (reset || !analysis.pressureChannel)
        analysis.pressureChannel = pressure?.id ?? "";
      if (reset || !analysis.shearChannels.length)
        analysis.shearChannels = shearLayers(data);
      if (analysis.densityMethod !== "manual" && (reset || !pressure))
        analysis.densityMethod = pressure
          ? "measured"
          : temperature && tower.altitude
            ? "altitude"
            : "measured";
      if ((reset || !analysis.altitude) && tower.altitude && temperature)
        analysis.altitude = String(Number(tower.altitude) + temperature.height);
    }
    if (source.kind === "result" && (reset || !analysis.directionChannel))
      analysis.directionChannel = highest(means(data, "direction"))?.id ?? "";
  }
  return {
    ...state,
    towers: state.towers.map((t, i) => (i === index ? tower : t)),
    analysis,
    autoValues: { ...state.autoValues, [tower.id]: previous },
    planSaved: false,
  };
}
export function initializeDefaults(state: WorkspaceState) {
  const next = state.files
    .filter((f) => f.dataset)
    .reduce(
      (current, file) => applySourceDefaults(current, file, false),
      state,
    );
  return {
    ...next,
    planSaved:
      JSON.stringify(next.analysis) === JSON.stringify(state.analysis) &&
      JSON.stringify(next.towers) === JSON.stringify(state.towers)
        ? state.planSaved
        : false,
  };
}
export function activateTower(
  state: WorkspaceState,
  id: string,
): WorkspaceState {
  if (id === state.activeTowerId) return state;
  const saved = {
    ...state.analysisByTower,
    [state.activeTowerId]: state.analysis,
  };
  return initializeDefaults({
    ...state,
    activeTowerId: id,
    analysisByTower: saved,
    analysis: saved[id] ?? createWorkspace().analysis,
  });
}
/** Clear analysis references (and dependent channel picks) when a source file is removed. */
export function forgetFile(
  state: WorkspaceState,
  fileId: string,
): WorkspaceState {
  const analysis = { ...state.analysis };
  if (analysis.rawFileId === fileId) analysis.rawFileId = "";
  if (analysis.qcFileId === fileId) {
    analysis.qcFileId = "";
    analysis.temperatureChannel = "";
    analysis.pressureChannel = "";
    analysis.shearChannels = [];
  }
  if (analysis.resultFileId === fileId) {
    analysis.resultFileId = "";
    analysis.directionChannel = "";
  }
  const longTerm =
    state.longTerm.fileId === fileId
      ? { ...state.longTerm, fileId: "", directionChannel: "" }
      : state.longTerm;
  return { ...state, analysis, longTerm, planSaved: false };
}
