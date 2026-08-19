import { describe, expect, test } from "bun:test"
import valid from "./fixtures/atif-valid.json"
import { deriveTraceActivity } from "./activity.ts"
import type { AtifTrajectory } from "./contracts.ts"

describe("trace activity projection", () => {
  test("groups a trajectory into semantic phases with exact leaves", () => {
    const activity = deriveTraceActivity(valid as AtifTrajectory)

    expect(activity.schema_version).toBe("clavia.trace-activity/v1")
    expect(activity.root.children.map((phase) => phase.category)).toEqual([
      "orient",
      "change",
      "respond"
    ])
    expect(activity.root.children[1]).toMatchObject({
      label: "Make changes",
      start_step: 2,
      end_step: 2,
      step_count: 1,
      tool_call_count: 1,
      tools: ["write"]
    })
    expect(activity.root.children[1]?.children[0]?.children).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "tool",
        label: "Write clause.md",
        leaf_ref: { step_id: 2, tool_call_id: "write-1" }
      })
    ]))
  })

  test("starts a recovery phase after a structured tool failure", () => {
    const changed = structuredClone(valid) as unknown as AtifTrajectory
    const failed = {
      ...changed.steps[1]!,
      extra: { status: "Error" }
    }
    const recovered = {
      ...changed.steps[1]!,
      step_id: 3,
      tool_calls: [{
        tool_call_id: "write-2",
        function_name: "write",
        arguments: { file_path: "clause.md", content: "Corrected clause" }
      }],
      observation: { results: [{ source_call_id: "write-2", content: "Wrote clause.md" }] },
      extra: { status: "Ok" }
    }
    const response = { ...changed.steps[2]!, step_id: 4 }
    const trace = { ...changed, steps: [changed.steps[0]!, failed, recovered, response] }

    const activity = deriveTraceActivity(trace)

    expect(activity.root.children.map((phase) => phase.category)).toEqual([
      "orient",
      "change",
      "recover",
      "respond"
    ])
    expect(activity.root.children[1]?.status).toBe("failed")
    expect(activity.root.children[2]?.dimension).toBe("recovery")
  })

  test("splits a long phase into bounded review passes", () => {
    const steps = Array.from({ length: 29 }, (_, index) => ({
      step_id: index + 2,
      source: "agent" as const,
      message: "",
      tool_calls: [{
        tool_call_id: `read-${index + 1}`,
        function_name: "read",
        arguments: { file_path: `source-${index + 1}.md` }
      }],
      observation: { results: [{ source_call_id: `read-${index + 1}`, content: "Read file" }] },
      llm_call_count: 0
    }))
    const changed = structuredClone(valid) as unknown as AtifTrajectory
    const response = { ...changed.steps[2]!, step_id: 31 }
    const trace = { ...changed, steps: [changed.steps[0]!, ...steps, response] }

    const activity = deriveTraceActivity(trace)
    const investigation = activity.root.children.filter((phase) => phase.category === "investigate")

    expect(investigation).toHaveLength(3)
    expect(investigation.map((phase) => phase.step_count)).toEqual([12, 12, 5])
    expect(deriveTraceActivity(trace)).toEqual(activity)
  })
})
