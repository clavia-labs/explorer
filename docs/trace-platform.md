# Trace platform

The trace platform turns agent run records into immutable review datasets. It supports aggregate analysis, hierarchical activity drill-down, and an optional linear record for each trajectory. This repository contains the executable package.

## Product boundary

The first adapter reads Legal Benchmarks candidate archives under `benchmark/build/pull`. The first review workflow compares candidate behavior, strict task outcomes, pooled checkpoints, usefulness, tool use, and individual actions.

The service stores imported traces and answers questions about them. It does not host agents or run model inference. Agents can use the same query and drill-down surface through MCP.

## Canonical trajectory

The canonical storage form is the [Agent Trajectory Interchange Format v1.7](../spec/atif-v1.7.schema.json). This profile requires `trajectory_id` and `extra.clavia` because the store needs stable identity and review metadata.

One ATIF step represents at most one model inference. A deterministic dispatch uses `llm_call_count: 0` and carries no model metrics or reasoning. Each tool result uses `source_call_id` to name its tool call.

The Clavia extension records source identity, task identity, outcome, derived behavior, duration, stored checkpoint evidence, artifacts, and provider metadata. Behavior labels describe recurring action patterns. They do not set expected conduct.

The public contracts are:

- [ATIF v1.7 storage profile](../spec/atif-v1.7.schema.json)
- [Immutable dataset v1](../spec/dataset-v1.schema.json)
- [Trace query v1](../spec/query-v1.schema.json)
- [Analysis view v1](../spec/view-v1.schema.json)
- [Trace activity tree v1](../spec/activity-v1.schema.json)
- [Analysis export v1](../spec/analysis-export-v1.schema.json)

The MCP `get_trace` tool returns the deterministic activity tree by default. Use the compact format for a short action stream. Use full ATIF when replay detail matters.

## Hierarchical activity

The activity tree is a deterministic projection of one redacted ATIF trajectory. The API applies the active share policy before it derives the tree.

The hierarchy has four levels:

- The trajectory root summarizes the complete run.
- A phase groups contiguous work with one purpose, such as investigation, change, verification, or recovery.
- A turn represents one ATIF step and summarizes its action, tools, status, and timing.
- A leaf references the exact ATIF step and optional tool call that contains the raw evidence.

Each phase maps to one Agent Behavior dimension: intent, evidence, decision, execution, recovery, or outcome. A phase holds at most 12 contiguous turns. Longer work becomes numbered passes so the first view stays bounded.

Phase, turn, and leaf identifiers are stable for one stored trajectory. Every leaf keeps a `step_id` and optional `tool_call_id`, so a reviewer can verify the summary against the canonical record.

The trace reader starts with collapsed phases and a phase ribbon. A reviewer can search semantic labels, open all turns, focus one subtree, or switch to the linear record. The step endpoint loads raw messages, reasoning, arguments, and results only after the reviewer opens a turn.

## Import paths

| Source | Accepted input | Conversion rule |
|---|---|---|
| Legal Benchmarks | Pulled model column archives | Candidate events, provider traces, tool traces, results, and judge records become one ATIF trajectory per cell. |
| ATIF | JSON object or array | The importer normalizes an ATIF v1.x input to the v1.7 storage profile and adds Clavia metadata when needed. |
| OpenTelemetry | OTLP JSON | Spans are grouped by trace ID. GenAI message, usage, model, and tool attributes become ATIF steps. |
| Tardigrade | `fileTelemetry` NDJSON | Span hierarchy, status, duration, action names, call IDs, and safe structural attributes become ATIF steps. |
| Braintrust | JSON export rows | Root span fields, input, output, metadata, scores, and metrics become trajectories. |
| Langfuse | Observation export rows | Observations are grouped by `trace_id` and ordered by start time. |
| Letta | Compact trajectory JSON | User, reasoning, assistant, and tool records become ATIF steps. |

Converters are offline TypeScript modules under `src/importers`. They need no service credential.

## Immutable datasets

The store writes each canonical trajectory as a content-addressed object. A dataset manifest lists sorted trace IDs and object hashes. The manifest identity produces the `dataset_id` and `object_sha256`.

Importing the same name, source, and trace objects returns the existing dataset. Any trace content change produces a new dataset ID. The SQLite store uses WAL mode and keeps datasets, summaries, views, and share secrets in one file.

Generated stores and imported datasets belong under `build/`. They are local artifacts and must not enter Git.

## Query contract

`POST /v1/query` accepts equality, inequality, and set filters. It can group by model, agent, source, task, work type, status, strict pass, alignment, behavior, or tool name.

The metrics are trace count, strict pass rate, pooled checkpoint rate, average usefulness, average cost, average duration, average tool calls, and average prompt or completion tokens. Checkpoint rate pools passed and total checkpoints before division.

The query engine reads stored summaries and performs no model call. Results are deterministic for one dataset ID and query.

## Analysis export

`GET /v1/datasets/:id/analysis-export` returns one deterministic JSON page for internal analysis. The page contains normalized `traces`, `steps`, `tool_calls`, `observations`, `checkpoint_results`, and `artifacts` tables. Each evidence row keeps its dataset ID and trace ID.

The trace table includes a path to the complete canonical trajectory. The other tables preserve messages, reasoning, structured tool arguments, tool results, recorded checkpoint rationales, and artifact references. This gives a notebook enough context to build a question-specific corpus and link any derived claim back to source evidence.

The `checkpoint_results` table reports stored scorer output. A shared checkpoint ID is a rubric grouping. It is not a semantic failure cluster and does not imply validation by a practicing legal expert.

The endpoint requires internal access and does not accept a share token. `trace_offset` selects the first trace and `trace_limit` selects up to 20 traces. The response includes `next_trace_offset` when another page exists. The response ETag combines the immutable dataset object hash with the page bounds. Hex setup and table use are defined in [Hex integration](hex.md).

## Views and sharing

A view is a content-addressed set of Markdown, chart, and trace-list cells over one dataset. A signed link displays these cells as a report before the reader opens a selected trace.

The default Legal Benchmarks view compares models, execution patterns, tool use, and representative trajectories. A custom view can combine a written result with query-backed charts and selected trace samples.

The Share action creates and copies an internal-partner link. The server selects the `partner-review` policy. Callers provide a view ID and an optional expiry.

| Capability | Internal partner |
|---|---|
| Aggregate analysis | Yes |
| Visible traces | All traces in the dataset |
| Task and message content | Yes |
| Reasoning | Yes |
| Tool names | Yes |
| Tool arguments and results | Yes |
| Checkpoint verdicts | Yes |
| Failure justifications | Withheld by the server |
| Artifact references | Yes |

Redaction runs on the server before the trace leaves the API. The browser never receives fields that the policy withholds.

## API and MCP

The HTTP API exposes session context, datasets, normalized analysis exports, trace summaries, trace drill-down, activity trees, individual steps, queries, views, shares, and file import under `/v1`.

The MCP server mirrors the store operations through `list_datasets`, `get_dataset`, `get_analysis_table`, `get_trace`, `query_traces`, `create_view`, and `share_view`. It runs over stdio for local clients and Streamable HTTP at `/mcp` for hosted clients. `get_analysis_table` pages through the same normalized analysis contract used by Hex notebooks.

## Tardigrade telemetry

Legal Benchmarks candidate turns write `otel-spans.ndjson` beside each local attempt. World generation and seed extraction write the same file name under their runtime directory. These files use Tardigrade `fileTelemetry` and can enter the trace importer directly.

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to send spans through Tardigrade's OTLP JSON exporter. `OTEL_EXPORTER_OTLP_HEADERS` accepts the standard comma-separated `key=value` form. `OTEL_SERVICE_NAME` can replace the default service name.

The OTLP endpoint takes precedence over local file output. Span attributes carry structural action data, timing, status, action names, call IDs, and turn IDs. Task content, tool arguments, tool results, and credentials stay out of span attributes.

The SQLite runtime stamps W3C `traceparent` context on cross-lane events. A receiving transition links to that context, so one run remains connected across parent and child actors.

## Standards

ATIF is the full-fidelity interchange and replay contract. The compact MCP projection follows the [Letta trajectory format](https://www.letta.com/blog/trajectory/) for efficient agent reading. The canonical schema follows the [Harbor ATIF RFC](https://github.com/harbor-framework/harbor/blob/main/rfcs/0001-trajectory-format.md).

Behavior summaries follow the descriptive aim of [Agent Behavior](https://www.agentbehavior.dev/): make recurring conduct easy to name and compare. A stored trace remains the evidence for what happened.
