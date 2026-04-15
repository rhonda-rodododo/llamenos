import { authFacadeClient } from '../auth-facade-client'

// Split-origin configuration — Tier 4 PR-A.
// In dev the VITE_API_ORIGIN env var is unset and API_ORIGIN resolves to '',
// which yields a same-origin API_BASE of '/api' (the Vite proxy handles it).
// In production the SPA is hosted on app.* and VITE_API_ORIGIN points at
// https://api.* so API_BASE is absolute.
export const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? ''
export const CRYPTO_ORIGIN = import.meta.env.VITE_CRYPTO_ORIGIN ?? ''
export const API_BASE = `${API_ORIGIN}/api`

// Auth expiry callback — set by AuthProvider to handle 401s reactively
let onAuthExpired: (() => void) | null = null
export function setOnAuthExpired(cb: (() => void) | null) {
  onAuthExpired = cb
}

export function getAuthHeaders(): Record<string, string> {
  const token = authFacadeClient.getAccessToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

// Activity tracking callback — set by AuthProvider
let onApiActivity: (() => void) | null = null
export function setOnApiActivity(cb: (() => void) | null) {
  onApiActivity = cb
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...options.headers,
  }
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers,
  })
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) {
      // Session expired — notify auth provider (don't clear nsec for reconnect)
      onAuthExpired?.()
    }
    const body = await res.text()
    throw new ApiError(res.status, body)
  }
  // Track successful API activity for session expiry warning
  onApiActivity?.()
  return res.json()
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`API error ${status}: ${body}`)
    this.name = 'ApiError'
  }
}

// --- Hub context for hub-scoped API calls ---

let activeHubId: string | null = null
export function setActiveHub(id: string | null) {
  activeHubId = id
}
function getActiveHub(): string | null {
  return activeHubId
}

/** Prefix a path with the active hub scope. No-op when no hub is active. */
export function hp(path: string): string {
  return activeHubId ? `/hubs/${activeHubId}${path}` : path
}

/** Fire the auth-expired callback (for use in non-request custom fetch calls). */
export function fireAuthExpired() {
  onAuthExpired?.()
}

/** Fire the API activity callback (for use in non-request custom fetch calls). */
export function fireApiActivity() {
  onApiActivity?.()
}
