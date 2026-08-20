import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  BookOpenText,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Database,
  FileLock2,
  Filter,
  Gauge,
  Import,
  List,
  ListTree,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Search,
  Share2,
  Sparkles,
  Sun,
  TerminalSquare,
  TreePine,
  X
} from "lucide-react"
import type {
  AtifStep,
  AtifTrajectory,
  ClaviaTraceMetadata,
  DatasetManifest,
  PolicyCapabilities,
  QueryResult,
  TraceActivity,
  TraceActivityNode,
  TraceSummary,
  TraceView,
  ViewCell
} from "../contracts.ts"
import { api, sharedSession } from "./api.ts"
import { parseExplorerRoute, screenRoute, traceRoute, type ExplorerScreen } from "./routing.ts"

const AnalysisCharts = lazy(() => import("./Charts.tsx"))

type Screen = ExplorerScreen
type Theme = "light" | "dark"
type TraceReaderMode = "activity" | "linear"
type ShareState = "idle" | "creating" | "copied"
type TraceGroupBy = "model" | "task" | "behavior" | "outcome"

interface SessionResponse {
  readonly policy: PolicyCapabilities
  readonly datasets?: ReadonlyArray<DatasetManifest>
  readonly views?: ReadonlyArray<TraceView>
  readonly dataset?: DatasetManifest
  readonly view?: TraceView
}

interface AnalysisData {
  readonly behaviors: QueryResult
  readonly models: QueryResult
  readonly tools: QueryResult
}

interface TraceSelection {
  readonly activity: TraceActivity
  readonly metadata: ClaviaTraceMetadata
  readonly summary: TraceSummary
}

interface ActivityResponse {
  readonly activity: TraceActivity
  readonly metadata: ClaviaTraceMetadata
}

const behaviorCopy: Readonly<Record<string, string>> = {
  "research-first": "Gathers context before making the first material change.",
  "direct-builder": "Moves from the request to tool-backed execution quickly.",
  "iterative-refiner": "Builds, inspects, and improves through several cycles.",
  "recovery-loop": "Encounters a failed action and changes course.",
  "single-shot": "Completes the task in one model turn.",
  "answer-only": "Returns an answer without calling a tool."
}

const colors = ["var(--accent)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"]

const number = (value: unknown) => typeof value === "number" ? value : 0
const percent = (value: unknown) => typeof value === "number" ? `${Math.round(value * 100)}%` : "n/a"
const compactNumber = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)
const money = (value: number) => value === 0 ? "$0" : `$${value.toFixed(value < 0.01 ? 4 : 2)}`
const duration = (value: number | undefined) => {
  if (value === undefined) return "n/a"
  if (value < 1_000) return `${Math.round(value)} ms`
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`
  return `${(value / 60_000).toFixed(1)} min`
}

const textOf = (message: AtifStep["message"]) => typeof message === "string"
  ? message
  : message.filter((part) => part.type === "text").map((part) => part.text).join("\n")

const shortModel = (model: string) => model.replace(/^.+\//, "").replace(/-/g, " ")

const routeState = () => parseExplorerRoute(location.pathname, location.search, sharedSession)

const tracePath = (datasetId: string, traceId: string) => {
  const path = `/v1/traces/${encodeURIComponent(traceId)}`
  return { path, query: `dataset_id=${encodeURIComponent(datasetId)}` }
}

const loadTraceSelection = async (datasetId: string, summary: TraceSummary): Promise<TraceSelection> => {
  const { path, query } = tracePath(datasetId, summary.trace_id)
  const response = await api<ActivityResponse>(`${path}/activity?${query}`)
  return { activity: response.activity, metadata: response.metadata, summary }
}

const loadRequestedTrace = async (datasetId: string, traceId: string): Promise<TraceSelection> => {
  const { path, query } = tracePath(datasetId, traceId)
  const [summary, activity] = await Promise.all([
    api<{ readonly summary: TraceSummary }>(`${path}/summary?${query}`),
    api<ActivityResponse>(`${path}/activity?${query}`)
  ])
  return { activity: activity.activity, metadata: activity.metadata, summary: summary.summary }
}

const loadFullTrace = async (datasetId: string, traceId: string) => {
  const { path, query } = tracePath(datasetId, traceId)
  const response = await api<{ readonly trace: AtifTrajectory }>(`${path}?${query}`)
  return response.trace
}

const loadTraceStep = async (datasetId: string, traceId: string, stepId: number) => {
  const { path, query } = tracePath(datasetId, traceId)
  const response = await api<{ readonly step: AtifStep }>(`${path}/steps/${stepId}?${query}`)
  return response.step
}

function EmptyState({ onImport }: { readonly onImport: () => void }) {
  return <main className="empty-state">
    <div className="empty-mark"><Activity size={34} /></div>
    <p className="eyebrow">EXPLORER / EMPTY STORE</p>
    <h1>Turn agent runs into evidence.</h1>
    <p>Import ATIF, OpenTelemetry, Letta, Braintrust, Langfuse, or LegalBench traces to compare behavior and drill from phases into raw evidence.</p>
    <button className="primary-action" onClick={onImport}><Import size={17} /> Import a trace file</button>
  </main>
}

function Stat({ label, value, note }: { readonly label: string; readonly value: string; readonly note: string }) {
  return <div className="stat">
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{note}</small>
  </div>
}

function BehaviorAnalysis({ data }: { readonly data: QueryResult }) {
  const rows = data.rows
  const maximum = Math.max(...rows.map((row) => number(row.trace_count)), 1)
  return <section className="behavior-section">
    <div className="section-heading">
      <div>
        <p className="eyebrow">EXECUTION PATTERNS</p>
        <h2>How the work gets done.</h2>
      </div>
      <p className="section-lede">A behavioral summary derived from action order, tool use, iteration, and recovery signals.</p>
    </div>
    <div className="behavior-list">
      {rows.map((row, index) => {
        const behavior = String(row.behavior)
        const count = number(row.trace_count)
        return <div className="behavior-row" key={behavior}>
          <div className="behavior-index">0{index + 1}</div>
          <div className="behavior-label">
            <strong>{behavior.replace(/-/g, " ")}</strong>
            <span>{behaviorCopy[behavior] ?? "A recurring action pattern in the dataset."}</span>
          </div>
          <div className="behavior-bar-track">
            <div className="behavior-bar" style={{ width: `${Math.max((count / maximum) * 100, 2)}%`, background: colors[index % colors.length] }} />
          </div>
          <div className="behavior-metric"><strong>{count}</strong><span>{percent(row.pass_rate)} pass</span></div>
        </div>
      })}
    </div>
  </section>
}

const modelLabel = (value: unknown) => shortModel(String(value))

function Findings({ analysis }: { readonly analysis: AnalysisData }) {
  const behavior = analysis.behaviors.rows[0]
  const model = analysis.models.rows[0]
  const tool = analysis.tools.rows.find((row) => row.tool_name !== "no tools")
  const findings = [
    {
      kicker: "Dominant pattern",
      title: String(behavior?.behavior ?? "No pattern"),
      copy: `${number(behavior?.trace_count)} traces follow this path, with a ${percent(behavior?.pass_rate)} strict pass rate.`
    },
    {
      kicker: "Highest coverage",
      title: modelLabel(model?.model ?? "No model"),
      copy: `${percent(model?.checkpoint_rate)} of pooled reliability checkpoints held for this model.`
    },
    {
      kicker: "Most observed tool",
      title: String(tool?.tool_name ?? "No tools"),
      copy: `Present in ${number(tool?.trace_count)} traces across the current immutable snapshot.`
    }
  ]
  return <section className="findings" aria-labelledby="readout-title">
    <div className="findings-title"><Sparkles size={17} /><div><p className="eyebrow">SYNTHESIS</p><h2 id="readout-title">Three things worth opening.</h2></div></div>
    <ol>{findings.map((finding, index) => <li key={finding.kicker}>
      <span className="finding-number">0{index + 1}</span>
      <span className="finding-kicker">{finding.kicker}</span>
      <strong>{finding.title.replace(/-/g, " ")}</strong>
      <p>{finding.copy}</p>
    </li>)}</ol>
  </section>
}

const traceOutcome = (trace: TraceSummary) => trace.strict_pass === true
  ? "Passed"
  : trace.strict_pass === false ? "Did not pass" : trace.status

const traceGroupKey = (trace: TraceSummary, groupBy: TraceGroupBy) => {
  if (groupBy === "model") return shortModel(trace.model)
  if (groupBy === "task") return trace.task_id ?? trace.work_type ?? "Unclassified task"
  if (groupBy === "behavior") return trace.behavior.replace(/-/g, " ")
  return traceOutcome(trace)
}

function TraceTable({ traces, onSelect, limit }: { readonly traces: ReadonlyArray<TraceSummary>; readonly onSelect: (trace: TraceSummary) => void; readonly limit?: number }) {
  const [search, setSearch] = useState("")
  const [groupBy, setGroupBy] = useState<TraceGroupBy>("model")
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set())
  const matchesSearch = traces.filter((trace) => `${trace.title} ${trace.model} ${trace.task_id ?? ""} ${trace.work_type ?? ""} ${trace.behavior}`.toLowerCase().includes(search.toLowerCase()))
  const visible = limit === undefined ? matchesSearch : matchesSearch.slice(0, limit)
  const groups = useMemo(() => {
    const indexed = new Map<string, Array<TraceSummary>>()
    for (const trace of visible) {
      const key = traceGroupKey(trace, groupBy)
      indexed.set(key, [...indexed.get(key) ?? [], trace])
    }
    return [...indexed.entries()].sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
  }, [groupBy, visible])
  const toggleGroup = (key: string) => {
    const next = new Set(openGroups)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setOpenGroups(next)
  }
  return <section className="trace-index-section">
    <div className="section-heading trace-heading">
      <div><p className="eyebrow">TRACE EVIDENCE</p><h2>Browse patterns before individual runs.</h2></div>
      <div className="trace-filters">
        <label><span className="sr-only">Search traces</span><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find task or model" /></label>
        <label><Filter size={15} /><span className="filter-prefix">Group by</span><select aria-label="Group traces by" value={groupBy} onChange={(event) => { setGroupBy(event.target.value as TraceGroupBy); setOpenGroups(new Set()) }}><option value="model">Model</option><option value="task">Task</option><option value="behavior">Pattern</option><option value="outcome">Outcome</option></select><ChevronDown size={14} /></label>
      </div>
    </div>
    <div className="trace-groups">
      {groups.map(([key, group], index) => {
        const open = search.length > 0 || openGroups.has(key)
        const passed = group.filter((trace) => trace.strict_pass === true).length
        const assessed = group.filter((trace) => trace.strict_pass !== undefined).length
        return <section className="trace-group" key={`${groupBy}-${key}`}>
          <button className="trace-group-toggle" aria-expanded={open} onClick={() => toggleGroup(key)}>
            <span className="group-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="group-copy"><strong>{key}</strong><small>{group.length} {group.length === 1 ? "trace" : "traces"}{assessed > 0 ? ` · ${Math.round((passed / assessed) * 100)}% pass` : ""}</small></span>
            <span className="group-actions">{group.reduce((sum, trace) => sum + trace.steps + trace.tool_calls, 0)} actions</span>
            <ChevronDown className={open ? "open" : ""} size={16} />
          </button>
          {open && <div className="trace-group-runs">{group.map((trace) => <button className="trace-run" onClick={() => onSelect(trace)} key={trace.trace_id}>
            <span className={`run-status outcome-${trace.strict_pass === true ? "pass" : trace.strict_pass === false ? "fail" : "unknown"}`}>{trace.strict_pass === true ? <CircleCheck size={15} /> : trace.strict_pass === false ? <CircleAlert size={15} /> : <Activity size={15} />}<span className="sr-only">{traceOutcome(trace)}</span></span>
            <span className="run-copy"><strong>{trace.title}</strong><small>{trace.task_id ?? trace.trace_id.slice(0, 12)}</small></span>
            <span className="run-pattern">{trace.behavior.replace(/-/g, " ")}</span>
            <span className="run-actions">{trace.steps} steps · {trace.tool_calls} tools</span>
            <ArrowUpRight size={15} />
          </button>)}</div>}
        </section>
      })}
      {visible.length === 0 && <p className="no-results">No traces match this filter.</p>}
    </div>
  </section>
}

const inlineMarkdown = (value: string, key: string): ReadonlyArray<ReactNode> => value
  .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  .filter((part) => part.length > 0)
  .map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={`${key}-${index}`}>{part.slice(2, -2)}</strong>
    if (part.startsWith("`") && part.endsWith("`")) return <code key={`${key}-${index}`}>{part.slice(1, -1)}</code>
    return part
  })

const tableCells = (line: string) => line
  .trim()
  .replace(/^\|/, "")
  .replace(/\|$/, "")
  .split("|")
  .map((cell) => cell.trim())

function ReportMarkdown({ content }: { readonly content: string }) {
  const lines = content.split("\n")
  const nodes: Array<ReactNode> = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!.trim()
    if (line.length === 0) {
      index += 1
      continue
    }
    if (line.startsWith("|") && lines[index + 1]?.trim().startsWith("|") === true) {
      const header = tableCells(line)
      const divider = tableCells(lines[index + 1]!)
      if (divider.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        index += 2
        const rows: Array<ReadonlyArray<string>> = []
        while (lines[index]?.trim().startsWith("|") === true) {
          rows.push(tableCells(lines[index]!))
          index += 1
        }
        nodes.push(<div className="report-table-wrap" key={`table-${index}`}><table><thead><tr>{header.map((cell, cellIndex) => <th scope="col" key={`${cell}-${cellIndex}`}>{inlineMarkdown(cell, `th-${index}-${cellIndex}`)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`row-${index}-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{inlineMarkdown(cell, `td-${index}-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody></table></div>)
        continue
      }
    }
    const heading = line.match(/^#{1,6}\s+(.+)$/)
    if (heading !== null) {
      nodes.push(<h3 key={`heading-${index}`}>{inlineMarkdown(heading[1]!, `heading-${index}`)}</h3>)
      index += 1
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      const items: Array<string> = []
      while (lines[index] !== undefined && /^[-*]\s+/.test(lines[index]!.trim())) {
        items.push(lines[index]!.trim().replace(/^[-*]\s+/, ""))
        index += 1
      }
      nodes.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{inlineMarkdown(item, `list-${index}-${itemIndex}`)}</li>)}</ul>)
      continue
    }
    if (line.startsWith(">")) {
      const quote: Array<string> = []
      while (lines[index]?.trim().startsWith(">") === true) {
        quote.push(lines[index]!.trim().replace(/^>\s?/, ""))
        index += 1
      }
      nodes.push(<blockquote key={`quote-${index}`}>{inlineMarkdown(quote.join(" "), `quote-${index}`)}</blockquote>)
      continue
    }
    const paragraph = [line]
    index += 1
    while (
      lines[index] !== undefined
      && lines[index]!.trim().length > 0
      && !/^(#{1,6}\s+|[-*]\s+|>|\|)/.test(lines[index]!.trim())
    ) {
      paragraph.push(lines[index]!.trim())
      index += 1
    }
    nodes.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraph.join(" "), `paragraph-${index}`)}</p>)
  }
  return <div className="report-markdown">{nodes}</div>
}

type ChartCell = Extract<ViewCell, { readonly kind: "chart" }>

const reportMetric = (key: string, value: unknown) => {
  if (typeof value !== "number") return String(value ?? "n/a")
  if (key.includes("rate")) return `${(value * 100).toFixed(1)}%`
  if (key.includes("duration")) return duration(value)
  if (key.includes("cost")) return money(value)
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1)
}

function ReportChart({ cell, datasetId }: { readonly cell: ChartCell; readonly datasetId: string }) {
  const [data, setData] = useState<QueryResult>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let active = true
    void api<QueryResult>("/v1/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...cell.query, dataset_id: datasetId })
    }).then((result) => {
      if (active) setData(result)
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "The chart query failed")
    })
    return () => { active = false }
  }, [cell, datasetId])
  const maximum = Math.max(...(data?.rows.map((row) => number(row[cell.y])) ?? []), 1)
  return <section className="report-cell report-chart" aria-labelledby={`cell-${cell.title.replace(/\W+/g, "-")}`}>
    <div className="report-cell-heading"><p className="eyebrow">QUERY-BACKED CHART</p><h2 id={`cell-${cell.title.replace(/\W+/g, "-")}`}>{cell.title}</h2></div>
    {error !== undefined && <p className="report-cell-error" role="alert">{error}</p>}
    {data === undefined && error === undefined && <div className="report-cell-loading" role="status"><LoaderCircle className="spin" size={15} /> Loading chart data</div>}
    {data !== undefined && <><div className="report-bars" role="img" aria-label={`${cell.title}. ${data.matched_traces} traces matched.`}>{data.rows.map((row, rowIndex) => {
      const value = number(row[cell.y])
      const label = cell.x === "model" ? shortModel(String(row[cell.x])) : String(row[cell.x] ?? "Unknown").replace(/-/g, " ")
      return <div className="report-bar-row" key={`${label}-${rowIndex}`}><span>{label}</span><div><i style={{ width: `${value === 0 ? 0 : Math.max((value / maximum) * 100, 2)}%` }} /></div><strong>{reportMetric(cell.y, value)}</strong></div>
    })}</div><details className="chart-data report-chart-data"><summary>View chart data</summary><table><thead><tr><th scope="col">{cell.x.replace(/_/g, " ")}</th><th scope="col">{cell.y.replace(/_/g, " ")}</th></tr></thead><tbody>{data.rows.map((row, rowIndex) => <tr key={`chart-row-${rowIndex}`}><td>{cell.x === "model" ? shortModel(String(row[cell.x])) : String(row[cell.x] ?? "Unknown").replace(/-/g, " ")}</td><td>{reportMetric(cell.y, row[cell.y])}</td></tr>)}</tbody></table></details></>}
  </section>
}

type TraceListCell = Extract<ViewCell, { readonly kind: "trace-list" }>

function ReportTraceList({ cell, traces, onSelect }: {
  readonly cell: TraceListCell
  readonly traces: ReadonlyArray<TraceSummary>
  readonly onSelect: (trace: TraceSummary) => void
}) {
  const byId = new Map(traces.map((trace) => [trace.trace_id, trace]))
  const selected = cell.sample_trace_ids === undefined
    ? traces.slice(0, 12)
    : cell.sample_trace_ids.flatMap((traceId) => byId.get(traceId) ?? [])
  return <section className="report-cell report-trace-samples" aria-labelledby={`cell-${cell.title.replace(/\W+/g, "-")}`}>
    <div className="report-cell-heading"><p className="eyebrow">SELECTED ACTION SHAPES</p><h2 id={`cell-${cell.title.replace(/\W+/g, "-")}`}>{cell.title}</h2><p>Open a sample to inspect its activity tree. The server applies the active policy before it returns a step.</p></div>
    <div className="report-trace-list">{selected.map((trace) => <button key={trace.trace_id} onClick={() => onSelect(trace)}>
      <span className={`outcome outcome-${trace.strict_pass === true ? "pass" : trace.strict_pass === false ? "fail" : "unknown"}`}>{trace.strict_pass === true ? <CircleCheck size={15} /> : trace.strict_pass === false ? <CircleAlert size={15} /> : <Activity size={15} />}{trace.strict_pass === true ? "Passed" : trace.strict_pass === false && trace.checkpoint_total !== undefined && trace.checkpoint_passed === trace.checkpoint_total - 1 ? "Near miss" : trace.strict_pass === false ? "Did not pass" : trace.status}</span>
      <span><strong>{trace.title}</strong><small>{trace.behavior.replace(/-/g, " ")} · {trace.steps} steps · {trace.tool_calls} tools</small></span>
      <ArrowUpRight size={16} />
    </button>)}</div>
    {selected.length === 0 && <p className="no-results">This view has no visible trace sample.</p>}
  </section>
}

function ViewReport({ view, dataset, traces, policy, onSelect }: {
  readonly view: TraceView
  readonly dataset: DatasetManifest
  readonly traces: ReadonlyArray<TraceSummary>
  readonly policy: PolicyCapabilities
  readonly onSelect: (trace: TraceSummary) => void
}) {
  return <main className="report-main">
    <section className="report-hero" aria-labelledby="report-title">
      <div><p className="eyebrow">SIGNED EVIDENCE VIEW / {policy.policy}</p><h1 id="report-title">{view.title}</h1>{view.description !== undefined && <p>{view.description}</p>}</div>
      <div className="report-provenance"><span>IMMUTABLE SNAPSHOT</span><strong>{dataset.object_sha256.slice(0, 16)}</strong><small>{dataset.name}</small></div>
    </section>
    {!policy.task_content && <div className="policy-notice"><FileLock2 size={16} />Task text, reasoning, tool payloads, and failure details remain on the server.</div>}
    <div className="report-body">{view.cells.map((cell, index) => cell.kind === "markdown"
      ? <section className={`report-cell ${index === 0 ? "report-cell-lead" : ""}`} key={`${cell.kind}-${cell.title}`} aria-labelledby={`cell-${index}`}><div className="report-cell-heading"><p className="eyebrow">{index === 0 ? "PROCUREMENT READOUT" : `SECTION ${String(index + 1).padStart(2, "0")}`}</p><h2 id={`cell-${index}`}>{cell.title}</h2></div><ReportMarkdown content={cell.content} /></section>
      : cell.kind === "chart"
        ? <ReportChart cell={cell} datasetId={dataset.dataset_id} key={`${cell.kind}-${cell.title}`} />
        : <ReportTraceList cell={cell} traces={traces} onSelect={onSelect} key={`${cell.kind}-${cell.title}`} />
    )}</div>
  </main>
}

function AnalysisScreen({ dataset, traces, analysis, onSelect }: {
  readonly dataset: DatasetManifest
  readonly traces: ReadonlyArray<TraceSummary>
  readonly analysis: AnalysisData
  readonly onSelect: (trace: TraceSummary) => void
}) {
  const passed = traces.filter((trace) => trace.strict_pass).length
  const assessed = traces.filter((trace) => trace.strict_pass !== undefined).length
  const checkpoints = traces.reduce((sum, trace) => sum + (trace.checkpoint_total ?? 0), 0)
  const held = traces.reduce((sum, trace) => sum + (trace.checkpoint_passed ?? 0), 0)
  const toolCalls = traces.reduce((sum, trace) => sum + trace.tool_calls, 0)
  const cost = traces.reduce((sum, trace) => sum + trace.cost_usd, 0)
  return <>
    <section className="analysis-hero" aria-labelledby="analysis-title">
      <div className="hero-copy">
        <p className="eyebrow">BEHAVIOR REVIEW / IMMUTABLE SNAPSHOT</p>
        <h1 id="analysis-title">What are these trajectories doing?</h1>
        <p>Compare how agents approach legal work, see what holds under review, and drill from activity phases into raw trace evidence.</p>
      </div>
      <div className="snapshot-stamp"><span>DATASET HASH</span><strong>{dataset.object_sha256.slice(0, 16)}</strong><small>{dataset.name}</small></div>
    </section>
    <section className="evidence-strip" aria-label="Dataset evidence summary">
      <Stat label="Trajectories" value={compactNumber(traces.length)} note={`${new Set(traces.map((trace) => trace.model)).size} candidate models`} />
      <Stat label="Strict pass" value={assessed === 0 ? "n/a" : `${Math.round((passed / assessed) * 100)}%`} note={`${passed} of ${assessed} assessed`} />
      <Stat label="Checkpoints held" value={checkpoints === 0 ? "n/a" : `${Math.round((held / checkpoints) * 100)}%`} note={`${compactNumber(held)} of ${compactNumber(checkpoints)}`} />
      <Stat label="Recorded actions" value={compactNumber(toolCalls)} note={`${money(cost)} measured model cost`} />
    </section>
    <BehaviorAnalysis data={analysis.behaviors} />
    <Suspense fallback={<div className="analysis-grid"><div className="chart-skeleton" /><div className="chart-skeleton" /></div>}><AnalysisCharts models={analysis.models} tools={analysis.tools} /></Suspense>
    <Findings analysis={analysis} />
    <TraceTable traces={traces} onSelect={onSelect} limit={12} />
  </>
}

function ContentBlock({ label, text, defaultOpen = false }: { readonly label: string; readonly text: string; readonly defaultOpen?: boolean }) {
  if (text.trim().length === 0) return null
  const long = text.length > 420
  if (!long) return <div className="content-block"><span>{label}</span><p>{text}</p></div>
  return <details className="content-block" open={defaultOpen}>
    <summary><span>{label}</span><small>{compactNumber(text.length)} characters <ChevronDown size={13} /></small></summary>
    <p>{text}</p>
  </details>
}

function ToolAction({ step, callIndex }: { readonly step: AtifStep; readonly callIndex: number }) {
  const call = step.tool_calls![callIndex]!
  const result = step.observation?.results.find((candidate) => candidate.source_call_id === call.tool_call_id)
  const resultText = typeof result?.content === "string"
    ? result.content
    : result?.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n")
  const argPreview = Object.entries(call.arguments).slice(0, 3).map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`).join(" · ")
  return <details className="tool-action">
    <summary>
      <span className="tool-icon"><TerminalSquare size={15} /></span>
      <span className="tool-title"><strong>{call.function_name}</strong><small>{argPreview || "No arguments"}</small></span>
      {resultText !== undefined && <span className="tool-status"><Check size={12} /> returned</span>}
      <ChevronDown size={14} />
    </summary>
    <div className="tool-detail"><div><span>ARGUMENTS</span><pre>{JSON.stringify(call.arguments, null, 2)}</pre></div>{resultText !== undefined && <div><span>RESULT</span><pre>{resultText}</pre></div>}</div>
  </details>
}

function TimelineStep({ step }: { readonly step: AtifStep }) {
  const type = step.source === "user" ? "request" : step.source === "system" ? "system" : step.tool_calls?.length ? "action" : "response"
  return <article className={`timeline-step timeline-${type}`}>
    <div className="timeline-rail"><span>{String(step.step_id).padStart(2, "0")}</span></div>
    <div className="timeline-body">
      <header>
        <div><span className="step-type">{type}</span>{step.model_name !== undefined && <span className="step-model">{shortModel(step.model_name)}</span>}</div>
        <small>{step.timestamp === undefined ? `step ${step.step_id}` : new Date(step.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small>
      </header>
      <StepContents step={step} />
    </div>
  </article>
}

function StepContents({ step }: { readonly step: AtifStep }) {
  const message = textOf(step.message)
  return <>
    {step.reasoning_content !== undefined && <ContentBlock label="REASONING" text={step.reasoning_content} />}
    <ContentBlock label={step.source === "user" ? "INSTRUCTION" : step.tool_calls?.length ? "NARRATION" : "MESSAGE"} text={message} defaultOpen={step.source === "user"} />
    {(step.tool_calls ?? []).map((_, index) => <ToolAction step={step} callIndex={index} key={step.tool_calls![index]!.tool_call_id} />)}
    {step.metrics !== undefined && <div className="step-metrics"><span>{compactNumber(step.metrics.prompt_tokens ?? 0)} prompt</span><span>{compactNumber(step.metrics.completion_tokens ?? 0)} completion</span><span>{money(step.metrics.cost_usd ?? 0)}</span></div>}
  </>
}

function PhaseGlyph({ category }: { readonly category: TraceActivityNode["category"] }) {
  if (category === "orient") return <BookOpenText size={15} />
  if (category === "investigate") return <Search size={15} />
  if (category === "decide") return <Sparkles size={15} />
  if (category === "change" || category === "execute") return <TerminalSquare size={15} />
  if (category === "verify") return <Check size={15} />
  if (category === "coordinate") return <ListTree size={15} />
  if (category === "recover") return <CircleAlert size={15} />
  return <ArrowUpRight size={15} />
}

function ActivityTurn({ node, datasetId, traceId, open, onToggle }: {
  readonly node: TraceActivityNode
  readonly datasetId: string
  readonly traceId: string
  readonly open: boolean
  readonly onToggle: (nodeId: string, open: boolean) => void
}) {
  const [step, setStep] = useState<AtifStep>()
  const [leafLoading, setLeafLoading] = useState(false)
  const [leafError, setLeafError] = useState<string>()
  const [requestVersion, setRequestVersion] = useState(0)
  useEffect(() => {
    if (!open || step !== undefined) return
    let active = true
    setLeafLoading(true)
    setLeafError(undefined)
    void loadTraceStep(datasetId, traceId, node.start_step).then((loaded) => {
      if (active) setStep(loaded)
    }).catch((caught) => {
      if (active) setLeafError(caught instanceof Error ? caught.message : "Unable to load raw evidence")
    }).finally(() => {
      if (active) setLeafLoading(false)
    })
    return () => { active = false }
  }, [datasetId, node.start_step, open, requestVersion, step, traceId])
  const clock = node.start_time === undefined
    ? `step ${node.start_step}`
    : new Date(node.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  return <article className={`activity-turn activity-turn-${node.status}`}>
    <button className="activity-turn-trigger" aria-expanded={open} onClick={() => onToggle(node.node_id, !open)}>
      <span className="turn-step">{String(node.start_step).padStart(2, "0")}</span>
      <span className="turn-copy"><strong>{node.label}</strong><small>{node.summary}</small></span>
      <span className="turn-tools" aria-label={node.tools.length === 0 ? "No tools" : `Tools: ${node.tools.join(", ")}`}>
        {node.tools.slice(0, 2).map((tool) => <i key={tool}>{tool}</i>)}
        {node.tools.length > 2 && <i>+{node.tools.length - 2}</i>}
      </span>
      <span className="turn-clock">{node.status === "failed" ? <CircleAlert size={12} aria-hidden="true" /> : <Check className="turn-completed" size={12} aria-hidden="true" />}<span className="sr-only">{node.status}</span>{clock}</span>
      <ChevronDown className={open ? "open" : ""} size={15} />
    </button>
    {open && <div className="activity-leaf">
      <div className="raw-evidence-bar"><span>RAW EVIDENCE</span><small>ATIF step {node.start_step} · {node.children.length} {node.children.length === 1 ? "leaf" : "leaves"}</small></div>
      {leafLoading && <div className="activity-leaf-state" role="status"><LoaderCircle className="spin" size={15} /> Loading raw step</div>}
      {leafError !== undefined && <div className="activity-leaf-state activity-leaf-error" role="alert"><CircleAlert size={15} /><span>{leafError}</span><button onClick={() => { setLeafError(undefined); setRequestVersion((value) => value + 1) }}>Retry</button></div>}
      {step !== undefined && <StepContents step={step} />}
    </div>}
  </article>
}

function ActivityPhase({ phase, index, datasetId, traceId, open, openTurns, visibleTurns, onToggle, onToggleTurn }: {
  readonly phase: TraceActivityNode
  readonly index: number
  readonly datasetId: string
  readonly traceId: string
  readonly open: boolean
  readonly openTurns: ReadonlySet<string>
  readonly visibleTurns: ReadonlyArray<TraceActivityNode>
  readonly onToggle: (nodeId: string, open: boolean) => void
  readonly onToggleTurn: (nodeId: string, open: boolean) => void
}) {
  return <section className={`activity-phase activity-phase-${phase.category} ${open ? "open" : ""}`}>
    <header className="activity-phase-head">
      <button className="activity-phase-toggle" aria-expanded={open} onClick={() => onToggle(phase.node_id, !open)}>
        <span className="phase-index">{String(index + 1).padStart(2, "0")}</span>
        <span className="phase-glyph"><PhaseGlyph category={phase.category} /></span>
        <span className="phase-copy"><small>{phase.dimension}</small><strong>{phase.label}</strong><span>{phase.summary}</span></span>
        <span className="phase-metrics"><strong>{phase.step_count} {phase.step_count === 1 ? "turn" : "turns"}</strong><small>{phase.tool_call_count} tool {phase.tool_call_count === 1 ? "call" : "calls"} · {duration(phase.duration_ms)}</small></span>
        <ChevronDown className={open ? "open" : ""} size={16} />
      </button>
    </header>
    {open && <div className="activity-turns">
      {visibleTurns.map((turn) => <ActivityTurn node={turn} datasetId={datasetId} traceId={traceId} open={openTurns.has(turn.node_id)} onToggle={onToggleTurn} key={turn.node_id} />)}
      {visibleTurns.length === 0 && <p className="activity-no-match">No turns in this phase match the search.</p>}
    </div>}
  </section>
}

function ActivityExplorer({ activity, datasetId, traceId }: { readonly activity: TraceActivity; readonly datasetId: string; readonly traceId: string }) {
  const phases = activity.root.children
  const [openPhases, setOpenPhases] = useState<ReadonlySet<string>>(() => new Set())
  const [openTurns, setOpenTurns] = useState<ReadonlySet<string>>(() => new Set())
  const [query, setQuery] = useState("")
  const normalizedQuery = query.trim().toLowerCase()
  const matches = useMemo(() => new Map(phases.map((phase) => {
    const phaseMatch = `${phase.label} ${phase.summary} ${phase.category} ${phase.dimension} ${phase.tools.join(" ")}`.toLowerCase().includes(normalizedQuery)
    const turns = normalizedQuery.length === 0 || phaseMatch
      ? phase.children
      : phase.children.filter((turn) => `${turn.label} ${turn.summary} ${turn.tools.join(" ")}`.toLowerCase().includes(normalizedQuery))
    return [phase.node_id, turns] as const
  })), [normalizedQuery, phases])
  const visiblePhases = phases.filter((phase) => normalizedQuery.length === 0 || (matches.get(phase.node_id)?.length ?? 0) > 0)
  const matchCount = normalizedQuery.length === 0
    ? activity.root.step_count
    : visiblePhases.reduce((sum, phase) => sum + (matches.get(phase.node_id)?.length ?? 0), 0)

  const toggle = (setter: (value: ReadonlySet<string>) => void, current: ReadonlySet<string>, nodeId: string, nextOpen: boolean) => {
    const next = new Set(current)
    if (nextOpen) next.add(nodeId)
    else next.delete(nodeId)
    setter(next)
  }
  const showTurns = () => setOpenPhases(new Set(visiblePhases.map((phase) => phase.node_id)))
  const collapse = () => {
    setOpenPhases(new Set())
    setOpenTurns(new Set())
  }

  return <div className="activity-explorer">
    <div className="activity-overview">
      <div><span>BEHAVIOR SHAPE</span><strong>{activity.root.summary}</strong></div>
      <small>{phases.length} phases · {activity.root.step_count} turns · {activity.root.tool_call_count} tool calls</small>
    </div>
    <div className="activity-controls">
      <div className="activity-search" role="search"><Search size={15} /><input aria-label="Search activity" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search phases, turns, or tools" />{query.length > 0 && <button aria-label="Clear activity search" onClick={() => setQuery("")}><X size={14} /></button>}</div>
      <div className="activity-control-buttons" aria-label="Activity tree detail controls">
        <button onClick={collapse}><List size={15} /> Collapse all</button>
        <button onClick={showTurns}><TreePine size={15} /> Expand groups</button>
      </div>
    </div>
    <div className="activity-context" aria-live="polite"><span>{normalizedQuery.length === 0 ? `${phases.length} activity groups` : `${matchCount} matching ${matchCount === 1 ? "turn" : "turns"}`}</span><small>Expand a group to see its turns and raw evidence.</small></div>
    <div className="activity-tree">
      {visiblePhases.map((phase) => <ActivityPhase
        phase={phase}
        index={phases.indexOf(phase)}
        datasetId={datasetId}
        traceId={traceId}
        open={normalizedQuery.length > 0 || openPhases.has(phase.node_id)}
        openTurns={openTurns}
        visibleTurns={matches.get(phase.node_id) ?? []}
        onToggle={(nodeId, nextOpen) => toggle(setOpenPhases, openPhases, nodeId, nextOpen)}
        onToggleTurn={(nodeId, nextOpen) => toggle(setOpenTurns, openTurns, nodeId, nextOpen)}
        key={phase.node_id}
      />)}
      {visiblePhases.length === 0 && <div className="activity-empty-search"><Search size={18} /><strong>No activity matched.</strong><span>Search by a phase name, turn label, or tool.</span><button onClick={() => setQuery("")}>Clear search</button></div>}
    </div>
    <div className="timeline-end"><Check size={14} /> End of trajectory · {activity.root.step_count} steps</div>
  </div>
}

function TraceDetail({ datasetId, activity, metadata, summary, peers, policy, backLabel, onBack, onSelect }: {
  readonly datasetId: string
  readonly activity: TraceActivity
  readonly metadata: ClaviaTraceMetadata
  readonly summary: TraceSummary
  readonly peers: ReadonlyArray<TraceSummary>
  readonly policy: PolicyCapabilities
  readonly backLabel: string
  readonly onBack: () => void
  readonly onSelect: (summary: TraceSummary) => void
}) {
  const tags = metadata.behavior.tags
  const visiblePeers = [summary, ...peers.filter((peer) => peer.trace_id !== summary.trace_id && peer.model === summary.model)].slice(0, 8)
  const outcomeClass = summary.strict_pass === true ? "pass" : summary.strict_pass === false ? "fail" : "unknown"
  const [readerMode, setReaderMode] = useState<TraceReaderMode>("activity")
  const [linearTrace, setLinearTrace] = useState<AtifTrajectory>()
  const [linearLoading, setLinearLoading] = useState(false)
  const [linearError, setLinearError] = useState<string>()
  const openLinear = async () => {
    setReaderMode("linear")
    if (linearTrace !== undefined || linearLoading) return
    setLinearLoading(true)
    setLinearError(undefined)
    try {
      setLinearTrace(await loadFullTrace(datasetId, summary.trace_id))
    } catch (caught) {
      setLinearError(caught instanceof Error ? caught.message : "Unable to load the linear record")
    } finally {
      setLinearLoading(false)
    }
  }
  return <main className="trace-detail">
    <div className="trace-detail-top">
      <button className="back-button" onClick={onBack}><ArrowLeft size={16} /> {backLabel}</button>
      <div className="trace-title"><p className="eyebrow">TRAJECTORY / {summary.task_id ?? summary.trace_id.slice(-12)}</p><h1>{metadata.title}</h1><p>{shortModel(summary.model)} · {summary.behavior.replace(/-/g, " ")} · {summary.steps} recorded steps</p></div>
      <div className={`trace-verdict ${outcomeClass}`}>{summary.strict_pass === true ? <CircleCheck size={18} /> : summary.strict_pass === false ? <CircleAlert size={18} /> : <Activity size={18} />}<div><span>STRICT REVIEW</span><strong>{summary.strict_pass === undefined ? summary.status : summary.strict_pass ? "Passed" : "Did not pass"}</strong></div></div>
    </div>
    {!policy.reasoning && <div className="policy-notice"><FileLock2 size={16} />This shared view preserves action shape while withholding reasoning and sensitive content under the {policy.policy} policy.</div>}
    <div className="trace-layout">
      <aside className="peer-list" aria-label="Same model traces">
        <div className="aside-title"><span>SAME MODEL</span><small>{visiblePeers.length} traces</small></div>
        {visiblePeers.map((peer) => <button className={peer.trace_id === summary.trace_id ? "active" : ""} aria-current={peer.trace_id === summary.trace_id ? "true" : undefined} onClick={() => onSelect(peer)} key={peer.trace_id}>
          <span className={peer.strict_pass ? "peer-pass" : "peer-fail"} />
          <div><strong>{peer.task_id ?? peer.title}</strong><small>{shortModel(peer.model)}</small></div>
          <em>{peer.tool_calls}</em>
        </button>)}
      </aside>
      <section className="timeline" aria-labelledby="timeline-title">
        <h2 id="timeline-title" className="sr-only">Trajectory activity</h2>
        <div className="timeline-intro">
          <div>{readerMode === "activity" ? <ListTree size={17} /> : <Activity size={17} />}<span>{readerMode === "activity" ? "HIERARCHICAL ACTIVITY" : "LINEAR ACTION RECORD"}</span></div>
          <div className="reader-mode" role="group" aria-label="Trajectory reading mode">
            <button className={readerMode === "activity" ? "active" : ""} aria-pressed={readerMode === "activity"} onClick={() => setReaderMode("activity")}><TreePine size={14} /> Activity</button>
            <button className={readerMode === "linear" ? "active" : ""} aria-pressed={readerMode === "linear"} onClick={() => void openLinear()}><List size={14} /> Linear</button>
          </div>
        </div>
        {readerMode === "activity"
          ? <ActivityExplorer activity={activity} datasetId={datasetId} traceId={summary.trace_id} key={summary.trace_id} />
          : linearTrace !== undefined
            ? <>{linearTrace.steps.map((step) => <TimelineStep step={step} key={step.step_id} />)}<div className="timeline-end"><Check size={14} /> End of trajectory · {linearTrace.steps.length} steps</div></>
            : <div className={`reader-state ${linearError === undefined ? "" : "reader-state-error"}`} role={linearError === undefined ? "status" : "alert"}>{linearError === undefined ? <><LoaderCircle className="spin" size={17} /> Loading the linear record</> : <><CircleAlert size={17} /><span>{linearError}</span><button onClick={() => void openLinear()}>Retry</button></>}</div>}
      </section>
      <aside className="trace-anatomy" aria-label="Trace anatomy">
        <div className="aside-title"><span>TRACE ANATOMY</span><Gauge size={15} /></div>
        <div className="anatomy-callout"><span>BEHAVIOR CLASS</span><strong>{summary.behavior.replace(/-/g, " ")}</strong><p>{metadata.behavior.summary}</p></div>
        <dl>
          <div><dt>Activity phases</dt><dd>{activity.root.children.length}</dd></div>
          <div><dt>Tool calls</dt><dd>{summary.tool_calls}</dd></div>
          <div><dt>Duration</dt><dd>{duration(summary.duration_ms)}</dd></div>
          <div><dt>Prompt tokens</dt><dd>{compactNumber(summary.prompt_tokens)}</dd></div>
          <div><dt>Completion</dt><dd>{compactNumber(summary.completion_tokens)}</dd></div>
          <div><dt>Measured cost</dt><dd>{money(summary.cost_usd)}</dd></div>
          <div><dt>Checkpoints</dt><dd>{summary.checkpoint_passed ?? 0}/{summary.checkpoint_total ?? 0}</dd></div>
        </dl>
        {tags.length > 0 && <div className="tag-section"><span>SIGNALS</span><div>{tags.map((tag) => <i key={tag}>{tag}</i>)}</div></div>}
        {(metadata.failure_modes ?? []).some((mode) => mode.verdict === "FAIL") && <div className="failure-section"><span>FAILED CHECKPOINTS</span>{metadata.failure_modes?.filter((mode) => mode.verdict === "FAIL").slice(0, 4).map((mode) => <div key={mode.id}><X size={12} /><p><strong>{mode.id}</strong>{mode.justification !== undefined && <small>{mode.justification}</small>}</p></div>)}</div>}
      </aside>
    </div>
  </main>
}

export default function App() {
  const [session, setSession] = useState<SessionResponse>()
  const [dataset, setDataset] = useState<DatasetManifest>()
  const [traces, setTraces] = useState<ReadonlyArray<TraceSummary>>([])
  const [analysis, setAnalysis] = useState<AnalysisData>()
  const [selected, setSelected] = useState<TraceSelection>()
  const [screen, setScreen] = useState<Screen>(() => routeState().screen)
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("clavia-trace-theme")
    if (saved === "light" || saved === "dark") return saved
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  })
  const [shareState, setShareState] = useState<ShareState>("idle")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const fileInput = useRef<HTMLInputElement>(null)

  const loadDataset = async (next: DatasetManifest) => {
    setLoading(true)
    setDataset(next)
    try {
      if (sharedSession) {
        const listed = await api<{ readonly traces: ReadonlyArray<TraceSummary> }>(`/v1/datasets/${encodeURIComponent(next.dataset_id)}/traces`)
        setTraces(listed.traces)
        setAnalysis(undefined)
        return listed.traces
      }
      const [listed, behaviors, models, tools] = await Promise.all([
        api<{ readonly traces: ReadonlyArray<TraceSummary> }>(`/v1/datasets/${encodeURIComponent(next.dataset_id)}/traces`),
        api<QueryResult>("/v1/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataset_id: next.dataset_id, group_by: "behavior", metrics: ["trace_count", "pass_rate", "avg_tool_calls"], order_by: { metric: "trace_count", direction: "desc" } }) }),
        api<QueryResult>("/v1/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataset_id: next.dataset_id, group_by: "model", metrics: ["trace_count", "pass_rate", "checkpoint_rate", "avg_usefulness", "avg_tool_calls"], order_by: { metric: "checkpoint_rate", direction: "desc" } }) }),
        api<QueryResult>("/v1/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataset_id: next.dataset_id, group_by: "tool_name", metrics: ["trace_count", "pass_rate", "avg_tool_calls"], order_by: { metric: "trace_count", direction: "desc" }, limit: 18 }) })
      ])
      setTraces(listed.traces)
      setAnalysis({ behaviors, models, tools })
      return listed.traces
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load dataset") }
    finally { setLoading(false) }
  }

  useEffect(() => {
    void api<SessionResponse>("/v1/session").then(async (loaded) => {
      setSession(loaded)
      if (!sharedSession && location.pathname === "/") history.replaceState(null, "", "/analysis")
      const first = loaded.dataset ?? loaded.datasets?.[0]
      if (first === undefined) {
        setLoading(false)
        return
      }
      setDataset(first)
      const requestedTrace = routeState().traceId
      if (requestedTrace !== undefined) {
        try {
          setSelected(await loadRequestedTrace(first.dataset_id, requestedTrace))
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Unable to load requested trace")
        } finally { setLoading(false) }
        void loadDataset(first)
        return
      }
      await loadDataset(first)
    }).catch((caught) => { setError(caught instanceof Error ? caught.message : "Unable to load session"); setLoading(false) })
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem("clavia-trace-theme", theme)
  }, [theme])

  useEffect(() => {
    const syncRoute = () => {
      const route = routeState()
      setScreen(route.screen)
      if (route.traceId === undefined) {
        setSelected(undefined)
        return
      }
      if (dataset !== undefined && route.traceId !== selected?.summary.trace_id) {
        setLoading(true)
        void loadRequestedTrace(dataset.dataset_id, route.traceId).then(setSelected).catch((caught) => {
          setError(caught instanceof Error ? caught.message : "Unable to load requested trace")
        }).finally(() => setLoading(false))
      }
    }
    addEventListener("popstate", syncRoute)
    return () => removeEventListener("popstate", syncRoute)
  }, [dataset, selected?.summary.trace_id])

  const selectTrace = async (summary: TraceSummary) => {
    if (dataset === undefined) return
    setLoading(true)
    try {
      setSelected(await loadTraceSelection(dataset.dataset_id, summary))
      history.pushState(null, "", traceRoute(summary.trace_id, sharedSession ? location.pathname : undefined))
      scrollTo({ top: 0 })
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load trace") }
    finally { setLoading(false) }
  }

  const importFile = async (file: File) => {
    const form = new FormData()
    form.set("file", file)
    setLoading(true)
    try {
      const imported = await api<{ readonly dataset: DatasetManifest; readonly view: TraceView }>("/v1/import", { method: "POST", body: form })
      const loaded = await api<SessionResponse>("/v1/session")
      setSession(loaded)
      await loadDataset(imported.dataset)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Import failed"); setLoading(false) }
  }

  const views = session?.view === undefined ? session?.views ?? [] : [session.view]
  const view = views.find((candidate) => candidate.dataset_id === dataset?.dataset_id)
  const policy = session?.policy
  const datasets = session?.dataset === undefined ? session?.datasets ?? [] : [session.dataset]
  const createPartnerShare = async () => {
    if (view === undefined || shareState !== "idle") return
    setShareState("creating")
    try {
      const created = await api<{ readonly url: string }>("/v1/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ view_id: view.view_id })
      })
      if (navigator.clipboard === undefined) throw new Error("Clipboard access is unavailable in this browser.")
      await navigator.clipboard.writeText(created.url)
      setShareState("copied")
      window.setTimeout(() => setShareState("idle"), 1_800)
    } catch (caught) {
      setShareState("idle")
      setError(caught instanceof Error ? caught.message : "Unable to create the partner link")
    }
  }

  const navigate = (next: Screen) => {
    setSelected(undefined)
    setScreen(next)
    history.pushState(null, "", screenRoute(next, sharedSession ? location.pathname : undefined))
    scrollTo({ top: 0 })
  }

  function AppRail() {
    return <aside className="app-rail">
      <button className="brand" aria-label="Open analysis" onClick={() => navigate("analysis")}><span className="brand-mark">C</span><span><strong>clavia</strong><small>explorer</small></span></button>
      <nav aria-label="Primary navigation">
        <button className={screen === "analysis" && selected === undefined ? "active" : ""} aria-current={screen === "analysis" && selected === undefined ? "page" : undefined} onClick={() => navigate("analysis")}><Activity size={17} /><span>Analysis</span></button>
        <button className={screen === "traces" && selected === undefined ? "active" : ""} aria-current={screen === "traces" && selected === undefined ? "page" : undefined} onClick={() => navigate("traces")}><ListTree size={17} /><span>Traces</span><em>{traces.length}</em></button>
      </nav>
      {dataset !== undefined && <label className="rail-dataset"><span>DATASET SNAPSHOT</span><span className="rail-select"><Database size={15} /><select aria-label="Dataset snapshot" value={dataset.dataset_id} disabled={sharedSession} onChange={(event) => { const next = datasets.find((candidate) => candidate.dataset_id === event.target.value); if (next !== undefined) void loadDataset(next) }}>{datasets.map((candidate) => <option value={candidate.dataset_id} key={candidate.dataset_id}>{candidate.name}</option>)}</select><ChevronDown size={13} /></span><small>{dataset.traces.length} traces · {dataset.object_sha256.slice(0, 8)}</small></label>}
      <div className="rail-footer">
        <button className="theme-toggle" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")} aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}>{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}<span>{theme === "light" ? "Dark theme" : "Light theme"}</span></button>
      </div>
    </aside>
  }

  function WorkBar() {
    const title = selected?.summary.task_id
      ?? (sharedSession && session?.view !== undefined
        ? session.view.title
        : screen === "analysis" ? "Behavior analysis" : "All traces")
    return <header className="workbar">
      <button className="mobile-brand" aria-label="Open analysis" onClick={() => navigate("analysis")}><span>C</span> clavia</button>
      <div className="workbar-path"><span>{selected === undefined ? screen : "trace"}</span><strong>{title}</strong></div>
      <div className="workbar-tools">
        {!sharedSession && <button className="secondary-action" aria-label="Import" onClick={() => fileInput.current?.click()}><Import size={15} /> <span>Import</span></button>}
        {!sharedSession && view !== undefined && <button className="primary-action" aria-label={shareState === "idle" ? "Copy internal partner link" : shareState === "creating" ? "Creating internal partner link" : "Internal partner link copied"} disabled={shareState !== "idle"} onClick={() => void createPartnerShare()}>{shareState === "creating" ? <LoaderCircle className="spin" size={15} /> : shareState === "copied" ? <Check size={15} /> : <Share2 size={15} />} <span aria-live="polite">{shareState === "creating" ? "Creating link" : shareState === "copied" ? "Link copied" : "Share with partner"}</span></button>}
        {sharedSession && <div className="shared-badge"><LockKeyhole size={14} /> {policy?.policy === "partner-review" ? "Internal partner" : "Shared view"}</div>}
        <button className="mobile-theme" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")} aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}>{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</button>
      </div>
    </header>
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    {AppRail()}
    <div className="app-workspace">
      {WorkBar()}
      <input ref={fileInput} type="file" accept=".json,.jsonl,.ndjson" hidden onChange={(event) => event.target.files?.[0] !== undefined && void importFile(event.target.files[0])} />
      {error !== undefined && <div className="error-banner" role="alert"><CircleAlert size={16} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(undefined)}><X size={15} /></button></div>}
      {loading && <div className="loading-bar" role="progressbar" aria-label="Loading trace data"><span /></div>}
      <div id="main-content" tabIndex={-1}>{session !== undefined && dataset === undefined && !loading
        ? <EmptyState onImport={() => fileInput.current?.click()} />
        : selected !== undefined && policy !== undefined && dataset !== undefined
          ? <TraceDetail key={selected.summary.trace_id} datasetId={dataset.dataset_id} activity={selected.activity} metadata={selected.metadata} summary={selected.summary} peers={traces} policy={policy} backLabel={screen === "traces" ? "All traces" : "Analysis"} onBack={() => navigate(screen)} onSelect={(summary) => void selectTrace(summary)} />
          : sharedSession && session?.view !== undefined && dataset !== undefined && policy !== undefined
            ? <ViewReport view={session.view} dataset={dataset} traces={traces} policy={policy} onSelect={(summary) => void selectTrace(summary)} />
          : dataset !== undefined && analysis !== undefined
            ? <main className="analysis-main">{screen === "analysis" ? <AnalysisScreen dataset={dataset} traces={traces} analysis={analysis} onSelect={(summary) => void selectTrace(summary)} /> : <TraceTable traces={traces} onSelect={(summary) => void selectTrace(summary)} />}</main>
            : null}</div>
    </div>
  </div>
}
