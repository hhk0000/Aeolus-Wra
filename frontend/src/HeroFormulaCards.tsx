import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { EXCEL } from "./features/wind-workspace/chartTheme";

const scale = 7;
const shape = 2;
const airDensity = 1.225;
const windSpeeds = Array.from({ length: 81 }, (_, index) => index / 4);
const weibull = windSpeeds.map((speed) => {
  const ratio = speed / scale;
  return (shape / scale) * ratio ** (shape - 1) * Math.exp(-(ratio ** shape));
});
const powerDensity = windSpeeds.map((speed) => (airDensity * speed ** 3) / 2);

function FormulaCard({
  variant,
  title,
  formula,
  description,
  values,
  color,
}: {
  variant: "weibull" | "power";
  title: string;
  formula: ReactNode;
  description: string;
  values: number[];
  color: string;
}) {
  const plot = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = plot.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const { width, height } = canvas;
    const left = 12;
    const right = width - 7;
    const bottom = height - 9;
    const peak = Math.max(...values);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = "#d7e7dc";
    context.lineWidth = 1;
    context.beginPath();
    for (const y of [8, bottom / 2, bottom]) {
      context.moveTo(left, y);
      context.lineTo(right, y);
    }
    context.moveTo(left, 8);
    context.lineTo(left, bottom);
    context.stroke();

    context.beginPath();
    values.forEach((value, index) => {
      const x = left + ((right - left) * index) / (values.length - 1);
      const y = bottom - ((bottom - 12) * value) / peak;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.lineWidth = 3.5;
    context.lineJoin = "round";
    context.strokeStyle = color;
    context.stroke();
    context.lineTo(right, bottom);
    context.lineTo(left, bottom);
    context.closePath();
    context.fillStyle = color;
    context.globalAlpha = 0.11;
    context.fill();
    context.globalAlpha = 1;
  }, [color, values]);

  return (
    <figure className={`hero-formula hero-formula-${variant}`}>
      <figcaption>
        <strong>{title}</strong>
        <span>示意</span>
      </figcaption>
      <div className="hero-equation">{formula}</div>
      <canvas
        ref={plot}
        width="288"
        height="84"
        role="img"
        aria-label={description}
      />
    </figure>
  );
}

export default function HeroFormulaCards() {
  return (
    <div className="hero-formulas">
      <FormulaCard
        variant="weibull"
        title="Weibull 风速分布"
        formula={
          <>
            <span>f(v) = (k/A)</span>{" "}
            <span>
              (v/A)<sup>k−1</sup>
            </span>{" "}
            <span>
              e
              <sup>
                −(v/A)<sup>k</sup>
              </sup>
            </span>
          </>
        }
        description="Weibull 概率密度示意，形状参数 k 为 2，尺度参数 A 为 7 米每秒。"
        values={weibull}
        color={EXCEL.weibull}
      />
      <FormulaCard
        variant="power"
        title="风功率密度"
        formula={
          <>
            P/S = ½ρv<sup>3</sup>
          </>
        }
        description="风功率密度示意，空气密度为 1.225 千克每立方米，风功率密度随风速的三次方增长。"
        values={powerDensity}
        color={EXCEL.series[1]}
      />
    </div>
  );
}
