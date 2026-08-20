import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import valid from "./fixtures/atif-valid.json"
import { createApi } from "./api.ts"
import { createShareToken } from "./share.ts"
import { TraceStore } from "./store.ts"

interface ApiBody {
  readonly datasets: ReadonlyArray<{ readonly dataset_id: string }>
  readonly rows: ReadonlyArray<Record<string, unknown>>
  readonly url: string
  readonly token: string
  readonly policy: string | { readonly policy: string }
  readonly trace: { readonly steps: ReadonlyArray<{ readonly message?: string }> }
  readonly activity: { readonly root: { readonly children: ReadonlyArray<{ readonly category: string }> } }
  readonly summary: { readonly trace_id: string }
  readonly step: { readonly step_id: number }
  readonly clusters: ReadonlyArray<{ readonly id: string; readonly trace_count: number }>
}

const apiBody = (response: Response) => response.json() as Promise<ApiBody>

describe("trace API", () => {
  test("serves datasets, queries, views, shares, and redacted drill-downs", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "clavia-trace-api-"))
    try {
      const store = new TraceStore(resolve(directory, "store.sqlite"))
      const dataset = store.putDataset({ name: "Fixture", source: { kind: "fixture", id: "one" }, traces: [valid] })
      const view = store.putView({
        dataset_id: dataset.dataset_id,
        title: "Fixture analysis",
        cells: [{ kind: "trace-list", title: "Samples", sample_trace_ids: ["fixture-trace"] }]
      })
      const api = createApi(store)
      const datasets = await api(new Request("http://trace.local/v1/datasets"))
      expect(datasets.status).toBe(200)
      expect((await apiBody(datasets)).datasets[0]?.dataset_id).toBe(dataset.dataset_id)

      const query = await api(new Request("http://trace.local/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataset_id: dataset.dataset_id,
          group_by: "behavior",
          metrics: ["trace_count", "pass_rate"]
        })
      }))
      expect((await apiBody(query)).rows[0]).toMatchObject({ behavior: "direct-builder", trace_count: 1 })

      const clusters = await api(new Request(
        `http://trace.local/v1/datasets/${dataset.dataset_id}/failure-clusters`
      ))
      expect((await apiBody(clusters)).clusters).toEqual([
        expect.objectContaining({ id: "C-004", trace_count: 1 })
      ])

      const shared = await api(new Request("http://trace.local/v1/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ view_id: view.view_id })
      }))
      const share = await apiBody(shared)
      expect(share.url).toStartWith("http://trace.local/share/")
      expect(share.policy).toBe("partner-review")

      const trace = await api(new Request(
        `http://trace.local/v1/traces/fixture-trace?dataset_id=${dataset.dataset_id}&share=${share.token}`
      ))
      const body = await apiBody(trace)
      expect(typeof body.policy === "string" ? body.policy : body.policy.policy).toBe("partner-review")
      expect(body.trace.steps[0]?.message).toBe("Draft a clause.")

      const activity = await api(new Request(
        `http://trace.local/v1/traces/fixture-trace/activity?dataset_id=${dataset.dataset_id}&share=${share.token}`
      ))
      const activityBody = await apiBody(activity)
      expect(activityBody.activity.root.children.map((phase: { readonly category: string }) => phase.category)).toEqual([
        "orient",
        "change",
        "respond"
      ])
      expect(JSON.stringify(activityBody)).not.toContain("withheld")

      const summary = await api(new Request(
        `http://trace.local/v1/traces/fixture-trace/summary?dataset_id=${dataset.dataset_id}&share=${share.token}`
      ))
      expect((await apiBody(summary)).summary.trace_id).toBe("fixture-trace")

      const step = await api(new Request(
        `http://trace.local/v1/traces/fixture-trace/steps/2?dataset_id=${dataset.dataset_id}&share=${share.token}`
      ))
      const stepBody = await apiBody(step)
      expect(stepBody.step.step_id).toBe(2)
      expect(JSON.stringify(stepBody)).toContain("Clause text")
      store.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("keeps a legacy prospect token scoped to listed traces", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "clavia-trace-api-"))
    try {
      const store = new TraceStore(resolve(directory, "store.sqlite"))
      const dataset = store.putDataset({ name: "Fixture", source: { kind: "fixture", id: "one" }, traces: [valid] })
      const view = store.putView({ dataset_id: dataset.dataset_id, title: "No samples", cells: [] })
      const api = createApi(store)
      const token = createShareToken({ view_id: view.view_id, policy: "lab-prospect" }, store.shareSecret())
      const trace = await api(new Request(
        `http://trace.local/v1/traces/fixture-trace?dataset_id=${dataset.dataset_id}&share=${token}`
      ))
      expect(trace.status).toBe(403)
      const clusters = await api(new Request(
        `http://trace.local/v1/datasets/${dataset.dataset_id}/failure-clusters?share=${token}`
      ))
      expect(clusters.status).toBe(403)
      const analysisExport = await api(new Request(
        `http://trace.local/v1/datasets/${dataset.dataset_id}/analysis-export?share=${token}`
      ))
      expect(analysisExport.status).toBe(403)
      store.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("selects the internal-partner policy on the server", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "clavia-trace-api-"))
    try {
      const store = new TraceStore(resolve(directory, "store.sqlite"))
      const dataset = store.putDataset({ name: "Fixture", source: { kind: "fixture", id: "one" }, traces: [valid] })
      const view = store.putView({ dataset_id: dataset.dataset_id, title: "Fixture analysis", cells: [] })
      const api = createApi(store)
      const response = await api(new Request("http://trace.local/v1/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ view_id: view.view_id, policy: "lab-prospect" })
      }))
      expect(response.status).toBe(201)
      expect((await apiBody(response)).policy).toBe("partner-review")
      store.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("exports deterministic analysis tables with trace-level evidence", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "clavia-trace-api-"))
    try {
      const store = new TraceStore(resolve(directory, "store.sqlite"))
      const secondTrace = structuredClone(valid)
      secondTrace.trajectory_id = "fixture-trace-2"
      secondTrace.session_id = "fixture-session-2"
      secondTrace.extra.clavia.title = "Second fixture trace"
      const dataset = store.putDataset({
        name: "Fixture",
        source: { kind: "fixture", id: "one" },
        traces: [valid, secondTrace]
      })
      const api = createApi(store)

      const response = await api(new Request(
        `http://trace.local/v1/datasets/${dataset.dataset_id}/analysis-export?trace_limit=1`
      ))
      expect(response.status).toBe(200)
      expect(response.headers.get("etag")).toBe(`"${dataset.object_sha256}:0:1"`)
      expect(response.headers.get("link")).toContain("trace_offset=1")
      const body = await response.json() as {
        readonly schema_version: string
        readonly dataset: { readonly dataset_id: string }
        readonly page: {
          readonly trace_offset: number
          readonly trace_limit: number
          readonly total_traces: number
          readonly returned_traces: number
          readonly next_trace_offset?: number
        }
        readonly tables: {
          readonly traces: ReadonlyArray<Record<string, unknown>>
          readonly steps: ReadonlyArray<Record<string, unknown>>
          readonly tool_calls: ReadonlyArray<Record<string, unknown>>
          readonly observations: ReadonlyArray<Record<string, unknown>>
          readonly checkpoint_results: ReadonlyArray<Record<string, unknown>>
        }
      }
      expect(body.schema_version).toBe("clavia.analysis-export/v1")
      expect(body.dataset.dataset_id).toBe(dataset.dataset_id)
      expect(body.page).toEqual({
        trace_offset: 0,
        trace_limit: 1,
        total_traces: 2,
        returned_traces: 1,
        next_trace_offset: 1
      })
      expect(body.tables.traces).toEqual([
        expect.objectContaining({ trace_id: "fixture-trace", model: "openai/gpt-5.6-sol" })
      ])
      expect(body.tables.steps).toHaveLength(3)
      expect(body.tables.steps[1]).toMatchObject({
        trace_id: "fixture-trace",
        step_id: 2,
        message_text: "I will write the requested clause.",
        tool_call_count: 1
      })
      expect(body.tables.tool_calls).toEqual([
        expect.objectContaining({
          trace_id: "fixture-trace",
          step_id: 2,
          tool_call_id: "write-1",
          function_name: "write"
        })
      ])
      expect(body.tables.observations).toEqual([
        expect.objectContaining({ source_call_id: "write-1", content_text: "Wrote clause.md" })
      ])
      expect(body.tables.checkpoint_results).toEqual([
        expect.objectContaining({
          checkpoint_id: "C-004",
          verdict: "FAIL",
          justification: "The clause omits one required term."
        })
      ])

      const next = await api(new Request(
        `http://trace.local/v1/datasets/${dataset.dataset_id}/analysis-export?trace_offset=1&trace_limit=1`
      ))
      const nextBody = await next.json() as typeof body
      expect(nextBody.page.next_trace_offset).toBeUndefined()
      expect(nextBody.tables.traces[0]).toMatchObject({ trace_id: "fixture-trace-2" })

      const oversized = await api(new Request(
        `http://trace.local/v1/datasets/${dataset.dataset_id}/analysis-export?trace_limit=21`
      ))
      expect(oversized.status).toBe(400)
      expect(await oversized.json()).toMatchObject({ error: { code: "ANALYSIS_LIMIT" } })
      store.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
