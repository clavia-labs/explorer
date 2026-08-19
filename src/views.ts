import type { DatasetManifest, TraceSummary } from "./contracts.ts"
import type { TraceStoreApi } from "./store-api.ts"

const sampleTraceIds = (summaries: ReadonlyArray<TraceSummary>) =>
  [...summaries]
    .sort((left, right) =>
      Number(left.strict_pass ?? false) - Number(right.strict_pass ?? false)
      || right.tool_calls - left.tool_calls
      || left.trace_id.localeCompare(right.trace_id)
    )
    .slice(0, 12)
    .map((summary) => summary.trace_id)

export const createDefaultView = async (store: TraceStoreApi, dataset: DatasetManifest) => {
  const summaries = await store.listTraceSummaries(dataset.dataset_id)
  return store.putView({
    dataset_id: dataset.dataset_id,
    title: `${dataset.name}: trajectory analysis`,
    description: "Model outcomes, execution patterns, tool use, and trace samples from one immutable dataset snapshot.",
    cells: [
      {
        kind: "chart",
        title: "Reliability by model",
        query: {
          group_by: "model",
          metrics: ["trace_count", "pass_rate", "checkpoint_rate", "avg_usefulness"],
          order_by: { metric: "checkpoint_rate", direction: "desc" }
        },
        chart: "bar",
        x: "model",
        y: "checkpoint_rate"
      },
      {
        kind: "chart",
        title: "What the trajectories do",
        query: {
          group_by: "behavior",
          metrics: ["trace_count", "pass_rate", "avg_tool_calls"],
          order_by: { metric: "trace_count", direction: "desc" }
        },
        chart: "distribution",
        x: "behavior",
        y: "trace_count"
      },
      {
        kind: "chart",
        title: "Tool use and outcome",
        query: {
          group_by: "tool_name",
          metrics: ["trace_count", "pass_rate", "avg_tool_calls"],
          order_by: { metric: "trace_count", direction: "desc" },
          limit: 12
        },
        chart: "bar",
        x: "tool_name",
        y: "trace_count"
      },
      {
        kind: "trace-list",
        title: "Representative traces",
        sample_trace_ids: sampleTraceIds(summaries)
      }
    ]
  })
}
