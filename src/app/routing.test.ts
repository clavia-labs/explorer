import { describe, expect, test } from "bun:test"
import { parseExplorerRoute, screenRoute, traceRoute } from "./routing.ts"

describe("explorer routing", () => {
  test("maps internal pages and trace IDs to stable paths", () => {
    expect(parseExplorerRoute("/analysis", "", false)).toEqual({ screen: "analysis" })
    expect(parseExplorerRoute("/traces", "", false)).toEqual({ screen: "traces" })
    expect(parseExplorerRoute("/traces/run%3A42", "", false)).toEqual({ screen: "traces", traceId: "run:42" })
    expect(screenRoute("analysis")).toBe("/analysis")
    expect(screenRoute("traces")).toBe("/traces")
    expect(traceRoute("run:42")).toBe("/traces/run%3A42")
  })

  test("keeps signed views on their share path", () => {
    expect(parseExplorerRoute("/share/token", "?trace=run%3A42", true)).toEqual({ screen: "analysis", traceId: "run:42" })
    expect(screenRoute("analysis", "/share/token")).toBe("/share/token")
    expect(traceRoute("run:42", "/share/token")).toBe("/share/token?trace=run%3A42")
  })
})
