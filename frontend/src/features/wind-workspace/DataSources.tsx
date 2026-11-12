import { useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import {
  SOURCE_TYPES,
  filesForTower,
  newTower,
  suggestHeaderMetadata,
} from "./model";
import type {
  SourceFile,
  SourceKind,
  Tower,
  WorkspaceViewProps,
} from "./model";
import { api } from "./api";
import type { UploadedFile } from "./api";
import ChannelMapper from "./ChannelMapper";

export default function DataSources({
  state,
  onChange,
  onNotice,
}: WorkspaceViewProps) {
  const [busy, setBusy] = useState(false);
  const [previewId, setPreviewId] = useState("");
  const [error, setError] = useState("");
  const tower = state.towers.find((t) => t.id === state.activeTowerId)!;
  const preview = state.files.find(
    (f) =>
      f.id === previewId && (f.towerId === tower.id || f.kind === "reference"),
  );
  const suggestions =
    preview?.kind === "raw" ? suggestHeaderMetadata(preview.preview) : {};
  const suggestionCount = Object.keys(suggestions).length;

  function setTower(key: keyof Tower, value: string) {
    onChange((current) => ({
      ...current,
      planSaved: false,
      towers: current.towers.map((t) =>
        t.id === tower.id ? { ...t, [key]: value } : t,
      ),
    }));
  }

  async function chooseFiles(kind: SourceKind, files: File[]) {
    if (busy || !files.length) return;
    files = files.filter(
      (f) =>
        !state.files.some(
          (item) =>
            item.kind === kind &&
            item.towerId === (kind === "reference" ? null : tower.id) &&
            item.file.name === f.name &&
            item.file.size === f.size &&
            item.file.lastModified === f.lastModified,
        ),
    );
    if (!files.length) {
      onNotice("这些文件已在当前资料中，可点击文件名继续查看。");
      return;
    }
    setBusy(true);
    setError("");
    const selectedTowerId = tower.id;
    const allowed = kind === "raw" ? /\.txt$/i : /\.(txt|csv|dat)$/i;
    const invalid = files.filter((file) => !allowed.test(file.name));
    if (invalid.length) {
      setError(
        `${invalid.map((file) => file.name).join("、")}：请选择${kind === "raw" ? " TXT 原始文件" : " TXT、CSV 或 DAT 文本文件"}。`,
      );
      setBusy(false);
      return;
    }
    const results = await Promise.allSettled(
      files.map(async (file): Promise<SourceFile> => {
        if (file.size > 32 * 1024 * 1024)
          throw new Error(`${file.name} 超过首版32MB限制，请按时段拆分。`);
        const form = new FormData();
        form.set("file", file);
        form.set("stage", kind);
        form.set(
          "tower_id",
          kind === "reference" ? "reference" : selectedTowerId,
        );
        const server = await api<UploadedFile>("/files", form);
        return {
          id: crypto.randomUUID(),
          kind,
          towerId: kind === "reference" ? null : selectedTowerId,
          file: {
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
          },
          preview: server.text_preview,
          encoding: server.encoding,
          warning: "",
          server,
        };
      }),
    );
    const additions = results
      .filter(
        (r): r is PromiseFulfilledResult<SourceFile> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value);
    const errors = results
      .filter((r) => r.status === "rejected")
      .map((r) => String(r.reason?.message ?? r.reason));
    if (errors.length) setError(errors.join("；"));
    onChange((current) => {
      const fresh = additions.filter(
        (next) =>
          !current.files.some(
            (item) =>
              item.kind === next.kind &&
              item.towerId === next.towerId &&
              item.file.name === next.file.name &&
              item.file.size === next.file.size &&
              item.file.lastModified === next.file.lastModified,
          ),
      );
      return {
        ...current,
        files: [...current.files, ...fresh],
        planSaved: false,
      };
    });
    if (additions[0]) setPreviewId(additions[0].id);
    setBusy(false);
    if (additions.length)
      onNotice("原始字节已保存到本机分析服务，请确认时间与通道映射后解析。");
  }

  function pick(kind: SourceKind, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void chooseFiles(kind, files);
  }

  function drop(kind: SourceKind, event: DragEvent<HTMLElement>) {
    event.preventDefault();
    void chooseFiles(kind, Array.from(event.dataTransfer.files));
  }

  return (
    <div className="ww-data-view">
      <div className="ww-section-heading">
        <div>
          <h2>四类资料，各有用途</h2>
          <p>接收你已处理好的数据，分别绑定到对应分析成果。</p>
        </div>
        <span className="ww-quiet-tag">本机服务存储 · 原始文件保留</span>
      </div>
      <div className="ww-tower-strip">
        <label>
          当前测风塔
          <select
            aria-label="当前测风塔"
            value={tower.id}
            onChange={(e) => {
              setPreviewId("");
              onChange((current) => ({
                ...current,
                activeTowerId: e.target.value,
              }));
            }}
          >
            {state.towers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name || "未命名测风塔"}
              </option>
            ))}
          </select>
        </label>
        <button
          className="ww-button"
          onClick={() => {
            const next = newTower(crypto.randomUUID(), state.towers.length + 1);
            onChange((current) => ({
              ...current,
              towers: [...current.towers, next],
              activeTowerId: next.id,
              planSaved: false,
            }));
            setPreviewId("");
          }}
        >
          ＋ 添加测风塔
        </button>
        <p>原始、质控、结果按塔管理；中尺度文件在当前项目内共享。</p>
      </div>
      {error && (
        <p className="ww-error" role="alert">
          {error}
        </p>
      )}
      <div className="ww-source-grid">
        {SOURCE_TYPES.map((source) => {
          const files = filesForTower(state, source.id);
          return (
            <section
              key={source.id}
              className={`ww-source-card ww-source-${source.id}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(source.id, e)}
            >
              <div className="ww-source-top">
                <span className="ww-source-number">{source.number}</span>
                <span
                  className={`ww-source-state ${files.length ? "has-file" : ""}`}
                >
                  {files.length ? `${files.length} 个文件已选择` : "待选择"}
                </span>
              </div>
              <h3>{source.label}</h3>
              <p>{source.description}</p>
              <div className="ww-source-output">
                <span>用于生成</span>
                {source.outputs}
              </div>
              <label className="ww-file-drop">
                <input
                  type="file"
                  multiple
                  accept={source.id === "raw" ? ".txt" : ".txt,.csv,.dat"}
                  aria-label={`选择${source.label}`}
                  disabled={busy}
                  onChange={(e) => pick(source.id, e)}
                />
                <span aria-hidden="true">↥</span>
                <strong>
                  {busy ? "正在导入本机服务…" : "选择文件或拖到这里"}
                </strong>
                <small>
                  {source.id === "raw" ? "TXT" : "TXT / CSV / DAT"} ·
                  保留文件原貌
                </small>
              </label>
              {files.length > 0 && (
                <ul className="ww-file-list">
                  {files.map((item) => (
                    <li key={item.id}>
                      <button
                        className="ww-file-name"
                        onClick={() => setPreviewId(item.id)}
                        title={item.file.name}
                      >
                        <span>▤</span>
                        <span>
                          {item.file.name}
                          <small>
                            {formatSize(item.file.size)} ·{" "}
                            {item.dataset
                              ? `已解析 ${item.dataset.row_count.toLocaleString()} 条`
                              : item.encoding + " · 待确认映射"}
                          </small>
                        </span>
                      </button>
                      <button
                        className="ww-remove"
                        aria-label={`移除${source.shortLabel}文件 ${item.file.name}`}
                        onClick={() => {
                          onChange((current) => ({
                            ...current,
                            files: current.files.filter(
                              (f) => f.id !== item.id,
                            ),
                            planSaved: false,
                          }));
                          if (previewId === item.id) setPreviewId("");
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <p className="ww-inline-note">
        文件保存到本机分析服务的
        data/engine，未发送至外部AI。页面配置可导出；保留你的源文件备份。
      </p>

      {preview && (
        <section className="ww-panel ww-file-preview">
          <div className="ww-section-heading">
            <div>
              <span className="ww-overline">FILE HEADER</span>
              <h2>{preview.file.name}</h2>
            </div>
            <button className="ww-button" onClick={() => setPreviewId("")}>
              收起预览
            </button>
          </div>
          {preview.warning ? (
            <p className="ww-error">{preview.warning}</p>
          ) : (
            <pre>{preview.preview || "文件为空。"}</pre>
          )}
          <div className="ww-preview-bottom">
            <p>预览文件开头，用于核对基本信息；不代表已完成数据导入。</p>
            {preview.kind === "raw" && (
              <button
                className="ww-button"
                disabled={!suggestionCount}
                onClick={() => {
                  onChange((current) => ({
                    ...current,
                    towers: current.towers.map((t) =>
                      t.id === tower.id ? { ...t, ...suggestions } : t,
                    ),
                    planSaved: false,
                  }));
                  onNotice(
                    `已填写 ${suggestionCount} 项文件头建议，请核对测风塔基本信息。`,
                  );
                }}
              >
                {suggestionCount
                  ? `采用 ${suggestionCount} 项基本信息建议`
                  : "未匹配到明确的基本信息"}
              </button>
            )}
          </div>
        </section>
      )}
      {preview?.server && (
        <ChannelMapper
          key={preview.id}
          source={preview}
          state={state}
          onChange={onChange}
          onNotice={onNotice}
        />
      )}

      <section className="ww-panel">
        <div className="ww-section-heading">
          <div>
            <span className="ww-overline">MAST INFORMATION</span>
            <h2>测风塔基本信息</h2>
            <p>可采用原始文件头中的明确键值建议，未识别的信息在这里补充。</p>
          </div>
          <span className="ww-quiet-tag">请核对后使用</span>
        </div>
        <div className="ww-fields ww-fields-four">
          <label>
            测风塔编号 / 名称
            <input
              value={tower.name}
              onChange={(e) => setTower("name", e.target.value)}
              placeholder="填写原文件中的塔号"
            />
          </label>
          <label>
            纬度（十进制度）
            <input
              type="number"
              min="-90"
              max="90"
              step="any"
              value={tower.latitude}
              onChange={(e) => setTower("latitude", e.target.value)}
              placeholder="例如 28.2468"
            />
          </label>
          <label>
            经度（十进制度）
            <input
              type="number"
              min="-180"
              max="180"
              step="any"
              value={tower.longitude}
              onChange={(e) => setTower("longitude", e.target.value)}
              placeholder="例如 108.7398"
            />
          </label>
          <label>
            测风塔海拔（m）
            <input
              type="number"
              step="any"
              value={tower.altitude}
              onChange={(e) => setTower("altitude", e.target.value)}
              placeholder="填写塔基海拔"
            />
          </label>
          <label>
            风速仪配置高度（m）
            <input
              value={tower.speedHeights}
              onChange={(e) => setTower("speedHeights", e.target.value)}
              placeholder="例如 30, 50, 70, 100, 120"
            />
          </label>
          <label>
            风向仪配置高度（m）
            <input
              value={tower.directionHeights}
              onChange={(e) => setTower("directionHeights", e.target.value)}
              placeholder="例如 30, 120"
            />
          </label>
          <label>
            温度仪配置高度（m）
            <input
              value={tower.temperatureHeights}
              onChange={(e) => setTower("temperatureHeights", e.target.value)}
              placeholder="填写配置高度"
            />
          </label>
          <label>
            气压仪配置高度（m）
            <input
              value={tower.pressureHeights}
              onChange={(e) => setTower("pressureHeights", e.target.value)}
              placeholder="填写配置高度"
            />
          </label>
          <label>
            原始观测开始
            <input
              type="datetime-local"
              value={tower.observedStart}
              onChange={(e) => setTower("observedStart", e.target.value)}
            />
          </label>
          <label>
            原始观测结束（不含该时刻）
            <input
              type="datetime-local"
              value={tower.observedEnd}
              onChange={(e) => setTower("observedEnd", e.target.value)}
            />
          </label>
          <label>
            测风数据时间基准
            <select
              value={tower.timezone}
              onChange={(e) => setTower("timezone", e.target.value)}
            >
              <option value="">请选择并核对文件说明</option>
              <option value="Asia/Shanghai">北京时间 UTC+8</option>
              <option value="UTC">UTC</option>
            </select>
          </label>
          <label>
            原始数据步长
            <input value="10 分钟" readOnly />
            <small>按本次需求记录；实际间隔仍需在导入时核对。</small>
          </label>
        </div>
        <details className="ww-details">
          <summary>当前字段识别范围 V0.1</summary>
          <p>
            要素：风速、风向、温度、气压、湿度、电压。统计类型：平均值、标准差、最大值、最小值。
          </p>
          <p>
            关键字及排除词后续可增删。排除词优先、短词按边界识别；所有自动建议均需在上方映射中核对，高度与单位可直接修改。
          </p>
        </details>
      </section>
    </div>
  );
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
