import { describe, expect, test } from "bun:test"
import valid from "./fixtures/atif-valid.json"
import { policyCapabilities, redactTrace } from "./redaction.ts"
import { createShareToken, verifyShareToken } from "./share.ts"

describe("share redaction", () => {
  test("partner review keeps the trajectory and removes failure explanations", () => {
    const trace = redactTrace(valid, "partner-review")
    expect(trace.steps[1]?.reasoning_content).toContain("short output")
    expect(trace.extra.clavia.failure_modes?.[0]).toEqual({ id: "C-004", verdict: "FAIL" })
    expect(policyCapabilities("partner-review").failure_details).toBeFalse()
  })

  test("lab prospect keeps action shape and removes private content", () => {
    const trace = redactTrace(valid, "lab-prospect")
    expect(trace.steps[0]?.message).toBe("Content withheld by lab-prospect policy.")
    expect(trace.steps[1]?.reasoning_content).toBeUndefined()
    expect(trace.steps[1]?.tool_calls?.[0]?.function_name).toBe("write")
    expect(trace.steps[1]?.tool_calls?.[0]?.arguments).toEqual({})
    expect(trace.extra.clavia.failure_modes).toBeUndefined()
    expect(policyCapabilities("lab-prospect").all_traces).toBeFalse()
  })

  test("signed share claims reject changes and expiry", () => {
    const secret = "fixture-secret"
    const token = createShareToken({ view_id: "view_one", policy: "partner-review" }, secret)
    expect(verifyShareToken(token, secret)).toEqual({ view_id: "view_one", policy: "partner-review" })
    expect(() => verifyShareToken(`${token}x`, secret)).toThrow()
    const expired = createShareToken({
      view_id: "view_one",
      policy: "lab-prospect",
      expires_at: "2020-01-01T00:00:00.000Z"
    }, secret)
    expect(() => verifyShareToken(expired, secret)).toThrow()
  })
})
