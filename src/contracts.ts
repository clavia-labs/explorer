export const ATIF_VERSION = "ATIF-v1.7" as const
export const TRACE_METADATA_VERSION = "clavia.trace-metadata/v1" as const
export const DATASET_VERSION = "clavia.dataset/v1" as const
export const VIEW_VERSION = "clavia.view/v1" as const
export const TRACE_ACTIVITY_VERSION = "clavia.trace-activity/v1" as const
export const ANALYSIS_EXPORT_VERSION = "clavia.analysis-export/v1" as const

export type ContentPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image"
      readonly source: {
        readonly media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
        readonly path: string
      }
    }

export interface AtifToolCall {
  readonly tool_call_id: string
  readonly function_name: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly extra?: Readonly<Record<string, unknown>>
}

export interface AtifObservationResult {
  readonly source_call_id?: string
  readonly content?: string | ReadonlyArray<ContentPart>
  readonly subagent_trajectory_ref?: ReadonlyArray<{
    readonly trajectory_id?: string
    readonly trajectory_path?: string
    readonly session_id?: string
  }>
  readonly extra?: Readonly<Record<string, unknown>>
}

export interface AtifMetrics {
  readonly prompt_tokens?: number
  readonly completion_tokens?: number
  readonly cached_tokens?: number
  readonly cost_usd?: number
  readonly prompt_token_ids?: ReadonlyArray<number>
  readonly completion_token_ids?: ReadonlyArray<number>
  readonly logprobs?: ReadonlyArray<number>
  readonly extra?: Readonly<Record<string, unknown>>
}

export interface AtifStep {
  readonly step_id: number
  readonly timestamp?: string
  readonly source: "system" | "user" | "agent"
  readonly model_name?: string
  readonly reasoning_effort?: string | number
  readonly message: string | ReadonlyArray<ContentPart>
  readonly reasoning_content?: string
  readonly tool_calls?: ReadonlyArray<AtifToolCall>
  readonly observation?: { readonly results: ReadonlyArray<AtifObservationResult> }
  readonly metrics?: AtifMetrics
  readonly llm_call_count?: number
  readonly is_copied_context?: boolean
  readonly extra?: Readonly<Record<string, unknown>>
}

export interface FailureMode {
  readonly id: string
  readonly verdict: "PASS" | "FAIL" | "NOT_ASSESSABLE"
  readonly justification?: string
}

export type BehaviorClass =
  | "single-shot"
  | "direct-builder"
  | "research-first"
  | "iterative-refiner"
  | "recovery-loop"
  | "answer-only"

export interface ClaviaTraceMetadata {
  readonly schema_version: typeof TRACE_METADATA_VERSION
  readonly title: string
  readonly source: {
    readonly kind: "legalbench" | "atif" | "letta" | "otel" | "braintrust" | "langfuse"
    readonly id: string
  }
  readonly task?: {
    readonly id: string
    readonly work_type?: string
  }
  readonly outcome: {
    readonly status: string
    readonly strict_pass?: boolean
    readonly checkpoint_passed?: number
    readonly checkpoint_total?: number
    readonly alignment?: string
    readonly usefulness?: {
      readonly clarity?: number
      readonly length?: number
      readonly structure?: number
    }
  }
  readonly behavior: {
    readonly class: BehaviorClass
    readonly summary: string
    readonly tags: ReadonlyArray<string>
  }
  readonly duration_ms?: number
  readonly failure_modes?: ReadonlyArray<FailureMode>
  readonly artifacts?: ReadonlyArray<{
    readonly path: string
    readonly bytes?: number
    readonly sha256?: string
  }>
  readonly provider?: Readonly<Record<string, unknown>>
}

export interface AtifTrajectory {
  readonly schema_version: typeof ATIF_VERSION
  readonly session_id?: string
  readonly trajectory_id: string
  readonly agent: {
    readonly name: string
    readonly version: string
    readonly model_name?: string
    readonly tool_definitions?: ReadonlyArray<unknown>
    readonly extra?: Readonly<Record<string, unknown>>
  }
  readonly steps: ReadonlyArray<AtifStep>
  readonly notes?: string
  readonly final_metrics?: {
    readonly total_prompt_tokens?: number
    readonly total_completion_tokens?: number
    readonly total_cached_tokens?: number
    readonly total_cost_usd?: number
    readonly total_steps?: number
    readonly extra?: Readonly<Record<string, unknown>>
  }
  readonly continued_trajectory_ref?: string
  readonly subagent_trajectories?: ReadonlyArray<AtifTrajectory>
  readonly extra: Readonly<Record<string, unknown>> & {
    readonly clavia: ClaviaTraceMetadata
  }
}

export interface TraceSummary {
  readonly trace_id: string
  readonly title: string
  readonly model: string
  readonly agent: string
  readonly source: ClaviaTraceMetadata["source"]["kind"]
  readonly task_id?: string
  readonly work_type?: string
  readonly status: string
  readonly strict_pass?: boolean
  readonly checkpoint_passed?: number
  readonly checkpoint_total?: number
  readonly checkpoint_rate?: number
  readonly alignment?: string
  readonly usefulness?: number
  readonly duration_ms?: number
  readonly prompt_tokens: number
  readonly completion_tokens: number
  readonly cost_usd: number
  readonly steps: number
  readonly tool_calls: number
  readonly tool_names: ReadonlyArray<string>
  readonly behavior: BehaviorClass
  readonly behavior_summary: string
  readonly behavior_tags: ReadonlyArray<string>
  readonly failed_checkpoints: number
}

export interface TraceFailureEvidence {
  readonly summary: TraceSummary
  readonly failure_modes: ReadonlyArray<FailureMode>
}

export interface AnalysisTraceRow extends TraceSummary {
  readonly dataset_id: string
  readonly object_sha256: string
  readonly trace_path: string
}

export interface AnalysisStepRow {
  readonly dataset_id: string
  readonly trace_id: string
  readonly step_id: number
  readonly timestamp?: string
  readonly source: AtifStep["source"]
  readonly model_name?: string
  readonly reasoning_effort?: string | number
  readonly message: AtifStep["message"]
  readonly message_text: string
  readonly reasoning_content?: string
  readonly llm_call_count?: number
  readonly prompt_tokens?: number
  readonly completion_tokens?: number
  readonly cached_tokens?: number
  readonly cost_usd?: number
  readonly tool_call_count: number
  readonly observation_count: number
  readonly is_copied_context?: boolean
  readonly extra?: Readonly<Record<string, unknown>>
}

export interface AnalysisToolCallRow {
  readonly dataset_id: string
  readonly trace_id: string
  readonly step_id: number
  readonly tool_call_index: number
  readonly tool_call_id: string
  readonly function_name: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly extra?: Readonly<Record<string, unknown>>
}

export interface AnalysisObservationRow {
  readonly dataset_id: string
  readonly trace_id: string
  readonly step_id: number
  readonly observation_index: number
  readonly source_call_id?: string
  readonly content?: AtifObservationResult["content"]
  readonly content_text: string
  readonly subagent_trajectory_ref?: AtifObservationResult["subagent_trajectory_ref"]
  readonly extra?: Readonly<Record<string, unknown>>
}

export interface AnalysisCheckpointRow {
  readonly dataset_id: string
  readonly trace_id: string
  readonly model: string
  readonly task_id?: string
  readonly work_type?: string
  readonly behavior: BehaviorClass
  readonly strict_pass?: boolean
  readonly checkpoint_id: string
  readonly verdict: FailureMode["verdict"]
  readonly justification?: string
}

export interface AnalysisArtifactRow {
  readonly dataset_id: string
  readonly trace_id: string
  readonly artifact_index: number
  readonly path: string
  readonly bytes?: number
  readonly sha256?: string
}

export interface AnalysisExport {
  readonly schema_version: typeof ANALYSIS_EXPORT_VERSION
  readonly dataset: DatasetManifest
  readonly page: {
    readonly trace_offset: number
    readonly trace_limit: number
    readonly total_traces: number
    readonly returned_traces: number
    readonly next_trace_offset?: number
  }
  readonly tables: {
    readonly traces: ReadonlyArray<AnalysisTraceRow>
    readonly steps: ReadonlyArray<AnalysisStepRow>
    readonly tool_calls: ReadonlyArray<AnalysisToolCallRow>
    readonly observations: ReadonlyArray<AnalysisObservationRow>
    readonly checkpoint_results: ReadonlyArray<AnalysisCheckpointRow>
    readonly artifacts: ReadonlyArray<AnalysisArtifactRow>
  }
}

export interface FailureClusterTrace {
  readonly trace_id: string
  readonly title: string
  readonly model: string
  readonly task_id?: string
  readonly work_type?: string
  readonly behavior: BehaviorClass
  readonly strict_pass?: boolean
}

export interface FailureClusterExample {
  readonly model: string
  readonly justification: string
}

export interface CountedLabel {
  readonly label: string
  readonly count: number
}

export interface FailureCluster {
  readonly id: string
  readonly trace_count: number
  readonly model_count: number
  readonly dominant_behaviors: ReadonlyArray<CountedLabel>
  readonly dominant_task_types: ReadonlyArray<CountedLabel>
  readonly examples: ReadonlyArray<FailureClusterExample>
  readonly traces: ReadonlyArray<FailureClusterTrace>
}

export interface FailureAnalysis {
  readonly dataset_id: string
  readonly clusters: ReadonlyArray<FailureCluster>
}

export type ActivityCategory =
  | "trajectory"
  | "orient"
  | "investigate"
  | "decide"
  | "change"
  | "verify"
  | "coordinate"
  | "recover"
  | "respond"
  | "execute"

export type ActivityDimension =
  | "intent"
  | "evidence"
  | "decision"
  | "execution"
  | "recovery"
  | "outcome"

export interface TraceActivityNode {
  readonly node_id: string
  readonly kind: "trajectory" | "phase" | "turn" | "step" | "tool"
  readonly category: ActivityCategory
  readonly dimension: ActivityDimension
  readonly label: string
  readonly summary: string
  readonly status: "completed" | "failed" | "unknown"
  readonly start_step: number
  readonly end_step: number
  readonly step_count: number
  readonly tool_call_count: number
  readonly tools: ReadonlyArray<string>
  readonly start_time?: string
  readonly end_time?: string
  readonly duration_ms?: number
  readonly leaf_ref?: {
    readonly step_id: number
    readonly tool_call_id?: string
  }
  readonly children: ReadonlyArray<TraceActivityNode>
}

export interface TraceActivity {
  readonly schema_version: typeof TRACE_ACTIVITY_VERSION
  readonly trajectory_id: string
  readonly generated_by: {
    readonly kind: "deterministic"
    readonly algorithm: "clavia.activity-tree/v1"
  }
  readonly root: TraceActivityNode
}

export interface DatasetManifest {
  readonly schema_version: typeof DATASET_VERSION
  readonly dataset_id: string
  readonly name: string
  readonly created_at: string
  readonly source: {
    readonly kind: string
    readonly id: string
    readonly sha256?: string
  }
  readonly traces: ReadonlyArray<{
    readonly trace_id: string
    readonly object_sha256: string
  }>
  readonly object_sha256: string
}

export const QUERY_FIELDS = [
  "model",
  "agent",
  "source",
  "task_id",
  "work_type",
  "status",
  "strict_pass",
  "alignment",
  "behavior",
  "tool_name"
] as const

export type QueryField = typeof QUERY_FIELDS[number]
export type QueryMetric =
  | "trace_count"
  | "pass_rate"
  | "checkpoint_rate"
  | "avg_usefulness"
  | "avg_cost_usd"
  | "avg_duration_ms"
  | "avg_tool_calls"
  | "avg_prompt_tokens"
  | "avg_completion_tokens"

export interface TraceQuery {
  readonly dataset_id: string
  readonly filters?: ReadonlyArray<{
    readonly field: QueryField
    readonly op: "eq" | "neq" | "in"
    readonly value: string | boolean | ReadonlyArray<string | boolean>
  }>
  readonly group_by?: QueryField
  readonly metrics: ReadonlyArray<QueryMetric>
  readonly order_by?: { readonly metric: QueryMetric; readonly direction: "asc" | "desc" }
  readonly limit?: number
}

export interface QueryResult {
  readonly dataset_id: string
  readonly matched_traces: number
  readonly group_by?: QueryField
  readonly rows: ReadonlyArray<Readonly<Record<string, string | number | boolean | null>>>
}

export type ViewCell =
  | { readonly kind: "markdown"; readonly title: string; readonly content: string }
  | {
      readonly kind: "chart"
      readonly title: string
      readonly query: Omit<TraceQuery, "dataset_id">
      readonly chart: "bar" | "scatter" | "distribution"
      readonly x: string
      readonly y: string
    }
  | {
      readonly kind: "trace-list"
      readonly title: string
      readonly filters?: TraceQuery["filters"]
      readonly sample_trace_ids?: ReadonlyArray<string>
    }

export interface TraceView {
  readonly schema_version: typeof VIEW_VERSION
  readonly view_id: string
  readonly dataset_id: string
  readonly title: string
  readonly description?: string
  readonly created_at: string
  readonly cells: ReadonlyArray<ViewCell>
  readonly object_sha256: string
}

export type SharePolicy = "partner-review" | "lab-prospect"

export interface PolicyCapabilities {
  readonly policy: "internal" | SharePolicy
  readonly reasoning: boolean
  readonly task_content: boolean
  readonly tool_content: boolean
  readonly failure_details: boolean
  readonly all_traces: boolean
}

export class ContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = "ContractError"
  }
}

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined

export const claviaMetadataOf = (trace: AtifTrajectory) => trace.extra.clavia

export const validateTrajectory = (value: unknown): AtifTrajectory => {
  const root = record(value)
  if (root?.schema_version !== ATIF_VERSION) {
    throw new ContractError("TRACE_SCHEMA", `schema_version must equal ${ATIF_VERSION}`)
  }
  const agent = record(root.agent)
  if (typeof agent?.name !== "string" || typeof agent.version !== "string") {
    throw new ContractError("TRACE_AGENT", "agent name and version are required")
  }
  if (typeof root.trajectory_id !== "string" || root.trajectory_id.length === 0) {
    throw new ContractError("TRACE_ID", "trajectory_id is required by the store")
  }
  if (!Array.isArray(root.steps) || root.steps.length === 0) {
    throw new ContractError("TRACE_STEPS", "steps must contain at least one step")
  }
  for (const [index, candidate] of root.steps.entries()) {
    const step = record(candidate)
    if (step?.step_id !== index + 1) {
      throw new ContractError("TRACE_STEP_ORDER", `step_id must equal ${index + 1}`)
    }
    if (step.source !== "system" && step.source !== "user" && step.source !== "agent") {
      throw new ContractError("TRACE_STEP_SOURCE", `step ${index + 1} has an invalid source`)
    }
    if (typeof step.message !== "string" && !Array.isArray(step.message)) {
      throw new ContractError("TRACE_STEP_MESSAGE", `step ${index + 1} has an invalid message`)
    }
    if (step.llm_call_count === 0 && (step.metrics !== undefined || step.reasoning_content !== undefined)) {
      throw new ContractError("TRACE_DETERMINISTIC_STEP", `step ${index + 1} has LLM fields with llm_call_count 0`)
    }
    if (step.tool_calls !== undefined) {
      if (!Array.isArray(step.tool_calls)) {
        throw new ContractError("TRACE_TOOL_CALLS", `step ${index + 1} has invalid tool_calls`)
      }
      const ids = new Set<string>()
      for (const call of step.tool_calls) {
        const tool = record(call)
        if (
          typeof tool?.tool_call_id !== "string"
          || typeof tool.function_name !== "string"
          || record(tool.arguments) === undefined
        ) {
          throw new ContractError("TRACE_TOOL_CALL", `step ${index + 1} has an invalid tool call`)
        }
        if (ids.has(tool.tool_call_id)) {
          throw new ContractError("TRACE_TOOL_CALL_ID", `step ${index + 1} repeats tool_call_id ${tool.tool_call_id}`)
        }
        ids.add(tool.tool_call_id)
      }
    }
  }
  const extra = record(root.extra)
  const metadata = record(extra?.clavia)
  if (metadata?.schema_version !== TRACE_METADATA_VERSION) {
    throw new ContractError("TRACE_METADATA", `extra.clavia must use ${TRACE_METADATA_VERSION}`)
  }
  return value as AtifTrajectory
}
