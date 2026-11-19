import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { api } from "./api";
import { localInput } from "./autoSetup";
import { useChartTextSize } from "./chartText";
import { EXCEL, excelSvgProps } from "./chartTheme";
import { RoseChart } from "./RoseChart";

type Quantity = "speed" | "direction";
type Point = [number, number | null, number | null, number, number];
type Series = {
  paired: number;
  counts: [number, number];
  visible: number;
  points: Point[];
};
type Range = { start: number; end: number };
type Timeline = Range & {
  timezone: string;
  metrics: Partial<Record<Quantity, Series>>;
};
type RoseRow = {
  label: string;
  degrees: number;
  frequency: number;
  energy_frequency?: number | null;
};
export type ConcurrentComparison = Timeline & {
  id: string;
  config: { paired_only: boolean; aggregation: "hourly" | "native" };
  summary: {
    stages: string[];
    monthly_speed: (number | null)[][];
    direction: RoseRow[][];
    energy: RoseRow[][];
  };
};
type Legend = { name: string; color: string }[];

function SourceLegend({ items }: { items: Legend }) {
  return (
    <div className="ww-plot-legend" aria-label="数据来源">
      {items.map(({ name, color }) => (
        <span key={name}>
          <i style={{ borderColor: color }} />
          {name}
        </span>
      ))}
    </div>
  );
}

function ConcurrentChart({
  metric,
  view,
  legend,
  onZoom,
}: {
  metric: Quantity;
  view: Timeline;
  legend: Legend;
  onZoom: (range: Range) => void;
}) {
  const label = metric === "speed" ? "风速" : "风向";
  const series = view.metrics[metric];
  const textSize = useChartTextSize();
  const [drag, setDrag] = useState<[number, number]>();
  const dragStart = useRef<number | null>(null);
  const points = series?.points ?? [];
  const max =
    metric === "direction"
      ? 360
      : Math.ceil(
          Math.max(
            1,
            ...points.flatMap((point) => [point[1] ?? 0, point[2] ?? 0]),
          ),
        );
  const axisSize = textSize(16);
  const left = Math.max(70, axisSize * 2.4),
    right = 862,
    top = axisSize + 13,
    bottom = top + 215;
  const x = (time: number) =>
    left + ((right - left) * (time - view.start)) / (view.end - view.start);
  const y = (value: number) =>
    bottom - ((bottom - top) * Math.max(0, Math.min(max, value))) / max;
  const fraction = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  };
  function finishDrag(event: PointerEvent<SVGRectElement>) {
    const start = dragStart.current;
    dragStart.current = null;
    setDrag(undefined);
    if (start === null) return;
    const end = fraction(event);
    if (Math.abs(end - start) < 0.02) return;
    const span = view.end - view.start;
    onZoom({
      start: view.start + Math.min(start, end) * span,
      end: view.start + Math.max(start, end) * span,
    });
  }
  return (
    <section className="ww-concurrent-timeline">
      <h3>{label}同期</h3>
      {series && (
        <p>
          A 有效 {series.counts[0]} · B 有效 {series.counts[1]} · 同期{" "}
          {series.paired} 条
          {series.visible > points.length && ` · 绘图抽样 ${points.length} 点`}
        </p>
      )}
      <SourceLegend items={legend} />
      {points.length > 0 ? (
        <div className="ww-plot-scroll">
          <svg
            viewBox={`0 0 900 ${bottom + 2 * axisSize + 24}`}
            role="img"
            aria-label={label + "同期，数据 A 与 B 叠加"}
            {...excelSvgProps()}
          >
            <rect
              x={left}
              y={top}
              width={right - left}
              height={bottom - top}
              fill="none"
              stroke={EXCEL.axis}
            />
            <text x={left} y={axisSize} fontSize={axisSize}>
              {metric === "speed" ? "风速 m/s" : "风向 °"}
            </text>
            {[0, 1, 2, 3, 4].map((tick) => {
              const value = (tick * max) / 4;
              return (
                <g key={tick}>
                  <line
                    x1={left}
                    x2={right}
                    y1={y(value)}
                    y2={y(value)}
                    stroke={EXCEL.grid}
                  />
                  <text
                    x={left - 8}
                    y={y(value) + 5}
                    textAnchor="end"
                    fontSize={axisSize}
                  >
                    {Number(value.toFixed(1))}
                  </text>
                </g>
              );
            })}
            {([1, 0] as const).map((side) => {
              let lastSegment: number | undefined;
              const path = points
                .map((point) => {
                  const value = point[side === 0 ? 1 : 2];
                  if (value === null) return "";
                  const segment = point[side === 0 ? 3 : 4];
                  const coordinates = `${x(point[0]).toFixed(2)} ${y(value).toFixed(2)}`;
                  const command =
                    lastSegment === segment
                      ? "L" + coordinates
                      : "M" + coordinates + "h0.01";
                  lastSegment = segment;
                  return command;
                })
                .join(" ");
              return (
                <path
                  key={side}
                  data-side={side}
                  d={path}
                  fill="none"
                  stroke={legend[side].color}
                  strokeWidth={side === 0 ? 1.6 : 2}
                  strokeLinecap="round"
                  opacity="0.87"
                />
              );
            })}
            {(axisSize > 24 ? [0, 1] : [0, 1 / 3, 2 / 3, 1]).map((step) => {
              const time = view.start + step * (view.end - view.start);
              const date = localInput(
                new Date(time * 1000).toISOString(),
                view.timezone,
              );
              return (
                <text
                  key={step}
                  x={x(time)}
                  y={bottom + axisSize + 5}
                  textAnchor={
                    step === 0 ? "start" : step === 1 ? "end" : "middle"
                  }
                  fontSize={axisSize}
                >
                  {view.end - view.start > 90 * 86400
                    ? date.slice(0, 10)
                    : date.slice(5).replace("T", " ")}
                </text>
              );
            })}
            {drag && (
              <rect
                x={left + (right - left) * Math.min(...drag)}
                y={top}
                width={(right - left) * Math.abs(drag[0] - drag[1])}
                height={bottom - top}
                fill="#2a8058"
                opacity="0.2"
                pointerEvents="none"
              />
            )}
            <rect
              x={left}
              y={top}
              width={right - left}
              height={bottom - top}
              className="ww-concurrent-zoom-target"
              fill="transparent"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                const start = fraction(event);
                dragStart.current = start;
                event.currentTarget.setPointerCapture(event.pointerId);
                setDrag([start, start]);
              }}
              onPointerMove={(event) => {
                const start = dragStart.current;
                if (start !== null) setDrag([start, fraction(event)]);
              }}
              onPointerUp={finishDrag}
              onPointerCancel={() => {
                dragStart.current = null;
                setDrag(undefined);
              }}
              onLostPointerCapture={() => {
                dragStart.current = null;
                setDrag(undefined);
              }}
            />
          </svg>
        </div>
      ) : (
        <p>
          {series
            ? "所选时间内没有符合条件的记录。"
            : "未选择" + label + "通道。"}
        </p>
      )}
    </section>
  );
}

export function ConcurrentCharts({ result }: { result: ConcurrentComparison }) {
  const [detail, setDetail] = useState<Timeline>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const view = detail ?? result;
  const span = view.end - view.start;
  const stages = result.summary.stages;
  const bothReference = stages.every((stage) => stage === "reference");
  const sameStage =
    bothReference || stages.every((stage) => stage !== "reference");
  const names = stages.map(
    (stage, index) =>
      `${stage === "reference" ? "中尺度" : "测风塔"}（${index === 0 ? "A" : "B"}）`,
  );
  function legendFor(mast: string, reference: string): Legend {
    return names.map((name, index) => ({
      name,
      color: (
        sameStage
          ? index === (bothReference ? 0 : 1)
          : stages[index] === "reference"
      )
        ? reference
        : mast,
    }));
  }
  const speed = legendFor(EXCEL.series[0], "#b18400");
  const direction = legendFor("#24774b", "#bd4038");
  function reset() {
    request.current?.abort();
    setBusy(false);
    setError("");
    setDetail(undefined);
  }
  async function zoom(range: Range) {
    const window = {
      start: Math.max(result.start, range.start),
      end: Math.min(result.end, range.end),
    };
    if (window.end - window.start < 60) return;
    if (window.start === result.start && window.end === result.end) {
      reset();
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError("");
    setBusy(true);
    try {
      const timeline = await api<Timeline>(
        `/concurrent/${result.id}/window`,
        window,
        controller.signal,
      );
      if (!controller.signal.aborted) setDetail(timeline);
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const windowLabel = (stamp: number) =>
    localInput(new Date(stamp * 1000).toISOString(), result.timezone).replace(
      "T",
      " ",
    );
  return (
    <div className="ww-concurrent-charts">
      <section className="ww-concurrent-summary">
        <h3>月均风速对比（m/s）</h3>
        <p className="ww-inline-note">
          按选定时段的自然月汇总；年平均按所选整段有效样本加权，多年时段合并统计。
        </p>
        <div
          className="ww-table-scroll"
          role="region"
          aria-label="月均风速结论表"
          tabIndex={0}
        >
          <table className="ww-result-table">
            <thead>
              <tr>
                <th scope="col">数据</th>
                {Array.from({ length: 12 }, (_, index) => (
                  <th scope="col" key={index}>
                    {index + 1} 月
                  </th>
                ))}
                <th scope="col">年平均</th>
              </tr>
            </thead>
            <tbody>
              {result.summary.monthly_speed.map((row, index) => (
                <tr key={index}>
                  <th scope="row">{names[index]}</th>
                  {row.map((value, month) => (
                    <td key={month}>
                      {value === null ? "—" : value.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="ww-concurrent-zoom">
        <div className="ww-chart-actions" aria-label="时间轴缩放" role="group">
          <button
            className="ww-button"
            type="button"
            disabled={busy || span < 120}
            onClick={() =>
              void zoom({
                start: view.start + span / 4,
                end: view.end - span / 4,
              })
            }
          >
            放大 ×2
          </button>
          <button
            className="ww-button"
            type="button"
            disabled={busy || !detail}
            onClick={() =>
              void zoom({
                start: view.start - span / 2,
                end: view.end + span / 2,
              })
            }
          >
            缩小
          </button>
          <button
            className="ww-button"
            type="button"
            disabled={!detail && !busy}
            onClick={reset}
          >
            恢复全时段
          </button>
        </div>
        <p className="ww-inline-note">
          拖选任一图的时间段可同步放大两张曲线。{windowLabel(view.start)} →{" "}
          {windowLabel(view.end)}
        </p>
        {busy && <p role="status">正在载入该时段的曲线…</p>}
        {error && <p role="alert">{error}</p>}
      </div>
      <ConcurrentChart
        metric="speed"
        view={view}
        legend={speed}
        onZoom={(range) => void zoom(range)}
      />
      <ConcurrentChart
        metric="direction"
        view={view}
        legend={direction}
        onZoom={(range) => void zoom(range)}
      />
      <div className="ww-concurrent-grid ww-concurrent-roses">
        {(["direction", "energy"] as const).map((metric) => {
          const [a, b] = result.summary[metric];
          const items =
            metric === "direction"
              ? direction
              : legendFor(EXCEL.series[0], EXCEL.series[1]);
          const primary = a.length ? 0 : 1;
          const title =
            metric === "direction" ? "风向频率玫瑰" : "风能频率玫瑰";
          return (
            <section key={metric}>
              <h3>{title}</h3>
              <SourceLegend items={items} />
              <RoseChart
                rows={primary === 0 ? a : b}
                title={title}
                energy={metric === "energy"}
                compact
                lineColor={items[primary].color}
                overlay={
                  a.length && b.length
                    ? { rows: b, color: items[1].color }
                    : undefined
                }
              />
            </section>
          );
        })}
      </div>
      <p className="ww-inline-note">
        玫瑰图按原分析时段统计，16
        扇区；风能基于同期风速和风向配对，并按风速立方加权。
      </p>
    </div>
  );
}
