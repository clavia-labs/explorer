import type { AtifTrajectory, QueryField, TraceSummary } from "./contracts.ts"
import { claviaMetadataOf } from "./contracts.ts"

const total = (values: ReadonlyArray<number | undefined>) =>
  values.reduce<number>((sum, value) => sum + (value ?? 0), 0)

const mean = (values: ReadonlyArray<number | undefined>) => {
  const held = values.filter((value): value is number => value !== undefined)
  return held.length === 0 ? undefined : total(held) / held.length
}

export const summarizeTrace = (trace: AtifTrajectory): TraceSummary => {
  const metadata = claviaMetadataOf(trace)
  const toolNames = [...new Set(
    trace.steps.flatMap((step) => step.tool_calls?.map((call) => call.function_name) ?? [])
  )].sort()
  const usefulness = metadata.outcome.usefulness
  const checkpointPassed = metadata.outcome.checkpoint_passed
  const checkpointTotal = metadata.outcome.checkpoint_total
  return {
    trace_id: trace.trajectory_id,
    title: metadata.title,
    model: trace.agent.model_name ?? "unknown",
    agent: trace.agent.name,
    source: metadata.source.kind,
    ...(metadata.task?.id === undefined ? {} : { task_id: metadata.task.id }),
    ...(metadata.task?.work_type === undefined ? {} : { work_type: metadata.task.work_type }),
    status: metadata.outcome.status,
    ...(metadata.outcome.strict_pass === undefined
      ? {}
      : { strict_pass: metadata.outcome.strict_pass }),
    ...(checkpointPassed === undefined ? {} : { checkpoint_passed: checkpointPassed }),
    ...(checkpointTotal === undefined ? {} : { checkpoint_total: checkpointTotal }),
    ...(checkpointPassed === undefined || checkpointTotal === undefined || checkpointTotal === 0
      ? {}
      : { checkpoint_rate: checkpointPassed / checkpointTotal }),
    ...(metadata.outcome.alignment === undefined ? {} : { alignment: metadata.outcome.alignment }),
    ...(usefulness === undefined
      ? {}
      : { usefulness: mean([usefulness.clarity, usefulness.length, usefulness.structure])! }),
    ...(metadata.duration_ms === undefined ? {} : { duration_ms: metadata.duration_ms }),
    prompt_tokens: trace.final_metrics?.total_prompt_tokens
      ?? total(trace.steps.map((step) => step.metrics?.prompt_tokens)),
    completion_tokens: trace.final_metrics?.total_completion_tokens
      ?? total(trace.steps.map((step) => step.metrics?.completion_tokens)),
    cost_usd: trace.final_metrics?.total_cost_usd
      ?? total(trace.steps.map((step) => step.metrics?.cost_usd)),
    steps: trace.steps.length,
    tool_calls: total(trace.steps.map((step) => step.tool_calls?.length)),
    tool_names: toolNames,
    behavior: metadata.behavior.class,
    behavior_summary: metadata.behavior.summary,
    behavior_tags: metadata.behavior.tags,
    failed_checkpoints: metadata.failure_modes?.filter((mode) => mode.verdict === "FAIL").length ?? 0
  }
}

export const fieldValue = (summary: TraceSummary, field: QueryField): string | boolean | undefined => {
  if (field === "tool_name") return undefined
  return summary[field]
}
