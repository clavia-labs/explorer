import type { AtifStep, AtifTrajectory } from "../contracts.ts"
import { atifTrajectory, numberOf, recordOf, stringOf, textOf, timestampOf } from "./common.ts"

const traceIdOf = (row: Readonly<Record<string, unknown>>) =>
  stringOf(row.trace_id) ?? stringOf(row.traceId) ?? stringOf(row.id) ?? "unknown"

export const convertLangfuse = (value: unknown): ReadonlyArray<AtifTrajectory> => {
  const root = recordOf(value)
  const source = Array.isArray(value) ? value : Array.isArray(root?.data) ? root.data : []
  const rows = source.map(recordOf).filter((row): row is Readonly<Record<string, unknown>> => row !== undefined)
  const groups = new Map<string, Array<Readonly<Record<string, unknown>>>>()
  for (const row of rows) {
    const id = traceIdOf(row)
    const held = groups.get(id) ?? []
    held.push(row)
    groups.set(id, held)
  }
  return [...groups.entries()].map(([id, observations]) => {
    observations.sort((left, right) =>
      String(left.start_time ?? left.startTime ?? "").localeCompare(String(right.start_time ?? right.startTime ?? ""))
    )
    const model = observations.map((row) => stringOf(row.model)).find((held) => held !== undefined) ?? "unknown"
    const steps: Array<AtifStep> = []
    for (const observation of observations) {
      const type = (stringOf(observation.type) ?? "SPAN").toUpperCase()
      const timestamp = timestampOf(observation.start_time ?? observation.startTime)
      if (type === "TOOL") {
        const callId = stringOf(observation.id) ?? `tool-${steps.length + 1}`
        steps.push({
          step_id: 0,
          ...(timestamp === undefined ? {} : { timestamp }),
          source: "agent",
          model_name: model,
          message: "",
          tool_calls: [{
            tool_call_id: callId,
            function_name: stringOf(observation.name) ?? "tool",
            arguments: recordOf(observation.input) ?? { input: observation.input }
          }],
          observation: { results: [{ source_call_id: callId, content: textOf(observation.output) }] },
          llm_call_count: 0
        })
        continue
      }
      if (type !== "GENERATION" && type !== "AGENT") continue
      const input = textOf(observation.input)
      if (input.length > 0) steps.push({ step_id: 0, ...(timestamp === undefined ? {} : { timestamp }), source: "user", message: input })
      const usage = recordOf(observation.usage_details ?? observation.usageDetails ?? observation.usage)
      const prompt = numberOf(usage?.input ?? usage?.promptTokens ?? usage?.input_tokens)
      const completion = numberOf(usage?.output ?? usage?.completionTokens ?? usage?.output_tokens)
      const cost = numberOf(observation.total_cost ?? observation.calculated_total_cost)
      steps.push({
        step_id: 0,
        ...(timestamp === undefined ? {} : { timestamp }),
        source: "agent",
        model_name: model,
        message: textOf(observation.output),
        metrics: {
          ...(prompt === undefined ? {} : { prompt_tokens: prompt }),
          ...(completion === undefined ? {} : { completion_tokens: completion }),
          ...(cost === undefined ? {} : { cost_usd: cost })
        },
        llm_call_count: 1
      })
    }
    if (steps.length === 0) steps.push({ step_id: 0, source: "system", message: "Imported Langfuse trace", llm_call_count: 0 })
    const start = timestampOf(observations[0]?.start_time ?? observations[0]?.startTime)
    const end = timestampOf(observations.at(-1)?.end_time ?? observations.at(-1)?.endTime)
    const duration = start === undefined || end === undefined ? undefined : new Date(end).valueOf() - new Date(start).valueOf()
    return atifTrajectory({
      trajectoryId: `langfuse:${id}`,
      sessionId: stringOf(observations[0]?.session_id ?? observations[0]?.sessionId) ?? id,
      agentName: "langfuse-agent",
      agentVersion: stringOf(observations[0]?.version) ?? "1",
      model,
      steps,
      metadata: {
        title: stringOf(observations[0]?.trace_name ?? observations[0]?.name) ?? `Langfuse trace ${id.slice(0, 8)}`,
        source: { kind: "langfuse", id },
        outcome: { status: observations.some((row) => stringOf(row.level) === "ERROR") ? "failed" : "completed" },
        ...(duration === undefined ? {} : { duration_ms: duration })
      }
    })
  })
}
