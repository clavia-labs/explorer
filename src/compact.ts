import type { AtifTrajectory } from "./contracts.ts"

const contentOf = (message: AtifTrajectory["steps"][number]["message"]) =>
  typeof message === "string"
    ? message
    : message.filter((part) => part.type === "text").map((part) => part.text).join("\n")

const clipped = (value: string, limit: number) =>
  value.length <= limit ? value : `${value.slice(0, limit)}\n[truncated ${value.length - limit} characters]`

export const compactTrajectory = (trace: AtifTrajectory, contentLimit = 4_000) => {
  const metadata = trace.extra.clavia
  const records: Array<Readonly<Record<string, unknown>>> = [{
    type: "meta",
    trajectory_id: trace.trajectory_id,
    agent: trace.agent.name,
    model: trace.agent.model_name,
    outcome: metadata.outcome,
    behavior: metadata.behavior
  }]
  for (const step of trace.steps) {
    const content = clipped(contentOf(step.message), contentLimit)
    if (step.source === "user") records.push({ type: "user", step_id: step.step_id, content })
    if (step.source === "system") records.push({ type: "meta", step_id: step.step_id, content })
    if (step.source === "agent" && step.reasoning_content !== undefined) {
      records.push({
        type: "reasoning",
        step_id: step.step_id,
        content: clipped(step.reasoning_content, contentLimit)
      })
    }
    if (step.source === "agent" && content.length > 0) {
      records.push({ type: "assistant", step_id: step.step_id, content })
    }
    for (const call of step.tool_calls ?? []) {
      const result = step.observation?.results.find((candidate) => candidate.source_call_id === call.tool_call_id)
      const resultContent = typeof result?.content === "string"
        ? clipped(result.content, contentLimit)
        : result?.content
      records.push({
        type: "tool",
        step_id: step.step_id,
        name: call.function_name,
        arguments: call.arguments,
        ...(resultContent === undefined ? {} : { result: resultContent })
      })
    }
  }
  return records
}
