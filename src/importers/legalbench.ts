import type { AtifMetrics, AtifStep, AtifTrajectory, FailureMode } from "../contracts.ts"
import {
  atifTrajectory,
  numberOf,
  recordOf,
  stringOf,
  textOf,
  timestampOf
} from "./common.ts"

export interface LegalBenchCellInput {
  readonly events: ReadonlyArray<Readonly<Record<string, unknown>>>
  readonly providerTrace?: ReadonlyArray<Readonly<Record<string, unknown>>>
  readonly toolTrace?: ReadonlyArray<Readonly<Record<string, unknown>>>
  readonly result: Readonly<Record<string, unknown>>
  readonly reliability?: Readonly<Record<string, unknown>>
  readonly usefulness?: ReadonlyArray<Readonly<Record<string, unknown>>>
}

const metricsOf = (event: Readonly<Record<string, unknown>> | undefined): AtifMetrics | undefined => {
  const usage = recordOf(event?.usage)
  const prompt = numberOf(usage?.promptTokens)
  const completion = numberOf(usage?.completionTokens)
  const cost = numberOf(usage?.costUsd)
  if (prompt === undefined && completion === undefined && cost === undefined) return undefined
  return {
    ...(prompt === undefined ? {} : { prompt_tokens: prompt }),
    ...(completion === undefined ? {} : { completion_tokens: completion }),
    ...(cost === undefined ? {} : { cost_usd: cost })
  }
}

const scoreOf = (usefulness: ReadonlyArray<Readonly<Record<string, unknown>>>, key: string) => {
  const scores = usefulness.flatMap((entry) => {
    const dimension = recordOf(recordOf(entry.result)?.[key])
    const score = numberOf(dimension?.score)
    return score === undefined ? [] : [score]
  })
  return scores.length === 0 ? undefined : scores.reduce((sum, score) => sum + score, 0) / scores.length
}

const failureModesOf = (reliability: Readonly<Record<string, unknown>> | undefined) => {
  const result = recordOf(reliability?.result)
  if (!Array.isArray(result?.results)) return undefined
  const modes = result.results.flatMap((entry): ReadonlyArray<FailureMode> => {
    const held = recordOf(entry)
    const id = stringOf(held?.id)
    const verdict = stringOf(held?.verdict)
    if (
      id === undefined
      || (verdict !== "PASS" && verdict !== "FAIL" && verdict !== "NOT_ASSESSABLE")
    ) return []
    const justification = stringOf(held?.justification)
    return [{ id, verdict, ...(justification === undefined ? {} : { justification }) }]
  })
  return modes.length === 0 ? undefined : modes
}

const modelStep = (
  call: Readonly<Record<string, unknown>>,
  segment: ReadonlyArray<Readonly<Record<string, unknown>>>,
  provider: Readonly<Record<string, unknown>> | undefined,
  defaultModel: string
): AtifStep => {
  const returned = segment.find((event) => event.type === "ModelReturned")
  const text = segment.findLast((event) => event.type === "TextReturned")
  const terminal = segment.findLast((event) => event.type === "TurnCompleted")
  const calls = segment.filter((event) => event.type === "ToolCalled")
  const returns = new Map(
    segment
      .filter((event) => event.type === "ToolReturned")
      .map((event) => [stringOf(event.callId), event] as const)
      .filter((entry): entry is readonly [string, Readonly<Record<string, unknown>>] => entry[0] !== undefined)
  )
  const message = terminal === undefined
    ? calls.length === 0 ? stringOf(text?.text) ?? "" : ""
    : stringOf(terminal.output) ?? ""
  const reasoning = stringOf(provider?.reasoning)
    ?? (calls.length === 0 ? undefined : stringOf(text?.text))
  const latency = numberOf(provider?.latencyMs)
  const finishReason = stringOf(provider?.finishReason)
  const metrics = metricsOf(returned)
  return {
    step_id: 0,
    ...(timestampOf(call.at) === undefined ? {} : { timestamp: timestampOf(call.at)! }),
    source: "agent",
    model_name: stringOf(provider?.effectiveModel) ?? defaultModel,
    message,
    ...(reasoning === undefined || reasoning === message ? {} : { reasoning_content: reasoning }),
    ...(calls.length === 0
      ? {}
      : {
          tool_calls: calls.map((event, index) => ({
            tool_call_id: stringOf(event.callId) ?? `tool-${index + 1}`,
            function_name: stringOf(event.name) ?? "unknown",
            arguments: recordOf(event.arguments) ?? {}
          })),
          observation: {
            results: calls.map((event, index) => {
              const id = stringOf(event.callId) ?? `tool-${index + 1}`
              const answer = returns.get(id)
              return {
                source_call_id: id,
                content: textOf(answer?.result),
                ...(answer === undefined ? { extra: { missing_result: true } } : {})
              }
            })
          }
        }),
    ...(metrics === undefined ? {} : { metrics }),
    llm_call_count: 1,
    ...(
      latency === undefined
      && finishReason === undefined
      && provider?.requestSha256 === undefined
      && provider?.responseSha256 === undefined
        ? {}
        : {
            extra: {
              ...(latency === undefined ? {} : { latency_ms: latency }),
              ...(finishReason === undefined ? {} : { finish_reason: finishReason }),
              ...(typeof provider?.requestSha256 !== "string" ? {} : { request_sha256: provider.requestSha256 }),
              ...(typeof provider?.responseSha256 !== "string" ? {} : { response_sha256: provider.responseSha256 })
            }
          }
    )
  }
}

export const convertLegalBenchCell = (input: LegalBenchCellInput): AtifTrajectory => {
  const result = input.result
  const runId = stringOf(result.run_id) ?? "legalbench"
  const taskId = stringOf(result.task_id) ?? "unknown"
  const modelSlug = stringOf(result.model_slug) ?? "unknown"
  const requestedModel = stringOf(result.requested_model_id) ?? modelSlug
  const status = stringOf(result.status) ?? "unknown"
  const workType = stringOf(result.work_type)
  const message = input.events.find((event) => event.type === "MessageReceived")
  const calls = input.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === "ModelCalled")
  const provider = new Map(
    (input.providerTrace ?? []).flatMap((entry) => {
      const key = stringOf(entry.key)
      return key === undefined ? [] : [[key, entry] as const]
    })
  )
  const steps: Array<AtifStep> = [{
    step_id: 0,
    ...(timestampOf(message?.at) === undefined ? {} : { timestamp: timestampOf(message?.at)! }),
    source: "user",
    message: stringOf(message?.text) ?? ""
  }]
  for (const [position, current] of calls.entries()) {
    const next = calls[position + 1]?.index ?? input.events.length
    const segment = input.events.slice(current.index + 1, next)
    const callId = stringOf(current.event.callId)
    steps.push(modelStep(
      current.event,
      segment,
      callId === undefined ? undefined : provider.get(callId),
      requestedModel
    ))
  }
  if (calls.length === 0) {
    const answer = recordOf(result.answer)
    const held = recordOf(result.result)
    steps.push({
      step_id: 0,
      source: "agent",
      model_name: requestedModel,
      message: stringOf(answer?.final_output) ?? stringOf(held?.output) ?? "",
      llm_call_count: 1
    })
  }
  const reliabilityResult = recordOf(input.reliability?.result)
  const score = recordOf(reliabilityResult?.score)
  const alignment = recordOf(reliabilityResult?.collection_alignment)
  const usefulness = input.usefulness ?? []
  const clarity = scoreOf(usefulness, "clarity")
  const length = scoreOf(usefulness, "length")
  const structure = scoreOf(usefulness, "structure")
  const artifactValues = Array.isArray(result.artifacts) ? result.artifacts : []
  const artifacts = artifactValues.flatMap((entry) => {
    const held = recordOf(entry)
    const path = stringOf(held?.path)
    if (path === undefined) return []
    const bytes = numberOf(held?.bytes)
    const digest = stringOf(held?.sha256)
    return [{
      path,
      ...(bytes === undefined ? {} : { bytes }),
      ...(digest === undefined ? {} : { sha256: digest })
    }]
  })
  const agentId = stringOf(result.agent_id) ?? "legalbench-candidate"
  return atifTrajectory({
    trajectoryId: `legalbench:${runId}:${modelSlug}:${taskId}`,
    sessionId: runId,
    agentName: agentId.split(`/${modelSlug}`)[0] ?? agentId,
    agentVersion: agentId.split("/").at(-1) ?? "1",
    model: requestedModel,
    steps,
    metadata: {
      title: `Task ${taskId}: ${workType ?? "legal work"}`,
      source: { kind: "legalbench", id: `${runId}/${modelSlug}/${taskId}` },
      task: { id: taskId, ...(workType === undefined ? {} : { work_type: workType }) },
      outcome: {
        status,
        ...(typeof reliabilityResult?.strict_task_pass !== "boolean"
          ? {}
          : { strict_pass: reliabilityResult.strict_task_pass }),
        ...(numberOf(score?.passed) === undefined ? {} : { checkpoint_passed: numberOf(score?.passed)! }),
        ...(numberOf(score?.total) === undefined ? {} : { checkpoint_total: numberOf(score?.total)! }),
        ...(stringOf(alignment?.verdict) === undefined ? {} : { alignment: stringOf(alignment?.verdict)! }),
        ...(clarity === undefined && length === undefined && structure === undefined
          ? {}
          : {
              usefulness: {
                ...(clarity === undefined ? {} : { clarity }),
                ...(length === undefined ? {} : { length }),
                ...(structure === undefined ? {} : { structure })
              }
            })
      },
      ...(numberOf(result.duration_ms) === undefined ? {} : { duration_ms: numberOf(result.duration_ms)! }),
      ...(failureModesOf(input.reliability) === undefined
        ? {}
        : { failure_modes: failureModesOf(input.reliability)! }),
      ...(artifacts.length === 0 ? {} : { artifacts }),
      provider: {
        requested_model: requestedModel,
        model_slug: modelSlug,
        tool_events: input.toolTrace?.length ?? 0,
        judge_model: stringOf(recordOf(input.reliability?.judge)?.model) ?? "unknown"
      }
    }
  })
}
