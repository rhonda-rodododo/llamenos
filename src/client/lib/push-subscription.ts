/**
 * Client-side Web Push subscription management.
 *
 * Handles subscribing/unsubscribing from push notifications via the browser
 * PushManager API and syncing subscription state with the server.
 */

import { API_BASE } from './api/client'

/** Returns true if the browser supports Web Push */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** Converts a base64url VAPID public key to Uint8Array backed by ArrayBuffer for PushManager.subscribe() */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/**
 * Derives a simplified device label from the user agent.
 * Returns e.g. "Chrome/Linux", "Firefox/Android", "Safari/iOS"
 */
function getDeviceLabel(): string {
  const ua = navigator.userAgent

  // OS detection
  let os = 'Unknown'
  if (/Android/.test(ua)) os = 'Android'
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
  else if (/Windows/.test(ua)) os = 'Windows'
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'macOS'
  else if (/Linux/.test(ua)) os = 'Linux'
  else if (/CrOS/.test(ua)) os = 'ChromeOS'

  // Browser detection (order matters — check Edge before Chrome, Samsung before Chrome)
  let browser = 'Browser'
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung'
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Chrome\//.test(ua)) browser = 'Chrome'
  else if (/Safari\//.test(ua)) browser = 'Safari'

  return `${browser}/${os}`
}

/** Returns true if there is an active push subscription */
export async function isPushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false
  try {
    // navigator.serviceWorker.ready never rejects but can hang indefinitely
    // if the service worker is registered but never activates (e.g. self-signed
    // TLS certs, cert errors, or SW update stuck in waiting state).
    // Race with a 3s timeout to prevent blocking callers.
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SW ready timeout')), 3000)
      ),
    ])
    const subscription = await registration.pushManager.getSubscription()
    return subscription !== null
  } catch {
    return false
  }
}

/**
 * Subscribes to Web Push notifications.
 *
 * 1. Fetches the VAPID public key from the server
 * 2. Subscribes via PushManager
 * 3. Sends the subscription to the server
 *
 * Returns true on success, false if unsupported or if any step fails.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) return false
  if (Notification.permission !== 'granted') return false

  try {
    // Fetch VAPID public key
    const resp = await fetch(`${API_BASE}/notifications/vapid-public-key`, {
      credentials: 'include',
    })
    if (!resp.ok) return false
    const { publicKey } = (await resp.json()) as { publicKey: string }
    if (!publicKey) return false

    // Get service worker registration
    const registration = await navigator.serviceWorker.ready

    // Subscribe (or reuse existing subscription)
    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
    }

    // Serialize subscription for the server
    const json = subscription.toJSON()
    const { endpoint, keys } = json
    if (!endpoint || !keys?.p256dh || !keys?.auth) return false

    // Send subscription to server (uses authenticated API helper)
    const { subscribePush } = await import('./api')
    await subscribePush({
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      deviceLabel: getDeviceLabel(),
    })

    return true
  } catch {
    return false
  }
}

/**
 * Unsubscribes from Web Push notifications.
 *
 * 1. Gets the current subscription
 * 2. DELETEs it from the server
 * 3. Calls subscription.unsubscribe()
 *
 * Returns true on success, false if there was no subscription or an error occurred.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return false

    // Notify server first (uses authenticated API helper)
    const { unsubscribePush } = await import('./api')
    await unsubscribePush(subscription.endpoint).catch(() => {
      // Continue with local unsubscribe even if server call fails
    })

    return await subscription.unsubscribe()
  } catch {
    return false
  }
}
