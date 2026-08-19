import {
  ContractError,
  type QueryField,
  type QueryMetric,
  type QueryResult,
  type TraceQuery,
  type TraceSummary
} from "./contracts.ts"
import { fieldValue } from "./summary.ts"

const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000

const matchesFilter = (
  summary: TraceSummary,
  filter: NonNullable<TraceQuery["filters"]>[number]
) => {
  const values: ReadonlyArray<string | boolean> = filter.field === "tool_name"
    ? summary.tool_names
    : [fieldValue(summary, filter.field)].filter(
        (value): value is string | boolean => value !== undefined
      )
  const expected = Array.isArray(filter.value) ? filter.value : [filter.value]
  if (filter.op === "eq") return values.some((value) => expected.includes(value))
  if (filter.op === "neq") return values.every((value) => !expected.includes(value))
  return values.some((value) => expected.includes(value))
}

const valuesForGroup = (summary: TraceSummary, field: QueryField) => {
  if (field === "tool_name") return summary.tool_names.length === 0 ? ["no tools"] : summary.tool_names
  return [fieldValue(summary, field) ?? "unknown"]
}

const average = (values: ReadonlyArray<number | undefined>) => {
  const held = values.filter((value): value is number => value !== undefined)
  return held.length === 0 ? null : rounded(held.reduce((sum, value) => sum + value, 0) / held.length)
}

const metricValue = (metric: QueryMetric, summaries: ReadonlyArray<TraceSummary>) => {
  if (metric === "trace_count") return summaries.length
  if (metric === "pass_rate") {
    const assessed = summaries.filter((summary) => summary.strict_pass !== undefined)
    return assessed.length === 0
      ? null
      : rounded(assessed.filter((summary) => summary.strict_pass).length / assessed.length)
  }
  if (metric === "checkpoint_rate") {
    const total = summaries.reduce((sum, summary) => sum + (summary.checkpoint_total ?? 0), 0)
    const passed = summaries.reduce((sum, summary) => sum + (summary.checkpoint_passed ?? 0), 0)
    return total === 0 ? null : rounded(passed / total)
  }
  if (metric === "avg_usefulness") return average(summaries.map((summary) => summary.usefulness))
  if (metric === "avg_cost_usd") return average(summaries.map((summary) => summary.cost_usd))
  if (metric === "avg_duration_ms") return average(summaries.map((summary) => summary.duration_ms))
  if (metric === "avg_tool_calls") return average(summaries.map((summary) => summary.tool_calls))
  if (metric === "avg_prompt_tokens") return average(summaries.map((summary) => summary.prompt_tokens))
  return average(summaries.map((summary) => summary.completion_tokens))
}

const rowFor = (
  query: TraceQuery,
  summaries: ReadonlyArray<TraceSummary>,
  group?: string | boolean
) => ({
  ...(query.group_by === undefined ? {} : { [query.group_by]: group ?? "unknown" }),
  ...Object.fromEntries(query.metrics.map((metric) => [metric, metricValue(metric, summaries)]))
})

export const querySummaries = (
  query: TraceQuery,
  summaries: ReadonlyArray<TraceSummary>
): QueryResult => {
  if (query.metrics.length === 0) throw new ContractError("QUERY_METRICS", "metrics must contain one item")
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 1000)) {
    throw new ContractError("QUERY_LIMIT", "limit must be an integer from 1 through 1000")
  }
  const matched = summaries.filter((summary) =>
    (query.filters ?? []).every((filter) => matchesFilter(summary, filter))
  )
  let rows: Array<Readonly<Record<string, string | number | boolean | null>>>
  if (query.group_by === undefined) {
    rows = [rowFor(query, matched)]
  } else {
    const groups = new Map<string | boolean, Array<TraceSummary>>()
    for (const summary of matched) {
      for (const value of valuesForGroup(summary, query.group_by)) {
        const held = groups.get(value) ?? []
        if (!held.some((candidate) => candidate.trace_id === summary.trace_id)) held.push(summary)
        groups.set(value, held)
      }
    }
    rows = [...groups.entries()].map(([group, values]) => rowFor(query, values, group))
  }
  if (query.order_by !== undefined) {
    const { metric, direction } = query.order_by
    rows.sort((left, right) => {
      const a = typeof left[metric] === "number" ? left[metric] : Number.NEGATIVE_INFINITY
      const b = typeof right[metric] === "number" ? right[metric] : Number.NEGATIVE_INFINITY
      return direction === "asc" ? a - b : b - a
    })
  } else if (query.group_by !== undefined) {
    rows.sort((left, right) => String(left[query.group_by!]).localeCompare(String(right[query.group_by!])))
  }
  rows = rows.slice(0, query.limit ?? rows.length)
  return {
    dataset_id: query.dataset_id,
    matched_traces: matched.length,
    ...(query.group_by === undefined ? {} : { group_by: query.group_by }),
    rows
  }
}
