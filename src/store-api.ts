import type {
  AtifTrajectory,
  DatasetManifest,
  QueryResult,
  TraceQuery,
  TraceSummary,
  TraceView,
  ViewCell
} from "./contracts.ts"

export interface PutDatasetOptions {
  readonly name: string
  readonly source: DatasetManifest["source"]
  readonly traces: ReadonlyArray<unknown>
}

export interface PutViewOptions {
  readonly dataset_id: string
  readonly title: string
  readonly description?: string
  readonly cells: ReadonlyArray<ViewCell>
}

type Awaitable<T> = T | Promise<T>

export interface TraceStoreApi {
  putDataset(options: PutDatasetOptions): Awaitable<DatasetManifest>
  listDatasets(): Awaitable<ReadonlyArray<DatasetManifest>>
  getDataset(datasetId: string): Awaitable<DatasetManifest | undefined>
  listTraceSummaries(datasetId: string): Awaitable<ReadonlyArray<TraceSummary>>
  getTraceSummary(datasetId: string, traceId: string): Awaitable<TraceSummary | undefined>
  getTrace(datasetId: string, traceId: string): Awaitable<AtifTrajectory | undefined>
  query(query: TraceQuery): Awaitable<QueryResult>
  putView(options: PutViewOptions): Awaitable<TraceView>
  getView(viewId: string): Awaitable<TraceView | undefined>
  listViews(datasetId?: string): Awaitable<ReadonlyArray<TraceView>>
  shareSecret(): Awaitable<string>
  policyTraceSample(viewId: string): Awaitable<ReadonlySet<string>>
}
