import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, resolve } from "node:path"
import { contentHash } from "../canonical.ts"
import type { AtifTrajectory, DatasetManifest } from "../contracts.ts"
import { convertLegalBenchCell } from "./legalbench.ts"

interface LegalBenchPullOptions {
  readonly models?: ReadonlyArray<string>
  readonly limit?: number
  readonly onProgress?: (message: string) => void
}

export interface ImportedLegalBenchPull {
  readonly name: string
  readonly source: DatasetManifest["source"]
  readonly traces: ReadonlyArray<AtifTrajectory>
}

const json = async (path: string) => JSON.parse(await readFile(path, "utf8")) as Readonly<Record<string, unknown>>

const optionalJson = async (path: string) => {
  try { return await json(path) } catch { return undefined }
}

const run = async (command: ReadonlyArray<string>) => {
  const process = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" })
  const [code, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()])
  if (code !== 0) throw new Error(`${command[0]} failed: ${stderr.trim()}`)
  return new Response(process.stdout).text()
}

const rootOfArchive = async (path: string) => {
  const listing = await run(["tar", "-tzf", path])
  const first = listing.split("\n").find((line) => line.includes("/candidate/"))
  if (first === undefined) throw new TypeError(`archive has no candidate directory: ${path}`)
  return first.split("/")[0]!
}

const readExtracted = async (
  root: string,
  model: string,
  remaining: number
): Promise<ReadonlyArray<AtifTrajectory>> => {
  const candidateRoot = resolve(root, "candidate", model)
  const gradingRoot = resolve(root, "grading", model)
  const tasks = (await readdir(candidateRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(left) - Number(right))
    .slice(0, remaining)
  const traces = await Promise.all(tasks.map(async (taskId) => {
    const attempt = resolve(candidateRoot, taskId, "attempt-001")
    const [result, events, providerTrace, toolTrace, reliability, usefulnessSol, usefulnessSonnet] = await Promise.all([
      optionalJson(resolve(attempt, "result.json")),
      optionalJson(resolve(attempt, "events.json")),
      optionalJson(resolve(attempt, "provider-trace.json")),
      optionalJson(resolve(attempt, "tool-trace.json")),
      optionalJson(resolve(gradingRoot, taskId, "reliability-sol.json")),
      optionalJson(resolve(gradingRoot, taskId, "usefulness-sol.json")),
      optionalJson(resolve(gradingRoot, taskId, "usefulness-sonnet-5.json"))
    ])
    if (result === undefined || !Array.isArray(events)) return undefined
    return convertLegalBenchCell({
      result,
      events,
      ...(Array.isArray(providerTrace) ? { providerTrace } : {}),
      ...(Array.isArray(toolTrace) ? { toolTrace } : {}),
      ...(reliability === undefined ? {} : { reliability }),
      usefulness: [usefulnessSol, usefulnessSonnet].filter(
        (entry): entry is Readonly<Record<string, unknown>> => entry !== undefined
      )
    })
  }))
  return traces.filter((trace): trace is AtifTrajectory => trace !== undefined)
}

export const importLegalBenchPull = async (
  pullRoot: string,
  options: LegalBenchPullOptions = {}
): Promise<ImportedLegalBenchPull> => {
  const columnsRoot = resolve(pullRoot, "columns")
  const selected = options.models === undefined ? undefined : new Set(options.models)
  const archives = (await readdir(columnsRoot))
    .filter((entry) => entry.endsWith(".tar.gz"))
    .sort()
    .filter((entry) => selected === undefined || [...selected].some((model) => entry.endsWith(`-${model}.tar.gz`)))
  if (archives.length === 0) throw new TypeError(`no selected LegalBench column archive exists under ${columnsRoot}`)
  const traces: Array<AtifTrajectory> = []
  for (const entry of archives) {
    if (traces.length >= (options.limit ?? Number.POSITIVE_INFINITY)) break
    const archive = resolve(columnsRoot, entry)
    const archiveRoot = await rootOfArchive(archive)
    const model = (await run(["tar", "-tzf", archive]))
      .split("\n")
      .map((path) => path.match(/\/candidate\/([^/]+)\/$/)?.[1])
      .find((value) => value !== undefined)
    if (model === undefined) throw new TypeError(`cannot identify the model in ${entry}`)
    options.onProgress?.(`Converting ${model}`)
    const staging = await mkdtemp(resolve(tmpdir(), "clavia-legalbench-"))
    try {
      await run([
        "tar", "-xzf", archive,
        "-C", staging,
        "--strip-components", "1",
        "--exclude", "*/artifacts/*",
        "--exclude", "*/diagnostics/*",
        `${archiveRoot}/candidate`,
        `${archiveRoot}/grading`
      ])
      const remaining = Math.max(0, (options.limit ?? Number.POSITIVE_INFINITY) - traces.length)
      traces.push(...await readExtracted(staging, model, remaining))
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }
  const manifestText = await readFile(resolve(pullRoot, "manifest.json"), "utf8").catch(() => "{}")
  const manifest = JSON.parse(manifestText) as Readonly<Record<string, unknown>>
  const dated = manifestText.match(/benchmark-runs\/(\d{4}-\d{2}-\d{2})\//)?.[1]
  const sourceHash = contentHash(manifest)
  return {
    name: dated === undefined ? "LegalBench trace archive" : `LegalBench ${dated}`,
    source: { kind: "legalbench-archive", id: stringValue(manifest.runPrefix) ?? basename(pullRoot), sha256: sourceHash },
    traces
  }
}

const stringValue = (value: unknown) => typeof value === "string" ? value : undefined
