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
export function addReportCharts(entries: Omit<SavedChart, "id">[]) {
  const charts = entries.map((entry) => ({
    ...entry,
    id: crypto.randomUUID(),
  }));
  localStorage.setItem(key, JSON.stringify([...readCharts(), ...charts]));
  window.dispatchEvent(new Event("aeolus-report-change"));
  return charts.map((chart) => chart.id);
}

export function removeReportChart(id: string) {
  removeReportCharts([id]);
}

export function removeReportCharts(ids: string[]) {
  localStorage.setItem(
    key,
    JSON.stringify(readCharts().filter((chart) => !ids.includes(chart.id))),
  );
  window.dispatchEvent(new Event("aeolus-report-change"));
}
