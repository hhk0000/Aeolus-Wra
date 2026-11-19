import { useRef, useState } from "react";
import { sameFile, sourceKindFromFilename } from "./batchImport";
import type { ChangeEvent, DragEvent } from "react";
import { SOURCE_TYPES, filesForTower, newTower } from "./model";
import type {
  SourceFile,
  SourceKind,
  Tower,
  WorkspaceViewProps,
} from "./model";
import { api } from "./api";
import type { UploadedFile } from "./api";
import ChannelMapper from "./ChannelMapper";
import {
  activateTower,
  applySourceDefaults,
  autoParseSource,
  DEFAULT_TIMEZONE,
  forgetFile,
  useErrorFocus,
} from "./autoSetup";

type BatchEntry = {
  file: File;
  kind: SourceKind | "";
  id: string;
  error?: string;
};
type ImportEntry = Omit<BatchEntry, "kind"> & { kind: SourceKind };

export default function DataSources({
  state,
  onChange,
  onNotice,
}: WorkspaceViewProps) {
  const [busy, setBusy] = useState(false);
  const importing = useRef(false);
  const [batch, setBatch] = useState<BatchEntry[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const readyCount = batch.filter((entry) => entry.kind).length;
  const [previewId, setPreviewId] = useState("");
  const [error, setError] = useState("");
  const errorRef = useErrorFocus<HTMLParagraphElement>(error);
  const tower = state.towers.find((t) => t.id === state.activeTowerId)!;
  const preview = state.files.find(
    (f) =>
      f.id === previewId && (f.towerId === tower.id || f.kind === "reference"),
  );

  function setTower(key: keyof Tower, value: string) {
    onChange((current) => ({
      ...current,
      planSaved: false,
      towers: current.towers.map((t) =>
        t.id === tower.id ? { ...t, [key]: value } : t,
      ),
    }));
  }

  function addToBatch(files: File[]) {
    if (importing.current || !files.length) return;
    const queued = files.map((file) => ({
      file,
      id: crypto.randomUUID(),
      kind: sourceKindFromFilename(file.name),
    }));
    setBatch((current) => {
      const next = [...current];
      for (const entry of queued)
        if (!next.some((item) => sameFile(item.file, entry.file)))
          next.push(entry);
      return next;
    });
  }

  async function importFiles(entries: ImportEntry[], isBatch = false) {
    if (importing.current || !entries.length) return;
    importing.current = true;
    setBusy(true);
    setError("");
    if (isBatch) setProgress({ done: 0, total: entries.length });
    const additions: SourceFile[] = [];
    const completed = new Set<string>();
    const errors = new Map<string, string>();
    let duplicates = 0;
    try {
      for (const [index, { file, kind, id }] of entries.entries()) {
        const towerId = kind === "reference" ? null : tower.id;
        try {
          if (
            [...state.files, ...additions].some(
              (item) =>
                item.kind === kind &&
                item.towerId === towerId &&
                sameFile(item.file, file),
            )
          ) {
            duplicates++;
            completed.add(id);
            continue;
          }
          const allowed = kind === "raw" ? /\.txt$/i : /\.(txt|csv|dat)$/i;
          if (!allowed.test(file.name))
            throw new Error(
              kind === "raw"
                ? "原始数据需使用 TXT 文件。"
                : "请选择 TXT、CSV 或 DAT 文件。",
            );
          if (file.size > 32 * 1024 * 1024)
            throw new Error("文件超过 32 MB，请按时段拆分。");
          const form = new FormData();
          form.set("file", file);
          form.set("stage", kind);
          form.set("tower_id", towerId ?? "reference");
          const server = await api<UploadedFile>("/files", form);
          const source: SourceFile = {
            id,
            kind,
            towerId,
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
          try {
            additions.push(
              await autoParseSource(source, tower.timezone || DEFAULT_TIMEZONE),
            );
          } catch (cause) {
            additions.push({ ...source, warning: (cause as Error).message });
          }
          completed.add(id);
        } catch (cause) {
          errors.set(id, (cause as Error).message);
        } finally {
          if (isBatch) setProgress({ done: index + 1, total: entries.length });
        }
      }
      if (additions.length) {
        onChange((current) => {
          const fresh = additions.filter(
            (next) =>
              !current.files.some(
                (item) =>
                  item.kind === next.kind &&
                  item.towerId === next.towerId &&
                  sameFile(item.file, next.file),
              ),
          );
          if (!fresh.length) return current;
          const next: typeof current = {
            ...current,
            files: [...current.files, ...fresh],
            planSaved: false,
          };
          return fresh.reduce(
            (value, file) => applySourceDefaults(value, file),
            next,
          );
        });
        setPreviewId(
          (additions.find((file) => !file.dataset) ?? additions[0]).id,
        );
      }
      if (isBatch) {
        setBatch((current) =>
          current
            .filter((entry) => !completed.has(entry.id))
            .map((entry) => ({ ...entry, error: errors.get(entry.id) })),
        );
        const pending = entries.length - additions.length - duplicates;
        onNotice(
          [
            ...(additions.length ? ["已导入 " + additions.length + " 份"] : []),
            ...(duplicates ? ["跳过 " + duplicates + " 份重复文件"] : []),
            ...(pending ? [pending + " 份待修正或重试"] : []),
            ...(additions.some((file) => !file.dataset)
              ? ["部分文件待确认通道映射"]
              : []),
          ].join("，") + "。",
        );
      } else {
        if (errors.size)
          setError(
            entries
              .flatMap(({ file, id }) =>
                errors.has(id) ? [file.name + "：" + errors.get(id)] : [],
              )
              .join("；"),
          );
        if (additions.length)
          onNotice(
            additions.every((file) => file.dataset)
              ? "数据已自动导入，测风塔信息和分析配置已更新。"
              : "文件已保存；部分信息无法识别，请展开对应文件的导入设置补充。",
          );
        else if (duplicates)
          onNotice("这些文件已在当前资料中，可点击文件名继续查看。");
      }
    } finally {
      importing.current = false;
      setBusy(false);
      setProgress(undefined);
    }
  }

  function chooseFiles(kind: SourceKind, files: File[]) {
    void importFiles(
      files.map((file) => ({ file, kind, id: crypto.randomUUID() })),
    );
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
            disabled={busy}
            value={tower.id}
            onChange={(e) => {
              setPreviewId("");
              onChange((current) => activateTower(current, e.target.value));
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
          disabled={busy}
          onClick={() => {
            const next = newTower(crypto.randomUUID(), state.towers.length + 1);
            onChange((current) =>
              activateTower(
                {
                  ...current,
                  towers: [...current.towers, next],
                  planSaved: false,
                },
                next.id,
              ),
            );
            setPreviewId("");
          }}
        >
          ＋ 添加测风塔
        </button>
        <p>原始、质控、结果按塔管理；中尺度文件在当前项目内共享。</p>
      </div>
      {error && (
        <p className="ww-error" role="alert" ref={errorRef} tabIndex={-1}>
          {error}
        </p>
      )}
      <section
        className="ww-panel ww-batch-import"
        aria-labelledby="ww-batch-title"
      >
        <h3 id="ww-batch-title">批量上传</h3>
        <p>
          一次拖入多份资料，按文件名预选类别。原始、质控和结果资料归入当前测风塔，中尺度资料在项目内共享。
        </p>
        <label
          className="ww-file-drop ww-batch-drop"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            addToBatch(Array.from(event.dataTransfer.files));
          }}
        >
          <input
            type="file"
            multiple
            accept=".txt,.csv,.dat"
            aria-label="选择批量上传文件"
            disabled={busy}
            onChange={(event) => {
              addToBatch(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <span aria-hidden="true">↥</span>
          <strong>选择多个文件或拖到这里</strong>
          <small>TXT / CSV / DAT</small>
        </label>
        {batch.length > 0 && (
          <>
            <ul className="ww-batch-queue" aria-label="批量上传文件">
              {batch.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>{entry.file.name}</strong>
                    <small>{formatSize(entry.file.size)}</small>
                    {entry.error && (
                      <p className="ww-field-error" role="alert">
                        {entry.error}
                      </p>
                    )}
                  </div>
                  <select
                    value={entry.kind}
                    aria-label={"资料类别：" + entry.file.name}
                    disabled={busy}
                    onChange={(event) => {
                      const kind = event.target.value as BatchEntry["kind"];
                      setBatch((current) =>
                        current.map((item) =>
                          item.id === entry.id
                            ? { ...item, kind, error: undefined }
                            : item,
                        ),
                      );
                    }}
                  >
                    <option value="">请选择资料类别</option>
                    {SOURCE_TYPES.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.shortLabel}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="ww-button"
                    disabled={busy}
                    aria-label={"移出待上传列表：" + entry.file.name}
                    onClick={() =>
                      setBatch((current) =>
                        current.filter((item) => item.id !== entry.id),
                      )
                    }
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
            <div className="ww-chart-actions">
              <button
                type="button"
                className="ww-button primary"
                disabled={busy || !readyCount}
                onClick={() =>
                  void importFiles(
                    batch.filter((entry): entry is ImportEntry =>
                      Boolean(entry.kind),
                    ),
                    true,
                  )
                }
              >
                导入已分类文件（{readyCount} 份）
              </button>
              <button
                type="button"
                className="ww-button"
                disabled={busy}
                onClick={() => setBatch([])}
              >
                清空列表
              </button>
              <small role="status">
                {progress
                  ? "已处理 " + progress.done + " / " + progress.total + " 份"
                  : batch.length > readyCount
                    ? batch.length - readyCount + " 份待选类别"
                    : "导入到：" + tower.name}
              </small>
            </div>
          </>
        )}
      </section>
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
                          onChange((current) =>
                            forgetFile(
                              {
                                ...current,
                                files: current.files.filter(
                                  (f) => f.id !== item.id,
                                ),
                              },
                              item.id,
                            ),
                          );
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
        <details className="ww-panel" open={!preview.dataset}>
          <summary>
            查看文件头与导入设置 ·{" "}
            {preview.dataset ? "已自动识别" : "需要补充识别信息"}
          </summary>
          <h3>{preview.file.name}</h3>
          {preview.warning && <p className="ww-error">{preview.warning}</p>}
          <p>
            {preview.dataset
              ? `已导入 ${preview.dataset.row_count.toLocaleString()} 条记录，信息已自动填入。`
              : "文件已保存，请补充下方未识别的信息。"}
          </p>
          <details>
            <summary>文件头原文</summary>
            <pre>{preview.preview}</pre>
          </details>
          {preview.server && (
            <ChannelMapper
              key={preview.id}
              source={preview}
              state={state}
              onChange={onChange}
              onNotice={onNotice}
            />
          )}
        </details>
      )}
      <section className="ww-panel">
        <div className="ww-section-heading">
          <div>
            <span className="ww-overline">MAST INFORMATION</span>
            <h2>测风塔基本信息</h2>
            <p>已根据文件自动填写。需要调整时可直接修改；空白项可按需补充。</p>
          </div>
          <span className="ww-quiet-tag">自动识别 · 可修改</span>
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
            数据时间设置
            <input
              value={
                tower.timezone === "Etc/GMT-8"
                  ? "北京时间 UTC+8（默认）"
                  : tower.timezone || "导入后自动识别"
              }
              readOnly
            />
            <small>特殊时间设置可在文件的高级导入设置中调整。</small>
          </label>
          <label>
            原始数据步长
            <input
              value={
                tower.intervalMinutes
                  ? `${tower.intervalMinutes} 分钟`
                  : "导入数据后自动识别"
              }
              readOnly
            />
            <small>按文件中的实际时间间隔识别。</small>
          </label>
        </div>
        <details className="ww-details">
          <summary>当前字段识别范围 V0.1</summary>
          <p>
            要素：风速、风向、温度、气压、湿度、电压。统计类型：平均值、标准差、最大值、最小值。
          </p>
          <p>
            关键字及排除词后续可增删。排除词优先、短词按边界识别；识别结果已自动应用，高度与单位可在导入设置中修改。
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
