import { readFile } from "node:fs/promises"
import { basename, extname } from "node:path"
import { ATIF_VERSION, TRACE_METADATA_VERSION, type AtifTrajectory } from "../contracts.ts"
import { contentHash } from "../canonical.ts"
import { behaviorOf, recordOf, stringOf } from "./common.ts"
import { convertBraintrust } from "./braintrust.ts"
import { convertLangfuse } from "./langfuse.ts"
import { convertLetta } from "./letta.ts"
import { convertOtel, convertTardigradeSpans } from "./otel.ts"

export interface ImportedTraceFile {
  readonly name: string
  readonly source: { readonly kind: string; readonly id: string; readonly sha256: string }
  readonly traces: ReadonlyArray<AtifTrajectory>
}

const normalizeAtif = (value: unknown, sourceId: string): AtifTrajectory | undefined => {
  const root = recordOf(value)
  if (typeof root?.schema_version !== "string" || !root.schema_version.startsWith("ATIF-v1.")) return undefined
  if (!Array.isArray(root.steps)) return undefined
  const agent = recordOf(root.agent)
  if (typeof agent?.name !== "string" || typeof agent.version !== "string") return undefined
  const extra = recordOf(root.extra) ?? {}
  const clavia = recordOf(extra.clavia)
  const status = stringOf(recordOf(clavia?.outcome)?.status) ?? "completed"
  const traceId = stringOf(root.trajectory_id) ?? `atif:${contentHash(value).slice(0, 24)}`
  return {
    ...root,
    schema_version: ATIF_VERSION,
    trajectory_id: traceId,
    agent,
    steps: root.steps,
    extra: {
      ...extra,
      clavia: clavia?.schema_version === TRACE_METADATA_VERSION
        ? clavia
        : {
            schema_version: TRACE_METADATA_VERSION,
            title: stringOf(root.notes) ?? `ATIF trace ${traceId}`,
            source: { kind: "atif", id: sourceId },
            outcome: { status },
            behavior: behaviorOf(root.steps as AtifTrajectory["steps"], status)
          }
    }
  } as unknown as AtifTrajectory
}

const parse = (text: string, extension: string) => {
  if (extension !== ".jsonl" && extension !== ".ndjson") return JSON.parse(text) as unknown
  return text.split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as unknown)
}

const arrayHas = (value: unknown, field: string) =>
  Array.isArray(value) && value.some((entry) => recordOf(entry)?.[field] !== undefined)

export const importTraceText = (
  text: string,
  name: string
): ImportedTraceFile => {
  const sha = contentHash(text)
  const value = parse(text, extname(name).toLowerCase())
  const direct = normalizeAtif(value, sha)
  let traces: ReadonlyArray<AtifTrajectory>
  let kind: string
  if (direct !== undefined) {
    traces = [direct]
    kind = "atif"
  } else if (Array.isArray(value) && value.every((entry) => normalizeAtif(entry, sha) !== undefined)) {
    traces = value.map((entry) => normalizeAtif(entry, sha)!)
    kind = "atif"
  } else if (recordOf(value)?.resourceSpans !== undefined) {
    traces = convertOtel(value)
    kind = "otel"
  } else if (arrayHas(value, "TraceId") && arrayHas(value, "SpanName")) {
    traces = convertTardigradeSpans(value)
    kind = "otel"
  } else if (arrayHas(value, "span_attributes") || arrayHas(value, "root_span_id")) {
    traces = convertBraintrust(value)
    kind = "braintrust"
  } else if (arrayHas(value, "trace_id") && arrayHas(value, "type")) {
    traces = convertLangfuse(value)
    kind = "langfuse"
  } else if ((Array.isArray(value) && arrayHas(value, "role")) || Array.isArray(recordOf(value)?.records)) {
    traces = convertLetta(value)
    kind = "letta"
  } else {
    throw new TypeError(`unsupported trace file: ${name}`)
  }
  if (traces.length === 0) throw new TypeError(`trace file contains no trajectories: ${name}`)
  return {
    name: basename(name),
    source: { kind, id: sha, sha256: sha },
    traces
  }
}

export const importTraceFile = async (path: string): Promise<ImportedTraceFile> =>
  importTraceText(await readFile(path, "utf8"), path)
