import { useState } from "react";
import { api, means } from "./api";
import type { Dataset, Run } from "./api";
import type { SourceFile, WorkspaceViewProps } from "./model";
import { ChannelOptions } from "./CalculationPanel";
import { ResultView } from "./ResultView";

export default function AlgorithmTools({
  state,
  onChange,
  onNotice,
}: WorkspaceViewProps) {
  const [operation, setOperation] = useState("extrapolation");
  const [fileId, setFileId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [refId, setRefId] = useState("");
  const [refChannel, setRefChannel] = useState("");
  const [height, setHeight] = useState("");
  const [seaLevel, setSeaLevel] = useState(false);
  const [maxima, setMaxima] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [interpolate, setInterpolate] = useState(false);
  const [directionId, setDirectionId] = useState("");
  const [baselineYears, setBaselineYears] = useState("20");
  const [resolution, setResolution] = useState("0.1");
  const [referenceConfirmed, setReferenceConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const files = state.files.filter(
    (f) =>
      f.dataset &&
      (f.towerId === state.activeTowerId || f.kind === "reference"),
  );
  const source = files.find((f) => f.id === fileId),
    reference = state.files.find((f) => f.id === refId);
  const qc = state.files.find(
    (f) =>
      f.id === state.analysis.qcFileId && f.towerId === state.activeTowerId,
  )?.dataset;
  const tower = state.towers.find((t) => t.id === state.activeTowerId)!;
  async function run() {
    setError("");
    setBusy(true);
    try {
      if (operation === "extreme") {
        const pairs = maxima
          .trim()
          .split(/\n+/)
          .map((line) =>
            line
              .trim()
              .split(/[,，;；\s]+/)
              .map(Number),
          );
        if (
          pairs.some(
            (p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)),
          )
        )
          throw new Error(
            "每行填写：年份, 年最大10min风速；至少10个连续年份。",
          );
        const result = await api<Run>("/extremes", {
          years: pairs.map((p) => p[0]),
          annual_maxima: pairs.map((p) => p[1]),
          homogeneous_annual_maxima_confirmed: confirmed,
          interpolate_coefficients: interpolate,
        });
        setLastRun(result);
        onChange((current) => ({
          ...current,
          toolRuns: [...current.toolRuns, result],
        }));
        onNotice("已计算年最大10min风速极值I型估计，请核对样本和适用条件。");
      } else if (operation === "review") {
        if (!source?.dataset) throw new Error("请选择已解析的审核数据。");
        const result = await api<Run>("/reviews", {
          dataset_id: source.dataset.id,
          sea_level_pressure_confirmed: seaLevel,
        });
        setLastRun(result);
        onChange((current) => ({
          ...current,
          toolRuns: [...current.toolRuns, result],
        }));
        onNotice("候选审核完成；记录仅标记，未删除或修改。");
      } else {
        if (!source?.dataset || !channelId)
          throw new Error("请选择基础数据及风速通道。");
        if (operation === "extrapolation" && (!qc || !height))
          throw new Error(
            "请先在风资源分析中选择质控文件及切变层，并填写目标高度。",
          );
        const dataset = await api<Dataset>("/processing", {
          operation,
          dataset_id: source.dataset.id,
          channel_id: channelId,
          reference_id: reference?.dataset?.id,
          reference_channel: refChannel || undefined,
          qc_id: qc?.id,
          shear_channels: state.analysis.shearChannels,
          target_height: height ? Number(height) : undefined,
          direction_channel: directionId || undefined,
          baseline_years: Number(baselineYears),
          correction_resolution: Number(resolution),
          reference_suitability_confirmed: referenceConfirmed,
          start: tower.analysisStart || undefined,
          end: tower.analysisEnd || undefined,
        });
        const next: SourceFile = {
          id: crypto.randomUUID(),
          kind: "result",
          towerId: tower.id,
          dataset,
          file: { name: dataset.filename, size: 0, lastModified: 0 },
          preview:
            "本平台生成的新序列。变换参数、父数据标识与版本随数据保存；未自动进行代表年订正。",
          encoding: "SI标准化序列",
          warning: "",
        };
        onChange((current) => ({
          ...current,
          files: [...current.files, next],
        }));
        onNotice(
          "新序列已加入结果资料，可返回风资源分析选择它进行统计；未覆盖输入。",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="ww-section-heading">
        <div>
          <h2>数据审核与序列处理</h2>
          <p>
            每次变换产生独立版本。输入四类外部成果后，也可直接分析，无需重复处理。
          </p>
        </div>
      </div>
      <section className="ww-panel">
        <div className="ww-fields ww-fields-two">
          <label>
            计算方法
            <select
              value={operation}
              onChange={(e) => {
                setOperation(e.target.value);
                setError("");
                setLastRun(null);
              }}
            >
              <option value="extrapolation">由实测质控切变外推风速</option>
              <option value="gap-fill">总体线性相关插补</option>
              <option value="representative-c1">
                国标C.1 · 16象限代表年订正
              </option>
              <option value="tower-shadow">同行业规范同高双通道取大候选</option>
              <option value="review">范围、趋势、连续不变候选审核</option>
              <option value="extreme">年最大10min风速 · 极值I型</option>
            </select>
          </label>
          {operation !== "extreme" && (
            <label>
              基础数据
              <select
                value={fileId}
                onChange={(e) => {
                  setFileId(e.target.value);
                  setChannelId("");
                }}
              >
                <option value="">选择已解析文件</option>
                {files
                  .filter((f) =>
                    operation === "review" ||
                    operation === "extrapolation" ||
                    operation === "representative-c1"
                      ? f.kind !== "reference"
                      : f.kind === "qc",
                  )
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.file.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {!["review", "extreme"].includes(operation) && (
            <label>
              基础风速通道
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
              >
                <ChannelOptions channels={means(source?.dataset)} />
              </select>
            </label>
          )}
          {operation === "extrapolation" && (
            <label>
              目标高度（m）
              <input
                type="number"
                min="1"
                max="1000"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
              <small>
                使用分析配置中所选质控层的综合切变；月/日内方式仍需单独研究。
              </small>
            </label>
          )}
          {["gap-fill", "tower-shadow", "representative-c1"].includes(
            operation,
          ) && (
            <>
              <label>
                参照文件
                <select
                  value={refId}
                  onChange={(e) => {
                    setRefId(e.target.value);
                    setRefChannel("");
                  }}
                >
                  <option value="">选择参照文件</option>
                  {state.files
                    .filter(
                      (f) =>
                        f.dataset &&
                        (f.kind === "qc" ||
                          (["gap-fill", "representative-c1"].includes(
                            operation,
                          ) &&
                            f.kind === "reference")),
                    )
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.file.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                参照通道
                <select
                  value={refChannel}
                  onChange={(e) => setRefChannel(e.target.value)}
                >
                  <ChannelOptions channels={means(reference?.dataset)} />
                </select>
              </label>
            </>
          )}
        </div>
        {operation === "representative-c1" && (
          <>
            <div className="ww-fields ww-fields-three">
              <label>
                测风塔同期风向
                <select
                  value={directionId}
                  onChange={(e) => setDirectionId(e.target.value)}
                >
                  <ChannelOptions
                    channels={means(source?.dataset, "direction")}
                  />
                </select>
              </label>
              <label>
                长期基准（年，含同期年）
                <select
                  value={baselineYears}
                  onChange={(e) => setBaselineYears(e.target.value)}
                >
                  <option>20</option>
                  <option>30</option>
                </select>
              </label>
              <label>
                条件均值风速组距（m/s）
                <input
                  type="number"
                  min="0.01"
                  max="1"
                  step="0.01"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                />
              </label>
            </div>
            <label className="ww-checkbox-line">
              <input
                type="checkbox"
                checked={referenceConfirmed}
                onChange={(e) => setReferenceConfirmed(e.target.checked)}
              />
              已核对参照资料的站点一致性、气候相似性、数据质量及适用性
            </label>
            <div className="ww-callout">
              采用国标C.1的条件均值曲线及16象限代数差。按所选组距统计后分段线性连线是软件约定；每个有风扇区至少30对同期样本，不在曲线范围外外插。分析年完整小时有效率需≥90%，所选基准需完整覆盖≥20年。失败时说明原因，不套用总体回归替代。
            </div>
          </>
        )}
        {operation === "review" && (
          <label className="ww-checkbox-line">
            <input
              type="checkbox"
              checked={seaLevel}
              onChange={(e) => setSeaLevel(e.target.checked)}
            />
            确认所选气压为海平面气压，启用870–1100hPa参考范围检查
          </label>
        )}
        {operation === "extreme" && (
          <>
            <p className="ww-inline-note">
              仅估计输入站点原高度、原密度的年最大10min平均风速。3s极大风速、站点迁移、复杂地形及台风需专项研究。
            </p>
            <label className="ww-textarea-label">
              年度最大风速样本
              <textarea
                rows={9}
                value={maxima}
                onChange={(e) => setMaxima(e.target.value)}
                placeholder={"每行：年份, 风速 m/s\n例如：2010, 25.3"}
              />
            </label>
            <label className="ww-checkbox-line">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              确认每年一值、连续、独立、同质，且为最大10min平均风速
            </label>
            <label className="ww-checkbox-line">
              <input
                type="checkbox"
                checked={interpolate}
                onChange={(e) => setInterpolate(e.target.checked)}
              />
              非系数表列示的样本数，明确采用线性插值（软件约定，非标准原文）
            </label>
          </>
        )}
        {operation === "gap-fill" && (
          <div className="ww-callout">
            必须同一步长且严格同期，插补前有效数／应测数≥70%，正相关且双侧p≤0.05。只填缺值；负预测阻止生成；本入口不进行代表年订正。
          </div>
        )}
        {error && (
          <p className="ww-error" role="alert">
            {error}
          </p>
        )}
        <div className="ww-save-bar">
          <span>国家标准优先；适用条件随运行参数保存。</span>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? "正在执行…" : "执行所选方法 →"}
          </button>
        </div>
      </section>
      {lastRun && (
        <ResultView
          output={Object.values(lastRun.outputs)[0]}
          outputId={Object.keys(lastRun.outputs)[0]}
          run={lastRun}
        />
      )}
    </div>
  );
}
