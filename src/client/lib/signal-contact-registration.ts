// @knipignore
// Called by Signal notification settings UI (not yet wired) — server endpoints live in auth-facade.ts
import { LABEL_SIGNAL_CONTACT } from '@shared/crypto-labels'
import { normalizeSignalIdentifier } from '@shared/signal-identifier-normalize'
import { API_BASE } from './api/client'
import { cryptoWorker } from './crypto-worker-client'

async function fetchHmacKey(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/signal-contact/hmac-key`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('hmac-key fetch failed')
  const body = (await res.json()) as { key: string }
  return body.key
}

async function postContact(body: unknown): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/signal-contact`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`contact POST failed: ${res.status}`)
}

export interface RegisterSignalContactOpts {
  plaintextIdentifier: string
  identifierType: 'phone' | 'username'
  userPubkey: string
  /** Recipient's X25519 HPKE public key (raw 32 bytes). */
  recipientHpkePubkey: Uint8Array
}

export async function registerSignalContact(opts: RegisterSignalContactOpts): Promise<void> {
  const userHmacKey = await fetchHmacKey()

  const normalized = normalizeSignalIdentifier(opts.plaintextIdentifier, opts.identifierType)
  const identifierHash = await cryptoWorker.computeHmac(normalized, userHmacKey)

  // HPKE-seal the identifier for the user so they can retrieve + display it later.
  // Each recipient gets their own HpkeEnvelope (no shared symmetric key).
  const contactId = crypto.randomUUID()
  const envelope = await cryptoWorker.hpkeSeal(
    JSON.stringify({ identifier: normalized, type: opts.identifierType }),
    opts.recipientHpkePubkey,
    LABEL_SIGNAL_CONTACT,
    contactId,
    'identifier'
  )

  await postContact({
    id: contactId,
    identifierHash,
    identifierEnvelope: { pubkey: opts.userPubkey, ...envelope },
    identifierType: opts.identifierType,
    plaintextIdentifier: normalized,
  })
}
