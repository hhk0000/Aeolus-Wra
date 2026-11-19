import { useId } from "react";

import type { AxisMinimumSetting } from "./axisRange";
export function AxisMinimum({
  setting,
  onChange,
  unit,
  minimum,
  fallback,
  invalid,
}: {
  setting: AxisMinimumSetting;
  onChange: (setting: AxisMinimumSetting) => void;
  unit: string;
  minimum: number;
  fallback: number;
  invalid: boolean;
}) {
  const id = useId();
  return (
    <div className="ww-axis-minimum">
      <label>
        纵轴下限
        <select
          aria-label="纵轴下限"
          value={setting.mode}
          onChange={(event) =>
            onChange({
              ...setting,
              mode: event.target.value as AxisMinimumSetting["mode"],
            })
          }
        >
          <option value="default">默认（{fallback}）</option>
          <option value="auto">自动贴近数据</option>
          <option value="custom">手动设置</option>
        </select>
      </label>
      {setting.mode === "custom" && (
        <label>
          <input
            aria-label={`纵轴下限数值（${unit}）`}
            type="number"
            min="0"
            max={minimum}
            step="any"
            value={setting.custom}
            aria-invalid={invalid}
            aria-describedby={invalid ? id : undefined}
            onChange={(event) =>
              onChange({ ...setting, custom: event.target.value })
            }
          />
          {unit}
        </label>
      )}
      {invalid && (
        <span id={id} role="status">
          请输入 0 至 {minimum} 之间的数值。当前使用默认下限。
        </span>
      )}
    </div>
  );
}
