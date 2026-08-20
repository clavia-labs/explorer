import type {
  CountedLabel,
  FailureAnalysis,
  TraceSummary,
  TraceFailureEvidence
} from "./contracts.ts"

interface HeldFailureTrace {
  readonly summary: TraceSummary
  readonly justification?: string
}

const countsOf = (values: ReadonlyArray<string>): ReadonlyArray<CountedLabel> => {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
}

export const clusterFailureEvidence = (
  datasetId: string,
  evidence: ReadonlyArray<TraceFailureEvidence>
): FailureAnalysis => {
  const clusters = new Map<string, Array<HeldFailureTrace>>()
  for (const record of evidence) {
    for (const mode of record.failure_modes) {
      if (mode.verdict !== "FAIL") continue
      const held = clusters.get(mode.id) ?? []
      if (!held.some((trace) => trace.summary.trace_id === record.summary.trace_id)) {
        held.push({
          summary: record.summary,
          ...(mode.justification === undefined ? {} : { justification: mode.justification })
        })
      }
      clusters.set(mode.id, held)
    }
  }
  return {
    dataset_id: datasetId,
    clusters: [...clusters.entries()]
      .map(([id, traces]) => ({
        id,
        trace_count: traces.length,
        model_count: new Set(traces.map((trace) => trace.summary.model)).size,
        dominant_behaviors: countsOf(traces.map((trace) => trace.summary.behavior)),
        dominant_task_types: countsOf(traces.map((trace) => trace.summary.work_type ?? "unclassified")),
        examples: [...new Map(traces
          .filter((trace): trace is HeldFailureTrace & { readonly justification: string } => trace.justification !== undefined)
          .map((trace) => [trace.summary.model, { model: trace.summary.model, justification: trace.justification }])).values()],
        traces: traces
          .map(({ summary }) => ({
            trace_id: summary.trace_id,
            title: summary.title,
            model: summary.model,
            ...(summary.task_id === undefined ? {} : { task_id: summary.task_id }),
            ...(summary.work_type === undefined ? {} : { work_type: summary.work_type }),
            behavior: summary.behavior,
            ...(summary.strict_pass === undefined ? {} : { strict_pass: summary.strict_pass })
          }))
          .sort((left, right) => left.trace_id.localeCompare(right.trace_id))
      }))
      .sort((left, right) => right.trace_count - left.trace_count || left.id.localeCompare(right.id))
  }
}
