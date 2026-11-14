import { useState } from "react";
import { localInput, useErrorFocus } from "./autoSetup";
import { correlationErrors, heightPairs, sourceLabel } from "./model";
import type { CorrelationDraft, WorkspaceViewProps } from "./model";
import { api, means } from "./api";
import type { Run, Dataset } from "./api";
import { parseHeights } from "./model";

function alignedPeriod(
  files: WorkspaceViewProps["state"]["files"],
  towers: WorkspaceViewProps["state"]["towers"],
  leftId: string,
  rightId: string,
) {
  const target = files.find((f) => f.id === leftId)?.dataset;
  if (!target) return null;
  let start = target.start;
  let end = target.end_exclusive;
  const reference = files.find((f) => f.id === rightId)?.dataset;
  if (reference) {
    if (reference.start > start) start = reference.start;
    if (reference.end_exclusive < end) end = reference.end_exclusive;
  }
  if (!start || !end || start >= end) return null;
  const towerId = files.find((f) => f.id === leftId)?.towerId;
  const timezone =
    towers.find((t) => t.id === towerId)?.timezone || "Etc/GMT-8";
  return { start: localInput(start, timezone), end: localInput(end, timezone) };
}

export default function CorrelationSetup({
  state,
  onChange,
  onNotice,
}: WorkspaceViewProps) {
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState("");
  const draft = state.correlation;
  const left = state.files.find((f) => f.id === draft.leftFileId);
  const targets = state.files.filter((f) => f.kind !== "reference");
  const comparisons = state.files.filter((f) =>
    draft.mode === "reference"
      ? f.kind === "reference"
      : f.kind !== "reference" && f.towerId !== left?.towerId,
  );
  const pairs = heightPairs(draft);
  const errors = correlationErrors(state);
  const errorsRef = useErrorFocus<HTMLUListElement>(
    showErrors && errors.length ? errors.join("；") : "",
  );
  const apiErrorRef = useErrorFocus<HTMLParagraphElement>(apiError);
  const alignment = alignedPeriod(
    state.files,
    state.towers,
    draft.leftFileId,
    draft.rightFileId,
  );

  function aligned(
    current: WorkspaceViewProps["state"],
    next: CorrelationDraft,
  ) {
    const range = alignedPeriod(
      current.files,
      current.towers,
      next.leftFileId,
      next.rightFileId,
    );
    return range ? { ...next, ...range } : next;
  }
  function selectFile(key: "leftFileId" | "rightFileId", id: string) {
    onChange((current) => {
      const next: CorrelationDraft = {
        ...current.correlation,
        [key]: id,
        ...(key === "leftFileId" && current.correlation.mode === "cross-tower"
          ? { rightFileId: "" }
          : {}),
      };
      return {
        ...current,
        correlation: aligned(current, next),
      };
    });
  }
  function realign() {
    onChange((current) => ({
      ...current,
      correlation: aligned(current, current.correlation),
    }));
  }

  function change<K extends keyof CorrelationDraft>(
    key: K,
    value: CorrelationDraft[K],
  ) {
    onChange((current) => ({
      ...current,
      correlation: { ...current.correlation, [key]: value },
    }));
  }
  async function save() {
    setShowErrors(true);
    if (errors.length) return;
    setBusy(true);
    setApiError("");
    try {
      const sources = [
        state.files.find((f) => f.id === draft.leftFileId)!,
        ...(draft.mode === "same-tower"
          ? []
          : [state.files.find((f) => f.id === draft.rightFileId)!]),
      ];
      const target = sources[0].dataset,
        reference = (draft.mode === "same-tower" ? sources[0] : sources[1])
          .dataset;
      if (!target || !reference)
        throw new Error("目标与参考文件均须先确认映射并解析。");
      const direction = state.files.find(
        (f) => f.id === draft.directionFileId,
      )?.dataset;
      const findChannel = (
        data: Dataset,
        height: number,
        chosen: string | undefined,
        quantity = "speed",
      ) => {
        const channels = means(data, quantity).filter(
          (c) => c.height === height && (!chosen || c.id === chosen),
        );
        if (channels.length !== 1)
          throw new Error(
            `${height}m ${quantity === "speed" ? "风速" : "风向"}未唯一匹配，请确认同高度支臂通道。`,
          );
        return channels[0].id;
      };
      const directionChannel =
        draft.sectors > 1 && direction
          ? findChannel(
              direction,
              Number(draft.directionHeight),
              undefined,
              "direction",
            )
          : undefined;
      if (draft.sectors > 1 && !direction)
        throw new Error("风向文件须先解析。");
      const runs: Run[] = [];
      for (const [y, x] of pairs) {
        runs.push(
          await api<Run>("/correlations", {
            target_id: target.id,
            reference_id: reference.id,
            target_channel: findChannel(
              target,
              y,
              draft.targetChannels[String(y)],
            ),
            reference_channel: findChannel(
              reference,
              x,
              draft.mode === "same-tower"
                ? draft.targetChannels[String(x)]
                : draft.referenceChannels[String(x)],
            ),
            direction_id: direction?.id,
            direction_channel: directionChannel,
            start: draft.start,
            end: draft.end,
            timezone: state.towers.find((t) => t.id === left?.towerId)
              ?.timezone,
            sectors: draft.sectors,
            aggregation: draft.aggregation,
            through_origin: draft.regression === "through-origin",
          }),
        );
      }
      onChange((current) => ({
        ...current,
        correlationJobs: [
          ...current.correlationJobs,
          {
            ...draft,
            id: crypto.randomUUID(),
            pairs,
            sourceLabels: sources.map((file) => sourceLabel(file, state)),
            runs,
          },
        ],
      }));
      onNotice(
        `已完成${runs.length}组高度对、${runs.length * draft.sectors}个扇区相关分析，可前往图表中心查看。`,
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
          <h2>自由组合数据，比较风速关系</h2>
          <p>
            同塔多高度、跨塔对比、测风塔与中尺度，使用同一套时段和扇区配置。
          </p>
        </div>
        <span className="ww-quiet-tag">
          {state.correlationJobs.length} 个配置任务
        </span>
      </div>
      <div className="ww-mode-tabs" role="group" aria-label="相关性类型">
        {[
          ["same-tower", "同塔 · 不同高度", "同一文件的高度两两配对"],
          ["cross-tower", "测风塔 · 测风塔", "独立选择两塔的数据阶段"],
          ["reference", "测风塔 · 中尺度", "测风数据与长期参考对齐"],
        ].map(([id, label, detail]) => (
          <button
            key={id}
            aria-pressed={draft.mode === id}
            className={draft.mode === id ? "active" : ""}
            onClick={() => {
              onChange((current) => ({
                ...current,
                correlation: aligned(current, {
                  ...current.correlation,
                  mode: id as CorrelationDraft["mode"],
                  rightFileId: "",
                }),
              }));
              setShowErrors(false);
            }}
          >
            <strong>{label}</strong>
            <small>{detail}</small>
          </button>
        ))}
      </div>

      <div className="ww-correlation-layout">
        <section className="ww-panel">
          <div className="ww-section-heading">
            <div>
              <span className="ww-overline">DATA & ALIGNMENT</span>
              <h2>数据与时段</h2>
            </div>
          </div>
          <div className="ww-fields ww-fields-two">
            <label className="ww-wide">
              目标数据（Y）
              <select
                value={draft.leftFileId}
                onChange={(e) => selectFile("leftFileId", e.target.value)}
              >
                <option value="">选择原始 / 质控 / 结果文件</option>
                {targets.map((file) => (
                  <option key={file.id} value={file.id}>
                    {sourceLabel(file, state)}
                  </option>
                ))}
              </select>
            </label>
            {draft.mode !== "same-tower" && (
              <label className="ww-wide">
                对比数据（X）
                <select
                  value={draft.rightFileId}
                  onChange={(e) => selectFile("rightFileId", e.target.value)}
                >
                  <option value="">
                    {draft.mode === "reference"
                      ? "选择中尺度文件"
                      : "选择另一座塔的文件"}
                  </option>
                  {comparisons.map((file) => (
                    <option key={file.id} value={file.id}>
                      {sourceLabel(file, state)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={draft.mode === "same-tower" ? "ww-wide" : ""}>
              {draft.mode === "same-tower"
                ? "参与配对的风速高度（m）"
                : "目标风速高度（m）"}
              <input
                value={draft.leftHeights}
                onChange={(e) => change("leftHeights", e.target.value)}
                placeholder="例如 50, 70, 100, 120"
              />
              <small>
                {draft.mode === "same-tower"
                  ? "两两组合，每个高度对生成一组图。"
                  : "多高度将与对比高度逐一配对。"}
              </small>
            </label>
            {draft.mode !== "same-tower" && (
              <label>
                对比风速高度（m）
                <input
                  value={draft.rightHeights}
                  onChange={(e) => change("rightHeights", e.target.value)}
                  placeholder="例如 100"
                />
              </label>
            )}
            <label>
              相关性开始时间
              <input
                type="datetime-local"
                value={draft.start}
                onChange={(e) => change("start", e.target.value)}
              />
            </label>
            <label>
              相关性结束时间
              <input
                type="datetime-local"
                value={draft.end}
                onChange={(e) => change("end", e.target.value)}
              />
            </label>
            <div className="ww-align-hint">
              <small>
                {alignment
                  ? `已按${left?.file.name ?? "测风塔数据"}的有效时段自动对齐：${alignment.start.replace("T", " ")} → ${alignment.end.replace("T", " ")}（终点不含）`
                  : "选择已解析的目标数据后，自动按测风塔有效时段对齐。"}
              </small>
              <button
                type="button"
                className="ww-text-button"
                onClick={realign}
              >
                重新按测风时段对齐
              </button>
            </div>
            <label className="ww-wide">
              回归模型
              <select
                value={draft.regression}
                onChange={(e) =>
                  change(
                    "regression",
                    e.target.value as CorrelationDraft["regression"],
                  )
                }
              >
                <option value="with-intercept">
                  含截距的一元线性回归 · Y = aX + b
                </option>
                <option value="through-origin">过原点回归 · Y = aX</option>
              </select>
            </label>
          </div>
          <div className="ww-callout">
            按确认的时区转换为UTC，取严格同期的有效样本。完整小时模式要求小时内各记录齐全，不复制小时资料为十分钟资料。
          </div>
        </section>
        <section className="ww-panel ww-sector-panel">
          <div className="ww-section-heading">
            <div>
              <span className="ww-overline">DIRECTIONAL SECTORS</span>
              <h2>分扇区比较</h2>
            </div>
          </div>
          <div className="ww-fields">
            <label>
              扇区数量
              <select
                value={draft.sectors}
                onChange={(e) => change("sectors", Number(e.target.value))}
              >
                <option value="1">整体相关，不分扇区</option>
                <option value="8">8 个扇区</option>
                <option value="12">12 个扇区</option>
                <option value="16">16 个扇区</option>
                <option value="36">36 个扇区</option>
              </select>
            </label>
            {draft.sectors > 1 && (
              <>
                <label>
                  划分扇区的风向来源
                  <select
                    value={draft.directionFileId}
                    onChange={(e) => change("directionFileId", e.target.value)}
                  >
                    <option value="">明确选择一个参考风向文件</option>
                    {state.files.map((file) => (
                      <option key={file.id} value={file.id}>
                        {sourceLabel(file, state)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  风向参考高度（m）
                  <input
                    type="number"
                    min="1"
                    value={draft.directionHeight}
                    placeholder="例如 120"
                    onChange={(e) => change("directionHeight", e.target.value)}
                  />
                </label>
              </>
            )}
          </div>
          <div
            className="ww-sector-grid"
            style={{
              gridTemplateColumns: `repeat(${draft.sectors === 1 ? 1 : 4}, minmax(0, 1fr))`,
            }}
            aria-label="扇区布局预览"
          >
            {Array.from({ length: draft.sectors }, (_, i) => (
              <span key={i}>
                {draft.sectors === 1
                  ? "整体"
                  : draft.sectors === 16
                    ? [
                        "N",
                        "NNE",
                        "NE",
                        "ENE",
                        "E",
                        "ESE",
                        "SE",
                        "SSE",
                        "S",
                        "SSW",
                        "SW",
                        "WSW",
                        "W",
                        "WNW",
                        "NW",
                        "NNW",
                      ][i]
                    : `${i + 1} 区`}
                <i />
              </span>
            ))}
          </div>
          <p className="ww-inline-note">
            正北为扇区中心，顺时针编号；边界为左闭右开。此处预览布局，真实散点见图表中心。
          </p>
        </section>
      </div>
      <div className="ww-pair-summary">
        <strong>
          {pairs.length} 组高度配对 <span>×</span>{" "}
          {draft.sectors === 1 ? "1 组整体图" : `${draft.sectors} 个扇区`}{" "}
          <span>=</span> {pairs.length * draft.sectors} 幅散点图
        </strong>
        <p>
          {pairs.length
            ? `${pairs
                .slice(0, 6)
                .map(([a, b]) => `${a}m ↔ ${b}m`)
                .join(" · ")}${pairs.length > 6 ? " …" : ""}`
            : "填写高度后可查看配对数量"}
        </p>
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
        <h3>同期对齐与同高通道确认</h3>
        <div className="ww-fields ww-fields-three">
          <label>
            同期时间步长
            <select
              value={draft.aggregation}
              onChange={(e) =>
                change(
                  "aggregation",
                  e.target.value as CorrelationDraft["aggregation"],
                )
              }
            >
              <option value="hourly">完整小时对齐（推荐中尺度对比）</option>
              <option value="native">原生步长严格对齐（两侧须相同）</option>
            </select>
          </label>
          {(
            [
              "target",
              ...(draft.mode === "same-tower" ? [] : ["reference"]),
            ] as ("target" | "reference")[]
          ).flatMap((side) =>
            parseHeights(
              side === "target" ? draft.leftHeights : draft.rightHeights,
            ).map((height) => {
              const data = (
                side === "target"
                  ? left
                  : state.files.find((f) => f.id === draft.rightFileId)
              )?.dataset;
              const channels = means(data).filter((c) => c.height === height);
              const key =
                side === "target" ? "targetChannels" : "referenceChannels";
              return (
                <label key={`${side}-${height}`}>
                  {side === "target" ? "目标Y" : "参考X"} · {height}m
                  <select
                    value={draft[key][String(height)] ?? ""}
                    onChange={(e) =>
                      change(key, {
                        ...draft[key],
                        [String(height)]: e.target.value,
                      })
                    }
                  >
                    <option value="">
                      {channels.length === 1
                        ? "唯一通道，可直接匹配"
                        : "请明确选择同高通道"}
                    </option>
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.arm || "支臂未填"}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }),
          )}
        </div>
      </section>
      {apiError && (
        <p className="ww-error" role="alert" ref={apiErrorRef} tabIndex={-1}>
          {apiError}
        </p>
      )}
      <div className="ww-save-bar">
        <p>每组高度对独立成页，回归使用全部同期样本；图上最多显示1200个点。</p>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {busy ? "正在对齐与拟合…" : "执行相关性分析 →"}
        </button>
      </div>
    </div>
  );
}
