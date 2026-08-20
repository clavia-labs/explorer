const COOKIE_NAME = "clavia_explorer_access"

const digest = async (value: string) => {
  const bytes = new TextEncoder().encode(value)
  const held = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(held)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

const cookieValue = (request: Request) => request.headers.get("cookie")
  ?.split(";")
  .map((part) => part.trim().split("="))
  .find(([name]) => name === COOKIE_NAME)?.[1]

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")

const cleanLocation = (url: URL, denied = false) => {
  const query = new URLSearchParams(url.search)
  query.delete("access")
  if (denied) query.set("denied", "1")
  else query.delete("denied")
  const suffix = query.size === 0 ? "" : `?${query}`
  return `${url.pathname}${suffix}`
}

const unlockPage = (url: URL) => {
  const denied = url.searchParams.get("denied") === "1"
  const hidden = [...url.searchParams]
    .filter(([name]) => name !== "access" && name !== "denied")
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("")
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Unlock Clavia Explorer</title>
  <style>
    :root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif;--ground:oklch(95.7% .008 85);--surface:oklch(98.2% .006 85);--raised:oklch(99.4% .004 85);--ink:oklch(27% .012 75);--muted:oklch(47% .018 75);--line:oklch(83% .015 80);--accent:oklch(55% .145 40);--accent-hover:oklch(48% .145 40);--on-accent:oklch(98% .006 85);--failure:oklch(49% .16 30)}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;color:var(--ink);background:var(--ground)}main{width:min(420px,100%);padding:32px;border:1px solid var(--line);border-radius:10px;background:var(--surface);box-shadow:0 18px 50px oklch(28% .03 60/.08)}.mark{width:38px;height:38px;display:grid;place-items:center;border-radius:8px;color:var(--on-accent);background:var(--accent);font-weight:700}p{max-width:38ch;color:var(--muted);line-height:1.55}label{display:grid;gap:8px;margin-top:24px;font-size:13px;font-weight:600}input{min-height:46px;padding:0 12px;border:1px solid var(--line);border-radius:7px;color:var(--ink);background:var(--raised);font:inherit}input:focus{outline:3px solid color-mix(in oklch,var(--accent) 20%,transparent);border-color:var(--accent)}button{width:100%;min-height:46px;margin-top:12px;border:0;border-radius:7px;color:var(--on-accent);background:var(--accent);font:600 14px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer}button:hover{background:var(--accent-hover)}.error{color:var(--failure);font-size:13px}@media(prefers-color-scheme:dark){:root{--ground:oklch(22% .009 75);--surface:oklch(27% .011 75);--raised:oklch(24% .01 75);--ink:oklch(94% .008 85);--muted:oklch(75% .014 80);--line:oklch(38% .014 75);--accent:oklch(64% .14 40);--accent-hover:oklch(69% .13 40);--on-accent:oklch(20% .02 40);--failure:oklch(69% .14 30)}}
  </style>
</head>
<body><main><div class="mark" aria-hidden="true">C</div><h1>Clavia Explorer</h1><p>This private evidence workspace requires the shared access password.</p>${denied ? '<p class="error" role="alert">That password did not match. Try again.</p>' : ""}<form method="get" action="${escapeHtml(url.pathname)}">${hidden}<label for="access">Access password</label><input id="access" name="access" type="password" autocomplete="current-password" required autofocus><button type="submit">Open Explorer</button></form></main></body>
</html>`
}

export const passwordGuard = async (request: Request, password: string | undefined): Promise<Response | undefined> => {
  if (password === undefined || password.length === 0) return undefined
  const url = new URL(request.url)
  const expected = await digest(password)
  if (cookieValue(request) === expected) return undefined
  const authorization = request.headers.get("authorization")
  if (authorization?.startsWith("Bearer ") === true && await digest(authorization.slice(7)) === expected) {
    return undefined
  }

  const submitted = url.searchParams.get("access")
  if (submitted !== null) {
    const authorized = await digest(submitted) === expected
    const headers = new Headers({
      "cache-control": "no-store",
      location: cleanLocation(url, !authorized)
    })
    if (authorized) {
      const secure = url.protocol === "https:" ? "; Secure" : ""
      headers.set("set-cookie", `${COOKIE_NAME}=${expected}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`)
    }
    return new Response(null, { status: 303, headers })
  }

  if (url.pathname.startsWith("/v1/") || url.pathname === "/mcp") {
    return Response.json(
      { error: { code: "ACCESS_REQUIRED", message: "Explorer access is required" } },
      {
        status: 401,
        headers: {
          "cache-control": "no-store",
          vary: "Cookie, Authorization",
          "www-authenticate": "Bearer"
        }
      }
    )
  }
  return new Response(unlockPage(url), {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      vary: "Cookie",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY"
    }
  })
}
