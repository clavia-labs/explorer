import { contentHash } from "../canonical.ts"
import type { AtifStep, AtifTrajectory } from "../contracts.ts"
import { atifTrajectory, recordOf, stringOf, textOf, timestampOf } from "./common.ts"

export const convertLetta = (value: unknown): ReadonlyArray<AtifTrajectory> => {
  const root = recordOf(value)
  const records = Array.isArray(value) ? value : Array.isArray(root?.records) ? root.records : []
  const held = records.map(recordOf).filter((record): record is Readonly<Record<string, unknown>> => record !== undefined)
  const meta = held.find((record) => record.role === "meta")
  const steps: Array<AtifStep> = []
  let pendingReasoning: string | undefined
  const consumedTools = new Set<number>()
  for (const [index, record] of held.entries()) {
    const role = stringOf(record.role)
    if (role === "meta") continue
    if (role === "reasoning") {
      pendingReasoning = stringOf(record.content)
      continue
    }
    if (role === "tool" || consumedTools.has(index)) continue
    if (role === "user") {
      steps.push({
        step_id: 0,
        ...(timestampOf(record.timestamp) === undefined ? {} : { timestamp: timestampOf(record.timestamp)! }),
        source: "user",
        message: stringOf(record.content) ?? ""
      })
      continue
    }
    if (role !== "assistant") continue
    const calls = Array.isArray(record.tool_calls) ? record.tool_calls.map(recordOf).filter((call): call is Readonly<Record<string, unknown>> => call !== undefined) : []
    const results = calls.map((call) => {
      const id = stringOf(call.id) ?? "unknown"
      const found = held.findIndex((candidate, candidateIndex) =>
        candidateIndex > index && candidate.role === "tool" && candidate.tool_call_id === id
      )
      if (found !== -1) consumedTools.add(found)
      return {
        source_call_id: id,
        content: found === -1 ? "" : textOf(held[found]?.content),
        ...(found === -1 ? { extra: { missing_result: true } } : {})
      }
    })
    steps.push({
      step_id: 0,
      ...(timestampOf(record.timestamp) === undefined ? {} : { timestamp: timestampOf(record.timestamp)! }),
      source: "agent",
      ...(stringOf(meta?.model) === undefined ? {} : { model_name: stringOf(meta?.model)! }),
      message: stringOf(record.content) ?? "",
      ...(pendingReasoning === undefined ? {} : { reasoning_content: pendingReasoning }),
      ...(calls.length === 0
        ? {}
        : {
            tool_calls: calls.map((call, callIndex) => {
              const raw = call.args
              let args: Readonly<Record<string, unknown>> = {}
              if (typeof raw === "string") {
                try { args = recordOf(JSON.parse(raw)) ?? { value: raw } } catch { args = { value: raw } }
              } else args = recordOf(raw) ?? {}
              return {
                tool_call_id: stringOf(call.id) ?? `tool-${callIndex + 1}`,
                function_name: stringOf(call.name) ?? "unknown",
                arguments: args
              }
            }),
            observation: { results }
          }),
      llm_call_count: 1
    })
    pendingReasoning = undefined
  }
  if (steps.length === 0) return []
  const digest = contentHash(held)
  const source = stringOf(meta?.source) ?? "letta"
  return [atifTrajectory({
    trajectoryId: `letta:${digest.slice(0, 24)}`,
    agentName: source,
    agentVersion: stringOf(meta?.version) ?? "1",
    ...(stringOf(meta?.model) === undefined ? {} : { model: stringOf(meta?.model)! }),
    steps,
    metadata: {
      title: `Imported ${source} trajectory`,
      source: { kind: "letta", id: digest },
      outcome: { status: "completed" },
      provider: {
        ...(typeof meta?.cwd !== "string" ? {} : { cwd: meta.cwd }),
        ...(typeof meta?.git_branch !== "string" ? {} : { git_branch: meta.git_branch })
      }
    }
  })]
}
