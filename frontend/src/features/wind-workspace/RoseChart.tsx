import { useState } from "react";
import { useChartTextSize } from "./chartText";
import { EXCEL } from "./chartTheme";

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
}: {
  rows: Row[];
  title: string;
  energy?: boolean;
  rose?: string;
  zoom?: string;
  compact?: boolean;
  radialMax?: number;
}) {
  const textSize = useChartTextSize();
  const [hover, setHover] = useState("");
  const w = 900,
    h = 680,
    cx = 450,
    cy = 340,
    maxR = 280,
    labelR = maxR + 36;
  const key = energy ? "energy_frequency" : "frequency";
  const color = EXCEL.series[energy ? 1 : 0];
  const rawMax = Math.max(0.001, ...rows.map((r) => Number(r[key]) || 0));
  const max = Math.max(1, Math.ceil(Math.max(rawMax, radialMax ?? 0) / 5) * 5);
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
  const ringValues = [0.2, 0.4, 0.6, 0.8, 1].map((t) => max * t);
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
          fontSize={textSize(compact ? 30 : 17)}
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
                y={cy - (value / max) * maxR + 4}
                fontSize={textSize(compact ? 30 : 17)}
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
                y={label[1]}
                textAnchor="middle"
                fontSize={textSize(compact ? 34 : 18)}
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
            strokeWidth="2"
          />
          {rows.map((r, i) => {
            const a = angleOf(r);
            const p = point(a, (Number(r[key]) / max) * maxR);
            return (
              <circle
                key={`marker-${i}`}
                cx={p[0]}
                cy={p[1]}
                r={3}
                fill={color}
              />
            );
          })}
          {rows.map((r, i) => {
            const a = angleOf(r);
            const p = point(a, (Number(r[key]) / max) * maxR);
            return (
              <circle
                key={i}
                cx={p[0]}
                cy={p[1]}
                r={6}
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
          <text x={cx} y={28} textAnchor="middle" fontSize={EXCEL.tickSize + 2}>
            {hover}
          </text>
          <rect
            x="1"
            y="1"
            width={w - 2}
            height={h - 2}
            fill="none"
            stroke={EXCEL.axis}
            strokeWidth="2"
          />
        </svg>
      </div>
    </figure>
  );
}
