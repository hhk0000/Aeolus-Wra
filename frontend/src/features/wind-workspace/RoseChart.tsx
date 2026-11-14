import { useState } from "react";

type Row = Record<string, unknown>;

/** Shared wind-rose drawing used by interactive and long-term reference charts. */
export function RoseChart({
  rows,
  title,
  energy = false,
  rose = "line",
  zoom = "1",
}: {
  rows: Row[];
  title: string;
  energy?: boolean;
  rose?: string;
  zoom?: string;
}) {
  const [hover, setHover] = useState("");
  const w = 900,
    h = 640,
    cx = 450,
    cy = 310,
    base = 80,
    maxR = 200;
  const key = energy ? "energy_frequency" : "frequency";
  const max = Math.max(0.001, ...rows.map((r) => Number(r[key]) || 0)) * 1.1;
  const point = (a: number, r: number): [number, number] => [
    cx + Math.sin((a * Math.PI) / 180) * r,
    cy - Math.cos((a * Math.PI) / 180) * r,
  ];
  if (!rows.length)
    return (
      <div className="ww-simple-empty">
        <p>暂无可绘制的方向数据</p>
      </div>
    );
  return (
    <figure style={{ margin: 0 }}>
      <figcaption>{title}</figcaption>
      <div className="ww-plot-scroll">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={title}
          style={{
            width: `${Math.max(1, Number(zoom) || 1) * 100}%`,
            minWidth: 560,
            background: "white",
          }}
        >
          <text x={cx} y="24" textAnchor="middle" fontSize="12">
            {hover || title}
          </text>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const r = base + t * maxR;
            const tick = point(45, r + 6);
            return (
              <g key={t}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke="#dce5df"
                  strokeDasharray="3 3"
                />
                <text x={tick[0]} y={tick[1]} fontSize="10" fill="#7f9487">
                  {(max * t).toFixed(1)}%
                </text>
              </g>
            );
          })}
          {rows.map((r, i) => {
            const a = Number(r.degrees),
              da = 180 / rows.length;
            const r1 = base + (Number(r[key]) / max) * maxR;
            const p1 = point(a - da, r1),
              p2 = point(a + da, r1),
              p3 = point(a + da, base),
              p4 = point(a - da, base),
              label = point(a, base + maxR + 22);
            return (
              <g
                key={i}
                onMouseEnter={() =>
                  setHover(`${r.label}: ${Number(r[key]).toFixed(2)}%`)
                }
              >
                <line
                  x1={cx}
                  y1={cy}
                  x2={label[0]}
                  y2={label[1]}
                  stroke="#edf0ee"
                />
                {rose === "filled" && (
                  <path
                    d={`M${p1} A${r1},${r1} 0 0 1 ${p2} L${p3} A${base},${base} 0 0 0 ${p4} Z`}
                    fill="#326f35"
                  />
                )}
                <text
                  x={label[0]}
                  y={label[1]}
                  textAnchor="middle"
                  fontSize="11"
                >
                  {a}°
                </text>
                <title>
                  {String(r.label)} · {Number(r[key]).toFixed(2)}%
                </title>
              </g>
            );
          })}
          {rose === "line" && (
            <polygon
              points={rows
                .map((r) =>
                  point(
                    Number(r.degrees),
                    base + (Number(r[key]) / max) * maxR,
                  ).join(","),
                )
                .join(" ")}
              fill="none"
              stroke="#326f35"
              strokeWidth="2"
            />
          )}
          <circle cx={cx} cy={cy} r={base} fill="#f6f7f6" stroke="#a5b5aa" />
        </svg>
      </div>
    </figure>
  );
}
