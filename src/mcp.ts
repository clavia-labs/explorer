import { resolve } from "node:path"
import { McpServer } from "@modelcontextprotocol/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import * as z from "zod/v4"
import { deriveTraceActivity } from "./activity.ts"
import { compactTrajectory } from "./compact.ts"
import {
  QUERY_FIELDS,
  type TraceQuery,
  type ViewCell
} from "./contracts.ts"
import { createShareToken } from "./share.ts"
import { TraceStore } from "./store.ts"

const queryMetrics = [
  "trace_count",
  "pass_rate",
  "checkpoint_rate",
  "avg_usefulness",
  "avg_cost_usd",
  "avg_duration_ms",
  "avg_tool_calls",
  "avg_prompt_tokens",
  "avg_completion_tokens"
] as const

const argument = (name: string) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const storePath = argument("--store")
  ?? process.env.TRACE_STORE_PATH
  ?? resolve(import.meta.dir, "../build/trace.sqlite")
const store = new TraceStore(resolve(storePath))

const response = (value: Readonly<Record<string, unknown>>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: value
})

const serverFactory = () => {
  const server = new McpServer({ name: "clavia-trace", version: "1.0.0" })

  server.registerTool("list_datasets", {
    title: "List trace datasets",
    description: "List immutable trace dataset snapshots and their content hashes."
  }, async () => response({ datasets: store.listDatasets() }))

  server.registerTool("get_dataset", {
    title: "Get a trace dataset",
    description: "Get one dataset manifest and its trace summaries.",
    inputSchema: z.object({ dataset_id: z.string() })
  }, async ({ dataset_id }) => response({
    dataset: store.getDataset(dataset_id) ?? null,
    traces: store.listTraceSummaries(dataset_id)
  }))

  server.registerTool("get_trace", {
    title: "Read a trajectory",
    description: "Read a trace as a hierarchical activity tree, compact action stream, or full ATIF v1.7.",
    inputSchema: z.object({
      dataset_id: z.string(),
      trace_id: z.string(),
      format: z.enum(["activity", "compact", "atif"]).default("activity")
    })
  }, async ({ dataset_id, trace_id, format }) => {
    const trace = store.getTrace(dataset_id, trace_id)
    if (trace === undefined) throw new Error(`trace ${trace_id} does not exist in ${dataset_id}`)
    return response({
      format,
      trace: format === "activity"
        ? deriveTraceActivity(trace)
        : format === "compact"
          ? compactTrajectory(trace)
          : trace
    })
  })

  server.registerTool("query_traces", {
    title: "Query trace behavior",
    description: "Group and measure trace outcomes, behaviors, models, tasks, and tool use.",
    inputSchema: z.object({
      dataset_id: z.string(),
      filters: z.array(z.object({
        field: z.enum(QUERY_FIELDS),
        op: z.enum(["eq", "neq", "in"]),
        value: z.union([z.string(), z.boolean(), z.array(z.union([z.string(), z.boolean()]))])
      })).optional(),
      group_by: z.enum(QUERY_FIELDS).optional(),
      metrics: z.array(z.enum(queryMetrics)).min(1),
      order_by: z.object({
        metric: z.enum(queryMetrics),
        direction: z.enum(["asc", "desc"])
      }).optional(),
      limit: z.number().int().min(1).max(1000).optional()
    })
  }, async (query) => response({ ...store.query(query as TraceQuery) }))

  server.registerTool("create_view", {
    title: "Create a trace view",
    description: "Save a reusable analysis view over one immutable dataset.",
    inputSchema: z.object({
      dataset_id: z.string(),
      title: z.string(),
      description: z.string().optional(),
      cells: z.array(z.unknown())
    })
  }, async ({ dataset_id, title, description, cells }) => response({
    view: store.putView({
      dataset_id,
      title,
      ...(description === undefined ? {} : { description }),
      cells: cells as ReadonlyArray<ViewCell>
    })
  }))

  server.registerTool("share_view", {
    title: "Create an internal partner link",
    description: "Create a signed read-only link for an internal partner review.",
    inputSchema: z.object({
      view_id: z.string(),
      base_url: z.string().url().default("http://localhost:4321"),
      expires_at: z.string().optional()
    })
  }, async ({ view_id, base_url, expires_at }) => {
    if (store.getView(view_id) === undefined) throw new Error(`view ${view_id} does not exist`)
    const token = createShareToken({
      view_id,
      policy: "partner-review",
      ...(expires_at === undefined ? {} : { expires_at })
    }, store.shareSecret())
    return response({ policy: "partner-review", token, url: `${base_url.replace(/\/$/, "")}/share/${token}` })
  })

  return server
}

const handle = serveStdio(serverFactory, {
  onerror: (error) => console.error(error.message)
})

const close = async () => {
  await handle.close()
  store.close()
}

process.once("SIGINT", () => void close())
process.once("SIGTERM", () => void close())
