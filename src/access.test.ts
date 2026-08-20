import { describe, expect, test } from "bun:test"
import { passwordGuard } from "./access.ts"

describe("Explorer password gate", () => {
  test("stays disabled when no password is configured", async () => {
    expect(await passwordGuard(new Request("http://explorer.test/analysis"), undefined)).toBeUndefined()
  })

  test("rejects pages and API calls without an access session", async () => {
    const page = await passwordGuard(new Request("https://explorer.test/analysis"), "held-secret")
    expect(page?.status).toBe(401)
    expect(await page?.text()).toContain("Access password")

    const api = await passwordGuard(new Request("https://explorer.test/v1/session"), "held-secret")
    expect(api?.status).toBe(401)
    expect(await api?.json()).toMatchObject({ error: { code: "ACCESS_REQUIRED" } })
  })

  test("exchanges a URL password for an HttpOnly cookie and a clean route", async () => {
    const unlocked = await passwordGuard(
      new Request("https://explorer.test/share/token?trace=run%3A42&access=held-secret"),
      "held-secret"
    )
    expect(unlocked?.status).toBe(303)
    expect(unlocked?.headers.get("location")).toBe("/share/token?trace=run%3A42")
    const cookie = unlocked?.headers.get("set-cookie")
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("Secure")
    expect(cookie).not.toContain("held-secret")

    const authorized = await passwordGuard(new Request("https://explorer.test/analysis", {
      headers: { cookie: cookie?.split(";")[0] ?? "" }
    }), "held-secret")
    expect(authorized).toBeUndefined()
  })

  test("cleans an incorrect password from the URL", async () => {
    const denied = await passwordGuard(
      new Request("https://explorer.test/analysis?access=wrong"),
      "held-secret"
    )
    expect(denied?.status).toBe(303)
    expect(denied?.headers.get("location")).toBe("/analysis?denied=1")
    expect(denied?.headers.has("set-cookie")).toBeFalse()
  })

  test("accepts the shared password as a bearer token for API clients", async () => {
    const authorized = await passwordGuard(new Request("https://explorer.test/v1/session", {
      headers: { authorization: "Bearer held-secret" }
    }), "held-secret")
    expect(authorized).toBeUndefined()

    const denied = await passwordGuard(new Request("https://explorer.test/v1/session", {
      headers: { authorization: "Bearer wrong" }
    }), "held-secret")
    expect(denied?.status).toBe(401)
  })
})
