import { OUTPUTS, SOURCE_TYPES, outputStatus } from "./model";
import type { WorkspaceViewProps } from "./model";
import CalculationPanel from "./CalculationPanel";

export default function AnalysisSetup({
  state,
  onChange,
  onNotice,
}: WorkspaceViewProps) {
  const tower = state.towers.find((t) => t.id === state.activeTowerId)!;
  function changeAnalysis(
    key: "analysisStart" | "analysisEnd" | "hubHeight",
    value: string,
  ) {
    onChange((current) => ({
      ...current,
      towers: current.towers.map((t) =>
        t.id === tower.id ? { ...t, [key]: value } : t,
      ),
      planSaved: false,
    }));
  }
  return (
    <div className="ww-analysis-view">
      <section className="ww-panel ww-analysis-year">
        <div className="ww-section-heading">
          <div>
            <span className="ww-overline">ANALYSIS YEAR</span>
            <h2>以结果数据确定分析年</h2>
            <p>
              结果文件已经完成分析年选取、插补、订正与轮毂高度外推；这里记录它实际覆盖的时段。
            </p>
          </div>
          <span className="ww-source-chip result">结果数据</span>
        </div>
        <div className="ww-fields ww-fields-three">
          <label>
            结果数据分析年起点
            <input
              type="date"
              value={tower.analysisStart}
              onChange={(e) => changeAnalysis("analysisStart", e.target.value)}
            />
          </label>
          <label>
            结果数据分析年终点（不含当天）
            <input
              type="date"
              value={tower.analysisEnd}
              onChange={(e) => changeAnalysis("analysisEnd", e.target.value)}
            />
          </label>
          <label>
            结果数据轮毂高度（m）
            <input
              type="number"
              min="1"
              step="any"
              placeholder="填写结果文件中的轮毂高度"
              value={tower.hubHeight}
              onChange={(e) => changeAnalysis("hubHeight", e.target.value)}
            />
          </label>
        </div>
        {tower.analysisStart &&
          tower.analysisEnd &&
          tower.analysisStart >= tower.analysisEnd && (
            <p className="ww-error" role="alert">
              分析年终点必须晚于起点。
            </p>
          )}
        <p className="ww-inline-note">
          统一采用左闭右开区间，例如2024-07-01至2025-07-01。长期参考沿用这里的分析年，不自动切换自然年。
        </p>
      </section>
      <section className="ww-panel ww-qc-scope">
        <div>
          <h2>质控数据统计范围</h2>
          <p>
            切变、湍流与空气密度使用质控数据。轮毂外推采用的切变也来自这一阶段。
          </p>
        </div>
        <label>
          质控分析时段
          <select
            value={state.qcPeriod}
            onChange={(e) =>
              onChange((current) => ({
                ...current,
                qcPeriod: e.target.value as "all" | "analysis",
                planSaved: false,
              }))
            }
          >
            <option value="all">质控文件全部有效时段</option>
            <option value="analysis">与结果数据分析年一致</option>
          </select>
        </label>
      </section>
      <CalculationPanel state={state} onChange={onChange} onNotice={onNotice} />
      <div className="ww-section-heading">
        <div>
          <h2>选择需要查阅的图表与表格</h2>
          <p>图与表引用同一次运行结果，报告格式等模板接入。</p>
        </div>
        <span className="ww-quiet-tag">
          已选 {state.selectedOutputs.length} / {OUTPUTS.length} 组
        </span>
      </div>
      {SOURCE_TYPES.map((source) => (
        <section className="ww-output-group" key={source.id}>
          <div className="ww-group-title">
            <span className={`ww-source-chip ${source.id}`}>
              {source.shortLabel}
            </span>
            <h3>{source.outputs}</h3>
          </div>
          <div className="ww-output-grid">
            {OUTPUTS.filter((output) => output.kind === source.id).map(
              (output) => (
                <label
                  className={`ww-output-option ${state.selectedOutputs.includes(output.id) ? "is-selected" : ""}`}
                  key={output.id}
                >
                  <input
                    type="checkbox"
                    checked={state.selectedOutputs.includes(output.id)}
                    onChange={(e) =>
                      onChange((current) => ({
                        ...current,
                        selectedOutputs: e.target.checked
                          ? [...current.selectedOutputs, output.id]
                          : current.selectedOutputs.filter(
                              (id) => id !== output.id,
                            ),
                        planSaved: false,
                      }))
                    }
                  />
                  <span>
                    <strong>{output.title}</strong>
                    <span>{output.description}</span>
                    <small>
                      {output.form} <i>·</i> {outputStatus(output, state)}
                    </small>
                  </span>
                </label>
              ),
            )}
          </div>
        </section>
      ))}
      <div className="ww-save-bar">
        <p>
          {state.planSaved
            ? "图表清单已保留在本次会话，可前往图表中心查看。"
            : "此处保存图表查阅清单，实际计算请使用上方执行按钮。"}
        </p>
        <button
          className="primary"
          disabled={!state.selectedOutputs.length}
          onClick={() => {
            onChange((current) => ({ ...current, planSaved: true }));
            onNotice("图表查阅清单已保存；计算结果请在图表中心查阅。");
          }}
        >
          保存图表清单 <span>→</span>
        </button>
      </div>
    </div>
  );
}
