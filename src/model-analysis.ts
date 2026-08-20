import type { BehaviorClass, TraceSummary } from "./contracts.ts"

export interface TaskTypePerformance {
  readonly task_type: string
  readonly trace_count: number
  readonly pass_rate?: number
  readonly checkpoint_rate?: number
}

export interface ModelPerformance {
  readonly model: string
  readonly trace_count: number
  readonly pass_rate?: number
  readonly checkpoint_rate?: number
  readonly dominant_behavior: BehaviorClass
  readonly strongest_task?: TaskTypePerformance
  readonly task_types: ReadonlyArray<TaskTypePerformance>
}

const rate = (part: number, total: number) => total === 0 ? undefined : part / total

const taskPerformance = (taskType: string, traces: ReadonlyArray<TraceSummary>): TaskTypePerformance => {
  const assessed = traces.filter((trace) => trace.strict_pass !== undefined)
  const checkpoints = traces.reduce((sum, trace) => sum + (trace.checkpoint_total ?? 0), 0)
  const held = traces.reduce((sum, trace) => sum + (trace.checkpoint_passed ?? 0), 0)
  return {
    task_type: taskType,
    trace_count: traces.length,
    ...(rate(assessed.filter((trace) => trace.strict_pass === true).length, assessed.length) === undefined
      ? {}
      : { pass_rate: rate(assessed.filter((trace) => trace.strict_pass === true).length, assessed.length)! }),
    ...(rate(held, checkpoints) === undefined ? {} : { checkpoint_rate: rate(held, checkpoints)! })
  }
}

export const modelPerformance = (traces: ReadonlyArray<TraceSummary>): ReadonlyArray<ModelPerformance> => {
  const models = new Map<string, Array<TraceSummary>>()
  for (const trace of traces) models.set(trace.model, [...models.get(trace.model) ?? [], trace])
  return [...models.entries()].map(([model, held]) => {
    const assessed = held.filter((trace) => trace.strict_pass !== undefined)
    const checkpoints = held.reduce((sum, trace) => sum + (trace.checkpoint_total ?? 0), 0)
    const checkpointPassed = held.reduce((sum, trace) => sum + (trace.checkpoint_passed ?? 0), 0)
    const behaviors = new Map<BehaviorClass, number>()
    const tasks = new Map<string, Array<TraceSummary>>()
    for (const trace of held) {
      behaviors.set(trace.behavior, (behaviors.get(trace.behavior) ?? 0) + 1)
      const task = trace.work_type ?? "unclassified"
      tasks.set(task, [...tasks.get(task) ?? [], trace])
    }
    const taskTypes = [...tasks.entries()]
      .map(([task, taskTraces]) => taskPerformance(task, taskTraces))
      .sort((left, right) => right.trace_count - left.trace_count || left.task_type.localeCompare(right.task_type))
    const strongestTask = [...taskTypes]
      .filter((task) => task.checkpoint_rate !== undefined)
      .sort((left, right) => right.checkpoint_rate! - left.checkpoint_rate! || right.trace_count - left.trace_count)[0]
    const dominantBehavior = [...behaviors.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "answer-only"
    return {
      model,
      trace_count: held.length,
      ...(rate(assessed.filter((trace) => trace.strict_pass === true).length, assessed.length) === undefined
        ? {}
        : { pass_rate: rate(assessed.filter((trace) => trace.strict_pass === true).length, assessed.length)! }),
      ...(rate(checkpointPassed, checkpoints) === undefined ? {} : { checkpoint_rate: rate(checkpointPassed, checkpoints)! }),
      dominant_behavior: dominantBehavior,
      ...(strongestTask === undefined ? {} : { strongest_task: strongestTask }),
      task_types: taskTypes
    }
  }).sort((left, right) => (right.checkpoint_rate ?? -1) - (left.checkpoint_rate ?? -1) || left.model.localeCompare(right.model))
}
