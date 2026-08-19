import {
  ATIF_VERSION,
  TRACE_METADATA_VERSION,
  type AtifStep,
  type AtifTrajectory,
  type BehaviorClass,
  type ClaviaTraceMetadata
} from "../contracts.ts"

export const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined

export const stringOf = (value: unknown) => typeof value === "string" ? value : undefined

export const numberOf = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export const textOf = (value: unknown): string => {
  if (typeof value === "string") return value
  if (value === undefined || value === null) return ""
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export const timestampOf = (value: unknown) => {
  const numeric = numberOf(value)
  if (numeric !== undefined) return new Date(numeric).toISOString()
  if (typeof value !== "string") return undefined
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString()
}

export const behaviorOf = (
  steps: ReadonlyArray<AtifStep>,
  status: string,
  workType?: string
): ClaviaTraceMetadata["behavior"] => {
  const tools = steps.flatMap((step) => step.tool_calls?.map((call) => call.function_name.toLowerCase()) ?? [])
  const writeCount = tools.filter((tool) => tool === "write" || tool.includes("file_write")).length
  const editCount = tools.filter((tool) => tool === "edit" || tool.includes("replace")).length
  const readCount = tools.filter((tool) =>
    tool === "read" || tool === "grep" || tool === "glob" || tool.includes("search") || tool.includes("retriev")
  ).length
  const firstWrite = tools.findIndex((tool) => tool === "write" || tool.includes("file_write"))
  const researchBeforeWrite = firstWrite > 0 && tools.slice(0, firstWrite).some((tool) =>
    tool === "read" || tool === "grep" || tool === "glob" || tool.includes("search") || tool.includes("retriev")
  )
  let behavior: BehaviorClass
  let summary: string
  if (status !== "completed") {
    behavior = "recovery-loop"
    summary = "Encounters a failed action and continues through recovery work."
  } else if (tools.length === 0) {
    behavior = workType === "extract" ? "answer-only" : "single-shot"
    summary = workType === "extract"
      ? "Returns the extracted answer without a recorded tool call."
      : "Answers in one model path without a recorded tool call."
  } else if (editCount > 0 || writeCount > 1) {
    behavior = "iterative-refiner"
    summary = "Builds an output and revises it through multiple write actions."
  } else if (researchBeforeWrite || readCount >= 3) {
    behavior = "research-first"
    summary = "Reads or searches source material before it produces the output."
  } else if (writeCount > 0) {
    behavior = "direct-builder"
    summary = "Moves from a short plan to one output write."
  } else {
    behavior = "answer-only"
    summary = "Uses tools to inspect the task and returns the answer in the final response."
  }
  const tags = [
    ...(researchBeforeWrite ? ["research-before-write"] : []),
    ...(writeCount === 1 ? ["writes-once"] : []),
    ...(writeCount > 1 ? ["multiple-writes"] : []),
    ...(editCount > 0 ? ["edits-output"] : []),
    ...(tools.includes("bash") ? ["uses-shell"] : []),
    ...(tools.length === 0 ? ["no-tools"] : []),
    ...(tools.length >= 10 ? ["high-tool-use"] : [])
  ]
  return { class: behavior, summary, tags }
}

export const atifTrajectory = (options: {
  readonly trajectoryId: string
  readonly sessionId?: string
  readonly agentName: string
  readonly agentVersion: string
  readonly model?: string
  readonly steps: ReadonlyArray<AtifStep>
  readonly metadata: Omit<ClaviaTraceMetadata, "schema_version" | "behavior"> & {
    readonly behavior?: ClaviaTraceMetadata["behavior"]
  }
}): AtifTrajectory => {
  const steps = options.steps.map((step, index) => ({ ...step, step_id: index + 1 }))
  const promptTokens = steps.reduce((sum, step) => sum + (step.metrics?.prompt_tokens ?? 0), 0)
  const completionTokens = steps.reduce((sum, step) => sum + (step.metrics?.completion_tokens ?? 0), 0)
  const cachedTokens = steps.reduce((sum, step) => sum + (step.metrics?.cached_tokens ?? 0), 0)
  const costUsd = steps.reduce((sum, step) => sum + (step.metrics?.cost_usd ?? 0), 0)
  return {
    schema_version: ATIF_VERSION,
    ...(options.sessionId === undefined ? {} : { session_id: options.sessionId }),
    trajectory_id: options.trajectoryId,
    agent: {
      name: options.agentName,
      version: options.agentVersion,
      ...(options.model === undefined ? {} : { model_name: options.model })
    },
    steps,
    final_metrics: {
      total_prompt_tokens: promptTokens,
      total_completion_tokens: completionTokens,
      ...(cachedTokens === 0 ? {} : { total_cached_tokens: cachedTokens }),
      total_cost_usd: costUsd,
      total_steps: steps.length
    },
    extra: {
      clavia: {
        ...options.metadata,
        schema_version: TRACE_METADATA_VERSION,
        behavior: options.metadata.behavior
          ?? behaviorOf(steps, options.metadata.outcome.status, options.metadata.task?.work_type)
      }
    }
  }
}

export const messagesOf = (value: unknown): ReadonlyArray<{ role: string; content: string }> => {
  const parsed = typeof value === "string"
    ? (() => {
        try {
          return JSON.parse(value) as unknown
        } catch {
          return value
        }
      })()
    : value
  if (typeof parsed === "string") return [{ role: "user", content: parsed }]
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((item) => {
    const message = recordOf(item)
    const role = stringOf(message?.role)
    if (role === undefined) return []
    const content = message?.content
    if (typeof content === "string") return [{ role, content }]
    if (Array.isArray(content)) {
      const text = content.flatMap((part) => {
        const held = recordOf(part)
        return typeof held?.text === "string" ? [held.text] : []
      }).join("\n")
      return text.length === 0 ? [] : [{ role, content: text }]
    }
    return [{ role, content: textOf(content) }]
  })
}
