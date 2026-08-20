import {
  ContractError,
  type TraceQuery,
  type ViewCell
} from "./contracts.ts"
import { deriveTraceActivity } from "./activity.ts"
import { clusterFailureEvidence } from "./failure-analysis.ts"
import { importTraceText } from "./importers/file.ts"
import { policyCapabilities, redactTrace } from "./redaction.ts"
import { createShareToken, verifyShareToken, type ShareClaims } from "./share.ts"
import type { TraceStoreApi } from "./store-api.ts"
import { createDefaultView } from "./views.ts"

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
})

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined

const bodyOf = async (request: Request) => {
  try { return await request.json() as unknown } catch { throw new ContractError("REQUEST_JSON", "request body must be JSON") }
}

const shareTokenOf = (request: Request, url: URL) => {
  const query = url.searchParams.get("share")
  if (query !== null) return query
  const authorization = request.headers.get("authorization")
  return authorization?.startsWith("Share ") ? authorization.slice(6) : undefined
}

interface Access {
  readonly claims?: ShareClaims
  readonly viewId?: string
  readonly datasetId?: string
}

export const createApi = (store: TraceStoreApi) => {
  const secret = Promise.resolve(store.shareSecret())

  const accessOf = async (request: Request, url: URL): Promise<Access> => {
    const token = shareTokenOf(request, url)
    if (token === undefined) return {}
    const claims = verifyShareToken(token, await secret)
    const view = await store.getView(claims.view_id)
    if (view === undefined) throw new ContractError("SHARE_VIEW", "share view does not exist")
    return { claims, viewId: view.view_id, datasetId: view.dataset_id }
  }

  const internal = (access: Access) => {
    if (access.claims !== undefined) throw new ContractError("SHARE_READ_ONLY", "share access is read-only")
  }

  const datasetAccess = (access: Access, datasetId: string) => {
    if (access.datasetId !== undefined && access.datasetId !== datasetId) {
      throw new ContractError("SHARE_DATASET", "share access does not include this dataset")
    }
  }

  const traceAccess = async (access: Access, datasetId: string, traceId: string) => {
    datasetAccess(access, datasetId)
    if (access.claims?.policy === "lab-prospect" && access.viewId !== undefined) {
      if (!(await store.policyTraceSample(access.viewId)).has(traceId)) {
        throw new ContractError("SHARE_TRACE", "share access does not include this trace")
      }
    }
    const trace = await store.getTrace(datasetId, traceId)
    if (trace === undefined) throw new ContractError("TRACE_MISSING", "trace does not exist")
    return access.claims === undefined ? trace : redactTrace(trace, access.claims.policy)
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    try {
      const access = await accessOf(request, url)
      const policy = policyCapabilities(access.claims?.policy ?? "internal")

      if (request.method === "GET" && url.pathname === "/v1/session") {
        if (access.claims === undefined) {
          const [datasets, views] = await Promise.all([store.listDatasets(), store.listViews()])
          return json({ policy, datasets, views })
        }
        const [view, dataset] = await Promise.all([
          store.getView(access.claims.view_id),
          access.datasetId === undefined ? undefined : store.getDataset(access.datasetId)
        ])
        return json({
          policy,
          view,
          dataset
        })
      }

      if (request.method === "GET" && url.pathname === "/v1/datasets") {
        const datasets = access.datasetId === undefined
          ? await store.listDatasets()
          : [await store.getDataset(access.datasetId)].filter((item) => item !== undefined)
        return json({ policy, datasets })
      }

      const datasetMatch = url.pathname.match(/^\/v1\/datasets\/([^/]+)$/)
      if (request.method === "GET" && datasetMatch !== null) {
        const datasetId = decodeURIComponent(datasetMatch[1]!)
        datasetAccess(access, datasetId)
        const dataset = await store.getDataset(datasetId)
        return dataset === undefined ? json({ error: { code: "DATASET_MISSING" } }, 404) : json({ policy, dataset })
      }

      const summariesMatch = url.pathname.match(/^\/v1\/datasets\/([^/]+)\/traces$/)
      if (request.method === "GET" && summariesMatch !== null) {
        const datasetId = decodeURIComponent(summariesMatch[1]!)
        datasetAccess(access, datasetId)
        let traces = await store.listTraceSummaries(datasetId)
        if (access.claims?.policy === "lab-prospect" && access.viewId !== undefined) {
          const sample = await store.policyTraceSample(access.viewId)
          traces = traces.filter((trace) => sample.has(trace.trace_id))
        }
        return json({ policy, traces })
      }

      const failuresMatch = url.pathname.match(/^\/v1\/datasets\/([^/]+)\/failure-clusters$/)
      if (request.method === "GET" && failuresMatch !== null) {
        internal(access)
        const datasetId = decodeURIComponent(failuresMatch[1]!)
        datasetAccess(access, datasetId)
        return json({ policy, ...clusterFailureEvidence(datasetId, await store.listFailureEvidence(datasetId)) })
      }

      const activityMatch = url.pathname.match(/^\/v1\/traces\/([^/]+)\/activity$/)
      if (request.method === "GET" && activityMatch !== null) {
        const datasetId = url.searchParams.get("dataset_id")
        if (datasetId === null) throw new ContractError("TRACE_DATASET", "dataset_id is required")
        const traceId = decodeURIComponent(activityMatch[1]!)
        const trace = await traceAccess(access, datasetId, traceId)
        return json({ policy, activity: deriveTraceActivity(trace), metadata: trace.extra.clavia })
      }

      const summaryMatch = url.pathname.match(/^\/v1\/traces\/([^/]+)\/summary$/)
      if (request.method === "GET" && summaryMatch !== null) {
        const datasetId = url.searchParams.get("dataset_id")
        if (datasetId === null) throw new ContractError("TRACE_DATASET", "dataset_id is required")
        const traceId = decodeURIComponent(summaryMatch[1]!)
        await traceAccess(access, datasetId, traceId)
        const summary = await store.getTraceSummary(datasetId, traceId)
        return summary === undefined ? json({ error: { code: "TRACE_MISSING" } }, 404) : json({ policy, summary })
      }

      const stepMatch = url.pathname.match(/^\/v1\/traces\/([^/]+)\/steps\/([^/]+)$/)
      if (request.method === "GET" && stepMatch !== null) {
        const datasetId = url.searchParams.get("dataset_id")
        if (datasetId === null) throw new ContractError("TRACE_DATASET", "dataset_id is required")
        const traceId = decodeURIComponent(stepMatch[1]!)
        const stepId = Number(decodeURIComponent(stepMatch[2]!))
        if (!Number.isSafeInteger(stepId) || stepId < 1) throw new ContractError("STEP_ID", "step ID must be a positive integer")
        const trace = await traceAccess(access, datasetId, traceId)
        const step = trace.steps.find((candidate) => candidate.step_id === stepId)
        return step === undefined ? json({ error: { code: "STEP_MISSING" } }, 404) : json({ policy, step })
      }

      const traceMatch = url.pathname.match(/^\/v1\/traces\/([^/]+)$/)
      if (request.method === "GET" && traceMatch !== null) {
        const datasetId = url.searchParams.get("dataset_id")
        if (datasetId === null) throw new ContractError("TRACE_DATASET", "dataset_id is required")
        const traceId = decodeURIComponent(traceMatch[1]!)
        return json({ policy, trace: await traceAccess(access, datasetId, traceId) })
      }

      if (request.method === "POST" && url.pathname === "/v1/query") {
        const query = await bodyOf(request) as TraceQuery
        if (typeof query.dataset_id !== "string") throw new ContractError("QUERY_DATASET", "dataset_id is required")
        datasetAccess(access, query.dataset_id)
        return json({ policy, ...await store.query(query) })
      }

      if (request.method === "GET" && url.pathname === "/v1/views") {
        const requested = url.searchParams.get("dataset_id") ?? undefined
        if (requested !== undefined) datasetAccess(access, requested)
        const views = access.viewId === undefined
          ? await store.listViews(requested)
          : [await store.getView(access.viewId)].filter((view) => view !== undefined)
        return json({ policy, views })
      }

      const viewMatch = url.pathname.match(/^\/v1\/views\/([^/]+)$/)
      if (request.method === "GET" && viewMatch !== null) {
        const viewId = decodeURIComponent(viewMatch[1]!)
        if (access.viewId !== undefined && access.viewId !== viewId) {
          throw new ContractError("SHARE_VIEW", "share access does not include this view")
        }
        const view = await store.getView(viewId)
        return view === undefined ? json({ error: { code: "VIEW_MISSING" } }, 404) : json({ policy, view })
      }

      if (request.method === "POST" && url.pathname === "/v1/views") {
        internal(access)
        const body = recordOf(await bodyOf(request))
        if (typeof body?.dataset_id !== "string" || typeof body.title !== "string" || !Array.isArray(body.cells)) {
          throw new ContractError("VIEW_INPUT", "dataset_id, title, and cells are required")
        }
        const view = await store.putView({
          dataset_id: body.dataset_id,
          title: body.title,
          ...(typeof body.description !== "string" ? {} : { description: body.description }),
          cells: body.cells as ReadonlyArray<ViewCell>
        })
        return json({ view }, 201)
      }

      if (request.method === "POST" && url.pathname === "/v1/shares") {
        internal(access)
        const body = recordOf(await bodyOf(request))
        if (typeof body?.view_id !== "string") throw new ContractError("SHARE_INPUT", "view_id is required")
        if (await store.getView(body.view_id) === undefined) throw new ContractError("VIEW_MISSING", "view does not exist")
        const claims = {
          view_id: body.view_id,
          policy: "partner-review" as const,
          ...(typeof body.expires_at !== "string" ? {} : { expires_at: body.expires_at })
        }
        const token = createShareToken(claims, await secret)
        return json({ token, policy: claims.policy, url: `${url.origin}/share/${token}` }, 201)
      }

      if (request.method === "POST" && url.pathname === "/v1/import") {
        internal(access)
        let imported: ReturnType<typeof importTraceText>
        let requestedName: string | undefined
        if (request.headers.get("content-type")?.includes("multipart/form-data")) {
          const form = await request.formData()
          const file = form.get("file")
          if (!(file instanceof File)) throw new ContractError("IMPORT_FILE", "file is required")
          imported = importTraceText(await file.text(), file.name)
          const name = form.get("name")
          requestedName = typeof name === "string" && name.length > 0 ? name : undefined
        } else {
          const body = recordOf(await bodyOf(request))
          if (body === undefined || typeof body.name !== "string" || typeof body.content !== "string") {
            throw new ContractError("IMPORT_INPUT", "name and content are required")
          }
          imported = importTraceText(body.content, body.name)
          requestedName = typeof body.dataset_name === "string" ? body.dataset_name : undefined
        }
        const dataset = await store.putDataset({
          name: requestedName ?? imported.name,
          source: imported.source,
          traces: imported.traces
        })
        const view = await createDefaultView(store, dataset)
        return json({ dataset, view }, 201)
      }

      return json({ error: { code: "ROUTE_MISSING", message: "route does not exist" } }, 404)
    } catch (error) {
      if (error instanceof ContractError) {
        const forbidden = error.code.startsWith("SHARE_")
        const missing = error.code.endsWith("_MISSING")
        return json({ error: { code: error.code, message: error.message } }, forbidden ? 403 : missing ? 404 : 400)
      }
      return json({
        error: {
          code: "INTERNAL",
          message: error instanceof Error ? error.message : "unknown error"
        }
      }, 500)
    }
  }
}
