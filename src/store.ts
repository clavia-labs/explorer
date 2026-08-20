import { randomBytes } from "node:crypto"
import { dirname } from "node:path"
import { mkdirSync } from "node:fs"
import { Database } from "bun:sqlite"
import {
  DATASET_VERSION,
  VIEW_VERSION,
  ContractError,
  validateTrajectory,
  type AtifTrajectory,
  type DatasetManifest,
  type SharePolicy,
  type TraceQuery,
  type TraceFailureEvidence,
  type TraceSummary,
  type TraceView
} from "./contracts.ts"
import { canonicalJSON, contentHash } from "./canonical.ts"
import { querySummaries } from "./query.ts"
import type { PutDatasetOptions, PutViewOptions, TraceStoreApi } from "./store-api.ts"
import { summarizeTrace } from "./summary.ts"

const schema = `
CREATE TABLE IF NOT EXISTS objects (
  object_sha256 TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS datasets (
  dataset_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  object_sha256 TEXT NOT NULL,
  manifest_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dataset_traces (
  dataset_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  object_sha256 TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  PRIMARY KEY (dataset_id, trace_id),
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
);
CREATE TABLE IF NOT EXISTS views (
  view_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  object_sha256 TEXT NOT NULL,
  view_json TEXT NOT NULL,
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export class TraceStore implements TraceStoreApi {
  readonly #database: Database

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.#database = new Database(path, { create: true, strict: true })
    this.#database.run("PRAGMA journal_mode = WAL")
    this.#database.run("PRAGMA foreign_keys = ON")
    this.#database.run(schema)
  }

  close() {
    this.#database.close()
  }

  putDataset(options: PutDatasetOptions): DatasetManifest {
    const traces = options.traces.map(validateTrajectory)
    const ids = new Set<string>()
    for (const trace of traces) {
      if (ids.has(trace.trajectory_id)) {
        throw new ContractError("DATASET_TRACE_ID", `dataset repeats trace ${trace.trajectory_id}`)
      }
      ids.add(trace.trajectory_id)
    }
    const objects = traces
      .map((trace) => ({
        trace,
        trace_id: trace.trajectory_id,
        object_sha256: contentHash(trace)
      }))
      .sort((left, right) => left.trace_id.localeCompare(right.trace_id))
    const identity = {
      schema_version: DATASET_VERSION,
      name: options.name,
      source: options.source,
      traces: objects.map(({ trace_id, object_sha256 }) => ({ trace_id, object_sha256 }))
    }
    const objectSha256 = contentHash(identity)
    const datasetId = `ds_${objectSha256.slice(0, 24)}`
    const held = this.getDataset(datasetId)
    if (held !== undefined) return held
    const manifest: DatasetManifest = {
      ...identity,
      dataset_id: datasetId,
      created_at: new Date().toISOString(),
      object_sha256: objectSha256
    }
    const insertObject = this.#database.query(
      "INSERT OR IGNORE INTO objects(object_sha256, kind, payload_json) VALUES (?, 'trajectory', ?)"
    )
    const insertTrace = this.#database.query(
      "INSERT INTO dataset_traces(dataset_id, trace_id, object_sha256, summary_json) VALUES (?, ?, ?, ?)"
    )
    const transaction = this.#database.transaction(() => {
      this.#database.query(
        "INSERT INTO datasets(dataset_id, name, created_at, object_sha256, manifest_json) VALUES (?, ?, ?, ?, ?)"
      ).run(datasetId, manifest.name, manifest.created_at, objectSha256, canonicalJSON(manifest))
      for (const object of objects) {
        insertObject.run(object.object_sha256, canonicalJSON(object.trace))
        insertTrace.run(
          datasetId,
          object.trace_id,
          object.object_sha256,
          canonicalJSON(summarizeTrace(object.trace))
        )
      }
    })
    transaction.immediate()
    return manifest
  }

  listDatasets(): ReadonlyArray<DatasetManifest> {
    return this.#database
      .query<{ manifest_json: string }, []>(
        "SELECT manifest_json FROM datasets ORDER BY created_at DESC, dataset_id"
      )
      .all()
      .map((row) => JSON.parse(row.manifest_json) as DatasetManifest)
  }

  getDataset(datasetId: string): DatasetManifest | undefined {
    const row = this.#database
      .query<{ manifest_json: string }, [string]>(
        "SELECT manifest_json FROM datasets WHERE dataset_id = ?"
      )
      .get(datasetId)
    return row === null ? undefined : JSON.parse(row.manifest_json) as DatasetManifest
  }

  listTraceSummaries(datasetId: string): ReadonlyArray<TraceSummary> {
    if (this.getDataset(datasetId) === undefined) {
      throw new ContractError("DATASET_MISSING", `dataset ${datasetId} does not exist`)
    }
    return this.#database
      .query<{ summary_json: string }, [string]>(
        "SELECT summary_json FROM dataset_traces WHERE dataset_id = ? ORDER BY trace_id"
      )
      .all(datasetId)
      .map((row) => JSON.parse(row.summary_json) as TraceSummary)
  }

  getTraceSummary(datasetId: string, traceId: string): TraceSummary | undefined {
    const row = this.#database
      .query<{ summary_json: string }, [string, string]>(
        "SELECT summary_json FROM dataset_traces WHERE dataset_id = ? AND trace_id = ?"
      )
      .get(datasetId, traceId)
    return row === null ? undefined : JSON.parse(row.summary_json) as TraceSummary
  }

  getTrace(datasetId: string, traceId: string): AtifTrajectory | undefined {
    const row = this.#database
      .query<{ payload_json: string }, [string, string]>(
        `SELECT objects.payload_json
           FROM dataset_traces
           JOIN objects USING (object_sha256)
          WHERE dataset_traces.dataset_id = ? AND dataset_traces.trace_id = ?`
      )
      .get(datasetId, traceId)
    return row === null ? undefined : JSON.parse(row.payload_json) as AtifTrajectory
  }

  listFailureEvidence(datasetId: string): ReadonlyArray<TraceFailureEvidence> {
    if (this.getDataset(datasetId) === undefined) {
      throw new ContractError("DATASET_MISSING", `dataset ${datasetId} does not exist`)
    }
    return this.#database
      .query<{ summary_json: string; failure_modes_json: string | null }, [string]>(
        `SELECT dataset_traces.summary_json,
                json_extract(objects.payload_json, '$.extra.clavia.failure_modes') AS failure_modes_json
           FROM dataset_traces
           JOIN objects USING (object_sha256)
          WHERE dataset_traces.dataset_id = ?
          ORDER BY dataset_traces.trace_id`
      )
      .all(datasetId)
      .map((row) => ({
        summary: JSON.parse(row.summary_json) as TraceSummary,
        failure_modes: row.failure_modes_json === null ? [] : JSON.parse(row.failure_modes_json)
      }))
  }

  query(query: TraceQuery) {
    return querySummaries(query, this.listTraceSummaries(query.dataset_id))
  }

  putView(options: PutViewOptions): TraceView {
    if (this.getDataset(options.dataset_id) === undefined) {
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
    const held = this.getView(viewId)
    if (held !== undefined) return held
    const view: TraceView = {
      ...identity,
      view_id: viewId,
      created_at: new Date().toISOString(),
      object_sha256: objectSha256
    }
    this.#database.query(
      "INSERT INTO views(view_id, dataset_id, object_sha256, view_json) VALUES (?, ?, ?, ?)"
    ).run(viewId, options.dataset_id, objectSha256, canonicalJSON(view))
    return view
  }

  getView(viewId: string): TraceView | undefined {
    const row = this.#database
      .query<{ view_json: string }, [string]>("SELECT view_json FROM views WHERE view_id = ?")
      .get(viewId)
    return row === null ? undefined : JSON.parse(row.view_json) as TraceView
  }

  listViews(datasetId?: string): ReadonlyArray<TraceView> {
    const rows = datasetId === undefined
      ? this.#database.query<{ view_json: string }, []>("SELECT view_json FROM views ORDER BY view_id").all()
      : this.#database.query<{ view_json: string }, [string]>(
          "SELECT view_json FROM views WHERE dataset_id = ? ORDER BY view_id"
        ).all(datasetId)
    return rows.map((row) => JSON.parse(row.view_json) as TraceView)
  }

  shareSecret() {
    const held = this.#database
      .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
      .get("share_secret")
    if (held !== null) return held.value
    const value = Buffer.from(randomBytes(32)).toString("hex")
    this.#database.query("INSERT INTO settings(key, value) VALUES ('share_secret', ?)").run(value)
    return value
  }

  datasetForView(viewId: string) {
    return this.getView(viewId)?.dataset_id
  }

  hasTrace(datasetId: string, traceId: string) {
    return this.getTrace(datasetId, traceId) !== undefined
  }

  policyTraceSample(viewId: string): ReadonlySet<string> {
    const view = this.getView(viewId)
    if (view === undefined) return new Set()
    return new Set(view.cells.flatMap((cell) =>
      cell.kind === "trace-list" ? cell.sample_trace_ids ?? [] : []
    ))
  }

  static policyNames(): ReadonlyArray<SharePolicy> {
    return ["partner-review", "lab-prospect"]
  }
}
