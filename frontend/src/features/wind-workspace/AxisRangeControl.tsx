import { useId } from "react";

import type { AxisRangeSetting } from "./axisRange";
export function AxisRange({
  setting,
  onChange,
  unit,
  lowerDefault,
  upperDefault,
  invalid,
}: {
  setting: AxisRangeSetting;
  onChange: (setting: AxisRangeSetting) => void;
  unit: string;
  lowerDefault: number;
  upperDefault: number;
  invalid: boolean;
}) {
  const id = useId();
  return (
    <div className="ww-axis-minimum">
      <label>
        纵轴范围
        <select
          aria-label="纵轴范围"
          value={setting.mode}
          onChange={(event) =>
            onChange({
              ...setting,
              mode: event.target.value as AxisRangeSetting["mode"],
            })
          }
        >
          <option value="default">默认</option>
          <option value="auto">自动贴近数据</option>
          <option value="custom">手动设置</option>
        </select>
      </label>
      {setting.mode === "custom" &&
        (["lower", "upper"] as const).map((bound) => {
          const label = bound === "lower" ? "下限" : "上限";
          return (
            <label key={bound}>
              {label}
              <input
                aria-label={`纵轴${label}数值（${unit}）`}
                type="number"
                min="0"
                step="any"
                placeholder={String(
                  bound === "lower" ? lowerDefault : upperDefault,
                )}
                value={setting[bound]}
                aria-invalid={invalid}
                aria-describedby={invalid ? id : undefined}
                onChange={(event) =>
                  onChange({ ...setting, [bound]: event.target.value })
                }
              />
              {unit}
            </label>
          );
        })}
      {invalid && (
        <span id={id} role="status">
          上限须大于下限，且范围须覆盖全部数据。当前使用默认范围。
        </span>
      )}
    </div>
  );
}
