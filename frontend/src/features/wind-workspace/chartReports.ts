export type SavedChart = {
  id: string;
  title: string;
  html: string;
  config: Record<string, unknown>;
};
const key = "aeolus.report-charts.v1";
export function readCharts(): SavedChart[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter(
          (c) =>
            c &&
            typeof c.id === "string" &&
            typeof c.title === "string" &&
            typeof c.html === "string" &&
            c.config &&
            typeof c.config === "object",
        )
      : [];
  } catch {
    return [];
  }
}
export function addReportChart(
  title: string,
  html: string,
  config: Record<string, unknown>,
) {
  localStorage.setItem(
    key,
    JSON.stringify([
      ...readCharts(),
      { id: crypto.randomUUID(), title, html, config },
    ]),
  );
  window.dispatchEvent(new Event("aeolus-report-change"));
}

export function removeReportChart(id: string) {
  localStorage.setItem(
    key,
    JSON.stringify(readCharts().filter((chart) => chart.id !== id)),
  );
  window.dispatchEvent(new Event("aeolus-report-change"));
}
