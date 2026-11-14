import { useState } from "react";
import {
  applySourceDefaults,
  DEFAULT_TIMEZONE,
  useErrorFocus,
} from "./autoSetup";
import { api } from "./api";
import type { Dataset, Mapping, UploadedFile } from "./api";
import type { SourceFile, WorkspaceViewProps } from "./model";

const quantities: [string, string][] = [
  ["", "不导入"],
  ["speed", "风速"],
  ["direction", "风向"],
  ["temperature", "气温"],
  ["pressure", "气压"],
  ["humidity", "湿度"],
  ["voltage", "电压"],
];
const units: Record<string, string[]> = {
  speed: ["m/s"],
  direction: ["deg"],
  temperature: ["C", "K"],
  pressure: ["Pa", "hPa", "kPa", "mb"],
  humidity: ["%"],
  voltage: ["V"],
};

export default function ChannelMapper({
  source,
  state,
  onChange,
  onNotice,
}: WorkspaceViewProps & { source: SourceFile }) {
  const [preview, setPreview] = useState(source.server!);
  const [header, setHeader] = useState(String(preview.header_line));
  const [dataLine, setDataLine] = useState(String(preview.data_line));
  const [delimiter, setDelimiter] = useState(preview.delimiter);
  const [maps, setMaps] = useState<Mapping[]>(preview.suggestions);
  const [stampColumn, setStampColumn] = useState(
    preview.detected?.timestamp_column ?? 0,
  );
  const [timeColumn, setTimeColumn] = useState(
    preview.detected?.time_column == null
      ? ""
      : String(preview.detected.time_column),
  );
  const [format, setFormat] = useState("");
  const tower = state.towers.find((t) => t.id === source.towerId);
  const [timezone, setTimezone] = useState(
    source.dataset?.options.timezone ||
      preview.detected?.timezone ||
      tower?.timezone ||
      (source.kind === "reference" ? state.longTerm.timezone : "") ||
      DEFAULT_TIMEZONE,
  );
  const [step, setStep] = useState(
    String(
      source.dataset?.options.interval_minutes ??
        preview.detected?.interval_minutes ??
        (source.kind === "reference" ? 60 : 10),
    ),
  );
  const [position, setPosition] = useState(
    preview.detected?.timestamp_position ?? "start",
  );
  const [missing, setMissing] = useState("-9999, -999, NaN");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useErrorFocus<HTMLParagraphElement>(error);
  function map(index: number, changes: Partial<Mapping>) {
    setMaps((current) =>
      current.map((m, i) => (i === index ? { ...m, ...changes } : m)),
    );
  }
  async function rePreview() {
    setError("");
    setBusy(true);
    try {
      const next = await api<UploadedFile>(`/files/${preview.id}/preview`, {
        header_line: Number(header),
        delimiter,
      });
      setPreview(next);
      setMaps(next.suggestions);
      setDataLine(String(next.data_line));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function parse() {
    setError("");
    setBusy(true);
    try {
      if (!timezone) throw new Error("请核对并选择时间基准。");
      const channels = maps.filter(
        (m) =>
          m.quantity &&
          m.index !== stampColumn &&
          String(m.index) !== timeColumn,
      );
      if (
        !channels.length ||
        channels.some(
          (m) =>
            m.height === null ||
            m.height < 0 ||
            ((m.quantity === "speed" || m.quantity === "direction") &&
              m.height === 0) ||
            !m.unit ||
            !m.statistic,
        )
      )
        throw new Error(
          "请确认所导入通道的高度、单位和统计类型；无关列选择不导入。",
        );
      const dataset = await api<Dataset>(`/files/${preview.id}/parse`, {
        header_line: Number(header),
        data_line: Number(dataLine),
        delimiter,
        timestamp_column: stampColumn,
        time_column: timeColumn === "" ? null : Number(timeColumn),
        timestamp_format: format.trim() || "auto",
        timezone,
        interval_minutes: Number(step),
        timestamp_position: position,
        missing_values: ["", ...missing.split(/[,，]+/).map((v) => v.trim())],
        channels: channels.map(
          ({ index, quantity, statistic, height, unit, arm }) => ({
            index,
            quantity,
            statistic,
            height,
            unit,
            arm: arm.trim(),
          }),
        ),
      });
      onChange((current) =>
        applySourceDefaults(
          {
            ...current,
            files: current.files.map((f) =>
              f.id === source.id ? { ...f, dataset, warning: "" } : f,
            ),
          },
          { ...source, dataset, warning: "" },
        ),
      );
      onNotice(
        `已解析 ${dataset.row_count.toLocaleString()} 条记录、${dataset.channels.length} 个通道。原文件单独保留，未修改。`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ww-mapper">
      <div className="ww-section-heading">
        <div>
          <span className="ww-overline">CHANNEL MAPPING</span>
          <h2>确认通道与时间</h2>
          <p>关键字用于建议，实际计算采用你确认的映射和单位。</p>
        </div>
        <span className="ww-quiet-tag">
          SHA256 {preview.sha256.slice(0, 12)}…
        </span>
      </div>
      {(preview.detected?.warnings?.length ?? 0) > 0 && (
        <p className="ww-inline-note">
          自动识别提示：{preview.detected!.warnings!.join("；")}
        </p>
      )}
      <div className="ww-fields ww-fields-four">
        <label>
          表头行号（1起）
          <input
            type="number"
            min="1"
            value={header}
            onChange={(e) => setHeader(e.target.value)}
          />
        </label>
        <label>
          分隔符
          <select
            value={delimiter}
            onChange={(e) => setDelimiter(e.target.value)}
          >
            <option value="tab">制表符 TAB</option>
            <option value="comma">逗号</option>
            <option value="semicolon">分号</option>
            <option value="space">连续空白</option>
          </select>
        </label>
        <div className="ww-field-action">
          <button
            className="ww-button"
            disabled={busy}
            onClick={() => void rePreview()}
          >
            重新预览表头
          </button>
        </div>
        <label>
          数据起始行
          <input
            type="number"
            min="2"
            value={dataLine}
            onChange={(e) => setDataLine(e.target.value)}
          />
        </label>
        <label>
          日期 / 时间戳列
          <select
            value={stampColumn}
            onChange={(e) => setStampColumn(Number(e.target.value))}
          >
            {preview.headers.map((h, i) => (
              <option key={i} value={i}>
                {i + 1} · {h}
              </option>
            ))}
          </select>
        </label>
        <label>
          独立时分秒列（可选）
          <select
            value={timeColumn}
            onChange={(e) => setTimeColumn(e.target.value)}
          >
            <option value="">已含在时间戳列</option>
            {preview.headers.map((h, i) => (
              <option key={i} value={i}>
                {i + 1} · {h}
              </option>
            ))}
          </select>
        </label>
        <label>
          数据时间基准
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            <option value="">请核对文件说明</option>
            <option value="Etc/GMT-8">固定 UTC+8（不应用历史夏令时）</option>
            <option value="Asia/Shanghai">上海时区（含历史夏令时规则）</option>
            <option value="UTC">UTC</option>
          </select>
        </label>
        <label>
          记录间隔（分钟）
          <select value={step} onChange={(e) => setStep(e.target.value)}>
            {[1, 5, 10, 15, 30, 60].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          时间戳代表
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          >
            <option value="start">记录区间起点</option>
            <option value="end">记录区间终点（转为起点）</option>
          </select>
        </label>
        <label>
          时间格式（可选）
          <input
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            placeholder="ISO / 年-月-日自动识别"
          />
          <small>例如 %d/%m/%Y %H:%M；不猜测月日顺序</small>
        </label>
        <label className="ww-wide">
          缺测标记（逗号分隔）
          <input value={missing} onChange={(e) => setMissing(e.target.value)} />
          <small>空单元格按缺测处理；未声明的文字标记会阻止解析。</small>
        </label>
      </div>
      <div className="ww-table-scroll">
        <table className="ww-mapping-table">
          <thead>
            <tr>
              <th>原始列</th>
              <th>样本</th>
              <th>要素</th>
              <th>统计类型</th>
              <th>高度 m</th>
              <th>原单位</th>
              <th>支臂方向 / 标识</th>
            </tr>
          </thead>
          <tbody>
            {maps.map((m, i) => (
              <tr key={i}>
                <td title={preview.headers[i]}>
                  {i + 1} · {preview.headers[i]}
                </td>
                <td>{preview.sample_rows[0]?.[i] ?? "—"}</td>
                <td>
                  <select
                    aria-label={`第${i + 1}列要素`}
                    value={m.quantity}
                    onChange={(e) =>
                      map(i, {
                        quantity: e.target.value,
                        unit: units[e.target.value]?.[0] ?? "",
                      })
                    }
                  >
                    {quantities.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    aria-label={`第${i + 1}列统计类型`}
                    value={m.statistic}
                    disabled={!m.quantity}
                    onChange={(e) => map(i, { statistic: e.target.value })}
                  >
                    <option value="">待确认</option>
                    <option value="mean">平均值</option>
                    <option value="sd">标准差</option>
                    <option value="max">最大值</option>
                    <option value="min">最小值</option>
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`第${i + 1}列高度`}
                    type="number"
                    min="0.1"
                    step="any"
                    disabled={!m.quantity}
                    value={m.height ?? ""}
                    onChange={(e) =>
                      map(i, {
                        height: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </td>
                <td>
                  <select
                    aria-label={`第${i + 1}列单位`}
                    value={m.unit}
                    disabled={!m.quantity}
                    onChange={(e) => map(i, { unit: e.target.value })}
                  >
                    <option value="">待确认</option>
                    {(units[m.quantity] ?? []).map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`第${i + 1}列支臂`}
                    disabled={!m.quantity}
                    value={m.arm}
                    onChange={(e) => map(i, { arm: e.target.value })}
                    placeholder="如 NNE，切变必填"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ww-inline-note">
        支臂标识用于检查切变通道是否来自相同安装方向；不同通道保持独立。气压导入统一转Pa、温度统一转℃。
      </p>
      {error && (
        <p className="ww-error" role="alert" ref={errorRef} tabIndex={-1}>
          {error}
        </p>
      )}
      {source.dataset && (
        <div className="ww-callout">
          已解析 {source.dataset.row_count.toLocaleString()} 条 ·{" "}
          {source.dataset.channels.length} 通道 · {source.dataset.start} →{" "}
          {source.dataset.end_exclusive}（排他终点）。
          <a href={`/api/v1/datasets/${source.dataset.id}/export.csv`}>
            导出标准化序列 CSV
          </a>
        </div>
      )}
      <div className="ww-save-bar">
        <span>
          解析产物单独保存到本机项目
          data/engine；重复、倒序、未声明标记会返回具体行号。
        </span>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void parse()}
        >
          {busy ? "正在解析…" : "确认映射并解析数据"}
        </button>
      </div>
    </section>
  );
}
