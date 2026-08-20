import { describe, expect, test } from "bun:test"
import type { TraceSummary } from "./contracts.ts"
import { modelPerformance } from "./model-analysis.ts"

const trace = (overrides: Partial<TraceSummary>): TraceSummary => ({
  trace_id: "trace-1",
  title: "Trace",
  model: "model-a",
  agent: "agent",
  source: "legalbench",
  status: "completed",
  prompt_tokens: 10,
  completion_tokens: 5,
  cost_usd: 0,
  steps: 3,
  tool_calls: 1,
  tool_names: ["write"],
  behavior: "direct-builder",
  behavior_summary: "Builds directly.",
  behavior_tags: [],
  failed_checkpoints: 0,
  ...overrides
})

describe("model evidence analysis", () => {
  test("compares every model and its task-type strengths", () => {
    const rows = modelPerformance([
      trace({ trace_id: "a-draft", strict_pass: true, checkpoint_passed: 4, checkpoint_total: 4, work_type: "draft" }),
      trace({ trace_id: "a-extract", strict_pass: false, checkpoint_passed: 2, checkpoint_total: 4, work_type: "extract", behavior: "research-first" }),
      trace({ trace_id: "b-draft", model: "model-b", strict_pass: false, checkpoint_passed: 1, checkpoint_total: 4, work_type: "draft" })
    ])

    expect(rows.map((row) => row.model)).toEqual(["model-a", "model-b"])
    expect(rows[0]).toMatchObject({
      trace_count: 2,
      pass_rate: 0.5,
      checkpoint_rate: 0.75,
      dominant_behavior: "direct-builder",
      strongest_task: { task_type: "draft", checkpoint_rate: 1 }
    })
    expect(rows[0]?.task_types).toEqual([
      { task_type: "draft", trace_count: 1, pass_rate: 1, checkpoint_rate: 1 },
      { task_type: "extract", trace_count: 1, pass_rate: 0, checkpoint_rate: 0.5 }
    ])
  })
})
