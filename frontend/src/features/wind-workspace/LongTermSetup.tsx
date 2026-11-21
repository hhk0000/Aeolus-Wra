import {
  applySourceDefaults,
  nextAnniversary,
  useErrorFocus,
} from "./autoSetup";
import { useState } from "react";
import { filesForTower, longTermErrors } from "./model";
import type { WorkspaceViewProps } from "./model";
import type { GalleryTarget } from "./ResultsWorkspace";
import { api, means } from "./api";
import type { Run } from "./api";
import { ChannelOptions } from "./CalculationPanel";

export default function LongTermSetup({
  state,
  onChange,
  onNotice,
  onOpenGallery,
}: WorkspaceViewProps & {
  onOpenGallery?: (target?: GalleryTarget) => void;
}) {
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
  const errorsRef = useErrorFocus<HTMLUListElement>(
    showErrors && errors.length ? errors.join("；") : "",
  );
  const apiErrorRef = useErrorFocus<HTMLParagraphElement>(apiError);
  const reference = references.find(
    (f) => f.id === state.longTerm.fileId,
  )?.dataset;
  const span =
    new Date(tower.analysisEnd).getTime() -
    new Date(tower.analysisStart).getTime();
  const referenceEnd =
    tower.analysisStart && span >= 365 * 86400000
      ? nextAnniversary(tower.analysisStart)
      : tower.analysisEnd;
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
        throw new Error("请先导入中尺度与结果数据，文件将自动关联。");
      const channels = means(reference).filter(
        (c) => c.height === Number(state.longTerm.height),
      );
      if (channels.length !== 1)
        throw new Error("参考高度的风速通道未唯一匹配，请核对映射。");
      const response = await api<Run>("/long-term", {
        tower_name: tower.name,
        reference_id: reference.id,
        result_id: result.id,
        speed_channel: channels[0].id,
        direction_channel: state.longTerm.directionChannel || undefined,
        start: tower.analysisStart,
        end: referenceEnd,
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
        "周年序列、同期黄柱与中尺度均值已计算；不足完整年数的均值线已停止绘制。",
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
                  onChange((current) => {
                    const file = current.files.find(
                      (f) => f.id === e.target.value,
                    );
                    return file ? applySourceDefaults(current, file) : current;
                  })
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
            <details className="ww-wide">
              <summary>时间设置（高级）</summary>
              <p>
                已沿用文件导入时的时间设置：
                {reference?.options.timezone || "导入后自动识别"}
                。如需更改，在数据资料中展开对应文件的导入设置。
              </p>
            </details>
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
              {referenceEnd || "结束日期待确认"}
            </strong>
            <small>按结果数据起点逐周年分组；已自动沿用导入的时间设置。</small>
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
            aria-label="逐年柱图、同期黄柱、中尺度均值线的布局示意，不含计算数据"
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
        <ul
          className="ww-error-list"
          role="alert"
          ref={errorsRef}
          tabIndex={-1}
        >
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
        <p className="ww-error" role="alert" ref={apiErrorRef} tabIndex={-1}>
          {apiError}
        </p>
      )}
      {state.longTermRuns[tower.id] &&
        (() => {
          const latest = state.longTermRuns[tower.id];
          const annual = latest.outputs["reference-years"];
          const rows = (annual?.rows ?? []) as Record<string, unknown>[];
          const concurrentRow = rows.find((r) => r.concurrent === true);
          const concurrentSpeed =
            typeof concurrentRow?.mean_speed === "number"
              ? concurrentRow.mean_speed
              : undefined;
          const windowMeans = (
            Array.isArray(annual?.summary?.means) ? annual.summary?.means : []
          ) as { years: number; mean_speed: number | null }[];
          const baselineWindow = windowMeans.find(
            (m) => typeof m.mean_speed === "number" && m.mean_speed > 0,
          );
          const deviation =
            concurrentSpeed !== undefined &&
            concurrentRow?.complete === true &&
            typeof baselineWindow?.mean_speed === "number"
              ? ((concurrentSpeed - baselineWindow.mean_speed) /
                  baselineWindow.mean_speed) *
                100
              : undefined;
          const windYearClass =
            deviation === undefined
              ? "—"
              : Math.abs(deviation) <= 2
                ? `平风年 (${deviation >= 0 ? "+" : ""}${deviation.toFixed(2)}%)`
                : deviation > 2
                  ? `大风年 (+${deviation.toFixed(2)}%)`
                  : `小风年 (${deviation.toFixed(2)}%)`;
          const roseReady =
            latest.outputs["reference-rose"]?.status === "ready";
          return (
            <div
              className="ww-inline-feedback"
              role="region"
              aria-label="长期参考计算成果速览"
            >
              <div className="ww-inline-feedback-head">
                <div>
                  <strong>长期参考与同期风况成果已就绪</strong>
                  <span>
                    最近运行：{new Date(latest.created_at).toLocaleString()} ·
                    运行标识 {latest.id.slice(0, 10)}
                  </span>
                </div>
                {onOpenGallery && (
                  <button
                    type="button"
                    className="ww-text-button"
                    onClick={() =>
                      onOpenGallery({
                        filter: "reference",
                        activeId: "reference-years",
                      })
                    }
                  >
                    打开长期年际图 →
                  </button>
                )}
              </div>
              <div className="ww-inline-metrics">
                <div>
                  <span>测风同期中尺度风速</span>
                  <strong>
                    {concurrentSpeed !== undefined
                      ? `${concurrentSpeed.toFixed(2)} m/s`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>
                    长期基准均值
                    {baselineWindow ? ` (${baselineWindow.years}年)` : ""}
                  </span>
                  <strong>
                    {typeof baselineWindow?.mean_speed === "number"
                      ? `${baselineWindow.mean_speed.toFixed(2)} m/s`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>测风年风年判定</span>
                  <strong>{windYearClass}</strong>
                </div>
                <div>
                  <span>已统计周年序列</span>
                  <strong>{rows.length} 个分析年</strong>
                </div>
              </div>
              {onOpenGallery && (
                <div
                  className="ww-inline-pills"
                  aria-label="快捷打开长期参考图表"
                >
                  <span>直达图表：</span>
                  <button
                    type="button"
                    className="ww-inline-pill"
                    onClick={() =>
                      onOpenGallery({
                        filter: "reference",
                        activeId: "reference-years",
                      })
                    }
                  >
                    长期年际风速变化 ↗
                  </button>
                  {roseReady && (
                    <button
                      type="button"
                      className="ww-inline-pill"
                      onClick={() =>
                        onOpenGallery({
                          filter: "reference",
                          activeId: "reference-rose",
                        })
                      }
                    >
                      长期累计风向玫瑰 ↗
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      <div className="ww-save-bar">
        <p>配置同时用于长期年际柱图、均值线和累计风向图。</p>
        <div className="ww-save-actions">
          {onOpenGallery && (
            <button
              type="button"
              className="ww-button"
              disabled={!state.longTermRuns[tower.id]}
              onClick={() =>
                onOpenGallery({
                  filter: "reference",
                  activeId: "reference-years",
                })
              }
            >
              查看长期参考图表 →
            </button>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? "正在统计周年与长期窗口…" : "执行长期参考分析 →"}
          </button>
        </div>
      </div>
    </div>
  );
}
