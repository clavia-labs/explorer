/// <reference types="@cloudflare/workers-types" />

import { createApi } from "./api.ts"
import { D1TraceStore } from "./d1-store.ts"

interface Env {
  readonly ASSETS: Fetcher
  readonly SHARE_SECRET: string
  readonly TRACE_DB: D1Database
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === "/health") {
      return Response.json(
        { ok: true, service: "clavia-explorer" },
        { headers: { "cache-control": "no-store" } },
      )
    }
    if (url.pathname.startsWith("/v1/")) {
      return createApi(new D1TraceStore(env.TRACE_DB, env.SHARE_SECRET))(request)
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
