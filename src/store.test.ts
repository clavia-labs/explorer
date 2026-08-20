import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import valid from "./fixtures/atif-valid.json"
import { TraceStore } from "./store.ts"

describe("content-addressed trace store", () => {
  test("keeps immutable datasets and answers aggregate queries", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "clavia-trace-store-"))
    try {
      const store = new TraceStore(resolve(directory, "store.sqlite"))
      const first = store.putDataset({
        name: "Fixture dataset",
        source: { kind: "fixture", id: "one" },
        traces: [valid]
      })
      const second = store.putDataset({
        name: "Fixture dataset",
        source: { kind: "fixture", id: "one" },
        traces: [valid]
      })
      expect(first.dataset_id).toBe(second.dataset_id)
      expect(store.listDatasets()).toHaveLength(1)
      expect(store.getTrace(first.dataset_id, "fixture-trace")?.trajectory_id).toBe("fixture-trace")
      expect(store.listTraces(first.dataset_id).map((trace) => trace.trajectory_id)).toEqual(["fixture-trace"])
      expect(store.listFailureEvidence(first.dataset_id)).toEqual([
        expect.objectContaining({ failure_modes: [{ id: "C-004", verdict: "FAIL", justification: "The clause omits one required term." }] })
      ])
      expect(store.query({
        dataset_id: first.dataset_id,
        group_by: "model",
        metrics: ["trace_count", "pass_rate", "checkpoint_rate", "avg_tool_calls"]
      }).rows).toEqual([{
        model: "openai/gpt-5.6-sol",
        trace_count: 1,
        pass_rate: 0,
        checkpoint_rate: 0.75,
        avg_tool_calls: 1
      }])
      store.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
