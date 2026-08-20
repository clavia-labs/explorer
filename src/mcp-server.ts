import { McpServer } from "@modelcontextprotocol/server"
import * as z from "zod/v4"
import { deriveTraceActivity } from "./activity.ts"
import { createAnalysisExport } from "./analysis-export.ts"
import { compactTrajectory } from "./compact.ts"
import {
  QUERY_FIELDS,
  type TraceQuery,
  type ViewCell
} from "./contracts.ts"
import { createShareToken } from "./share.ts"
import type { TraceStoreApi } from "./store-api.ts"

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

const analysisTables = [
  "traces",
  "steps",
  "tool_calls",
  "observations",
  "checkpoint_results",
  "artifacts"
] as const

const response = (value: Readonly<Record<string, unknown>>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: value
})

export const createTraceMcpServer = (store: TraceStoreApi) => {
  const server = new McpServer({ name: "clavia-explorer", version: "1.1.0" })

  server.registerTool("list_datasets", {
    title: "List trace datasets",
    description: "List immutable trace dataset snapshots and their content hashes."
  }, async () => response({ datasets: await store.listDatasets() }))

  server.registerTool("get_dataset", {
    title: "Get a trace dataset",
    description: "Get one dataset manifest and its trace summaries.",
    inputSchema: z.object({ dataset_id: z.string() })
  }, async ({ dataset_id }) => response({
    dataset: await store.getDataset(dataset_id) ?? null,
    traces: await store.listTraceSummaries(dataset_id)
  }))

  server.registerTool("get_analysis_table", {
    title: "Read an analysis table",
    description: "Read a page from a normalized analysis table for one immutable trace dataset.",
    inputSchema: z.object({
      dataset_id: z.string(),
      table: z.enum(analysisTables),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(1000).default(100)
    })
  }, async ({ dataset_id, table, offset, limit }) => {
    const analysis = await createAnalysisExport(store, dataset_id)
    const rows = analysis.tables[table]
    return response({
      schema_version: analysis.schema_version,
      dataset_id,
      dataset_sha256: analysis.dataset.object_sha256,
      table,
      total_rows: rows.length,
      offset,
      rows: rows.slice(offset, offset + limit)
    })
  })

  server.registerTool("get_trace", {
    title: "Read a trajectory",
    description: "Read a trace as a hierarchical activity tree, compact action stream, or full ATIF v1.7.",
    inputSchema: z.object({
      dataset_id: z.string(),
      trace_id: z.string(),
      format: z.enum(["activity", "compact", "atif"]).default("activity")
    })
  }, async ({ dataset_id, trace_id, format }) => {
    const trace = await store.getTrace(dataset_id, trace_id)
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
  }, async (query) => response({ ...await store.query(query as TraceQuery) }))

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
    view: await store.putView({
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
    if (await store.getView(view_id) === undefined) throw new Error(`view ${view_id} does not exist`)
    const token = createShareToken({
      view_id,
      policy: "partner-review",
      ...(expires_at === undefined ? {} : { expires_at })
    }, await store.shareSecret())
    return response({ policy: "partner-review", token, url: `${base_url.replace(/\/$/, "")}/share/${token}` })
  })

  return server
}
