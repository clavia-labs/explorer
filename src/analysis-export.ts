import {
  ANALYSIS_EXPORT_VERSION,
  ContractError,
  type AnalysisArtifactRow,
  type AnalysisCheckpointRow,
  type AnalysisExport,
  type AnalysisObservationRow,
  type AnalysisStepRow,
  type AnalysisToolCallRow,
  type AtifObservationResult,
  type ContentPart
} from "./contracts.ts"
import type { TraceStoreApi } from "./store-api.ts"
import { summarizeTrace } from "./summary.ts"

const contentText = (content: string | ReadonlyArray<ContentPart> | undefined) => {
  if (content === undefined) return ""
  if (typeof content === "string") return content
  return content.map((part) => part.type === "text" ? part.text : `[image:${part.source.path}]`).join("\n")
}

const observationRow = (
  datasetId: string,
  traceId: string,
  stepId: number,
  result: AtifObservationResult,
  observationIndex: number
): AnalysisObservationRow => ({
  dataset_id: datasetId,
  trace_id: traceId,
  step_id: stepId,
  observation_index: observationIndex,
  ...(result.source_call_id === undefined ? {} : { source_call_id: result.source_call_id }),
  ...(result.content === undefined ? {} : { content: result.content }),
  content_text: contentText(result.content),
  ...(result.subagent_trajectory_ref === undefined ? {} : { subagent_trajectory_ref: result.subagent_trajectory_ref }),
  ...(result.extra === undefined ? {} : { extra: result.extra })
})

export const createAnalysisExport = async (
  store: TraceStoreApi,
  datasetId: string
): Promise<AnalysisExport> => {
  const dataset = await store.getDataset(datasetId)
  if (dataset === undefined) throw new ContractError("DATASET_MISSING", "dataset does not exist")

  const objects = new Map(dataset.traces.map((entry) => [entry.trace_id, entry.object_sha256]))
  const heldTraces = new Map((await store.listTraces(datasetId)).map((trace) => [trace.trajectory_id, trace]))
  const traces = [...dataset.traces]
    .sort((left, right) => left.trace_id.localeCompare(right.trace_id))
    .map(({ trace_id }) => {
      const trace = heldTraces.get(trace_id)
      if (trace === undefined) throw new ContractError("TRACE_MISSING", `trace ${trace_id} does not exist`)
      return trace
    })

  const steps: AnalysisStepRow[] = []
  const toolCalls: AnalysisToolCallRow[] = []
  const observations: AnalysisObservationRow[] = []
  const checkpointResults: AnalysisCheckpointRow[] = []
  const artifacts: AnalysisArtifactRow[] = []

  for (const trace of traces) {
    const metadata = trace.extra.clavia
    const summary = summarizeTrace(trace)
    for (const step of trace.steps) {
      steps.push({
        dataset_id: datasetId,
        trace_id: trace.trajectory_id,
        step_id: step.step_id,
        ...(step.timestamp === undefined ? {} : { timestamp: step.timestamp }),
        source: step.source,
        ...(step.model_name === undefined ? {} : { model_name: step.model_name }),
        ...(step.reasoning_effort === undefined ? {} : { reasoning_effort: step.reasoning_effort }),
        message: step.message,
        message_text: contentText(step.message),
        ...(step.reasoning_content === undefined ? {} : { reasoning_content: step.reasoning_content }),
        ...(step.llm_call_count === undefined ? {} : { llm_call_count: step.llm_call_count }),
        ...(step.metrics?.prompt_tokens === undefined ? {} : { prompt_tokens: step.metrics.prompt_tokens }),
        ...(step.metrics?.completion_tokens === undefined ? {} : { completion_tokens: step.metrics.completion_tokens }),
        ...(step.metrics?.cached_tokens === undefined ? {} : { cached_tokens: step.metrics.cached_tokens }),
        ...(step.metrics?.cost_usd === undefined ? {} : { cost_usd: step.metrics.cost_usd }),
        tool_call_count: step.tool_calls?.length ?? 0,
        observation_count: step.observation?.results.length ?? 0,
        ...(step.is_copied_context === undefined ? {} : { is_copied_context: step.is_copied_context }),
        ...(step.extra === undefined ? {} : { extra: step.extra })
      })
      toolCalls.push(...(step.tool_calls ?? []).map((call, toolCallIndex) => ({
        dataset_id: datasetId,
        trace_id: trace.trajectory_id,
        step_id: step.step_id,
        tool_call_index: toolCallIndex,
        tool_call_id: call.tool_call_id,
        function_name: call.function_name,
        arguments: call.arguments,
        ...(call.extra === undefined ? {} : { extra: call.extra })
      })))
      observations.push(...(step.observation?.results ?? []).map((result, observationIndex) =>
        observationRow(datasetId, trace.trajectory_id, step.step_id, result, observationIndex)
      ))
    }
    checkpointResults.push(...(metadata.failure_modes ?? []).map((checkpoint) => ({
      dataset_id: datasetId,
      trace_id: trace.trajectory_id,
      model: summary.model,
      ...(summary.task_id === undefined ? {} : { task_id: summary.task_id }),
      ...(summary.work_type === undefined ? {} : { work_type: summary.work_type }),
      behavior: summary.behavior,
      ...(summary.strict_pass === undefined ? {} : { strict_pass: summary.strict_pass }),
      checkpoint_id: checkpoint.id,
      verdict: checkpoint.verdict,
      ...(checkpoint.justification === undefined ? {} : { justification: checkpoint.justification })
    })))
    artifacts.push(...(metadata.artifacts ?? []).map((artifact, artifactIndex) => ({
      dataset_id: datasetId,
      trace_id: trace.trajectory_id,
      artifact_index: artifactIndex,
      path: artifact.path,
      ...(artifact.bytes === undefined ? {} : { bytes: artifact.bytes }),
      ...(artifact.sha256 === undefined ? {} : { sha256: artifact.sha256 })
    })))
  }

  return {
    schema_version: ANALYSIS_EXPORT_VERSION,
    dataset,
    tables: {
      traces: traces.map((trace) => ({
        dataset_id: datasetId,
        ...summarizeTrace(trace),
        object_sha256: objects.get(trace.trajectory_id)!,
        trace_path: `/v1/traces/${encodeURIComponent(trace.trajectory_id)}?dataset_id=${encodeURIComponent(datasetId)}`
      })),
      steps,
      tool_calls: toolCalls,
      observations,
      checkpoint_results: checkpointResults,
      artifacts
    }
  }
}
