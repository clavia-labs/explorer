# Clavia Explorer

Clavia Explorer stores, queries, reviews, and shares agent trajectories. See [Trace platform](docs/trace-platform.md) for the behavioral contract.

## Run locally

```sh
bun install --frozen-lockfile
bun run gate
bun run serve --store build/trace.sqlite --port 4321
```

Open `http://localhost:4321`.

## Import Legal Benchmarks

```sh
bun run import legalbench ./path/to/benchmark/build/pull --store build/trace.sqlite
```

Use `--models qwen-3-7-max,gpt-5-6-sol` to select model columns. Use `--limit 20` to stop after a fixed number of traces.

## Import a trace file

```sh
bun run import file ./path/to/traces.jsonl --store build/trace.sqlite --name "My run"
```

The file importer accepts ATIF, OTLP JSON, Tardigrade span NDJSON, Braintrust exports, Langfuse observation exports, and Letta compact trajectories.

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/session` | Read available datasets, views, and share policy. |
| `GET` | `/v1/datasets` | List immutable snapshots. |
| `GET` | `/v1/datasets/:id/traces` | List indexed trace summaries. |
| `GET` | `/v1/datasets/:id/analysis-export` | Read a trace-bounded page of normalized analysis tables. |
| `GET` | `/v1/traces/:id?dataset_id=:dataset` | Read one full or redacted trajectory. |
| `GET` | `/v1/traces/:id/summary?dataset_id=:dataset` | Read one indexed trace summary. |
| `GET` | `/v1/traces/:id/activity?dataset_id=:dataset` | Read the deterministic activity tree for one trajectory. |
| `GET` | `/v1/traces/:id/steps/:step?dataset_id=:dataset` | Read one full or redacted ATIF step. |
| `POST` | `/v1/query` | Group and measure traces. |
| `GET` or `POST` | `/v1/views` | List or create analysis views. |
| `POST` | `/v1/shares` | Create a signed internal-partner link. |
| `POST` | `/v1/import` | Import one supported trace file. |

## MCP

Run the stdio server with:

```sh
bun run mcp --store build/trace.sqlite
```

An MCP client can use this local configuration:

```json
{
  "command": "bun",
  "args": ["run", "/absolute/path/to/explorer/src/mcp.ts", "--store", "/absolute/path/to/explorer/build/trace.sqlite"]
}
```

The tools are `list_datasets`, `get_dataset`, `get_analysis_table`, `get_trace`, `query_traces`, `create_view`, and `share_view`. `get_analysis_table` returns a bounded page from a normalized table. `get_trace` returns the activity tree by default. Set its format to `compact` or `atif` when that detail is useful.

The hosted Streamable HTTP endpoint is `https://explorer.clavia.ai/mcp`. Send the Explorer access password as a Bearer token. The same endpoint can be configured as a Hex custom MCP External App when that feature is available in the workspace.

## Hex

The dependable Hex integration loads the immutable analysis export from a Python cell. See [Hex integration](docs/hex.md) and copy [the notebook loader](examples/hex_loader.py) into the project.

## Telemetry

Future Legal Benchmarks and Legalenv agent runs produce local Tardigrade span files automatically. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to route the same structural telemetry to an OTLP collector.

## Cloudflare

The production Worker serves the application assets, the `/v1` API, and the `/mcp` endpoint. A D1 database stores immutable datasets and views.

Apply the database migrations before the first deployment:

```sh
bunx --bun wrangler d1 migrations apply explorer --remote
```

Add the share-signing secret and Explorer access password through Wrangler. Then deploy the Worker:

```sh
bunx --bun wrangler secret put SHARE_SECRET
bunx --bun wrangler secret put EXPLORER_PASSWORD
bun run deploy
```

The Worker configuration assigns the custom domain `explorer.clavia.ai`. Cloudflare Builds uses `bun run gate` as its build command and `bun run deploy` as its deploy command.
