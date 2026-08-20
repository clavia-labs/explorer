export type ExplorerScreen = "analysis" | "traces"

export interface ExplorerRoute {
  readonly screen: ExplorerScreen
  readonly traceId?: string
}

export const parseExplorerRoute = (pathname: string, search: string, shared: boolean): ExplorerRoute => {
  if (shared) {
    const traceId = new URLSearchParams(search).get("trace")
    return traceId === null ? { screen: "analysis" } : { screen: "analysis", traceId }
  }
  const trace = pathname.match(/^\/traces\/([^/]+)$/)
  const screen = pathname === "/traces" || trace !== null ? "traces" : "analysis"
  return trace === null ? { screen } : { screen, traceId: decodeURIComponent(trace[1]!) }
}

export const screenRoute = (screen: ExplorerScreen, sharedPath?: string) =>
  sharedPath ?? (screen === "analysis" ? "/analysis" : "/traces")

export const traceRoute = (traceId: string, sharedPath?: string) => sharedPath === undefined
  ? `/traces/${encodeURIComponent(traceId)}`
  : `${sharedPath}?trace=${encodeURIComponent(traceId)}`
