import { api } from "./api";
import { initializeDefaults } from "./autoSetup";
import type { Run } from "./api";
import type { WorkspaceState } from "./model";

const key = "aeolus.workspaces.v2";
interface SavedWorkspace {
  state: WorkspaceState;
  analysis: Record<string, string>;
  longTerm: Record<string, string>;
  tools: string[];
  correlations: Record<string, string[]>;
}
function read(): Record<number, SavedWorkspace> {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}");
    return typeof value === "object" && value ? value : {};
  } catch {
    return {};
  }
}
export function loadWorkspaceCache(): Record<number, WorkspaceState> {
  return Object.fromEntries(
    Object.entries(read())
      .filter(
        ([, s]) =>
          Array.isArray(s?.state?.towers) && Array.isArray(s?.state?.files),
      )
      .map(([id, saved]) => [id, initializeDefaults(saved.state)]),
  );
}
export function saveWorkspaceCache(workspaces: Record<number, WorkspaceState>) {
  const previous = read();
  const saved = Object.fromEntries(
    Object.entries(workspaces).map(([id, state]) => [
      id,
      {
        state: {
          ...state,
          analysisRuns: {},
          longTermRuns: {},
          toolRuns: [],
          correlationJobs: state.correlationJobs.map((job) => ({
            ...job,
            runs: undefined,
          })),
        },
        analysis: {
          ...previous[Number(id)]?.analysis,
          ...Object.fromEntries(
            Object.entries(state.analysisRuns).map(([tower, run]) => [
              tower,
              run.id,
            ]),
          ),
        },
        longTerm: {
          ...previous[Number(id)]?.longTerm,
          ...Object.fromEntries(
            Object.entries(state.longTermRuns).map(([tower, run]) => [
              tower,
              run.id,
            ]),
          ),
        },
        tools: [
          ...new Set([
            ...(previous[Number(id)]?.tools ?? []),
            ...state.toolRuns.map((r) => r.id),
          ]),
        ],
        correlations: Object.fromEntries(
          state.correlationJobs.map((job) => [
            job.id,
            job.runs?.length
              ? job.runs.map((r) => r.id)
              : (previous[Number(id)]?.correlations[job.id] ?? []),
          ]),
        ),
      },
    ]),
  );
  localStorage.setItem(key, JSON.stringify(saved));
}

export async function restoreCachedRuns(): Promise<
  Record<number, Partial<WorkspaceState>>
> {
  const result: Record<number, Partial<WorkspaceState>> = {};
  for (const [project, saved] of Object.entries(read())) {
    const ids = [
      ...new Set([
        ...Object.values(saved.analysis),
        ...Object.values(saved.longTerm),
        ...saved.tools,
        ...Object.values(saved.correlations).flat(),
      ]),
    ];
    const responses = await Promise.allSettled(
      ids.map((id) => api<Run>(`/runs/${id}`)),
    );
    const runs = new Map(
      responses
        .filter(
          (r): r is PromiseFulfilledResult<Run> => r.status === "fulfilled",
        )
        .map((r) => [r.value.id, r.value]),
    );
    result[Number(project)] = {
      analysisRuns: Object.fromEntries(
        Object.entries(saved.analysis)
          .filter(([, id]) => runs.has(id))
          .map(([tower, id]) => [tower, runs.get(id)!]),
      ),
      longTermRuns: Object.fromEntries(
        Object.entries(saved.longTerm)
          .filter(([, id]) => runs.has(id))
          .map(([tower, id]) => [tower, runs.get(id)!]),
      ),
      toolRuns: saved.tools
        .map((id) => runs.get(id))
        .filter((r): r is Run => !!r),
      correlationJobs: saved.state.correlationJobs.map((job) => {
        const ids = saved.correlations[job.id] ?? [];
        return {
          ...job,
          runs:
            ids.length && ids.every((id) => runs.has(id))
              ? ids.map((id) => runs.get(id)!)
              : undefined,
        };
      }),
    };
  }
  return result;
}
