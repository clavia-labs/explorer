import {
  DATASET_VERSION,
  VIEW_VERSION,
  ContractError,
  validateTrajectory,
  type AtifTrajectory,
  type DatasetManifest,
  type TraceQuery,
  type TraceFailureEvidence,
  type TraceSummary,
  type TraceView
} from "./contracts.ts"
import { canonicalJSON, contentHash } from "./canonical.ts"
import { querySummaries } from "./query.ts"
import type { PutDatasetOptions, PutViewOptions, TraceStoreApi } from "./store-api.ts"
import { summarizeTrace } from "./summary.ts"

const parse = <Value>(value: string) => JSON.parse(value) as Value

const chunks = <Value>(values: ReadonlyArray<Value>, size: number) => {
  const result: Array<ReadonlyArray<Value>> = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

export class D1TraceStore implements TraceStoreApi {
  constructor(
    private readonly database: D1Database,
    private readonly secret: string
  ) {}

  async putDataset(options: PutDatasetOptions) {
    const traces = options.traces.map(validateTrajectory)
    const ids = new Set<string>()
    for (const trace of traces) {
      if (ids.has(trace.trajectory_id)) {
        throw new ContractError("DATASET_TRACE_ID", `dataset repeats trace ${trace.trajectory_id}`)
      }
      ids.add(trace.trajectory_id)
    }
    const objects = traces
      .map((trace) => ({ trace, trace_id: trace.trajectory_id, object_sha256: contentHash(trace) }))
      .sort((left, right) => left.trace_id.localeCompare(right.trace_id))
    const identity = {
      schema_version: DATASET_VERSION,
      name: options.name,
      source: options.source,
      traces: objects.map(({ trace_id, object_sha256 }) => ({ trace_id, object_sha256 }))
    }
    const objectSha256 = contentHash(identity)
    const datasetId = `ds_${objectSha256.slice(0, 24)}`
    const held = await this.getDataset(datasetId)
    if (held !== undefined) return held
    const manifest: DatasetManifest = {
      ...identity,
      dataset_id: datasetId,
      created_at: new Date().toISOString(),
      object_sha256: objectSha256
    }
    await this.database.prepare(
      "INSERT INTO datasets(dataset_id, name, created_at, object_sha256, manifest_json) VALUES (?, ?, ?, ?, ?)"
    ).bind(datasetId, manifest.name, manifest.created_at, objectSha256, canonicalJSON(manifest)).run()
    try {
      for (const group of chunks(objects, 40)) {
        const statements = group.flatMap((object) => [
          this.database.prepare(
            "INSERT OR IGNORE INTO objects(object_sha256, kind, payload_json) VALUES (?, 'trajectory', ?)"
          ).bind(object.object_sha256, canonicalJSON(object.trace)),
          this.database.prepare(
            "INSERT INTO dataset_traces(dataset_id, trace_id, object_sha256, summary_json) VALUES (?, ?, ?, ?)"
          ).bind(datasetId, object.trace_id, object.object_sha256, canonicalJSON(summarizeTrace(object.trace)))
        ])
        await this.database.batch(statements)
      }
    } catch (error) {
      await this.database.prepare("DELETE FROM dataset_traces WHERE dataset_id = ?").bind(datasetId).run()
      await this.database.prepare("DELETE FROM datasets WHERE dataset_id = ?").bind(datasetId).run()
      throw error
    }
    return manifest
  }

  async listDatasets() {
    const rows = await this.database.prepare(
      "SELECT manifest_json FROM datasets ORDER BY created_at DESC, dataset_id"
    ).all<{ readonly manifest_json: string }>()
    return rows.results.map((row) => parse<DatasetManifest>(row.manifest_json))
  }

  async getDataset(datasetId: string) {
    const row = await this.database.prepare(
      "SELECT manifest_json FROM datasets WHERE dataset_id = ?"
    ).bind(datasetId).first<{ readonly manifest_json: string }>()
    return row === null ? undefined : parse<DatasetManifest>(row.manifest_json)
  }

  async listTraceSummaries(datasetId: string) {
    if (await this.getDataset(datasetId) === undefined) {
      throw new ContractError("DATASET_MISSING", `dataset ${datasetId} does not exist`)
    }
    const rows = await this.database.prepare(
      "SELECT summary_json FROM dataset_traces WHERE dataset_id = ? ORDER BY trace_id"
    ).bind(datasetId).all<{ readonly summary_json: string }>()
    return rows.results.map((row) => parse<TraceSummary>(row.summary_json))
  }

  async getTraceSummary(datasetId: string, traceId: string) {
    const row = await this.database.prepare(
      "SELECT summary_json FROM dataset_traces WHERE dataset_id = ? AND trace_id = ?"
    ).bind(datasetId, traceId).first<{ readonly summary_json: string }>()
    return row === null ? undefined : parse<TraceSummary>(row.summary_json)
  }

  async getTrace(datasetId: string, traceId: string) {
    const row = await this.database.prepare(
      `SELECT objects.payload_json
         FROM dataset_traces
         JOIN objects USING (object_sha256)
        WHERE dataset_traces.dataset_id = ? AND dataset_traces.trace_id = ?`
    ).bind(datasetId, traceId).first<{ readonly payload_json: string }>()
    return row === null ? undefined : parse<AtifTrajectory>(row.payload_json)
  }

  async listFailureEvidence(datasetId: string): Promise<ReadonlyArray<TraceFailureEvidence>> {
    if (await this.getDataset(datasetId) === undefined) {
      throw new ContractError("DATASET_MISSING", `dataset ${datasetId} does not exist`)
    }
    const rows = await this.database.prepare(
      `SELECT dataset_traces.summary_json,
              json_extract(objects.payload_json, '$.extra.clavia.failure_modes') AS failure_modes_json
         FROM dataset_traces
         JOIN objects USING (object_sha256)
        WHERE dataset_traces.dataset_id = ?
        ORDER BY dataset_traces.trace_id`
    ).bind(datasetId).all<{ readonly summary_json: string; readonly failure_modes_json: string | null }>()
    return rows.results.map((row) => ({
      summary: parse<TraceSummary>(row.summary_json),
      failure_modes: row.failure_modes_json === null ? [] : parse(row.failure_modes_json)
    }))
  }

  async query(query: TraceQuery) {
    return querySummaries(query, await this.listTraceSummaries(query.dataset_id))
  }

  async putView(options: PutViewOptions) {
    if (await this.getDataset(options.dataset_id) === undefined) {
      throw new ContractError("DATASET_MISSING", `dataset ${options.dataset_id} does not exist`)
    }
    const identity = {
      schema_version: VIEW_VERSION,
      dataset_id: options.dataset_id,
      title: options.title,
      ...(options.description === undefined ? {} : { description: options.description }),
      cells: options.cells
    }
    const objectSha256 = contentHash(identity)
    const viewId = `view_${objectSha256.slice(0, 24)}`
    const held = await this.getView(viewId)
    if (held !== undefined) return held
    const view: TraceView = {
      ...identity,
      view_id: viewId,
      created_at: new Date().toISOString(),
      object_sha256: objectSha256
    }
    await this.database.prepare(
      "INSERT INTO views(view_id, dataset_id, object_sha256, view_json) VALUES (?, ?, ?, ?)"
    ).bind(viewId, options.dataset_id, objectSha256, canonicalJSON(view)).run()
    return view
  }

  async getView(viewId: string) {
    const row = await this.database.prepare(
      "SELECT view_json FROM views WHERE view_id = ?"
    ).bind(viewId).first<{ readonly view_json: string }>()
    return row === null ? undefined : parse<TraceView>(row.view_json)
  }

  async listViews(datasetId?: string) {
    const query = datasetId === undefined
      ? this.database.prepare("SELECT view_json FROM views ORDER BY view_id")
      : this.database.prepare("SELECT view_json FROM views WHERE dataset_id = ? ORDER BY view_id").bind(datasetId)
    const rows = await query.all<{ readonly view_json: string }>()
    return rows.results.map((row) => parse<TraceView>(row.view_json))
  }

  shareSecret() {
    return this.secret
  }

  async policyTraceSample(viewId: string) {
    const view = await this.getView(viewId)
    if (view === undefined) return new Set<string>()
    return new Set(view.cells.flatMap((cell) =>
      cell.kind === "trace-list" ? cell.sample_trace_ids ?? [] : []
    ))
  }
}
