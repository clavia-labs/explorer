import { resolve } from "node:path"
import { importTraceFile } from "./importers/file.ts"
import { importLegalBenchPull } from "./importers/legalbench-archive.ts"
import { TraceStore } from "./store.ts"
import { createDefaultView } from "./views.ts"

const usage = `Usage:
  bun run src/cli.ts import legalbench <benchmark/build/pull> [--store path] [--models a,b] [--limit n]
  bun run src/cli.ts import file <trace.json|jsonl> [--store path] [--name dataset-name]`

const argument = (name: string) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const storePath = resolve(argument("--store") ?? resolve(import.meta.dir, "../build/trace.sqlite"))
const command = process.argv[2]
const kind = process.argv[3]
const sourcePath = process.argv[4]

if (command !== "import" || sourcePath === undefined || (kind !== "legalbench" && kind !== "file")) {
  console.error(usage)
  process.exitCode = 2
} else {
  const store = new TraceStore(storePath)
  try {
    const models = argument("--models")
    const imported = kind === "legalbench"
      ? await importLegalBenchPull(resolve(sourcePath), {
          ...(models === undefined
            ? {}
            : { models: models.split(",").map((value: string) => value.trim()).filter(Boolean) }),
          ...(argument("--limit") === undefined ? {} : { limit: Number(argument("--limit")) }),
          onProgress: (message) => console.error(message)
        })
      : await importTraceFile(resolve(sourcePath))
    const dataset = store.putDataset({
      name: argument("--name") ?? imported.name,
      source: imported.source,
      traces: imported.traces
    })
    const view = await createDefaultView(store, dataset)
    console.log(JSON.stringify({
      store: storePath,
      dataset_id: dataset.dataset_id,
      view_id: view.view_id,
      traces: dataset.traces.length,
      object_sha256: dataset.object_sha256
    }, null, 2))
  } finally {
    store.close()
  }
}
