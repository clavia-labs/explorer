import { createHmac, timingSafeEqual } from "node:crypto"
import { canonicalJSON } from "./canonical.ts"
import { ContractError, type SharePolicy } from "./contracts.ts"

export interface ShareClaims {
  readonly view_id: string
  readonly policy: SharePolicy
  readonly expires_at?: string
}

const encode = (value: string | Uint8Array) => Buffer.from(value).toString("base64url")

const signature = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url")

export const createShareToken = (claims: ShareClaims, secret: string) => {
  if (claims.view_id.length === 0) throw new ContractError("SHARE_VIEW", "view_id is required")
  if (claims.expires_at !== undefined && Number.isNaN(new Date(claims.expires_at).valueOf())) {
    throw new ContractError("SHARE_EXPIRY", "expires_at must be an ISO timestamp")
  }
  const payload = encode(canonicalJSON({ version: 1, ...claims }))
  return `${payload}.${signature(payload, secret)}`
}

export const verifyShareToken = (token: string, secret: string): ShareClaims => {
  const [payload, supplied, extra] = token.split(".")
  if (payload === undefined || supplied === undefined || extra !== undefined) {
    throw new ContractError("SHARE_TOKEN", "share token is malformed")
  }
  const expected = signature(payload, secret)
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new ContractError("SHARE_SIGNATURE", "share token signature is invalid")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    throw new ContractError("SHARE_TOKEN", "share token payload is invalid")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ContractError("SHARE_TOKEN", "share token payload is invalid")
  }
  const claims = parsed as Readonly<Record<string, unknown>>
  if (
    claims.version !== 1
    || typeof claims.view_id !== "string"
    || (claims.policy !== "partner-review" && claims.policy !== "lab-prospect")
  ) {
    throw new ContractError("SHARE_TOKEN", "share token claims are invalid")
  }
  if (claims.expires_at !== undefined) {
    if (typeof claims.expires_at !== "string" || new Date(claims.expires_at).valueOf() <= Date.now()) {
      throw new ContractError("SHARE_EXPIRED", "share token is expired")
    }
  }
  return {
    view_id: claims.view_id,
    policy: claims.policy,
    ...(typeof claims.expires_at !== "string" ? {} : { expires_at: claims.expires_at })
  }
}
