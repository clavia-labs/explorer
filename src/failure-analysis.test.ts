import { describe, expect, test } from "bun:test"
import valid from "./fixtures/atif-valid.json"
import { validateTrajectory } from "./contracts.ts"
import { clusterFailureEvidence } from "./failure-analysis.ts"
import { summarizeTrace } from "./summary.ts"

describe("failure-mode clustering", () => {
  test("groups failed checkpoints and derives dominant trace patterns", () => {
    const first = validateTrajectory(valid)
    const second = validateTrajectory({
      ...structuredClone(valid),
      trajectory_id: "fixture-trace-2",
      agent: { ...valid.agent, model_name: "alibaba/qwen3.7-max" },
      extra: { clavia: {
        ...valid.extra.clavia,
        task: { ...valid.extra.clavia.task, work_type: "extract" },
        behavior: { ...valid.extra.clavia.behavior, class: "research-first" },
        failure_modes: [
          { id: "C-004", verdict: "FAIL", justification: "The extracted term is incomplete." },
          { id: "C-008", verdict: "PASS" }
        ]
      } }
    })

    const analysis = clusterFailureEvidence("dataset-1", [first, second].map((trace) => ({
      summary: summarizeTrace(trace),
      failure_modes: trace.extra.clavia.failure_modes ?? []
    })))

    expect(analysis.clusters).toHaveLength(1)
    expect(analysis.clusters[0]).toMatchObject({ id: "C-004", trace_count: 2, model_count: 2 })
    expect(analysis.clusters[0]?.dominant_behaviors).toEqual([
      { label: "direct-builder", count: 1 },
      { label: "research-first", count: 1 }
    ])
    expect(analysis.clusters[0]?.dominant_task_types).toEqual([
      { label: "draft", count: 1 },
      { label: "extract", count: 1 }
    ])
  })
})
