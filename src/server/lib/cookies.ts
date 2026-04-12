import type { CookieOptions } from 'hono/utils/cookie'

/**
 * Tier 4 PR-A: auth cookie builder.
 *
 * In the split-origin deployment the SPA lives on `app.<parent>` and the API
 * lives on `api.<parent>`. Both hosts share the same registrable domain so
 * requests between them are *same-site* — a `SameSite=Strict` cookie scoped
 * with `Domain=api.<parent>` is still delivered on cross-origin XHR from the
 * SPA, and is never delivered to any third-party site. That gives us strict
 * CSRF protection *and* single-sign-in behaviour without ever touching the
 * weaker `SameSite=None` setting.
 *
 * Discipline rule (Tier 4 session prompt): auth cookies must NEVER use
 * `SameSite=None` — same-site scoping is sufficient because app.* and api.*
 * live under the same eTLD+1.
 */

/**
 * Resolve the Domain attribute for auth cookies. Optional — when unset the
 * cookie defaults to the exact host (`api.<parent>`) which is what we want
 * in production. The env var exists as an escape hatch for alternative
 * deployments (e.g. a shared parent eTLD+1) and for tests.
 */
function apiCookieDomain(): string | undefined {
  return process.env.API_COOKIE_DOMAIN || undefined
}

const ONE_HOUR = 60 * 60
const THIRTY_DAYS = 30 * 24 * ONE_HOUR

/** Shared defaults for every auth cookie. */
function baseOptions(): CookieOptions {
  const domain = apiCookieDomain()
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    ...(domain ? { domain } : {}),
  }
}

/**
 * Cookie options for the opaque refresh token. Scoped to `/api/auth` so it is
 * only ever sent on the refresh endpoints — other auth calls get the access
 * token via the `Authorization` header instead.
 */
export function refreshCookieOptions(maxAge: number = THIRTY_DAYS): CookieOptions {
  return {
    ...baseOptions(),
    path: '/api/auth/token',
    maxAge,
  }
}

/**
 * Cookie options for the session-id marker. Scoped to `/` so every API call
 * can read it for audit/logging, but still Strict + HttpOnly + Secure.
 */
export function sessionIdCookieOptions(maxAge: number = THIRTY_DAYS): CookieOptions {
  return {
    ...baseOptions(),
    path: '/',
    maxAge,
  }
}

/** Cookie options for clearing (logout). Sets `maxAge: 0`. */
export function clearRefreshCookieOptions(): CookieOptions {
  return refreshCookieOptions(0)
}

export function clearSessionIdCookieOptions(): CookieOptions {
  return sessionIdCookieOptions(0)
}
