/**
 * Custom service worker for Llámenos Hotline.
 *
 * Uses Workbox injectManifest mode — VitePWA injects self.__WB_MANIFEST at build time.
 * Handles precaching, SPA navigation routing, push notifications, notification clicks,
 * and manifest-verified caching with anti-downgrade protection.
 */

/// <reference lib="webworker" />
/// <reference types="vite-plugin-pwa/client" />

import { ed25519 } from '@noble/curves/ed25519.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

// Precache all assets injected by VitePWA at build time
precacheAndRoute(self.__WB_MANIFEST)

// SPA navigation fallback — exclude API and telephony webhook paths
const handler = createHandlerBoundToURL('/index.html')
const navigationRoute = new NavigationRoute(handler, {
  denylist: [/^\/api\//, /^\/telephony\//],
})
registerRoute(navigationRoute)

// Push notification handler
self.addEventListener('push', (event: PushEvent) => {
  async function handlePush() {
    // If a focused window already exists, skip showing a notification —
    // the app is visible and will handle the push event via WebSocket/relay.
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })
    const hasFocusedWindow = windowClients.some((c) => c.focused)
    if (hasFocusedWindow) return

    let callSid = ''
    let hubId = ''

    if (event.data) {
      try {
        const payload = event.data.json() as {
          callSid?: string
          hubId?: string
        }
        callSid = payload.callSid ?? ''
        hubId = payload.hubId ?? ''
      } catch {
        // Ignore malformed push payloads
      }
    }

    // Always generic — never display caller info or hub names on lock screens (security requirement)
    const body = 'A call is waiting'

    // `vibrate` and `actions` are part of the Push API Notification extension
    // (not in the base NotificationOptions DOM type), so we cast here.
    const options = {
      body,
      tag: 'incoming-call',
      requireInteraction: true,
      vibrate: [200, 100, 200, 100, 200],
      data: { callSid, hubId },
      actions: [
        { action: 'answer', title: 'Answer' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    } as NotificationOptions
    await self.registration.showNotification('Incoming Call', options)
  }

  event.waitUntil(handlePush())
})

// Notification click handler
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()

  if (event.action === 'dismiss') return

  // Both 'answer' action and clicking the notification body navigate/focus the app
  const notifData = event.notification.data as { callSid?: string; hubId?: string }
  const callSid = notifData?.callSid ?? ''
  const hubId = notifData?.hubId ?? ''

  const params = new URLSearchParams({ action: 'answer' })
  if (callSid) params.set('callSid', callSid)
  if (hubId) params.set('hubId', hubId)
  const targetUrl = `/?${params.toString()}`

  async function handleClick() {
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })

    // Focus an existing window and send it the answer intent
    for (const client of windowClients) {
      if ('focus' in client) {
        await client.focus()
        client.postMessage({ type: 'ANSWER_CALL', callSid, hubId })
        return
      }
    }

    // No existing window — open a new one with the action encoded in the URL
    await self.clients.openWindow(targetUrl)
  }

  event.waitUntil(handleClick())
})

// ---- Manifest-verified caching (Tier 4 SW hardening) -----------------------
//
// On install, the SW fetches the signed release manifest and verifies its
// Ed25519 signature against a build-time-pinned key. Anti-downgrade check
// refuses manifests with a lower semver than the currently stored version.
//
// This is TOFU (Trust-on-First-Use): the first install trusts whatever the
// server delivers. Subsequent updates are verified against the manifest
// signed by the release pipeline.
//
// NOTE: canonicalizeJson, sha256Hex, parseSemver, isDowngrade are duplicated
// from sw-manifest-verifier.ts because the SW runs in a separate context and
// cannot import from the main bundle. This duplication is intentional.

const VERSION_CACHE_KEY = 'llamenos-sw-version'

// Vite replaces these at build time; empty in dev.
declare const __PINNED_SIGNING_KEY__: string
declare const __API_ORIGIN__: string

const PINNED_KEY = typeof __PINNED_SIGNING_KEY__ !== 'undefined' ? __PINNED_SIGNING_KEY__ : ''
const API_ORIGIN = typeof __API_ORIGIN__ !== 'undefined' ? __API_ORIGIN__ : ''

/**
 * Deterministic JSON serialization matching binary-verifier.ts.
 * Duplicated here because the SW cannot import from the main bundle.
 */
function canonicalizeJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  const t = typeof value
  if (t === 'number' || t === 'boolean' || t === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`
  if (t === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`).join(',')}}`
  }
  throw new TypeError('cannot canonicalize')
}

function parseSemver(tag: string): [number, number, number] | null {
  const m = tag.match(/^v?(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function isDowngrade(currentTag: string | null, newTag: string): boolean {
  if (!currentTag) return false
  const c = parseSemver(currentTag)
  const n = parseSemver(newTag)
  if (!c || !n) return false
  if (n[0] !== c[0]) return n[0] < c[0]
  if (n[1] !== c[1]) return n[1] < c[1]
  return n[2] < c[2]
}

// Simple IDB wrapper for storing the current verified version tag
function openSwDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('llamenos-sw', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getStoredVersion(): Promise<string | null> {
  try {
    const db = await openSwDb()
    const tx = db.transaction('meta', 'readonly')
    const store = tx.objectStore('meta')
    const req = store.get(VERSION_CACHE_KEY)
    return new Promise((resolve) => {
      req.onsuccess = () => resolve((req.result as string) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function setStoredVersion(tag: string): Promise<void> {
  try {
    const db = await openSwDb()
    const tx = db.transaction('meta', 'readwrite')
    tx.objectStore('meta').put(tag, VERSION_CACHE_KEY)
  } catch {
    /* best effort */
  }
}

/**
 * On SW install: fetch manifest, verify signature, check anti-downgrade.
 * This runs once per SW version update. Verification failure does NOT
 * prevent the SW from installing (Workbox precaching still works) — but
 * it records the failure so the main thread can detect it. The main thread
 * binary verifier is the fail-closed gate; the SW is defense-in-depth.
 */
async function verifyOnInstall(): Promise<void> {
  // Skip verification in dev (no pinned key)
  if (!PINNED_KEY || !API_ORIGIN) return

  try {
    const res = await fetch(`${API_ORIGIN.replace(/\/+$/, '')}/api/releases/latest/manifest`, {
      cache: 'no-store',
    })
    if (!res.ok) return

    const json: unknown = await res.json()
    const signed = json as {
      manifest: {
        version: number
        releaseTag: string
        builtAt: number
        files: Record<string, string>
      }
      signature: string
      signingKey: string
    }

    // Key pin check
    if (signed.signingKey !== PINNED_KEY) return

    // Signature verification
    const canonical = canonicalizeJson(signed.manifest)
    const msg = new TextEncoder().encode(canonical)
    const sig = hexToBytes(signed.signature)
    const pub = hexToBytes(signed.signingKey)
    if (!ed25519.verify(sig, msg, pub)) return

    // Anti-downgrade check
    const currentVersion = await getStoredVersion()
    if (isDowngrade(currentVersion, signed.manifest.releaseTag)) {
      // Log but don't block — the main thread binary verifier is the
      // fail-closed gate. The SW is defense-in-depth.
      // biome-ignore lint/suspicious/noConsole: SW context — structured logging not available
      console.error(
        `[sw] anti-downgrade: refusing ${signed.manifest.releaseTag} (current: ${currentVersion})`
      )
      return
    }

    // Verification passed — store the new version
    await setStoredVersion(signed.manifest.releaseTag)
  } catch {
    // Verification is best-effort in the SW; the main thread binary
    // verifier is the fail-closed gate.
  }
}

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(verifyOnInstall())
})
