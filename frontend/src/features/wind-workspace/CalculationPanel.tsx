import { useState } from "react";
import { applySourceDefaults, useErrorFocus } from "./autoSetup";
import { api, means } from "./api";
import type { Channel, Run } from "./api";
import type { SourceKind, WorkspaceViewProps } from "./model";
import { filesForTower } from "./model";

export function ChannelOptions({ channels }: { channels: Channel[] }) {
  return (
    <>
      <option value="">请选择通道</option>
      {channels.map((c) => (
        <option value={c.id} key={c.id}>
          {c.height}m · {c.name} {c.arm ? `· ${c.arm}` : ""}
        </option>
      ))}
    </>
  );
}

export default function CalculationPanel({
  state,
  onChange,
  onNotice,
}: WorkspaceViewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useErrorFocus<HTMLParagraphElement>(error);
  const tower = state.towers.find((t) => t.id === state.activeTowerId)!;
  const config = state.analysis;
  const selected = (kind: SourceKind, id: string) =>
    (
      filesForTower(state, kind).find((f) => f.id === id && f.dataset) ??
      filesForTower(state, kind)
        .filter((f) => f.dataset)
        .at(-1)
    )?.dataset;
  const raw = selected("raw", config.rawFileId),
    qc = selected("qc", config.qcFileId),
    result = selected("result", config.resultFileId);
  function change<K extends keyof typeof config>(
    key: K,
    value: (typeof config)[K],
  ) {
    onChange((current) => ({
      ...current,
      analysis: { ...current.analysis, [key]: value },
      planSaved: false,
    }));
  }
  async function run() {
    setError("");
    setBusy(true);
    try {
      if (!raw && !qc && !result)
        throw new Error("请先拖入测风数据，导入完成后即可分析。");
      const response = await api<Run>("/analysis", {
        raw_id: raw?.id,
        qc_id: qc?.id,
        result_id: result?.id,
        start: tower.analysisStart || undefined,
        end: tower.analysisEnd || undefined,
        observed_start: tower.observedStart || undefined,
        observed_end: tower.observedEnd || undefined,
        qc_period: state.qcPeriod,
        density_method: config.densityMethod,
        temperature_channel: config.temperatureChannel || undefined,
        pressure_channel: config.pressureChannel || undefined,
        altitude_m:
          config.altitude === "" ? undefined : Number(config.altitude),
        manual_density:
          config.manualDensity === ""
            ? undefined
            : Number(config.manualDensity),
        shear_channels: config.shearChannels,
        direction_channel: config.directionChannel || undefined,
        aggregation: config.aggregation,
        sectors: config.sectors,
        calm_threshold: Number(config.calmThreshold),
      });
      onChange((current) => ({
        ...current,
        analysisRuns: { ...current.analysisRuns, [tower.id]: response },
        planSaved: true,
      }));
      const count = Object.values(response.outputs).filter(
        (o) => o.status === "ready",
      ).length;
      onNotice(
        `已生成 ${count} 组真实计算结果；缺少条件的项目已说明原因，可在图表中心查看。`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const latest = state.analysisRuns[tower.id];
  return (
    <section className="ww-panel ww-calculation-panel">
      <div className="ww-section-heading">
        <div>
          <span className="ww-overline">ENGINE · SOURCE & METHOD</span>
          <h2>开始分析</h2>
          <p>已自动使用当前测风塔导入的数据，常规分析无需额外配置。</p>
        </div>
        <span className="ww-quiet-tag">方法版本 1.0.0</span>
      </div>
      <div className="ww-auto-inputs">
        {[
          ["原始数据", raw],
          ["质控数据", qc],
          ["结果数据", result],
        ].map(([label, data]) => (
          <p key={String(label)}>
            <strong>{String(label)}</strong> ·{" "}
            {typeof data === "object" && data
              ? data.filename
              : "尚未导入（可先分析已有资料）"}
          </p>
        ))}
      </div>
      <details className="ww-details">
        <summary>高级设置（常规分析无需填写）</summary>
        <div className="ww-fields ww-fields-three">
          {(
            [
              ["raw", "rawFileId", "原始数据"],
              ["qc", "qcFileId", "质控数据"],
              ["result", "resultFileId", "结果数据"],
            ] as const
          ).map(([kind, key, label]) => (
            <label key={kind}>
              {label}
              <select
                value={config[key]}
                onChange={(e) => {
                  const id = e.target.value;
                  onChange((current) => {
                    const candidates = current.files.filter(
                      (f) =>
                        f.kind === kind &&
                        f.towerId === current.activeTowerId &&
                        f.dataset,
                    );
                    const file = id
                      ? current.files.find(
                          (f) => f.id === id && f.kind === kind,
                        )
                      : candidates.at(-1);
                    if (!file?.dataset)
                      return {
                        ...current,
                        analysis: { ...current.analysis, [key]: id },
                        planSaved: false,
                      };
                    return applySourceDefaults(current, file);
                  });
                }}
              >
                <option value="">自动使用已导入文件</option>
                {filesForTower(state, kind)
                  .filter((f) => f.dataset)
                  .map((f) => (
                    <option value={f.id} key={f.id}>
                      {f.file.name} · {f.dataset!.row_count.toLocaleString()}条
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
        <div className="ww-fields ww-fields-three">
          <label>
            空气密度方法
            <select
              value={config.densityMethod}
              onChange={(e) => change("densityMethod", e.target.value)}
            >
              <option value="measured">国标B2 · 实测温压均值</option>
              <option value="altitude">国标B3 · 气温与海拔估算</option>
              <option value="manual">人工确认固定密度（附来源）</option>
            </select>
          </label>
          {config.densityMethod !== "manual" ? (
            <>
              <label>
                质控气温通道
                <select
                  value={config.temperatureChannel}
                  onChange={(e) => change("temperatureChannel", e.target.value)}
                >
                  <ChannelOptions channels={means(qc, "temperature")} />
                </select>
              </label>
              {config.densityMethod === "measured" ? (
                <label>
                  质控气压通道
                  <select
                    value={config.pressureChannel}
                    onChange={(e) => change("pressureChannel", e.target.value)}
                  >
                    <ChannelOptions channels={means(qc, "pressure")} />
                  </select>
                </label>
              ) : (
                <label>
                  气温仪处海拔（m）
                  <input
                    type="number"
                    step="any"
                    value={config.altitude}
                    onChange={(e) => change("altitude", e.target.value)}
                    placeholder="塔基海拔 + 安装高度"
                  />
                </label>
              )}
            </>
          ) : (
            <label>
              固定密度（kg/m³）
              <input
                type="number"
                min="0.1"
                max="2"
                step="any"
                value={config.manualDensity}
                onChange={(e) => change("manualDensity", e.target.value)}
                placeholder="请填写有来源的密度"
              />
            </label>
          )}
          <label>
            结果风况统计步长
            <select
              value={config.aggregation}
              onChange={(e) => change("aggregation", e.target.value)}
            >
              <option value="hourly">国标18710 · 完整小时均值</option>
              <option value="10min">十分钟序列统计（明确选择）</option>
            </select>
          </label>
          <label>
            结果数据风向通道
            <select
              value={config.directionChannel}
              onChange={(e) => change("directionChannel", e.target.value)}
            >
              <ChannelOptions channels={means(result, "direction")} />
            </select>
          </label>
          <label>
            玫瑰图方位数
            <select
              value={config.sectors}
              onChange={(e) => change("sectors", Number(e.target.value))}
            >
              {[8, 12, 16, 36].map((n) => (
                <option value={n} key={n}>
                  {n}
                  {n === 16 ? " · 国标16方位" : " · 自选图示"}
                </option>
              ))}
            </select>
          </label>
          <label>
            静风阈值（m/s）
            <select
              value={config.calmThreshold}
              onChange={(e) => change("calmThreshold", e.target.value)}
            >
              <option value="0.5">小于0.5单列静风（实现约定）</option>
              <option value="0">不单列，所有配对记录入扇区</option>
            </select>
          </label>
        </div>
        <div className="ww-callout">
          风功率密度使用本次确认的固定密度与每条风速的三次方计算。完整小时模式要求小时内记录齐全；十分钟湍流使用仪器标准差，两者分开统计。
        </div>
        <fieldset className="ww-channel-checks">
          <legend>用于综合切变的实测质控风速层（至少两层、同支臂）</legend>
          {means(qc).map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                checked={config.shearChannels.includes(c.id)}
                onChange={(e) =>
                  change(
                    "shearChannels",
                    e.target.checked
                      ? [...config.shearChannels, c.id]
                      : config.shearChannels.filter((id) => id !== c.id),
                  )
                }
              />
              <span>
                {c.height}m · {c.name}
                <small>{c.arm || "支臂未确认，请返回通道映射填写"}</small>
              </span>
            </label>
          ))}
          {!means(qc).length && (
            <p>选择已解析的质控文件后，在这里确认切变层。</p>
          )}
        </fieldset>
      </details>
      {error && (
        <p className="ww-error" role="alert" ref={errorRef} tabIndex={-1}>
          {error}
        </p>
      )}
      {latest && (
        <p className="ww-inline-note">
          最近运行：{new Date(latest.created_at).toLocaleString()} ·{" "}
          {
            Object.values(latest.outputs).filter((o) => o.status === "ready")
              .length
          }
          组可用 · 运行标识 {latest.id.slice(0, 10)}。修改配置后需重新计算。
        </p>
      )}
      <div className="ww-save-bar">
        <span>自动生成当前数据可计算的图表；缺少资料的项目会单独说明。</span>
        <button className="primary" disabled={busy} onClick={() => void run()}>
          {busy ? "正在计算…" : "开始分析 →"}
        </button>
      </div>
    </section>
  );
}
