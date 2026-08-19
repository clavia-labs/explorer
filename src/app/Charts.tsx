import { Wrench } from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from "recharts"
import type { QueryResult } from "../contracts.ts"

const number = (value: unknown) => typeof value === "number" ? value : 0
const shortModel = (model: string) => model.replace(/^.+\//, "").replace(/-/g, " ")

function ModelChart({ data }: { readonly data: QueryResult }) {
  const rows = data.rows.slice(0, 10).map((row) => ({
    label: shortModel(String(row.model)),
    checkpoint: number(row.checkpoint_rate) * 100
  }))
  return <section className="chart-panel">
    <div className="panel-heading">
      <div><p className="eyebrow">OUTCOME</p><h3>Checkpoint coverage by model</h3></div>
      <span>{data.matched_traces} assessed traces</span>
    </div>
    <div className="model-chart" role="img" aria-label="Horizontal bar chart of checkpoint coverage by model">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 20, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--line)" horizontal={false} strokeDasharray="2 4" />
          <XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} fontSize={11} />
          <YAxis type="category" dataKey="label" width={128} tickLine={false} axisLine={false} fontSize={11} />
          <Tooltip cursor={{ fill: "var(--hover)" }} content={({ active, payload }) => active && payload?.[0]
            ? <div className="chart-tooltip"><strong>{payload[0].payload.label}</strong><span>{Number(payload[0].value).toFixed(1)}% checkpoint coverage</span></div>
            : null} />
          <Bar dataKey="checkpoint" radius={[0, 3, 3, 0]} barSize={15}>
            {rows.map((row, index) => <Cell key={row.label} fill={index === 0 ? "var(--accent)" : "var(--chart-2)"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    <details className="chart-data"><summary>View chart data</summary><table><thead><tr><th scope="col">Model</th><th scope="col">Coverage</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{row.checkpoint.toFixed(1)}%</td></tr>)}</tbody></table></details>
  </section>
}

function ToolScatter({ data }: { readonly data: QueryResult }) {
  const rows = data.rows.filter((row) => row.tool_name !== "no tools").map((row) => ({
    name: String(row.tool_name),
    calls: number(row.avg_tool_calls),
    pass: number(row.pass_rate) * 100,
    count: number(row.trace_count)
  }))
  return <section className="chart-panel">
    <div className="panel-heading">
      <div><p className="eyebrow">ACTION MIX</p><h3>Tool use and strict pass rate</h3></div>
      <Wrench size={18} />
    </div>
    <div className="model-chart" role="img" aria-label="Scatter chart comparing average tool calls and strict pass rate">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" />
          <XAxis type="number" dataKey="calls" name="average tool calls" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis type="number" dataKey="pass" name="pass rate" unit="%" domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} />
          <ZAxis type="number" dataKey="count" range={[60, 500]} />
          <Tooltip cursor={{ strokeDasharray: "2 4" }} content={({ active, payload }) => active && payload?.[0]
            ? <div className="chart-tooltip"><strong>{payload[0].payload.name}</strong><span>{payload[0].payload.calls.toFixed(1)} avg calls</span><span>{payload[0].payload.pass.toFixed(0)}% strict pass</span></div>
            : null} />
          <Scatter data={rows} fill="var(--chart-2)" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
    <details className="chart-data"><summary>View chart data</summary><table><thead><tr><th scope="col">Tool</th><th scope="col">Average calls</th><th scope="col">Strict pass</th></tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.calls.toFixed(1)}</td><td>{row.pass.toFixed(1)}%</td></tr>)}</tbody></table></details>
  </section>
}

export default function AnalysisCharts({ models, tools }: { readonly models: QueryResult; readonly tools: QueryResult }) {
  return <div className="analysis-grid"><ModelChart data={models} /><ToolScatter data={tools} /></div>
}
