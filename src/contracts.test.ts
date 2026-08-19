import { describe, expect, test } from "bun:test"
import valid from "./fixtures/atif-valid.json"
import { ContractError, validateTrajectory } from "./contracts.ts"

describe("ATIF trace contract", () => {
  test("accepts a complete ATIF v1.7 trace", () => {
    expect(validateTrajectory(valid).trajectory_id).toBe("fixture-trace")
  })

  test("rejects a gap in the step sequence", () => {
    const changed = structuredClone(valid)
    changed.steps[1]!.step_id = 4
    expect(() => validateTrajectory(changed)).toThrow(
      new ContractError("TRACE_STEP_ORDER", "step_id must equal 2")
    )
  })

  test("rejects duplicate tool-call identifiers", () => {
    const changed = structuredClone(valid)
    const step = changed.steps[1]!
    step.tool_calls = [...step.tool_calls!, step.tool_calls![0]!]
    expect(() => validateTrajectory(changed)).toThrow(ContractError)
  })

  test("rejects LLM fields on a deterministic dispatch", () => {
    const changed = structuredClone(valid)
    changed.steps[1]!.llm_call_count = 0
    expect(() => validateTrajectory(changed)).toThrow(ContractError)
  })
})
