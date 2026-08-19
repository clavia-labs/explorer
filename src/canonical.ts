import { createHash } from "node:crypto"

export const canonicalJSON = (value: unknown): string => {
  if (value === null) return "null"
  if (typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`
  const record = value as Readonly<Record<string, unknown>>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`)
    .join(",")}}`
}

export const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex")

export const contentHash = (value: unknown) => sha256(canonicalJSON(value))
