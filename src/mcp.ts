import { resolve } from "node:path"
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import { createTraceMcpServer } from "./mcp-server.ts"
import { TraceStore } from "./store.ts"

const argument = (name: string) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const storePath = argument("--store")
  ?? process.env.TRACE_STORE_PATH
  ?? resolve(import.meta.dir, "../build/trace.sqlite")
const store = new TraceStore(resolve(storePath))
const handle = serveStdio(() => createTraceMcpServer(store), {
  onerror: (error) => console.error(error.message)
})

const close = async () => {
  await handle.close()
  store.close()
}

process.once("SIGINT", () => void close())
process.once("SIGTERM", () => void close())
