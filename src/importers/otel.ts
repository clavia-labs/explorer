import type { AtifStep, AtifTrajectory } from "../contracts.ts"
import {
  atifTrajectory,
  messagesOf,
  numberOf,
  recordOf,
  stringOf,
  textOf
} from "./common.ts"

const attributeValue = (value: unknown): unknown => {
  const held = recordOf(value)
  if (held === undefined) return value
  if (held.stringValue !== undefined) return held.stringValue
  if (held.intValue !== undefined) return numberOf(held.intValue)
  if (held.doubleValue !== undefined) return numberOf(held.doubleValue)
  if (held.boolValue !== undefined) return held.boolValue
  const array = recordOf(held.arrayValue)
  if (Array.isArray(array?.values)) return array.values.map(attributeValue)
  return value
}

const attributesOf = (value: unknown) => {
  if (!Array.isArray(value)) return {} as Readonly<Record<string, unknown>>
  return Object.fromEntries(value.flatMap((entry) => {
    const held = recordOf(entry)
    const key = stringOf(held?.key)
    return key === undefined ? [] : [[key, attributeValue(held?.value)] as const]
  }))
}

const unixNanoTimestamp = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  try {
    return new Date(Number(BigInt(value) / 1_000_000n)).toISOString()
  } catch {
    return undefined
  }
}

const otlpSpans = (value: unknown) => {
  const root = recordOf(value)
  if (!Array.isArray(root?.resourceSpans)) return []
  return root.resourceSpans.flatMap((resource) => {
    const held = recordOf(resource)
    const resourceAttributes = attributesOf(recordOf(held?.resource)?.attributes)
    const scopes = Array.isArray(held?.scopeSpans) ? held.scopeSpans : []
    return scopes.flatMap((scope) => {
      const scopeRecord = recordOf(scope)
      const spans = Array.isArray(scopeRecord?.spans) ? scopeRecord.spans : []
      return spans.flatMap((span) => {
        const spanRecord = recordOf(span)
        return spanRecord === undefined ? [] : [{ span: spanRecord, resourceAttributes }]
      })
    })
  })
}

const messageSteps = (
  span: Readonly<Record<string, unknown>>,
  attributes: Readonly<Record<string, unknown>>,
  model: string
): ReadonlyArray<AtifStep> => {
  const timestamp = unixNanoTimestamp(span.startTimeUnixNano)
  const toolName = stringOf(attributes["gen_ai.tool.name"])
  const toolCallId = stringOf(attributes["gen_ai.tool.call.id"])
  if (toolName !== undefined) {
    const callId = toolCallId ?? `${stringOf(span.spanId) ?? "span"}:tool`
    return [{
      step_id: 0,
      ...(timestamp === undefined ? {} : { timestamp }),
      source: "agent",
      message: "",
      tool_calls: [{
        tool_call_id: callId,
        function_name: toolName,
        arguments: { capture: "structural-only" }
      }],
      observation: { results: [{ source_call_id: callId, content: "Tool execution span completed." }] },
      llm_call_count: 0,
      extra: { span_id: stringOf(span.spanId) ?? "unknown", operation: attributes["gen_ai.operation.name"] }
    }]
  }
  const input = messagesOf(attributes["gen_ai.input.messages"] ?? attributes["gen_ai.prompt"])
  const output = messagesOf(attributes["gen_ai.output.messages"] ?? attributes["gen_ai.completion"])
  const promptTokens = numberOf(attributes["gen_ai.usage.input_tokens"])
  const completionTokens = numberOf(attributes["gen_ai.usage.output_tokens"])
  const cost = numberOf(attributes["gen_ai.usage.cost"])
  const metrics = promptTokens === undefined && completionTokens === undefined && cost === undefined
    ? undefined
    : {
        ...(promptTokens === undefined ? {} : { prompt_tokens: promptTokens }),
        ...(completionTokens === undefined ? {} : { completion_tokens: completionTokens }),
        ...(cost === undefined ? {} : { cost_usd: cost })
      }
  const steps: Array<AtifStep> = []
  for (const message of input) {
    if (message.role !== "user" && message.role !== "system") continue
    steps.push({ step_id: 0, ...(timestamp === undefined ? {} : { timestamp }), source: message.role, message: message.content })
  }
  for (const message of output) {
    if (message.role !== "assistant" && message.role !== "agent") continue
    steps.push({
      step_id: 0,
      ...(timestamp === undefined ? {} : { timestamp }),
      source: "agent",
      model_name: model,
      message: message.content,
      ...(metrics === undefined ? {} : { metrics }),
      llm_call_count: 1,
      extra: { span_id: stringOf(span.spanId) ?? "unknown", operation: attributes["gen_ai.operation.name"] }
    })
  }
  if (steps.length > 0) return steps
  return [{
    step_id: 0,
    ...(timestamp === undefined ? {} : { timestamp }),
    source: "system",
    message: stringOf(span.name) ?? "OpenTelemetry span",
    observation: { results: [{ content: textOf(attributes) }] },
    llm_call_count: 0,
    extra: { span_id: stringOf(span.spanId) ?? "unknown" }
  }]
}

export const convertOtel = (value: unknown): ReadonlyArray<AtifTrajectory> => {
  const groups = new Map<string, ReturnType<typeof otlpSpans>>()
  for (const span of otlpSpans(value)) {
    const traceId = stringOf(span.span.traceId) ?? "unknown"
    const held = groups.get(traceId) ?? []
    held.push(span)
    groups.set(traceId, held)
  }
  return [...groups.entries()].map(([traceId, spans]) => {
    spans.sort((left, right) =>
      String(left.span.startTimeUnixNano ?? "").localeCompare(String(right.span.startTimeUnixNano ?? ""))
    )
    const attrs = spans.map((entry) => attributesOf(entry.span.attributes))
    const model = attrs.map((entry) => stringOf(entry["gen_ai.response.model"] ?? entry["gen_ai.request.model"]))
      .find((entry) => entry !== undefined) ?? "unknown"
    const steps = spans.flatMap((entry, index) => messageSteps(entry.span, attrs[index] ?? {}, model))
    const start = spans.map((entry) => {
      const value = entry.span.startTimeUnixNano
      try { return BigInt(typeof value === "string" || typeof value === "number" ? value : 0) } catch { return 0n }
    })
    const end = spans.map((entry) => {
      const value = entry.span.endTimeUnixNano
      try { return BigInt(typeof value === "string" || typeof value === "number" ? value : 0) } catch { return 0n }
    })
    const durationMs = start.length === 0 ? undefined : Number((end.reduce((a, b) => a > b ? a : b, 0n) - start.reduce((a, b) => a < b ? a : b, start[0]!)) / 1_000_000n)
    return atifTrajectory({
      trajectoryId: `otel:${traceId}`,
      sessionId: traceId,
      agentName: stringOf(spans[0]?.resourceAttributes["service.name"]) ?? "otel-agent",
      agentVersion: stringOf(spans[0]?.resourceAttributes["service.version"]) ?? "1",
      model,
      steps,
      metadata: {
        title: stringOf(spans[0]?.span.name) ?? `OTel trace ${traceId.slice(0, 8)}`,
        source: { kind: "otel", id: traceId },
        outcome: { status: spans.some((entry) => numberOf(recordOf(entry.span.status)?.code) === 2) ? "failed" : "completed" },
        ...(durationMs === undefined ? {} : { duration_ms: durationMs })
      }
    })
  })
}

export const convertTardigradeSpans = (value: unknown): ReadonlyArray<AtifTrajectory> => {
  const rows = Array.isArray(value)
    ? value.map(recordOf).filter((row): row is Readonly<Record<string, unknown>> => row !== undefined)
    : []
  const groups = new Map<string, Array<Readonly<Record<string, unknown>>>>()
  for (const row of rows) {
    const traceId = stringOf(row.TraceId) ?? "unknown"
    const held = groups.get(traceId) ?? []
    held.push(row)
    groups.set(traceId, held)
  }
  return [...groups.entries()].map(([traceId, spans]) => {
    spans.sort((left, right) => String(left.Timestamp ?? "").localeCompare(String(right.Timestamp ?? "")))
    const steps: Array<AtifStep> = spans.map((span) => {
      const attributes = recordOf(span.SpanAttributes) ?? {}
      const toolName = stringOf(attributes["gen_ai.tool.name"])
      const callId = stringOf(attributes["gen_ai.tool.call.id"])
        ?? `${stringOf(span.SpanId) ?? "span"}:tool`
      const shared = {
        step_id: 0,
        ...(typeof span.Timestamp !== "string" ? {} : { timestamp: span.Timestamp }),
        source: "agent" as const,
        llm_call_count: 0,
        extra: {
          span_id: stringOf(span.SpanId),
          parent_span_id: stringOf(span.ParentSpanId),
          status: stringOf(span.StatusCode),
          duration_ns: numberOf(span.Duration),
          links: span.Links
        }
      }
      if (toolName !== undefined) {
        return {
          ...shared,
          message: "",
          tool_calls: [{
            tool_call_id: callId,
            function_name: toolName,
            arguments: { capture: "structural-only" }
          }],
          observation: {
            results: [{
              source_call_id: callId,
              content: `Tool execution span finished with ${stringOf(span.StatusCode) ?? "unknown"} status.`
            }]
          }
        }
      }
      return {
        ...shared,
        source: "system" as const,
        message: stringOf(span.SpanName) ?? "Tardigrade span",
        observation: { results: [{ content: textOf(attributes) }] }
      }
    })
    const starts = spans.map((span) => typeof span.Timestamp === "string" ? Date.parse(span.Timestamp) : Number.NaN)
      .filter(Number.isFinite)
    const ends = spans.flatMap((span) => {
      if (typeof span.Timestamp !== "string") return []
      const start = Date.parse(span.Timestamp)
      if (!Number.isFinite(start)) return []
      return [start + (numberOf(span.Duration) ?? 0) / 1_000_000]
    })
    const durationMs = starts.length === 0 || ends.length === 0
      ? 0
      : Math.max(...ends) - Math.min(...starts)
    const rootAttributes = spans.map((span) => recordOf(span.SpanAttributes) ?? {})
      .find((attributes) => stringOf(attributes["tardigrade.agent.name"]) !== undefined)
    return atifTrajectory({
      trajectoryId: `otel:${traceId}`,
      sessionId: traceId,
      agentName: stringOf(rootAttributes?.["tardigrade.agent.name"]) ?? "tardigrade",
      agentVersion: "1",
      steps,
      metadata: {
        title: `Tardigrade trace ${traceId.slice(0, 8)}`,
        source: { kind: "otel", id: traceId },
        outcome: { status: spans.some((span) => span.StatusCode === "Error") ? "failed" : "completed" },
        duration_ms: durationMs
      }
    })
  })
}
