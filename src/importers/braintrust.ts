import type { AtifStep, AtifTrajectory } from "../contracts.ts"
import { atifTrajectory, messagesOf, numberOf, recordOf, stringOf, textOf, timestampOf } from "./common.ts"

const rootId = (row: Readonly<Record<string, unknown>>) =>
  stringOf(row.root_span_id) ?? stringOf(row.trace_id) ?? stringOf(row.id) ?? "unknown"

export const convertBraintrust = (value: unknown): ReadonlyArray<AtifTrajectory> => {
  const rows = Array.isArray(value) ? value.map(recordOf).filter((row): row is Readonly<Record<string, unknown>> => row !== undefined) : []
  const groups = new Map<string, Array<Readonly<Record<string, unknown>>>>()
  for (const row of rows) {
    const id = rootId(row)
    const held = groups.get(id) ?? []
    held.push(row)
    groups.set(id, held)
  }
  return [...groups.entries()].map(([id, spans]) => {
    spans.sort((left, right) => String(left.created ?? "").localeCompare(String(right.created ?? "")))
    const model = spans.map((span) => stringOf(recordOf(span.metadata)?.model)).find((held) => held !== undefined) ?? "unknown"
    const steps: Array<AtifStep> = []
    for (const span of spans) {
      const type = stringOf(recordOf(span.span_attributes)?.type) ?? "task"
      const timestamp = timestampOf(span.created)
      if (type === "tool") {
        const callId = stringOf(span.id) ?? `tool-${steps.length + 1}`
        steps.push({
          step_id: 0,
          ...(timestamp === undefined ? {} : { timestamp }),
          source: "agent",
          model_name: model,
          message: "",
          tool_calls: [{
            tool_call_id: callId,
            function_name: stringOf(span.name) ?? "tool",
            arguments: recordOf(span.input) ?? { input: span.input }
          }],
          observation: { results: [{ source_call_id: callId, content: textOf(span.output) }] },
          llm_call_count: 0
        })
        continue
      }
      if (type !== "llm" && type !== "task" && type !== "eval") continue
      for (const message of messagesOf(span.input)) {
        if (message.role === "user") steps.push({ step_id: 0, ...(timestamp === undefined ? {} : { timestamp }), source: "user", message: message.content })
      }
      const metrics = recordOf(span.metrics)
      const prompt = numberOf(metrics?.prompt_tokens)
      const completion = numberOf(metrics?.completion_tokens)
      const cost = numberOf(metrics?.cost)
      for (const message of messagesOf(span.output)) {
        if (message.role !== "assistant" && message.role !== "agent") continue
        steps.push({
          step_id: 0,
          ...(timestamp === undefined ? {} : { timestamp }),
          source: "agent",
          model_name: model,
          message: message.content,
          metrics: {
            ...(prompt === undefined ? {} : { prompt_tokens: prompt }),
            ...(completion === undefined ? {} : { completion_tokens: completion }),
            ...(cost === undefined ? {} : { cost_usd: cost })
          },
          llm_call_count: 1
        })
      }
    }
    if (steps.length === 0) steps.push({ step_id: 0, source: "system", message: "Imported Braintrust trace", llm_call_count: 0 })
    return atifTrajectory({
      trajectoryId: `braintrust:${id}`,
      sessionId: id,
      agentName: "braintrust-agent",
      agentVersion: "1",
      model,
      steps,
      metadata: {
        title: stringOf(spans[0]?.name) ?? `Braintrust trace ${id.slice(0, 8)}`,
        source: { kind: "braintrust", id },
        outcome: { status: spans.some((span) => span.error !== undefined) ? "failed" : "completed" }
      }
    })
  })
}
