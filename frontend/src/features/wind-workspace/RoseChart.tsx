import { useState } from "react";
import { useChartTextSize } from "./chartText";
import { EXCEL } from "./chartTheme";
import { computeRoseNiceScale } from "./chartScale";

type Row = Record<string, unknown>;

/**
 * Excel radar (wind-rose) chart: polygonal rings, 16 compass labels, percent
 * labels along the vertical axis, thin blue line, no markers or centre hole.
 */
export function RoseChart({
  rows,
  title,
  energy = false,
  rose = "line",
  zoom = "1",
  compact = false,
  radialMax,
  lineColor,
  overlay,
}: {
  rows: Row[];
  title: string;
  energy?: boolean;
  rose?: string;
  zoom?: string;
  compact?: boolean;
  radialMax?: number;
  lineColor?: string;
  overlay?: { rows: Row[]; color: string };
}) {
  const textSize = useChartTextSize();
  const [hover, setHover] = useState("");
  const w = 760,
    h = 616,
    cx = 380,
    cy = 308;
  const compassSize = textSize(compact ? 26 : 16);
  const percentageSize = textSize(compact ? (overlay ? 20 : 24) : 15);
  const labelGap = Math.max(26, Math.ceil(compassSize * 0.9));
  const longestLabel = Math.max(
    1,
    ...rows.map((row) => String(row.label ?? row.degrees ?? "").length),
  );
  const framePadding = 14;
  const labelR = Math.min(
    284,
    cy - Math.ceil(compassSize * 0.72) - framePadding,
    cx - Math.ceil((longestLabel * compassSize) / 2) - framePadding,
  );
  const maxR = Math.max(80, labelR - labelGap);
  const key = energy ? "energy_frequency" : "frequency";
  const color = lineColor ?? EXCEL.series[energy ? 1 : 0];
  const rawMax = Math.max(
    0.001,
    ...[...rows, ...(overlay?.rows ?? [])].map((r) => Number(r[key]) || 0),
  );
  const roseScale = computeRoseNiceScale(Math.max(rawMax, radialMax ?? 0));
  const max = roseScale.max;
  const point = (a: number, r: number): [number, number] => [
    cx + Math.sin((a * Math.PI) / 180) * r,
    cy - Math.cos((a * Math.PI) / 180) * r,
  ];
  const angleOf = (r: Row) =>
    Number.isFinite(Number(r.degrees)) && r.degrees !== undefined
      ? Number(r.degrees)
      : (360 / Math.max(1, rows.length)) * (Number(r.sector ?? 0) + 0.5);
  if (!rows.length)
    return (
      <div className="ww-simple-empty">
        <p>暂无可绘制的方向数据</p>
      </div>
    );
  const ringValues = roseScale.ticks;
  const ringPoints = (value: number) =>
    rows
      .map((r) => point(angleOf(r), (value / max) * maxR).join(","))
      .join(" ");
  return (
    <figure className={`ww-rose-figure${compact ? " ww-rose-compact" : ""}`}>
      <figcaption>{title}</figcaption>
      <div className="ww-plot-scroll">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={title}
          fontFamily={EXCEL.font}
          fontWeight="700"
          fontSize={percentageSize}
          style={{
            width: `calc(${Math.max(1, Number(zoom) || 1) * 100}% * var(--ww-plot-scale, 1))`,
            background: "white",
          }}
        >
          {ringValues.map((value) => (
            <g key={value}>
              <polygon
                points={ringPoints(value)}
                fill="none"
                stroke={EXCEL.grid}
                strokeWidth="1"
              />
              <text
                x={cx + 6}
                y={cy - (value / max) * maxR + (overlay ? 10 : 4)}
                fontSize={percentageSize}
                fill={EXCEL.text}
              >
                {value.toFixed(0)}%
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const a = angleOf(r);
            const end = point(a, maxR);
            return (
              <line
                key={i}
                x1={cx}
                y1={cy}
                x2={end[0]}
                y2={end[1]}
                stroke={EXCEL.grid}
                strokeWidth="1"
              />
            );
          })}
          {rows.map((r, i) => {
            const a = angleOf(r);
            const label = point(a, labelR);
            return (
              <text
                key={i}
                x={label[0]}
                y={label[1] + Math.round(compassSize * 0.32)}
                textAnchor="middle"
                fontSize={compassSize}
                fill={EXCEL.text}
              >
                {String(r.label ?? a)}
              </text>
            );
          })}
          <polygon
            points={rows
              .map((r) =>
                point(angleOf(r), (Number(r[key]) / max) * maxR).join(","),
              )
              .join(" ")}
            fill={rose === "filled" ? color : "none"}
            fillOpacity={rose === "filled" ? 0.25 : 0}
            stroke={color}
            strokeWidth={EXCEL.roseLineWidth}
          />
          {!!overlay?.rows.length && (
            <polygon
              points={overlay.rows
                .map((r) =>
                  point(angleOf(r), (Number(r[key]) / max) * maxR).join(","),
                )
                .join(" ")}
              fill="none"
              stroke={overlay.color}
              strokeWidth="3.2"
              strokeDasharray="10 5"
            />
          )}
          {rows.map((r, i) => {
            const a = angleOf(r);
            const p = point(a, (Number(r[key]) / max) * maxR);
            return (
              <circle
                key={i}
                cx={p[0]}
                cy={p[1]}
                r={7}
                fill="transparent"
                onMouseEnter={() =>
                  setHover(`${r.label}: ${Number(r[key]).toFixed(2)}%`)
                }
              >
                <title>
                  {String(r.label)} · {Number(r[key]).toFixed(2)}%
                </title>
              </circle>
            );
          })}
          <text x={framePadding} y={28} fontSize={EXCEL.tickSize + 2}>
            {hover}
          </text>
          <rect
            x="0.5"
            y="0.5"
            width={w - 1}
            height={h - 1}
            fill="none"
            stroke={EXCEL.plotBorder}
            strokeWidth="1"
          />
        </svg>
      </div>
    </figure>
  );
}
