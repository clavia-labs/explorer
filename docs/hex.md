# Hex integration

Explorer is the source of truth for immutable trace datasets and trace evidence. Hex loads that data, runs question-specific analysis, and presents notebooks, charts, and reports.

## Supported connection paths

The notebook API path works in any editable Hex project that can make an HTTPS request. It is the default path for this MVP.

Hex also documents [custom MCP External Apps](https://learn.hex.tech/docs/api-integrations/external-apps) for some Team and Enterprise workspaces. Use `https://explorer.clavia.ai/mcp` as the server URL and select user-provided Bearer authentication. Use the Explorer access password as the token. If the workspace does not show custom External Apps, use the notebook API path.

The [Hex MCP server](https://learn.hex.tech/docs/api-integrations/mcp-server) at `https://app.hex.tech/mcp` serves a different direction. It lets an external MCP client ask Hex to search projects and run Threads. It does not load Explorer data into a Hex notebook.

## Notebook setup

Create a Hex project secret named `explorer_password`. Hex makes that secret available as the Python variable `explorer_password` and redacts it from displayed output.

Copy [the loader](../examples/hex_loader.py) into the first Python cell. Load one immutable snapshot in the next cell:

```python
explorer = load_explorer_dataset(
    base_url="https://explorer.clavia.ai",
    dataset_id="ds_replace_with_dataset_id",
    token=explorer_password,
)

traces = explorer.tables["traces"]
steps = explorer.tables["steps"]
tool_calls = explorer.tables["tool_calls"]
observations = explorer.tables["observations"]
checkpoint_results = explorer.tables["checkpoint_results"]
artifacts = explorer.tables["artifacts"]
```

Each export page records the dataset manifest, content hash, trace offset, and trace limit. The loader follows `next_trace_offset` and assembles every page. A repeated request for the same dataset ID and page returns the same stored evidence and table order.

Use a trace ID from any table to load the complete canonical run or its hierarchical activity view:

```python
trace_id = checkpoint_results.loc[0, "trace_id"]
trace = load_explorer_trace(
    "https://explorer.clavia.ai",
    explorer.manifest["dataset_id"],
    trace_id,
    explorer_password,
)
activity = load_explorer_activity(
    "https://explorer.clavia.ai",
    explorer.manifest["dataset_id"],
    trace_id,
    explorer_password,
)
```

## Table meanings

| Table | Unit | Main use |
|---|---|---|
| `traces` | One canonical trajectory | Model, task, outcome, behavior, cost, duration, and drill-down path. |
| `steps` | One ATIF step | Messages, reasoning, token use, and action sequence. |
| `tool_calls` | One tool call | Tool selection and structured arguments. |
| `observations` | One tool result | Returned evidence and subagent references. |
| `checkpoint_results` | One stored checkpoint verdict | Rubric result and recorded grader rationale. |
| `artifacts` | One artifact reference | Output paths, sizes, and hashes. |

`checkpoint_results` contains stored scorer output. It does not imply review by a practicing legal expert. Rows that share a checkpoint ID form a checkpoint group. They are not semantic clusters.

## Question-specific analysis

Start each analysis with a unit of analysis and an evidence corpus. A failure-mode question can use failed checkpoint rationales, nearby agent messages, tool results, final answers, or a combination. Keep `trace_id` on every derived row so a reader can open the source evidence.

Choose the clustering method after defining the question. Embeddings with UMAP and HDBSCAN can find dense semantic groups. BERTopic can add c-TF-IDF labels. Direct clustering in embedding space, hierarchical agglomeration, mixture models, or supervised labels can fit other questions. Record the corpus, embedding model, parameters, random seed, outlier rate, and representative traces with each result.

Cluster labels are analytical claims. Review representative and boundary traces before publishing a label. Report cluster size and outliers. Link every example to the complete Explorer trace.

## Explorer responsibilities

Explorer must ingest source traces, convert them to canonical ATIF, store immutable snapshots, expose deterministic analysis tables, enforce internal authentication, and preserve trace-level evidence links. It also serves the same data through HTTP and MCP.

Hex owns notebook execution, Python packages, question-specific feature construction, clustering, statistical checks, charts, and report composition. This split lets the analysis method change without changing the stored evidence.

The JSON export reads at most 20 canonical traces per request. The loader uses pages of 10 traces to bound Worker memory and response size. A later high-volume adapter can write the same table contract as Parquet in object storage and return signed snapshot URLs. Dataset IDs and trace IDs must remain stable across that adapter.
