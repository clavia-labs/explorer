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
})
