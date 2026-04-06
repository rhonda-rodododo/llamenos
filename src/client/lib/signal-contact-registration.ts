import { LABEL_SIGNAL_CONTACT } from '@shared/crypto-labels'
import { normalizeSignalIdentifier } from '@shared/signal-identifier-normalize'
import { cryptoWorker } from './crypto-worker-client'

async function fetchHmacKey(): Promise<string> {
  const res = await fetch('/api/auth/signal-contact/hmac-key', { credentials: 'include' })
  if (!res.ok) throw new Error('hmac-key fetch failed')
  const body = (await res.json()) as { key: string }
  return body.key
}

async function postContact(body: unknown): Promise<void> {
  const res = await fetch('/api/auth/signal-contact', {
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
}

export async function registerSignalContact(opts: RegisterSignalContactOpts): Promise<void> {
  const userHmacKey = await fetchHmacKey()

  const normalized = normalizeSignalIdentifier(opts.plaintextIdentifier, opts.identifierType)
  const identifierHash = await cryptoWorker.computeHmac(normalized, userHmacKey)

  // Envelope-encrypt the identifier for the user so they can retrieve + display it later
  const { encryptedHex, envelopes } = await cryptoWorker.envelopeEncryptField(
    JSON.stringify({ identifier: normalized, type: opts.identifierType }),
    [opts.userPubkey],
    LABEL_SIGNAL_CONTACT
  )

  // Single server call — the app server proxies registration to the notifier
  // sidecar using its own API key. Clients never talk to the notifier directly.
  await postContact({
    identifierHash,
    identifierCiphertext: encryptedHex,
    identifierEnvelope: envelopes,
    identifierType: opts.identifierType,
    plaintextIdentifier: normalized,
  })
}
