import {
  TRACE_ACTIVITY_VERSION,
  type ActivityCategory,
  type ActivityDimension,
  type AtifStep,
  type AtifToolCall,
  type AtifTrajectory,
  type TraceActivity,
  type TraceActivityNode
} from "./contracts.ts"

const MAX_PHASE_STEPS = 12

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined

const textOf = (message: AtifStep["message"]) => typeof message === "string"
  ? message
  : message.filter((part) => part.type === "text").map((part) => part.text).join("\n")

const normalized = (value: string) => value
  .toLowerCase()
  .replaceAll(".", " ")
  .replaceAll(":", " ")
  .replaceAll("/", " ")
  .replaceAll("_", " ")
  .replaceAll("-", " ")

const containsOne = (value: string, terms: ReadonlyArray<string>) =>
  terms.some((term) => value.includes(term))

const INVESTIGATION_TERMS = [
  "read",
  "search",
  "grep",
  "find",
  "glob",
  "list",
  "lookup",
  "retrieve",
  "inspect",
  "view",
  "browse",
  "fetch",
  "open",
  "query"
] as const

const CHANGE_TERMS = [
  "write",
  "edit",
  "patch",
  "apply",
  "create",
  "update",
  "insert",
  "delete",
  "remove",
  "move",
  "rename",
  "copy"
] as const

const VERIFY_TERMS = [
  "test",
  "typecheck",
  "lint",
  "build",
  "compile",
  "audit",
  "validate",
  "verify",
  "lighthouse",
  "screenshot"
] as const

const COORDINATE_TERMS = [
  "spawn",
  "delegate",
  "subagent",
  "followup",
  "message agent",
  "wait agent",
  "agent task"
] as const

const SHELL_INVESTIGATION_TERMS = [
  "ls ",
  "find ",
  "rg ",
  "grep ",
  "cat ",
  "sed ",
  "head ",
  "tail ",
  "git status",
  "git diff",
  "which ",
  "select "
] as const

const SHELL_CHANGE_TERMS = [
  "mkdir ",
  "touch ",
  " cp ",
  " mv ",
  " rm ",
  "apply_patch",
  "tee "
] as const

const stringsOf = (value: unknown): ReadonlyArray<string> => {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(stringsOf)
  const record = recordOf(value)
  return record === undefined ? [] : Object.values(record).flatMap(stringsOf)
}

const toolCategory = (call: AtifToolCall): ActivityCategory => {
  const name = normalized(call.function_name)
  const argumentsText = stringsOf(call.arguments).join(" ").toLowerCase()
  if (containsOne(name, COORDINATE_TERMS)) return "coordinate"
  if (containsOne(name, VERIFY_TERMS)) return "verify"
  if (containsOne(name, CHANGE_TERMS)) return "change"
  if (containsOne(name, INVESTIGATION_TERMS)) return "investigate"
  if (containsOne(name, ["bash", "shell", "terminal", "exec", "command"])) {
    if (containsOne(argumentsText, VERIFY_TERMS)) return "verify"
    if (containsOne(` ${argumentsText}`, SHELL_CHANGE_TERMS)) return "change"
    if (containsOne(argumentsText, SHELL_INVESTIGATION_TERMS)) return "investigate"
  }
  return "execute"
}

const structuredStatus = (value: unknown) => {
  const record = recordOf(value)
  if (record === undefined) return undefined
  if (record.error === true || record.ok === false || record.success === false) return "failed" as const
  const candidate = [record.status, record.status_code, record.statusCode, record.code]
    .find((held) => typeof held === "string")
  if (typeof candidate !== "string") return undefined
  const status = candidate.toLowerCase()
  if (["error", "failed", "failure", "status_code_error"].includes(status)) return "failed" as const
  if (["ok", "success", "completed", "unset", "status_code_ok"].includes(status)) return "completed" as const
  return undefined
}

const statusOf = (step: AtifStep) => {
  const statuses = [
    structuredStatus(step.extra),
    ...(step.observation?.results.map((result) => structuredStatus(result.extra)) ?? [])
  ]
  if (statuses.includes("failed")) return "failed" as const
  if (
    statuses.includes("completed")
    || step.observation !== undefined
    || step.source !== "agent"
    || step.llm_call_count !== undefined
  ) {
    return "completed" as const
  }
  return "unknown" as const
}

const dimensionOf = (category: ActivityCategory): ActivityDimension => {
  if (category === "orient") return "intent"
  if (category === "investigate" || category === "verify") return "evidence"
  if (category === "decide") return "decision"
  if (category === "recover") return "recovery"
  if (category === "respond" || category === "trajectory") return "outcome"
  return "execution"
}

const categoryOf = (step: AtifStep, index: number, total: number): ActivityCategory => {
  if (step.source === "user" || step.source === "system") return "orient"
  const calls = step.tool_calls ?? []
  if (calls.length > 0) {
    const counts = new Map<ActivityCategory, number>()
    for (const call of calls) {
      const category = toolCategory(call)
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "execute"
  }
  return index === total - 1 ? "respond" : "decide"
}

const shortTarget = (value: string) => {
  const cleaned = value.replaceAll("\\", "/").replaceAll("\n", " ").trim()
  const parts = cleaned.split("/").filter((part) => part.length > 0)
  const held = parts.length > 2 ? parts.slice(-2).join("/") : cleaned
  return held.length <= 54 ? held : `…${held.slice(-53)}`
}

const argumentString = (call: AtifToolCall, keys: ReadonlyArray<string>) => {
  for (const key of keys) {
    const value = call.arguments[key]
    if (typeof value === "string" && value.trim().length > 0) return shortTarget(value)
  }
  return undefined
}

const toolLabel = (call: AtifToolCall, category: ActivityCategory) => {
  const name = normalized(call.function_name)
  const file = argumentString(call, ["file_path", "path", "filename", "target", "uri", "url"])
  if (category === "investigate") {
    if (file !== undefined && containsOne(name, ["read", "open", "view", "fetch"])) return `Read ${file}`
    if (containsOne(name, ["search", "grep", "find", "glob", "query"])) return "Search source material"
    return "Inspect the workspace"
  }
  if (category === "change") {
    if (file !== undefined && containsOne(name, ["write", "create"])) return `Write ${file}`
    if (file !== undefined && containsOne(name, ["edit", "patch", "update", "apply"])) return `Edit ${file}`
    return file === undefined ? "Change workspace files" : `Change ${file}`
  }
  if (category === "verify") return "Check the work"
  if (category === "coordinate") return "Coordinate delegated work"
  if (category === "recover") return "Try a recovery action"
  return `Run ${call.function_name}`
}

const uniqueTools = (steps: ReadonlyArray<AtifStep>) => [...new Set(
  steps.flatMap((step) => step.tool_calls?.map((call) => call.function_name) ?? [])
)]

const isoTime = (value: string | undefined) => {
  if (value === undefined) return undefined
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined
}

const stepEndTime = (step: AtifStep) => {
  const start = isoTime(step.timestamp)
  if (start === undefined) return undefined
  const extra = recordOf(step.extra)
  const durationMs = typeof extra?.duration_ms === "number"
    ? extra.duration_ms
    : typeof extra?.duration_ns === "number"
      ? extra.duration_ns / 1_000_000
      : typeof extra?.latency_ms === "number"
        ? extra.latency_ms
      : undefined
  return durationMs === undefined ? start : new Date(Date.parse(start) + durationMs).toISOString()
}

const timingOf = (steps: ReadonlyArray<AtifStep>) => {
  const start = steps.map((step) => isoTime(step.timestamp)).find((time) => time !== undefined)
  const end = steps.map(stepEndTime).findLast((time) => time !== undefined)
  if (start === undefined || end === undefined) return {}
  return {
    start_time: start,
    end_time: end,
    duration_ms: Math.max(0, Date.parse(end) - Date.parse(start))
  }
}

const messageLeaf = (step: AtifStep, category: ActivityCategory): TraceActivityNode | undefined => {
  const hasContent = textOf(step.message).trim().length > 0 || step.reasoning_content !== undefined
  if (!hasContent && (step.tool_calls?.length ?? 0) > 0) return undefined
  const label = step.source === "user"
    ? "Task instruction"
    : step.source === "system"
      ? "Runtime context"
      : category === "respond"
        ? "Agent response"
        : "Model reasoning and narration"
  return {
    node_id: `step:${step.step_id}`,
    kind: "step",
    category,
    dimension: dimensionOf(category),
    label,
    summary: `Raw ATIF step ${step.step_id}.`,
    status: statusOf(step),
    start_step: step.step_id,
    end_step: step.step_id,
    step_count: 1,
    tool_call_count: 0,
    tools: [],
    ...timingOf([step]),
    leaf_ref: { step_id: step.step_id },
    children: []
  }
}

const toolLeaf = (step: AtifStep, call: AtifToolCall, category: ActivityCategory): TraceActivityNode => ({
  node_id: `tool:${call.tool_call_id}`,
  kind: "tool",
  category,
  dimension: dimensionOf(category),
  label: toolLabel(call, category),
  summary: statusOf(step) === "failed"
    ? `${call.function_name} recorded a structured failure.`
    : `${call.function_name} completed in ATIF step ${step.step_id}.`,
  status: statusOf(step),
  start_step: step.step_id,
  end_step: step.step_id,
  step_count: 1,
  tool_call_count: 1,
  tools: [call.function_name],
  ...timingOf([step]),
  leaf_ref: { step_id: step.step_id, tool_call_id: call.tool_call_id },
  children: []
})

const turnLabel = (step: AtifStep, category: ActivityCategory) => {
  const calls = step.tool_calls ?? []
  if (calls.length === 1) return toolLabel(calls[0]!, category)
  if (calls.length > 1) return `Run ${calls.length} tool calls`
  if (step.source === "user") return "Receive the task"
  if (step.source === "system") return "Load runtime context"
  if (category === "respond") return "Write the response"
  return "Decide the next action"
}

const turnNode = (step: AtifStep, category: ActivityCategory): TraceActivityNode => {
  const calls = step.tool_calls ?? []
  const content = messageLeaf(step, category)
  const children = [
    ...(content === undefined ? [] : [content]),
    ...calls.map((call) => toolLeaf(step, call, category))
  ]
  return {
    node_id: `turn:${step.step_id}`,
    kind: "turn",
    category,
    dimension: dimensionOf(category),
    label: turnLabel(step, category),
    summary: calls.length === 0
      ? `One ${step.source} step.`
      : `${calls.length} tool ${calls.length === 1 ? "call" : "calls"} in ATIF step ${step.step_id}.`,
    status: statusOf(step),
    start_step: step.step_id,
    end_step: step.step_id,
    step_count: 1,
    tool_call_count: calls.length,
    tools: calls.map((call) => call.function_name),
    ...timingOf([step]),
    children
  }
}

const phaseLabel = (category: ActivityCategory) => {
  if (category === "orient") return "Understand the task"
  if (category === "investigate") return "Gather context"
  if (category === "decide") return "Decide the next move"
  if (category === "change") return "Make changes"
  if (category === "verify") return "Check the work"
  if (category === "coordinate") return "Coordinate agents"
  if (category === "recover") return "Recover from a failure"
  if (category === "respond") return "Present the result"
  return "Run operations"
}

const toolPhrase = (tools: ReadonlyArray<string>) => {
  if (tools.length === 0) return "no tools"
  if (tools.length === 1) return tools[0]!
  if (tools.length === 2) return `${tools[0]} and ${tools[1]}`
  return `${tools[0]}, ${tools[1]}, and ${tools.length - 2} more`
}

const phaseSummary = (
  category: ActivityCategory,
  steps: ReadonlyArray<AtifStep>,
  tools: ReadonlyArray<string>
) => {
  const calls = steps.reduce((sum, step) => sum + (step.tool_calls?.length ?? 0), 0)
  if (category === "orient") return `Reviewed the task and runtime context in ${steps.length} ${steps.length === 1 ? "step" : "steps"}.`
  if (category === "investigate") return `Gathered evidence with ${toolPhrase(tools)} across ${calls} tool ${calls === 1 ? "call" : "calls"}.`
  if (category === "decide") return `Used ${steps.length} model ${steps.length === 1 ? "turn" : "turns"} to choose the next action.`
  if (category === "change") return `Changed artifacts with ${toolPhrase(tools)} across ${calls} tool ${calls === 1 ? "call" : "calls"}.`
  if (category === "verify") return `Checked the work with ${toolPhrase(tools)} across ${calls} tool ${calls === 1 ? "call" : "calls"}.`
  if (category === "coordinate") return `Coordinated delegated work across ${calls} tool ${calls === 1 ? "call" : "calls"}.`
  if (category === "recover") return `Adjusted course after a recorded failure across ${steps.length} ${steps.length === 1 ? "step" : "steps"}.`
  if (category === "respond") return `Prepared the final response in ${steps.length} ${steps.length === 1 ? "step" : "steps"}.`
  return `Ran ${calls} other tool ${calls === 1 ? "call" : "calls"} with ${toolPhrase(tools)}.`
}

interface PhaseGroup {
  readonly category: ActivityCategory
  readonly steps: ReadonlyArray<AtifStep>
}

const phaseGroups = (trace: AtifTrajectory) => {
  const groups: Array<{ category: ActivityCategory; steps: Array<AtifStep> }> = []
  let recovering = false
  for (const [index, step] of trace.steps.entries()) {
    const base = categoryOf(step, index, trace.steps.length)
    const category = recovering && statusOf(step) !== "failed" && step.source === "agent"
      ? "recover"
      : base
    const previous = groups.at(-1)
    if (previous?.category === category && previous.steps.length < MAX_PHASE_STEPS) previous.steps.push(step)
    else groups.push({ category, steps: [step] })
    if (statusOf(step) === "failed") recovering = true
    else if (recovering && step.source === "agent") recovering = false
  }
  return groups as ReadonlyArray<PhaseGroup>
}

const phaseNodes = (trace: AtifTrajectory) => {
  const groups = phaseGroups(trace)
  const totals = new Map<ActivityCategory, number>()
  for (const group of groups) totals.set(group.category, (totals.get(group.category) ?? 0) + 1)
  const seen = new Map<ActivityCategory, number>()
  return groups.map((group, index): TraceActivityNode => {
    const tools = uniqueTools(group.steps)
    const occurrence = (seen.get(group.category) ?? 0) + 1
    seen.set(group.category, occurrence)
    const baseLabel = phaseLabel(group.category)
    const label = (totals.get(group.category) ?? 0) > 1 ? `${baseLabel}, pass ${occurrence}` : baseLabel
    const children = group.steps.map((step) => turnNode(step, group.category))
    const failed = children.some((child) => child.status === "failed")
    const unknown = children.some((child) => child.status === "unknown")
    return {
      node_id: `phase:${String(index + 1).padStart(3, "0")}:${group.category}`,
      kind: "phase",
      category: group.category,
      dimension: dimensionOf(group.category),
      label,
      summary: phaseSummary(group.category, group.steps, tools),
      status: failed ? "failed" : unknown ? "unknown" : "completed",
      start_step: group.steps[0]!.step_id,
      end_step: group.steps.at(-1)!.step_id,
      step_count: group.steps.length,
      tool_call_count: children.reduce((sum, child) => sum + child.tool_call_count, 0),
      tools,
      ...timingOf(group.steps),
      children
    }
  })
}

export const deriveTraceActivity = (trace: AtifTrajectory): TraceActivity => {
  const children = phaseNodes(trace)
  const metadata = trace.extra.clavia
  const failed = children.some((child) => child.status === "failed")
  const unknown = children.some((child) => child.status === "unknown")
  return {
    schema_version: TRACE_ACTIVITY_VERSION,
    trajectory_id: trace.trajectory_id,
    generated_by: { kind: "deterministic", algorithm: "clavia.activity-tree/v1" },
    root: {
      node_id: `trajectory:${trace.trajectory_id}`,
      kind: "trajectory",
      category: "trajectory",
      dimension: dimensionOf("trajectory"),
      label: metadata.title,
      summary: metadata.behavior.summary,
      status: failed ? "failed" : unknown ? "unknown" : "completed",
      start_step: trace.steps[0]!.step_id,
      end_step: trace.steps.at(-1)!.step_id,
      step_count: trace.steps.length,
      tool_call_count: children.reduce((sum, child) => sum + child.tool_call_count, 0),
      tools: uniqueTools(trace.steps),
      ...timingOf(trace.steps),
      ...(metadata.duration_ms === undefined ? {} : { duration_ms: metadata.duration_ms }),
      children
    }
  }
}
