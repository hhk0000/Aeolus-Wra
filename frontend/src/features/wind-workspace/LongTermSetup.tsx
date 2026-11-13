import { useState } from "react";
import { filesForTower, longTermErrors } from "./model";
import type { WorkspaceViewProps } from "./model";
import { api, means } from "./api";
import type { Run } from "./api";
import { ChannelOptions } from "./CalculationPanel";

export default function LongTermSetup({
  state,
  onChange,
  onNotice,
}: WorkspaceViewProps) {
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState("");
  const tower = state.towers.find((t) => t.id === state.activeTowerId)!;
  const references = filesForTower(state, "reference");
  const years = [
    ...new Set(
      state.longTerm.windows
        .split(/[,，\s]+/)
        .filter(Boolean)
        .map(Number),
    ),
  ].filter((n) => Number.isInteger(n) && n > 0 && n <= 100);
  const errors = longTermErrors(state);
  const reference = references.find(
    (f) => f.id === state.longTerm.fileId,
  )?.dataset;
  async function run() {
    setShowErrors(true);
    if (errors.length) return;
    setApiError("");
    setBusy(true);
    try {
      const result = filesForTower(state, "result").find(
        (f) => f.id === state.analysis.resultFileId,
      )?.dataset;
      if (!reference || !result)
        throw new Error(
          "请解析中尺度与结果文件，并在风资源分析中选择本次结果文件。",
        );
      if (reference.options.timezone !== state.longTerm.timezone)
        throw new Error(
          "此处时间基准与中尺度解析记录不一致；请核对来源，在数据资料中重新解析后使用。",
        );
      const channels = means(reference).filter(
        (c) => c.height === Number(state.longTerm.height),
      );
      if (channels.length !== 1)
        throw new Error("参考高度的风速通道未唯一匹配，请核对映射。");
      const response = await api<Run>("/long-term", {
        reference_id: reference.id,
        result_id: result.id,
        speed_channel: channels[0].id,
        direction_channel: state.longTerm.directionChannel || undefined,
        start: tower.analysisStart,
        end: tower.analysisEnd,
        timezone: tower.timezone,
        windows: years,
        direction_period: state.longTerm.directionPeriod,
      });
      onChange((current) => ({
        ...current,
        longTermRuns: { ...current.longTermRuns, [tower.id]: response },
        planSaved: true,
      }));
      onNotice(
        "周年序列、同期红柱与长期均值已计算；不足完整年数的均值线已停止绘制。",
      );
    } catch (e) {
      setApiError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="ww-section-heading">
        <div>
          <h2>用同一分析年，对照长期风况</h2>
          <p>以结果数据的日期为基准，组织长期窗口和同期对比。</p>
        </div>
        <span className="ww-source-chip reference">中尺度数据</span>
      </div>
      <div className="ww-longterm-layout">
        <section className="ww-panel">
          <span className="ww-overline">REFERENCE PERIOD</span>
          <h2>长期参考配置</h2>
          <div className="ww-fields ww-fields-two">
            <label className="ww-wide">
              中尺度文件
              <select
                value={state.longTerm.fileId}
                onChange={(e) =>
                  onChange((current) => ({
                    ...current,
                    longTerm: { ...current.longTerm, fileId: e.target.value },
                    planSaved: false,
                  }))
                }
              >
                <option value="">选择已添加的中尺度数据</option>
                {references.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.file.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              中尺度风速高度（m）
              <input
                type="number"
                min="1"
                value={state.longTerm.height}
                onChange={(e) =>
                  onChange((current) => ({
                    ...current,
                    longTerm: { ...current.longTerm, height: e.target.value },
                    planSaved: false,
                  }))
                }
                placeholder="例如 100"
              />
            </label>
            <label>
              中尺度数据时间基准
              <select
                value={state.longTerm.timezone}
                onChange={(e) =>
                  onChange((current) => ({
                    ...current,
                    longTerm: { ...current.longTerm, timezone: e.target.value },
                    planSaved: false,
                  }))
                }
              >
                <option value="">请核对来源说明</option>
                <option value="UTC">UTC</option>
                <option value="Etc/GMT-8">
                  固定 UTC+8（不应用历史夏令时）
                </option>
                <option value="Asia/Shanghai">
                  上海时区（含历史夏令时规则）
                </option>
              </select>
            </label>
            <label className="ww-wide">
              长期统计窗口（年）
              <input
                value={state.longTerm.windows}
                onChange={(e) =>
                  onChange((current) => ({
                    ...current,
                    longTerm: { ...current.longTerm, windows: e.target.value },
                    planSaved: false,
                  }))
                }
                placeholder="30, 20, 10"
              />
              <small>以分析年为基准滑动截取，年数可以修改。</small>
            </label>
            <label className="ww-wide">
              累计风向统计范围
              <select
                value={state.longTerm.directionPeriod}
                onChange={(e) =>
                  onChange((current) => ({
                    ...current,
                    longTerm: {
                      ...current.longTerm,
                      directionPeriod: e.target.value as
                        "baseline" | "concurrent",
                    },
                    planSaved: false,
                  }))
                }
              >
                <option value="baseline">分别统计所选长期窗口</option>
                <option value="concurrent">与结果数据同期的参考数据</option>
              </select>
            </label>
          </div>
          <div className="ww-period-anchor">
            <span>结果数据分析年</span>
            <strong>
              {tower.analysisStart || "开始日期待确认"} <span>→</span>{" "}
              {tower.analysisEnd || "结束日期待确认"}
            </strong>
            <small>在“风资源分析”页确认；不会自动改用自然年。</small>
          </div>
        </section>
        <section className="ww-panel ww-longterm-preview">
          <div className="ww-section-heading">
            <div>
              <span className="ww-overline">CHART COMPOSITION</span>
              <h2>长期年际图的组成</h2>
            </div>
            <span className="ww-quiet-tag">布局示意</span>
          </div>
          <div
            className="ww-annual-skeleton"
            aria-label="逐年柱图、同期红柱、长期均值线的布局示意，不含计算数据"
          >
            <div className="ww-placeholder-bars">
              {Array.from({ length: 18 }, (_, i) => (
                <i key={i} />
              ))}
              <i className="concurrent" />
            </div>
            <div className="ww-mean-lines">
              {years.slice(0, 4).map((year, i) => (
                <div key={year} style={{ top: `${25 + i * 16}%` }}>
                  <span>{year} 年均值</span>
                </div>
              ))}
            </div>
            <span className="ww-skeleton-label">
              无分析数值，仅展示图表结构
            </span>
          </div>
          <div className="ww-chart-legend">
            <span>
              <i />
              各完整分析年平均风速
            </span>
            <span>
              <i className="red" />
              同期中尺度均值（测风年）
            </span>
          </div>
          <div className="ww-window-list">
            {years.map((year) => (
              <div key={year}>
                <strong>
                  {year}
                  <small>年窗口</small>
                </strong>
                <span>
                  按结果数据日期向前组织完整分析年
                  <small>逐周年检查完整度；缺测时不绘制对应长期均值线</small>
                </span>
              </div>
            ))}
          </div>
          <p className="ww-inline-note">
            参考序列不满所选年数时应明确提示，不用较短序列冒充完整窗口。
          </p>
        </section>
      </div>
      {showErrors && errors.length > 0 && (
        <ul className="ww-error-list" role="alert">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      <section className="ww-panel">
        <div className="ww-fields ww-fields-two">
          <label>
            参考风向通道（可选）
            <select
              value={state.longTerm.directionChannel}
              onChange={(e) =>
                onChange((current) => ({
                  ...current,
                  longTerm: {
                    ...current.longTerm,
                    directionChannel: e.target.value,
                  },
                }))
              }
            >
              <ChannelOptions channels={means(reference, "direction")} />
            </select>
          </label>
          <p>
            时间戳按各自已确认的时区转换，以测风塔分析年周年分组；长期窗口含同期年与之前n−1年。
          </p>
        </div>
      </section>
      {apiError && (
        <p className="ww-error" role="alert">
          {apiError}
        </p>
      )}
      <div className="ww-save-bar">
        <p>配置同时用于长期年际柱图、均值线和累计风向图。</p>
        <button className="primary" disabled={busy} onClick={() => void run()}>
          {busy ? "正在统计周年与长期窗口…" : "执行长期参考分析 →"}
        </button>
      </div>
    </div>
  );
}
