import { useEffect, useRef, useState } from "react";
import { api, means } from "./api";
import { localInput } from "./autoSetup";
import type { WorkspaceState } from "./model";
import "./towerComparison.css";

type Period = "monthly" | "hourly" | "reference-years";
interface ComparedSource {
  name: string;
  height: number;
  stage: string;
  channel: string;
  start: string;
  end_exclusive: string;
  timezone: string;
}
interface Comparison {
  sources: ComparedSource[];
  rows: { period: number; count: number; values: (number | null)[] }[];
  paired_count: number;
  timezone: string;
  start: string;
  end_exclusive: string;
}
const colors = ["#216d50", "#985816", "#345f9a", "#994969"];
const periodNames = {
  monthly: "月变化",
  hourly: "日变化",
  "reference-years": "长期周年",
};
const label = (s: ComparedSource) =>
  `${s.name} · ${s.height}m · ${s.stage === "reference" ? "中尺度" : "结果数据"}`;

function ComparisonResult({
  result,
  period,
  metric,
}: {
  result: Comparison;
  period: Period;
  metric: string;
}) {
  const chart = useRef<SVGSVGElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const { rows, sources } = result;
  const names = sources.map((s) => s.name).join("、");
  const unit =
    metric === "power_density" ? "风功率密度 (W/m²)" : "平均风速 (m/s)";
  const axis =
    period === "monthly" ? "月份" : period === "hourly" ? "时刻" : "周年起始年";
  const title = `${names} · ${periodNames[period]} · ${unit}`;
  const step = Math.max(1, Math.ceil(rows.length / 16));
  const max =
    Math.max(1, ...rows.flatMap((r) => r.values.map((v) => v ?? 0))) * 1.05;
  const x = (i: number) =>
    rows.length === 1 ? 415 : 60 + (i * 710) / (rows.length - 1);
  const y = (v: number) => 265 - (176 * v) / max;
  function save(format: "svg" | "csv" | "html") {
    const doc = document.implementation.createHTMLDocument(title);
    const info = document.createElement("p");
    info.textContent = `共同有效小时 ${result.paired_count}，分组时区 ${result.timezone}。覆盖边界 ${result.start} 至 ${result.end_exclusive}（UTC，终点不含）。`;
    doc.body.append(
      info,
      chart.current!.cloneNode(true),
      table.current!.cloneNode(true),
    );
    const csv = [...table.current!.rows]
      .map((row) =>
        [...row.cells]
          .map((cell) => {
            let v = cell.textContent || "";
            if (/^[=+@-]/.test(v)) v = "'" + v;
            return '"' + v.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n");
    const content =
      format === "csv"
        ? "\uFEFF" + csv
        : format === "html"
          ? "<!doctype html>" + doc.documentElement.outerHTML
          : new XMLSerializer().serializeToString(chart.current!);
    const type = { csv: "text/csv", html: "text/html", svg: "image/svg+xml" }[
      format
    ];
    const url = URL.createObjectURL(
      new Blob([content], { type: type + ";charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${names}-${periodNames[period]}-${metric}.${format}`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="ww-panel ww-comparison-output">
      <h3>{title}</h3>
      <p>
        共同有效 {result.paired_count.toLocaleString()} 小时，覆盖{" "}
        {localInput(result.start, result.timezone).replace("T", " ")} 至{" "}
        {localInput(result.end_exclusive, result.timezone).replace("T", " ")}
        （终点不含）。
        {period === "reference-years"
          ? "每年仅比较各塔同一周年起始年的重合小时。"
          : "按 " + result.timezone + " 分组。"}{" "}
        缺少共同样本的位置留空。
      </p>
      <svg
        ref={chart}
        role="img"
        aria-label={title}
        viewBox="0 0 810 301"
        width="100%"
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>{title}</title>
        <rect width="810" height="301" fill="#fff" />
        <text x="15" y="18" fontSize="12">
          {unit} · {periodNames[period]}对比
        </text>
        {sources.map((s, i) => (
          <g
            key={i}
            transform={`translate(${24 + (i % 2) * 393} ${39 + Math.floor(i / 2) * 17})`}
          >
            <path d="M0 0h21" stroke={colors[i]} strokeWidth="3" />
            <text x="27" y="4" fontSize="11">
              {label(s)}
            </text>
          </g>
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1="60"
              x2="770"
              y1={y((i * max) / 4)}
              y2={y((i * max) / 4)}
              stroke="#e2e9e6"
            />
            <text
              x="54"
              y={y((i * max) / 4) + 4}
              textAnchor="end"
              fontSize="10"
            >
              {((i * max) / 4).toFixed(2)}
            </text>
          </g>
        ))}
        {sources.map((s, j) => (
          <g key={j}>
            <path
              fill="none"
              stroke={colors[j]}
              strokeWidth="2.2"
              d={rows
                .map((r, i) => {
                  const v = r.values[j];
                  return v === null
                    ? ""
                    : `${i && rows[i - 1].values[j] !== null ? "L" : "M"}${x(i)} ${y(v)}`;
                })
                .join(" ")}
            />
            {rows.map(
              (r, i) =>
                r.values[j] !== null && (
                  <circle
                    key={i}
                    cx={x(i)}
                    cy={y(r.values[j]!)}
                    r="3"
                    fill={colors[j]}
                  >
                    <title>
                      {label(s)} · {r.period} · {r.values[j]?.toFixed(3)} ·{" "}
                      {r.count} 小时
                    </title>
                  </circle>
                ),
            )}
          </g>
        ))}
        {rows.map(
          (r, i) =>
            i % step === 0 && (
              <text key={i} x={x(i)} y="281" textAnchor="middle" fontSize="10">
                {r.period}
              </text>
            ),
        )}
        <text x="415" y="297" textAnchor="middle" fontSize="11">
          {axis}
        </text>
      </svg>
      <div className="ww-comparison-downloads">
        {(["svg", "csv", "html"] as const).map((f) => (
          <button key={f} className="ww-button" onClick={() => save(f)}>
            导出 {f.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="ww-table-scroll">
        <table ref={table} className="ww-result-table">
          <caption>{title}</caption>
          <thead>
            <tr>
              <th>{axis}</th>
              <th>共同有效小时数</th>
              {sources.map((s, i) => (
                <th key={i}>{label(s)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.period}>
                <td>{r.period}</td>
                <td>{r.count}</td>
                {r.values.map((v, i) => (
                  <td key={i}>{v?.toFixed(3) ?? "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function TowerComparison({
  state,
  onBack,
}: {
  state: WorkspaceState;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState([state.activeTowerId]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [period, setPeriod] = useState<Period>("monthly");
  const [metric, setMetric] = useState("mean_speed");
  const [years, setYears] = useState(30);
  const [out, setOut] = useState<{
    key: string;
    data?: Comparison;
    error?: string;
  }>({ key: "" });
  const annual = period === "reference-years";
  const towers = state.towers.map((t) => {
    const run = (annual ? state.longTermRuns : state.analysisRuns)[t.id];
    const datasetId = annual ? run?.config.reference_id : run?.config.result_id;
    const dataset = state.files.find(
      (f) => f.dataset?.id === datasetId,
    )?.dataset;
    const configured = run?.config.result_channels;
    const channels = means(dataset)
      .filter((c) =>
        annual
          ? c.id === run?.config.speed_channel
          : !Array.isArray(configured) ||
            !configured.length ||
            configured.includes(c.id),
      )
      .sort((a, b) => b.height - a.height);
    const key = `${t.id}:${datasetId}`;
    return {
      t,
      run,
      key,
      channels,
      ch: channels.find((c) => c.id === choices[key]) ?? channels[0],
    };
  });
  const picked = towers.filter(({ t }) => selected.includes(t.id));
  const windows = picked
    .reduce<number[]>((all, { run }, i) => {
      const ws = (run?.config.windows ?? []) as number[];
      return i ? all.filter((v) => ws.includes(v)) : ws;
    }, [])
    .sort((a, b) => b - a);
  const window = windows.includes(years) ? years : windows[0];
  const ready =
    picked.length >= 2 &&
    picked.every((e) => e.run && e.ch) &&
    (!annual || window);
  const request = ready
    ? JSON.stringify({
        period,
        metric,
        window: annual ? window : 30,
        towers: picked.map((e) => ({
          run_id: e.run!.id,
          name: e.t.name,
          channel_id: e.ch!.id,
        })),
      })
    : "";
  useEffect(() => {
    if (!request) return;
    let active = true;
    const controller = new AbortController();
    api<Comparison>(
      "/tower-comparisons",
      JSON.parse(request),
      controller.signal,
    )
      .then((data) => {
        if (active) setOut({ key: request, data });
      })
      .catch((err: Error) => {
        if (active) setOut({ key: request, error: err.message });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [request]);
  return (
    <div className="ww-results ww-comparison">
      <section className="ww-panel">
        <div className="ww-section-heading">
          <div>
            <h2>多塔对比</h2>
            <p>选择 2 至 4 座已完成分析的测风塔，每塔选择一个风速通道。</p>
          </div>
          <button className="ww-button" onClick={onBack}>
            返回单塔图表
          </button>
        </div>
        <div className="ww-fields ww-fields-three">
          <label>
            对比图表
            <select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value as Period);
                if (e.target.value === "reference-years")
                  setMetric("mean_speed");
              }}
            >
              {Object.entries(periodNames).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            统计量
            <select value={metric} onChange={(e) => setMetric(e.target.value)}>
              <option value="mean_speed">平均风速 (m/s)</option>
              {!annual && (
                <option value="power_density">风功率密度 (W/m²)</option>
              )}
            </select>
          </label>
          {annual && (
            <label>
              长期窗口
              <select
                value={window ?? ""}
                disabled={!windows.length}
                onChange={(e) => setYears(Number(e.target.value))}
              >
                {!windows.length && <option value="">无共同窗口</option>}
                {windows.map((w) => (
                  <option key={w} value={w}>
                    {w} 年
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="ww-comparison-towers">
          {towers.map(({ t, key, channels, ch }) => {
            const checked = selected.includes(t.id);
            return (
              <div key={t.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && (!ch || picked.length >= 4)}
                    onChange={() =>
                      setSelected(
                        checked
                          ? selected.filter((id) => id !== t.id)
                          : [...selected, t.id],
                      )
                    }
                  />
                  {t.name}
                </label>
                {ch ? (
                  <select
                    aria-label={t.name + " 对比通道"}
                    disabled={!checked}
                    value={ch.id}
                    onChange={(e) =>
                      setChoices({ ...choices, [key]: e.target.value })
                    }
                  >
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.height}m · {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <small>
                    {annual
                      ? "需长期参考运行和已解析的参考文件"
                      : "需风资源运行和已解析的结果文件"}
                  </small>
                )}
              </div>
            );
          })}
        </div>
      </section>
      {!request ? (
        <p className="ww-callout">
          请选择具备同阶段资料的测风塔{annual ? "及共同的长期窗口" : ""}。
        </p>
      ) : out.key !== request ? (
        <p role="status">正在匹配共同有效小时…</p>
      ) : out.error ? (
        <p role="alert" className="ww-error">
          {out.error}
        </p>
      ) : (
        out.data && (
          <ComparisonResult result={out.data} period={period} metric={metric} />
        )
      )}
    </div>
  );
}
