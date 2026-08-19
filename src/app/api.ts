const shareToken = location.pathname.startsWith("/share/")
  ? location.pathname.slice("/share/".length)
  : new URLSearchParams(location.search).get("share") ?? undefined

const endpoint = (path: string) => {
  if (shareToken === undefined) return path
  const url = new URL(path, location.origin)
  url.searchParams.set("share", shareToken)
  return `${url.pathname}${url.search}`
}

export const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(endpoint(path), init)
  const body = await response.json() as T & { readonly error?: { readonly message?: string } }
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed with ${response.status}`)
  return body
}

export const sharedSession = shareToken !== undefined
