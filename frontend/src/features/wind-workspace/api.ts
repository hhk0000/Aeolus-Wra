export interface Channel {
  id: string;
  name: string;
  quantity: string;
  statistic: string;
  height: number;
  unit: string;
  arm: string;
  valid_count: number;
}
export interface Mapping {
  index: number;
  quantity: string;
  statistic: string;
  height: number | null;
  unit: string;
  arm: string;
  ambiguous?: boolean;
}
export interface UploadedFile {
  detected?: {
    timestamp_column: number;
    time_column: number | null;
    interval_minutes: number | null;
    timezone: string | null;
    timestamp_position: string;
    warnings?: string[];
  };
  id: string;
  sha256: string;
  encoding: string;
  header_line: number;
  data_line: number;
  delimiter: string;
  headers: string[];
  sample_rows: string[][];
  suggestions: Mapping[];
  text_preview: string;
}
export interface Dataset {
  id: string;
  row_count: number;
  start: string;
  end_exclusive: string;
  stage: string;
  filename: string;
  sha256: string;
  channels: Channel[];
  options: { timezone: string; interval_minutes: number };
  transformation?: { operation: string; details: Record<string, unknown> };
}
export interface RunOutput {
  title: string;
  method: string;
  status: "ready" | "unavailable";
  reason?: string;
  rows?: Record<string, unknown>[];
  summary?: Record<string, unknown>;
}
export interface Run {
  id: string;
  kind: string;
  engine_version: string;
  created_at: string;
  config: Record<string, unknown>;
  sources?: Record<string, Record<string, unknown>>;
  warnings?: string[];
  outputs: Record<string, RunOutput>;
  methods?: Record<string, Method>;
  standards?: Registry["standards"];
}
export interface Method {
  id: string;
  title: string;
  source: string;
  clause: string;
  formula: string;
  stage: string;
  limits: string;
  status: string;
  version: string;
}
export interface Registry {
  engine_version: string;
  verified_on: string;
  standards: {
    id: string;
    name: string;
    title: string;
    level: string;
    status: string;
    url: string | null;
  }[];
  methods: Method[];
  notice: string;
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api/v1${path}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          ...(body instanceof FormData
            ? { body }
            : {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }),
        },
  );
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    const detail = result?.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail
              .map(
                (d: { loc: string[]; msg: string }) =>
                  `${d.loc.join(".")}: ${d.msg}`,
              )
              .join("；")
          : `服务请求失败（${response.status}）`,
    );
  }
  return response.json() as Promise<T>;
}

export function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function means(data?: Dataset, quantity = "speed") {
  return (
    data?.channels.filter(
      (c) => c.quantity === quantity && c.statistic === "mean",
    ) ?? []
  );
}
