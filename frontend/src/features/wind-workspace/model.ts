export type SourceKind = "raw" | "qc" | "result" | "reference";
import type { UploadedFile, Dataset, Run } from "./api";
export type WorkspaceTab =
  "data" | "analysis" | "correlation" | "long-term" | "tools";

export const SOURCE_TYPES: {
  id: SourceKind;
  number: string;
  label: string;
  shortLabel: string;
  description: string;
  outputs: string;
}[] = [
  {
    id: "raw",
    number: "01",
    label: "测风塔原始数据",
    shortLabel: "原始数据",
    description: "保留原始 TXT 文件及文件头信息",
    outputs: "测风塔基本信息 · 原始数据统计表",
  },
  {
    id: "qc",
    number: "02",
    label: "质量控制后数据",
    shortLabel: "质控数据",
    description: "已在外部完成异常标记值删除",
    outputs: "有效数据完整率 · 空气密度 · 湍流 · 切变",
  },
  {
    id: "result",
    number: "03",
    label: "外推与代表年订正结果",
    shortLabel: "结果数据",
    description: "已选分析年、插补、订正并外推至轮毂高度",
    outputs: "风速与风功率密度 · 频率 · Weibull · 玫瑰图",
  },
  {
    id: "reference",
    number: "04",
    label: "中尺度长期参考数据",
    shortLabel: "中尺度数据",
    description: "与结果数据同期，并保留可用的长期序列",
    outputs: "长期年际变化 · 30/20/10 年均值 · 累计风向",
  },
];

export interface Tower {
  intervalMinutes?: string;
  id: string;
  name: string;
  latitude: string;
  longitude: string;
  altitude: string;
  speedHeights: string;
  directionHeights: string;
  temperatureHeights: string;
  pressureHeights: string;
  observedStart: string;
  observedEnd: string;
  analysisStart: string;
  analysisEnd: string;
  hubHeight: string;
  timezone: string;
}

export interface SourceFile {
  id: string;
  kind: SourceKind;
  towerId: string | null;
  file: { name: string; size: number; lastModified: number };
  preview: string;
  encoding: string;
  warning: string;
  server?: UploadedFile;
  dataset?: Dataset;
}

export interface CorrelationDraft {
  mode: "same-tower" | "cross-tower" | "reference";
  leftFileId: string;
  rightFileId: string;
  leftHeights: string;
  rightHeights: string;
  start: string;
  end: string;
  sectors: number;
  directionFileId: string;
  directionHeight: string;
  regression: "with-intercept" | "through-origin";
  aggregation: "hourly" | "native";
  targetChannels: Record<string, string>;
  referenceChannels: Record<string, string>;
}

export interface CorrelationJob extends CorrelationDraft {
  id: string;
  pairs: [number, number][];
  sourceLabels: string[];
  runs?: Run[];
}

export interface WorkspaceState {
  analysisByTower?: Record<string, WorkspaceState["analysis"]>;
  autoValues?: Record<string, Partial<Record<keyof Tower, string>>>;
  activeTab: WorkspaceTab;
  towers: Tower[];
  activeTowerId: string;
  files: SourceFile[];
  selectedOutputs: string[];
  qcPeriod: "all" | "analysis";
  correlation: CorrelationDraft;
  correlationJobs: CorrelationJob[];
  longTerm: {
    fileId: string;
    height: string;
    windows: string;
    directionPeriod: "baseline" | "concurrent";
    timezone: string;
    directionChannel: string;
  };
  planSaved: boolean;
  analysis: {
    rawFileId: string;
    qcFileId: string;
    resultFileId: string;
    densityMethod: string;
    temperatureChannel: string;
    pressureChannel: string;
    manualDensity: string;
    altitude: string;
    shearChannels: string[];
    directionChannel: string;
    aggregation: string;
    sectors: number;
    calmThreshold: string;
  };
  analysisRuns: Record<string, Run>;
  longTermRuns: Record<string, Run>;
  toolRuns: Run[];
}

export const OUTPUTS = [
  {
    id: "completeness",
    title: "数据完整率统计",
    description: "实测、实测有效、完整年三张完整率表",
    kind: "qc",
    required: ["raw", "qc"],
    form: "统计表",
  },
  {
    id: "density",
    title: "空气密度变化",
    description: "空气密度月变化柱图、气温气压及密度表",
    kind: "qc",
    required: ["qc"],
    form: "柱图 + 表格",
  },
  {
    id: "turbulence",
    title: "湍流强度",
    description: "各高度、各风速段湍流曲线与统计表",
    kind: "qc",
    required: ["qc"],
    form: "曲线 + 表格",
  },
  {
    id: "shear",
    title: "风切变与风廓线",
    description: "高度对切变矩阵、风廓线与拟合图",
    kind: "qc",
    required: ["qc"],
    form: "拟合图 + 表格",
  },
  {
    id: "turbulence-hourly",
    title: "逐小时十分钟最大湍流",
    description: "小时内最大十分钟TI作为该小时代表值，并列有效样本数",
    kind: "qc",
    required: ["qc"],
    form: "逐小时统计表",
  },
  {
    id: "monthly",
    title: "风速与风功率密度月变化",
    description: "各高度月平均值，可分别成图或双轴展示",
    kind: "result",
    required: ["result"],
    form: "折线 + 表格",
  },
  {
    id: "hourly",
    title: "风速与风功率密度日变化",
    description: "全年 24 小时变化与对应统计表",
    kind: "result",
    required: ["result"],
    form: "折线 + 表格",
  },
  {
    id: "monthly-hourly",
    title: "各月日内变化",
    description: "按 12 个月分别展示小时变化",
    kind: "result",
    required: ["result"],
    form: "12 子图",
  },
  {
    id: "frequency",
    title: "风速与风能频率",
    description: "各风速段的风速频率与风能占比",
    kind: "result",
    required: ["result"],
    form: "分组柱图 + 表格",
  },
  {
    id: "weibull",
    title: "Weibull 风速分布",
    description: "经验频率、拟合曲线及分布参数",
    kind: "result",
    required: ["result"],
    form: "分布图 + 参数表",
  },
  {
    id: "annual-rose",
    title: "全年风向与风能玫瑰",
    description: "全年或多高度的风向、风能方向分布",
    kind: "result",
    required: ["result"],
    form: "双玫瑰图",
  },
  {
    id: "monthly-rose",
    title: "各月风向与风能玫瑰",
    description: "按月展示方向分布及扇区频率",
    kind: "result",
    required: ["result"],
    form: "月度玫瑰图组",
  },
  {
    id: "reference-years",
    title: "长期年际风速变化",
    description: "逐年柱图、同期红柱与 30/20/10 年均值线",
    kind: "reference",
    required: ["result", "reference"],
    form: "柱图 + 均值线",
  },
  {
    id: "reference-rose",
    title: "长期累计风向",
    description: "长期或同期参考数据的累计风向分布",
    kind: "reference",
    required: ["result", "reference"],
    form: "玫瑰图 + 表格",
  },
] as const;

export type OutputSpec = (typeof OUTPUTS)[number];

export function newTower(id: string, number: number): Tower {
  return {
    id,
    name: `测风塔 ${String(number).padStart(2, "0")}`,
    latitude: "",
    longitude: "",
    altitude: "",
    speedHeights: "",
    directionHeights: "",
    temperatureHeights: "",
    pressureHeights: "",
    observedStart: "",
    observedEnd: "",
    analysisStart: "",
    analysisEnd: "",
    hubHeight: "",
    timezone: "",
  };
}

export function createWorkspace(): WorkspaceState {
  return {
    activeTab: "data",
    towers: [newTower("tower-1", 1)],
    activeTowerId: "tower-1",
    files: [],
    selectedOutputs: OUTPUTS.map((item) => item.id),
    qcPeriod: "all",
    planSaved: false,
    correlation: {
      mode: "same-tower",
      leftFileId: "",
      rightFileId: "",
      leftHeights: "",
      rightHeights: "",
      start: "",
      end: "",
      sectors: 16,
      directionFileId: "",
      directionHeight: "",
      regression: "with-intercept",
      aggregation: "hourly",
      targetChannels: {},
      referenceChannels: {},
    },
    correlationJobs: [],
    longTerm: {
      fileId: "",
      height: "",
      windows: "30, 20, 10",
      directionPeriod: "baseline",
      timezone: "",
      directionChannel: "",
    },
    analysis: {
      rawFileId: "",
      qcFileId: "",
      resultFileId: "",
      densityMethod: "measured",
      temperatureChannel: "",
      pressureChannel: "",
      manualDensity: "",
      altitude: "",
      shearChannels: [],
      directionChannel: "",
      aggregation: "hourly",
      sectors: 16,
      calmThreshold: "0.5",
    },
    analysisRuns: {},
    longTermRuns: {},
    toolRuns: [],
  };
}

export function filesForTower(
  state: WorkspaceState,
  kind: SourceKind,
  towerId = state.activeTowerId,
) {
  return state.files.filter(
    (item) =>
      item.kind === kind && (kind === "reference" || item.towerId === towerId),
  );
}

export function parseHeights(value: string): number[] {
  const pieces = value
    .trim()
    .split(/[,，、;；\s]+/)
    .filter(Boolean);
  if (
    !pieces.length ||
    pieces.some((v) => !/^\d+(\.\d+)?$/.test(v) || Number(v) <= 0)
  )
    return [];
  return [...new Set(pieces.map(Number))].sort((a, b) => a - b);
}

export function heightPairs(draft: CorrelationDraft): [number, number][] {
  const left = parseHeights(draft.leftHeights);
  const right = parseHeights(draft.rightHeights);
  if (draft.mode === "same-tower") {
    return left.flatMap((h, i) =>
      left.slice(i + 1).map((r): [number, number] => [h, r]),
    );
  }
  return left.flatMap((h) => right.map((r): [number, number] => [h, r]));
}

export function correlationErrors(state: WorkspaceState): string[] {
  const draft = state.correlation;
  const left = state.files.find((f) => f.id === draft.leftFileId);
  const right = state.files.find((f) => f.id === draft.rightFileId);
  const errors: string[] = [];
  if (!left || left.kind === "reference")
    errors.push("请选择目标测风塔数据文件。");
  if (draft.mode !== "same-tower" && !right)
    errors.push("请选择对比数据文件。");
  if (
    draft.mode === "cross-tower" &&
    right &&
    (right.kind === "reference" || right.towerId === left?.towerId)
  )
    errors.push("跨塔分析需要另一座测风塔的数据。");
  if (draft.mode === "reference" && right?.kind !== "reference")
    errors.push("塔与中尺度分析需要中尺度对比文件。");
  const leftHeights = parseHeights(draft.leftHeights);
  if (
    !leftHeights.length ||
    (draft.mode === "same-tower" && leftHeights.length < 2)
  )
    errors.push(
      draft.mode === "same-tower"
        ? "同塔分析请填写至少两个不同高度。"
        : "请填写有效的目标高度。",
    );
  if (draft.mode !== "same-tower" && !parseHeights(draft.rightHeights).length)
    errors.push("请填写有效的对比高度。");
  if (!draft.start || !draft.end || draft.start >= draft.end)
    errors.push("请设置起点早于终点的相关性分析时段。");
  if (draft.sectors > 1) {
    const directionFile = state.files.find(
      (f) => f.id === draft.directionFileId,
    );
    if (!directionFile) errors.push("分扇区分析需要选择风向数据来源。");
    if (parseHeights(draft.directionHeight).length !== 1)
      errors.push("请指定一个有效的风向参考高度。");
  }
  if (!state.towers.find((t) => t.id === left?.towerId)?.timezone)
    errors.push("请先确认目标测风塔的时间基准。");
  if (
    right &&
    right.kind !== "reference" &&
    !state.towers.find((t) => t.id === right.towerId)?.timezone
  )
    errors.push("请先确认对比测风塔的时间基准。");
  return errors;
}

export function outputStatus(item: OutputSpec, state: WorkspaceState) {
  const missing = item.required.filter(
    (kind) => !filesForTower(state, kind).length,
  );
  if (missing.length)
    return `缺少${missing.map((kind) => SOURCE_TYPES.find((s) => s.id === kind)!.shortLabel).join(" / ")}`;
  const tower = state.towers.find((t) => t.id === state.activeTowerId)!;
  if (
    (item.kind === "result" || item.kind === "reference") &&
    (!tower.analysisStart ||
      !tower.analysisEnd ||
      tower.analysisStart >= tower.analysisEnd)
  )
    return "待确认结果数据时段";
  const run =
    item.kind === "reference"
      ? state.longTermRuns[state.activeTowerId]
      : state.analysisRuns[state.activeTowerId];
  const output = run?.outputs[item.id];
  return output
    ? output.status === "ready"
      ? "已有计算结果"
      : (output.reason ?? "待补条件")
    : "待解析并执行计算";
}

export function longTermErrors(state: WorkspaceState) {
  const tower = state.towers.find((t) => t.id === state.activeTowerId)!;
  const years = state.longTerm.windows
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map(Number);
  const errors: string[] = [];
  if (
    !state.files.some(
      (f) => f.id === state.longTerm.fileId && f.kind === "reference",
    )
  )
    errors.push("请选择中尺度长期参考文件。");
  if (!filesForTower(state, "result").length)
    errors.push("当前测风塔尚未选择结果数据文件。");
  if (
    !tower.analysisStart ||
    !tower.analysisEnd ||
    tower.analysisStart >= tower.analysisEnd
  )
    errors.push("请先确认结果数据中的分析年起止日期。");
  if (
    !years.length ||
    years.some((n) => !Number.isInteger(n) || n <= 0 || n > 100)
  )
    errors.push("长期基准请填写 1–100 之间的整数年数。");
  if (parseHeights(state.longTerm.height).length !== 1)
    errors.push("请指定一个有效的中尺度参考高度。");
  if (!state.longTerm.timezone || !tower.timezone)
    errors.push("请分别确认测风塔与中尺度数据的时间基准。");
  return errors;
}

export function configurationSnapshot(
  state: WorkspaceState,
  projectName: string,
) {
  return {
    format: "aeolus-workflow-config",
    version: 1,
    projectName,
    towers: state.towers,
    activeTowerId: state.activeTowerId,
    sources: state.files.map(({ id, kind, towerId, file, dataset }) => ({
      id,
      kind,
      towerId,
      name: file.name,
      bytes: file.size,
      lastModified: file.lastModified,
      datasetId: dataset?.id,
      sha256: dataset?.sha256,
    })),
    analysis: state.analysis,
    runIds: {
      analysis: Object.values(state.analysisRuns).map((r) => r.id),
      longTerm: Object.values(state.longTermRuns).map((r) => r.id),
    },
    selectedOutputs: state.selectedOutputs,
    qcPeriod: state.qcPeriod,
    correlation: state.correlation,
    correlationJobs: state.correlationJobs,
    longTerm: state.longTerm,
    note: "分析配置与来源描述，不含原始文件。运行快照和标准化序列由本机服务按标识单独保留。",
  };
}

export function sourceLabel(file: SourceFile, state: WorkspaceState) {
  const tower = state.towers.find((t) => t.id === file.towerId);
  const kind = SOURCE_TYPES.find((s) => s.id === file.kind)!;
  return `${tower?.name || "项目参考"} · ${kind.shortLabel} · ${file.file.name}`;
}

export interface HeaderSuggestions {
  name?: string;
  latitude?: string;
  longitude?: string;
  altitude?: string;
  speedHeights?: string;
  directionHeights?: string;
  temperatureHeights?: string;
  pressureHeights?: string;
  observedStart?: string;
  observedEnd?: string;
}

// 只提取明确的键值型元信息建议；不猜测单位、时间范围或通道统计类型。
export function suggestHeaderMetadata(text: string): HeaderSuggestions {
  const result: HeaderSuggestions = {};
  const patterns: [keyof HeaderSuggestions, RegExp][] = [
    [
      "name",
      /^(?:测风塔(?:编号|名称)?|塔号|Mast\s*(?:ID|Name))\s*[:：=]\s*(.+)$/im,
    ],
    [
      "latitude",
      /^(?:纬度|Latitude)\s*[:：=]\s*([+-]?\d+(?:\.\d+)?)\s*(?:°|[NS])?\s*$/im,
    ],
    [
      "longitude",
      /^(?:经度|Longitude)\s*[:：=]\s*([+-]?\d+(?:\.\d+)?)\s*(?:°|[EW])?\s*$/im,
    ],
    [
      "altitude",
      /^(?:海拔(?:高度)?|Elevation|Altitude)\s*[:：=]\s*([+-]?\d+(?:\.\d+)?)\s*(?:m|米)?\s*$/im,
    ],
    [
      "speedHeights",
      /^(?:风速(?:配置)?高度|Wind\s*Speed\s*Heights)\s*[:：=]\s*([\d.,，、;；\s]+?)(?:\s*m|米)?\s*$/im,
    ],
    [
      "directionHeights",
      /^(?:风向(?:配置)?高度|Wind\s*Direction\s*Heights)\s*[:：=]\s*([\d.,，、;；\s]+?)(?:\s*m|米)?\s*$/im,
    ],
    [
      "temperatureHeights",
      /^(?:温度(?:配置)?高度|Temperature\s*Heights)\s*[:：=]\s*([\d.,，、;；\s]+?)(?:\s*m|米)?\s*$/im,
    ],
    [
      "pressureHeights",
      /^(?:气压(?:配置)?高度|Pressure\s*Heights)\s*[:：=]\s*([\d.,，、;；\s]+?)(?:\s*m|米)?\s*$/im,
    ],
  ];
  for (const [key, pattern] of patterns) {
    const match = text
      .split(/\r?\n/)
      .map((line) => line.match(pattern))
      .find(Boolean);
    if (match) result[key] = match[1].trim();
  }
  // 对带南纬/西经后缀的表头保留方向信息。
  if (/^Latitude\s*[:：=].*S\s*$/im.test(text) && result.latitude)
    result.latitude = String(-Math.abs(Number(result.latitude)));
  if (/^Longitude\s*[:：=].*W\s*$/im.test(text) && result.longitude)
    result.longitude = String(-Math.abs(Number(result.longitude)));
  return result;
}

export interface WorkspaceViewProps {
  state: WorkspaceState;
  onChange: (update: (current: WorkspaceState) => WorkspaceState) => void;
  onNotice: (message: string) => void;
}

export async function readHeaderPreview(file: File) {
  const bytes = await file.slice(0, 64 * 1024).arrayBuffer();
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      encoding: "UTF-8",
    };
  } catch {
    return {
      text: new TextDecoder("gb18030", { fatal: true }).decode(bytes),
      encoding: "GB18030",
    };
  }
}
