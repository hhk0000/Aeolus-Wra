export interface HealthResponse {
  status: "ok";
  service: "aeolus-wra";
  version: string;
}

export async function getHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch("/api/v1/health", { signal });
  if (!response.ok) {
    throw new Error(`API 返回 HTTP ${response.status}`);
  }
  const data: unknown = await response.json();
  if (
    typeof data !== "object" ||
    data === null ||
    !("status" in data) ||
    data.status !== "ok" ||
    !("service" in data) ||
    data.service !== "aeolus-wra" ||
    !("version" in data) ||
    typeof data.version !== "string"
  ) {
    throw new Error("API 响应格式不符合健康检查契约");
  }
  return { status: data.status, service: data.service, version: data.version };
}
