import { AjvJsonSchemaValidator } from "@modelcontextprotocol/server/validators/ajv"
import type { JsonSchemaType } from "@modelcontextprotocol/server"
import { describe, expect, test } from "bun:test"
import schema from "../spec/analysis-export-v1.schema.json"
import { createAnalysisExport } from "./analysis-export.ts"
import valid from "./fixtures/atif-valid.json"
import { TraceStore } from "./store.ts"

describe("analysis export", () => {
  test("matches the public schema and is stable for one dataset", async () => {
    const store = new TraceStore(":memory:")
    try {
      const dataset = store.putDataset({ name: "Fixture", source: { kind: "fixture", id: "one" }, traces: [valid] })
      const first = await createAnalysisExport(store, dataset.dataset_id)
      const second = await createAnalysisExport(store, dataset.dataset_id)
      expect(second).toEqual(first)

      const validate = new AjvJsonSchemaValidator().getValidator(schema as JsonSchemaType)
      const result = validate(first)
      expect(result.valid).toBeTrue()
      expect(result.errorMessage).toBeUndefined()
    } finally {
      store.close()
    }
  })
})
