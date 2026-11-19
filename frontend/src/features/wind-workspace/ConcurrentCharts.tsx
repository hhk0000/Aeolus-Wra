import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { api } from "./api";
import { localInput } from "./autoSetup";
import { useChartTextSize } from "./chartText";
import { EXCEL, excelSvgProps } from "./chartTheme";
import { RoseChart } from "./RoseChart";

type Quantity = "speed" | "direction";
type PlotMode = "full" | "monthly";
type Point = [number, number | null, number | null, number, number];
const EMPTY_POINTS: Point[] = [];
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
  monthly_metrics: Timeline["metrics"];
  config: { paired_only: boolean; aggregation: "hourly" | "native" };
  summary: {
    stages: string[];
    monthly_speed: (number | null)[][];
    direction: RoseRow[][];
    energy: RoseRow[][];
  };
};
type Legend = { name: string; color: string; dash?: string }[];

function nearestPoint(points: Point[], time: number) {
  let left = 0;
  let right = points.length - 1;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (points[middle][0] < time) left = middle + 1;
    else right = middle;
  }
  return left > 0 && time - points[left - 1][0] <= points[left][0] - time
    ? left - 1
    : left;
}

function SourceLegend({ items }: { items: Legend }) {
  return (
    <div className="ww-plot-legend" aria-label="数据来源">
      {items.map(({ name, color, dash }) => (
        <span key={name}>
          <i
            style={{
              borderColor: color,
              borderTopStyle: dash ? "dashed" : undefined,
            }}
          />
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
  monthly,
}: {
  metric: Quantity;
  view: Timeline;
  legend: Legend;
  onZoom: (range: Range) => void;
  monthly: boolean;
}) {
  const label = metric === "speed" ? "风速" : "风向";
  const series = view.metrics[metric];
  const textSize = useChartTextSize();
  const [drag, setDrag] = useState<[number, number]>();
  const [cursorIndex, setCursorIndex] = useState<number>();
  const dragStart = useRef<number | null>(null);
  const points = series?.points ?? EMPTY_POINTS;
  const cursor = cursorIndex === undefined ? undefined : points[cursorIndex];
  const unit = metric === "speed" ? "m/s" : "°";
  const cursorTime = cursor
    ? localInput(new Date(cursor[0] * 1000).toISOString(), view.timezone)
    : "";
  const cursorDate = monthly
    ? cursorTime.slice(0, 7)
    : cursorTime.replace("T", " ");
  const cursorValues = cursor ? [cursor[1], cursor[2]] : [];
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
  const tickCount = axisSize > 24 ? 2 : 4;
  const monthlyTicks = Math.min(tickCount, points.length);
  const tickTimes = monthly
    ? Array.from(
        { length: monthlyTicks },
        (_, index) =>
          points[
            Math.round(
              (index * (points.length - 1)) / Math.max(1, monthlyTicks - 1),
            )
          ][0],
      )
    : Array.from(
        { length: tickCount },
        (_, index) =>
          view.start + (index * (view.end - view.start)) / (tickCount - 1),
      );
  const left = Math.max(70, axisSize * 2.4),
    right = 862,
    top = axisSize + 13,
    bottom = top + 215;
  const x = useCallback(
    (time: number) =>
      left + ((right - left) * (time - view.start)) / (view.end - view.start),
    [left, right, view.start, view.end],
  );
  const y = useCallback(
    (value: number) =>
      bottom - ((bottom - top) * Math.max(0, Math.min(max, value))) / max,
    [bottom, top, max],
  );
  const paths = useMemo(
    () =>
      ([0, 1] as const).map((side) => {
        let lastSegment: number | undefined;
        return points
          .map((point) => {
            const value = point[side === 0 ? 1 : 2];
            if (value === null) return "";
            const segment = point[side === 0 ? 3 : 4];
            const coordinates =
              x(point[0]).toFixed(2) + " " + y(value).toFixed(2);
            const command =
              lastSegment === segment
                ? "L" + coordinates
                : "M" + coordinates + "h0.01";
            lastSegment = segment;
            return command;
          })
          .join(" ");
      }),
    [points, x, y],
  );
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
          {series.paired} {monthly ? "个月" : "条"}
          {!monthly &&
            series.visible > points.length &&
            ` · 绘图抽样 ${points.length} 点`}
        </p>
      )}
      <SourceLegend items={legend} />
      {points.length > 0 ? (
        <>
          <div
            className="ww-concurrent-readout"
            aria-label={label + "光标数值"}
          >
            {cursor ? (
              <>
                <strong>{cursorDate}</strong>
                {cursorValues.map((value, side) => (
                  <span key={side} style={{ color: legend[side].color }}>
                    {legend[side].name}{" "}
                    {value === null ? "—" : `${value.toFixed(2)} ${unit}`}
                  </span>
                ))}
              </>
            ) : (
              <span>移动鼠标查看两侧数值，键盘可用方向键逐点查看。</span>
            )}
          </div>
          <div
            className="ww-plot-scroll"
            tabIndex={0}
            role="slider"
            aria-label={label + "读数光标"}
            aria-valuemin={1}
            aria-valuemax={points.length}
            aria-valuenow={(cursorIndex ?? 0) + 1}
            aria-valuetext={
              cursor
                ? [
                    cursorDate,
                    ...cursorValues.map(
                      (value, side) =>
                        legend[side].name +
                        " " +
                        (value === null
                          ? "缺测"
                          : value.toFixed(2) + " " + unit),
                    ),
                  ].join("，")
                : undefined
            }
            onKeyDown={(event) => {
              const key = event.key;
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(
                  key,
                )
              )
                return;
              if (key !== "Escape") event.preventDefault();
              setCursorIndex((current) => {
                if (key === "Escape") return undefined;
                if (key === "Home") return 0;
                if (key === "End") return points.length - 1;
                const offset = key === "ArrowRight" ? 1 : -1;
                return Math.min(
                  points.length - 1,
                  Math.max(0, (current ?? 0) + offset),
                );
              });
            }}
          >
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
                return (
                  <g key={side}>
                    <path
                      data-side={side}
                      d={paths[side]}
                      fill="none"
                      stroke={legend[side].color}
                      strokeWidth={side === 0 ? 1.6 : 2}
                      strokeLinecap="round"
                      strokeDasharray={legend[side].dash}
                      opacity="0.87"
                    />
                    {monthly &&
                      points.map((point) => {
                        const value = point[side === 0 ? 1 : 2];
                        return value === null ? null : (
                          <circle
                            key={point[0]}
                            data-month-point={side}
                            cx={x(point[0])}
                            cy={y(value)}
                            r="3.5"
                            fill={legend[side].color}
                          />
                        );
                      })}
                  </g>
                );
              })}
              {tickTimes.map((time, index) => {
                const date = localInput(
                  new Date(time * 1000).toISOString(),
                  view.timezone,
                );
                return (
                  <text
                    key={time}
                    x={x(time)}
                    y={bottom + axisSize + 5}
                    textAnchor={
                      index === 0
                        ? "start"
                        : index === tickTimes.length - 1
                          ? "end"
                          : "middle"
                    }
                    fontSize={axisSize}
                  >
                    {monthly
                      ? date.slice(0, 7)
                      : view.end - view.start > 90 * 86400
                        ? date.slice(0, 10)
                        : date.slice(5).replace("T", " ")}
                  </text>
                );
              })}
              {cursor && !drag && (
                <g className="ww-concurrent-cursor" pointerEvents="none">
                  <line
                    x1={x(cursor[0])}
                    x2={x(cursor[0])}
                    y1={top}
                    y2={bottom}
                    stroke="#4d6759"
                    strokeWidth="1.5"
                    strokeDasharray="5 4"
                  />
                  {cursorValues.map((value, side) =>
                    value === null ? null : (
                      <circle
                        key={side}
                        cx={x(cursor[0])}
                        cy={y(value)}
                        r="5"
                        fill={legend[side].color}
                        stroke="white"
                        strokeWidth="1.5"
                      />
                    ),
                  )}
                </g>
              )}
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
                  const position = fraction(event);
                  if (start !== null) setDrag([start, position]);
                  else
                    setCursorIndex(
                      nearestPoint(
                        points,
                        view.start + position * (view.end - view.start),
                      ),
                    );
                }}
                onPointerLeave={() => {
                  if (dragStart.current === null) setCursorIndex(undefined);
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
        </>
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
  const [mode, setMode] = useState<PlotMode>("full");
  const monthly = mode === "monthly";
  const [detail, setDetail] = useState<Timeline>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const range = detail ?? result;
  const view: Timeline = monthly
    ? {
        ...range,
        metrics: Object.fromEntries(
          Object.entries(result.monthly_metrics).map(([key, series]) => {
            const points = series.points.filter(
              (point) => point[0] >= range.start && point[0] < range.end,
            );
            return [
              key,
              {
                points,
                visible: points.length,
                counts: [
                  points.filter((point) => point[1] !== null).length,
                  points.filter((point) => point[2] !== null).length,
                ] as [number, number],
                paired: points.filter(
                  (point) => point[1] !== null && point[2] !== null,
                ).length,
              },
            ];
          }),
        ),
      }
    : range;
  const span = view.end - view.start;
  const stages = result.summary.stages;
  const sameStage = (stages[0] === "reference") === (stages[1] === "reference");
  const names = stages.map(
    (stage, index) =>
      `${stage === "reference" ? "中尺度" : "测风塔"}（${index === 0 ? "A" : "B"}）`,
  );
  function legendFor(mast: string): Legend {
    return names.map((name, index) => ({
      name,
      color: stages[index] === "reference" ? "#bd4038" : mast,
      dash: sameStage && index === 1 ? "7 4" : undefined,
    }));
  }
  const speed = legendFor(EXCEL.series[0]);
  const direction = legendFor("#24774b");
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
    if (monthly) {
      setDetail({ ...result, ...window });
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
          <label className="ww-concurrent-mode">
            绘制方式
            <select
              aria-label="绘制方式"
              value={mode}
              onChange={(event) => {
                reset();
                setMode(event.target.value as PlotMode);
              }}
            >
              <option value="full">全时段绘制</option>
              <option value="monthly">按月绘制</option>
            </select>
          </label>
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
        {monthly && (
          <p className="ww-inline-note">
            每个自然月一个数据点。风速取平均值，风向取圆周平均，缩放保留原月均值。
          </p>
        )}
        {busy && <p role="status">正在载入该时段的曲线…</p>}
        {error && <p role="alert">{error}</p>}
      </div>
      <ConcurrentChart
        key={`speed-${mode}-${view.start}-${view.end}`}
        metric="speed"
        view={view}
        legend={speed}
        monthly={monthly}
        onZoom={(range) => void zoom(range)}
      />
      <ConcurrentChart
        key={`direction-${mode}-${view.start}-${view.end}`}
        metric="direction"
        view={view}
        legend={direction}
        monthly={monthly}
        onZoom={(range) => void zoom(range)}
      />
      <div className="ww-concurrent-grid ww-concurrent-roses">
        {(["direction", "energy"] as const).map((metric) => {
          const [a, b] = result.summary[metric];
          const items =
            metric === "direction" ? direction : legendFor(EXCEL.series[0]);
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
