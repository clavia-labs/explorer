import { resolve, sep } from "node:path"
import { createApi } from "./api.ts"
import { TraceStore } from "./store.ts"

const argument = (name: string) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const storePath = resolve(argument("--store")
  ?? process.env.TRACE_STORE_PATH
  ?? resolve(import.meta.dir, "../build/trace.sqlite"))
const dist = resolve(import.meta.dir, "../dist")
const port = Number(argument("--port") ?? process.env.CONDUCTOR_PORT ?? 4321)
const store = new TraceStore(storePath)
const api = createApi(store)
const types: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
}

const extensionOf = (path: string) => path.slice(path.lastIndexOf("."))
const index = Bun.file(resolve(dist, "index.html"))
const compressible = (contentType: string) =>
  contentType.startsWith("text/")
  || contentType.startsWith("application/json")
  || contentType.startsWith("application/javascript")
  || contentType.startsWith("image/svg+xml")

const compressed = async (request: Request, response: Response) => {
  const contentType = response.headers.get("content-type") ?? ""
  if (
    request.method === "HEAD"
    || response.body === null
    || response.headers.has("content-encoding")
    || !request.headers.get("accept-encoding")?.split(",").some((value) => value.trim().startsWith("gzip"))
    || !compressible(contentType)
  ) return response
  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength < 1_024) return new Response(body, response)
  const headers = new Headers(response.headers)
  headers.set("content-encoding", "gzip")
  headers.set("vary", "Accept-Encoding")
  headers.delete("content-length")
  return new Response(Bun.gzipSync(body), {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith("/v1/")) return compressed(request, await api(request))
    if (url.pathname === "/health") return Response.json({ ok: true })
    const requested = resolve(dist, url.pathname.slice(1))
    if (requested.startsWith(`${dist}${sep}`)) {
      const file = Bun.file(requested)
      if (await file.exists()) {
        return compressed(request, new Response(file, { headers: {
          "cache-control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=300",
          "content-type": types[extensionOf(requested)] ?? "application/octet-stream"
        } }))
      }
    }
    return compressed(request, new Response(index, { headers: { "cache-control": "no-cache", "content-type": types[".html"]! } }))
  }
})

console.log(`Clavia Trace is listening on ${server.url}`)
console.log(`Trace store: ${storePath}`)

const close = () => {
  server.stop(true)
  store.close()
}

process.once("SIGINT", close)
process.once("SIGTERM", close)
