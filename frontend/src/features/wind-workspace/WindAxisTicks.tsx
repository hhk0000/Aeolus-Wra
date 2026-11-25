import { EXCEL, frequencyTickStep, windAxes } from "./chartTheme";

export function FrequencyAxisTicks({
  left,
  right,
  maximum,
  y,
}: {
  left: number;
  right: number;
  maximum: number;
  y: (value: number) => number;
}) {
  return Array.from({ length: maximum / frequencyTickStep + 1 }, (_, index) => {
    const value = index * frequencyTickStep;
    const position = y(value);
    return (
      <g key={value} data-axis-tick="frequency">
        <line
          x1={left}
          x2={right}
          y1={position}
          y2={position}
          stroke={EXCEL.grid}
        />
        <text
          x={left - 6}
          y={position + 4}
          textAnchor="end"
          fill={EXCEL.series[0]}
        >
          {value}
        </text>
      </g>
    );
  });
}

export function WindAxisTicks({
  left,
  right,
  maximum,
  y,
}: {
  left: number;
  right: number;
  maximum: (field: string) => number;
  y: (value: number, field: string) => number;
}) {
  return windAxes.flatMap(({ field, step }, side) =>
    Array.from({ length: Math.round(maximum(field) / step) + 1 }, (_, i) => {
      const tick = i * step;
      const position = y(tick, field);
      return (
        <g key={`${field}-${i}`} data-axis-tick={field}>
          <line
            x1={side ? right : left}
            x2={side ? right + 4 : right}
            y1={position}
            y2={position}
            stroke={side ? EXCEL.axis : EXCEL.grid}
          />
          <text
            x={side ? right + 7 : left - 6}
            y={position + 4}
            textAnchor={side ? "start" : "end"}
            fill={EXCEL.series[side]}
          >
            {tick}
          </text>
        </g>
      );
    }),
  );
}
