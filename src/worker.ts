/// <reference types="@cloudflare/workers-types" />

import {
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse
} from "@modelcontextprotocol/server"
import { createApi } from "./api.ts"
import { passwordGuard } from "./access.ts"
import { D1TraceStore } from "./d1-store.ts"
import { createTraceMcpServer } from "./mcp-server.ts"

interface Env {
  readonly ASSETS: Fetcher
  readonly EXPLORER_PASSWORD?: string
  readonly SHARE_SECRET: string
  readonly TRACE_DB: D1Database
}

const MCP_HOSTS = ["explorer.clavia.ai", "localhost", "127.0.0.1", "[::1]"]

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === "/health") {
      return Response.json(
        { ok: true, service: "clavia-explorer" },
        { headers: { "cache-control": "no-store" } },
      )
    }
    const access = await passwordGuard(request, env.EXPLORER_PASSWORD)
    if (access !== undefined) return access
    const store = new D1TraceStore(env.TRACE_DB, env.SHARE_SECRET)
    if (url.pathname === "/mcp") {
      const rejected = hostHeaderValidationResponse(request, MCP_HOSTS)
        ?? originValidationResponse(request, MCP_HOSTS)
      if (rejected !== undefined) return rejected
      return createMcpHandler(() => createTraceMcpServer(store)).fetch(request)
    }
    if (url.pathname.startsWith("/v1/")) {
      return createApi(store)(request)
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
