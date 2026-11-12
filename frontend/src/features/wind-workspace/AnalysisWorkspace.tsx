import AnalysisSetup from "./AnalysisSetup";
import CorrelationSetup from "./CorrelationSetup";
import DataSources from "./DataSources";
import AlgorithmTools from "./AlgorithmTools";
import LongTermSetup from "./LongTermSetup";
import { SOURCE_TYPES, configurationSnapshot, filesForTower } from "./model";
import type { WorkspaceTab, WorkspaceViewProps } from "./model";
import "./workspace.css";

interface Props extends WorkspaceViewProps {
  projectName: string;
  onOpenGallery: () => void;
}

export default function AnalysisWorkspace(props: Props) {
  const { state, onChange, onNotice, projectName, onOpenGallery } = props;
  const selectedTypes = SOURCE_TYPES.filter(
    (source) => filesForTower(state, source.id).length > 0,
  ).length;
  const tabs: [WorkspaceTab, string, string][] = [
    ["data", "数据资料", "01"],
    ["analysis", "风资源分析", "02"],
    ["correlation", "相关性分析", "03"],
    ["long-term", "长期参考", "04"],
    ["tools", "审核与处理", "05"],
  ];

  function downloadConfiguration() {
    const data = configurationSnapshot(state, projectName);
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${projectName.replace(/[\\/:*?"<>|]/g, "_")}_分析配置.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotice("分析配置已导出；数据和完整运行快照可在相应结果中单独导出。");
  }

  return (
    <div className="ww-workspace">
      <section className="ww-workflow-banner">
        <div>
          <span className="ww-overline">FROM DATA TO INSIGHT</span>
          <h2>让每一份数据，流向正确的分析</h2>
          <p>四类输入独立管理，图表、统计表与报告内容沿用明确的数据来源。</p>
        </div>
        <div className="ww-completion">
          <strong>
            {selectedTypes}
            <span>/ 4</span>
          </strong>
          <span>类资料已选择</span>
          <div className="ww-progress-track">
            <i style={{ width: `${selectedTypes * 25}%` }} />
          </div>
        </div>
      </section>
      <div className="ww-workspace-toolbar">
        <div className="ww-primary-tabs" role="tablist" aria-label="分析工作流">
          {tabs.map(([id, label, number]) => (
            <button
              key={id}
              id={`ww-tab-${id}`}
              role="tab"
              aria-controls={`ww-panel-${id}`}
              aria-selected={state.activeTab === id}
              className={state.activeTab === id ? "active" : ""}
              onClick={() =>
                onChange((current) => ({ ...current, activeTab: id }))
              }
            >
              <span>{number}</span>
              {label}
            </button>
          ))}
        </div>
        <button className="ww-button" onClick={downloadConfiguration}>
          ↓ 导出配置
        </button>
      </div>
      {state.activeTab !== "data" && (
        <div className="ww-active-tower">
          <label>
            当前测风塔{" "}
            <select
              aria-label="分析测风塔"
              value={state.activeTowerId}
              onChange={(e) =>
                onChange((current) => ({
                  ...current,
                  activeTowerId: e.target.value,
                }))
              }
            >
              {state.towers.map((tower) => (
                <option key={tower.id} value={tower.id}>
                  {tower.name || "未命名测风塔"}
                </option>
              ))}
            </select>
          </label>
          <button
            className="ww-text-button"
            onClick={() =>
              onChange((current) => ({ ...current, activeTab: "data" }))
            }
          >
            管理数据资料 →
          </button>
        </div>
      )}
      <div
        role="tabpanel"
        id={`ww-panel-${state.activeTab}`}
        aria-labelledby={`ww-tab-${state.activeTab}`}
      >
        {state.activeTab === "data" && <DataSources {...props} />}
        {state.activeTab === "analysis" && <AnalysisSetup {...props} />}
        {state.activeTab === "correlation" && <CorrelationSetup {...props} />}
        {state.activeTab === "long-term" && <LongTermSetup {...props} />}
        {state.activeTab === "tools" && <AlgorithmTools {...props} />}
      </div>
      <div className="ww-workspace-footer">
        <span>本机计算 · 来源与版本可追溯 · 每项结果独立提示适用条件</span>
        <button className="ww-text-button" onClick={onOpenGallery}>
          查看计算图表 →
        </button>
      </div>
    </div>
  );
}
