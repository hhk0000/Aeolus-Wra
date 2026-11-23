import type { WorkspaceState } from "./model";
import { InteractiveResultView } from "./InteractiveResultView";
import ReportExport from "./ReportExport";
import type { ReportRun } from "./ReportExport";

export default function WorkspaceReportExport({
  state,
  projectName,
}: {
  state: WorkspaceState;
  projectName?: string;
}) {
  const tower = state.towers.find((t) => t.id === state.activeTowerId);
  if (!tower) return null;
  const runs: ReportRun[] = [];
  const analysis = state.analysisRuns[tower.id];
  const reference = state.longTermRuns[tower.id];
  if (analysis) runs.push({ run: analysis });
  if (reference) runs.push({ run: reference });
  for (const job of state.correlationJobs) {
    if (
      !state.files.some(
        (file) => file.id === job.leftFileId && file.towerId === tower.id,
      )
    )
      continue;
    job.runs?.forEach((run, i) => {
      const pair = job.pairs[i];
      const sources = job.sourceLabels.join(" ↔ ");
      runs.push({
        run,
        label: [job.title, sources, pair && `${pair[0]}m ↔ ${pair[1]}m`]
          .filter(Boolean)
          .join(" · "),
      });
    });
  }
  if (
    !runs.some(({ run }) =>
      Object.values(run.outputs).some((output) => output.status === "ready"),
    )
  ) {
    return (
      <p className="ww-callout">
        当前测风塔还没有可导出的计算成果。请在“分析配置”中运行风资源分析、长期参考或相关性分析。
      </p>
    );
  }
  return (
    <ReportExport
      key={tower.id}
      runs={runs}
      title={[projectName, tower.name, "风资源分析报告"]
        .filter(Boolean)
        .join(" · ")}
      expanded
      renderOutput={(run, id, output) => (
        <InteractiveResultView
          run={run}
          towerName={tower.name}
          outputId={id}
          output={output}
          exportMode
        />
      )}
    />
  );
}
