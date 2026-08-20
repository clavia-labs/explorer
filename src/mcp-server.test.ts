import { createMcpHandler } from "@modelcontextprotocol/server"
import { describe, expect, test } from "bun:test"
import valid from "./fixtures/atif-valid.json"
import { createTraceMcpServer } from "./mcp-server.ts"
import { TraceStore } from "./store.ts"

const request = (body: Readonly<Record<string, unknown>>) => new Request("http://localhost/mcp", {
  method: "POST",
  headers: {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2025-11-25"
  },
  body: JSON.stringify(body)
})

describe("Explorer MCP server", () => {
  test("serves normalized evidence through Streamable HTTP", async () => {
    const store = new TraceStore(":memory:")
    const dataset = store.putDataset({ name: "Fixture", source: { kind: "fixture", id: "one" }, traces: [valid] })
    const handler = createMcpHandler(() => createTraceMcpServer(store))
    try {
      const initialized = await handler.fetch(request({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "fixture", version: "1" }
        }
      }))
      expect(initialized.status).toBe(200)
      expect(await initialized.text()).toContain('"name":"clavia-explorer"')

      const called = await handler.fetch(request({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_analysis_table",
          arguments: {
            dataset_id: dataset.dataset_id,
            table: "checkpoint_results",
            trace_limit: 10
          }
        }
      }))
      const body = await called.text()
      expect(called.status).toBe(200)
      expect(body).toContain('"checkpoint_id":"C-004"')
      expect(body).toContain('"trace_id":"fixture-trace"')
    } finally {
      await handler.close()
      store.close()
    }
  })
})
