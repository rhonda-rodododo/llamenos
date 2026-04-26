import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { type CryptoLabel, HMAC_IP_PREFIX } from '@shared/crypto-labels'
import {
  hkdfDerive,
  hmacSha256,
  symmetricDecrypt,
  symmetricEncrypt,
} from '@shared/crypto-primitives'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import { hubFieldAad } from '@shared/lib/hub-field-aad'
import type { RecipientEnvelope } from '@shared/types'
import type { HpkeService } from './hpke-service'

/**
 * Server-side cryptographic operations.
 *
 * Encryption tiers (in order of preference):
 * 1. Envelope E2EE (HPKE per-recipient key-wrap) — contacts, notes, PII, user/invite phone
 * 2. Hub-key E2EE (symmetric, all hub members) — org metadata (role/hub/team/shift/tag names)
 * 3. Server-key (below) — ONLY for fields the server must process at runtime
 *
 * Fields that MUST remain server-key encrypted:
 * - provider_config credentials (server calls telephony/messaging APIs)
 * - ivr_audio data (server serves to telephony bridge)
 * - blast_settings welcome/bye/opt-in messages (server sends SMS)
 * - push_subscriptions endpoint/auth/p256dh (server sends web push)
 * - subscribers identifier (server sends blasts)
 * - geocoding_config api_key (server calls geocoding API)
 * - signal_registration_pending number (server registers with Signal bridge)
 * - audit_log event/details (server writes audit entries)
 * - active_calls caller number (server routes calls)
 * - call_legs phone (server initiates call legs)
 *
 * All other encrypted fields use hub-key E2EE or envelope E2EE.
 */
export class CryptoService {
  private derivedKeys = new Map<string, Uint8Array>()
  private cachedHmacKey: Uint8Array | null = null

  constructor(
    private readonly serverSecret: string,
    private readonly hmacSecret: string,
    readonly hpke: HpkeService
  ) {}

  private deriveKey(label: CryptoLabel): Uint8Array {
    let key = this.derivedKeys.get(label)
    if (!key) {
      key = hkdfDerive(hexToBytes(this.serverSecret), new Uint8Array(0), utf8ToBytes(label), 32)
      this.derivedKeys.set(label, key)
    }
    return key
  }

  private getHmacKey(): Uint8Array {
    if (!this.cachedHmacKey) {
      this.cachedHmacKey = hexToBytes(this.hmacSecret)
    }
    return this.cachedHmacKey
  }

  /**
   * Encrypt a plaintext string with a server-derived key.
   * AAD is derived from the label, binding the ciphertext to this domain.
   */
  async serverEncrypt(plaintext: string, label: CryptoLabel): Promise<Ciphertext> {
    return symmetricEncrypt(utf8ToBytes(plaintext), this.deriveKey(label), utf8ToBytes(label))
  }

  /**
   * Decrypt a server-encrypted ciphertext.
   * AAD is derived from the label — must match what was used during encryption.
   */
  async serverDecrypt(ct: Ciphertext, label: CryptoLabel): Promise<string> {
    return new TextDecoder().decode(
      await symmetricDecrypt(ct, this.deriveKey(label), utf8ToBytes(label))
    )
  }

  /**
   * Encrypt a hub-scoped record field.
   *
   * AAD binds the ciphertext to `(recordId, fieldName)` via the shared
   * {@link hubFieldAad} formula so the resulting ciphertext is decryptable
   * by clients that use `hub-field-crypto.ts`. Any server-side path that
   * seeds or produces hub-field ciphertext for a row with a known id MUST
   * use this method so the formula matches the client's.
   *
   * The lower-level `hubEncryptPrimitive` exists only as a test hook for
   * the AEAD primitive itself — production code must not call it directly.
   */
  async hubEncryptField(
    plaintext: string,
    hubKey: Uint8Array,
    recordId: string,
    fieldName: string
  ): Promise<Ciphertext> {
    return symmetricEncrypt(utf8ToBytes(plaintext), hubKey, hubFieldAad(recordId, fieldName))
  }

  /**
   * Decrypt a hub-scoped record field. Returns null on auth failure.
   * Must be called with the same `(recordId, fieldName)` tuple used at encrypt.
   */
  async hubDecryptField(
    ct: Ciphertext,
    hubKey: Uint8Array,
    recordId: string,
    fieldName: string
  ): Promise<string | null> {
    try {
      return new TextDecoder().decode(
        await symmetricDecrypt(ct, hubKey, hubFieldAad(recordId, fieldName))
      )
    } catch {
      return null
    }
  }

  /**
   * Raw hub-key AEAD primitive. Test-only entry point — production hub-field
   * ciphertext MUST go through {@link hubEncryptField} / {@link hubDecryptField}
   * so the AAD formula is consistent with the client.
   */
  async hubEncryptPrimitive(
    plaintext: string,
    hubKey: Uint8Array,
    label: CryptoLabel
  ): Promise<Ciphertext> {
    return symmetricEncrypt(utf8ToBytes(plaintext), hubKey, utf8ToBytes(label))
  }

  /** Raw hub-key AEAD primitive (decrypt). See {@link hubEncryptPrimitive}. */
  async hubDecryptPrimitive(
    ct: Ciphertext,
    hubKey: Uint8Array,
    label: CryptoLabel
  ): Promise<string | null> {
    try {
      return new TextDecoder().decode(await symmetricDecrypt(ct, hubKey, utf8ToBytes(label)))
    } catch {
      return null
    }
  }

  hmac(input: string, label: string): HmacHash {
    const data = utf8ToBytes(`${label}${input}`)
    return bytesToHex(hmacSha256(this.getHmacKey(), data)) as HmacHash
  }

  /**
   * Envelope-encrypt a plaintext string.
   *
   * HPKE single-shot seal using the server's own X25519 keypair. The server
   * is always included as a recipient so `envelopeDecrypt` (openForServer)
   * works. User-specific envelopes require the user's registered X25519
   * HPKE public key — until X25519 pubkey registration is implemented, only
   * the server envelope is created.
   *
   * `recipientPubkeys` (secp256k1 identity pubkeys) are accepted for API
   * compatibility but currently unused for sealing — secp256k1 bytes are not
   * valid X25519 public keys.
   *
   * @param recordId  Bound into AAD — must match what the client passes
   *                  to `hpkeOpen`. Typically `obj.id ?? ''`.
   * @param fieldName Bound into AAD — must match the client's derived
   *                  field name (e.g. `'name'` for `encryptedName`).
   */
  async envelopeEncrypt(
    plaintext: string,
    _recipientPubkeys: string[],
    label: CryptoLabel,
    recordId = '',
    fieldName = ''
  ): Promise<{ encrypted: Ciphertext; envelopes: RecipientEnvelope[] }> {
    const ptBytes = utf8ToBytes(plaintext)
    // Seal for the server's own X25519 HPKE key — correct curve, server can decrypt
    const serverPubkeyHex = await this.hpke.getServerPubkeyHex()
    const serverEnvelope = await this.hpke.sealForHex(
      ptBytes,
      serverPubkeyHex,
      label,
      recordId,
      fieldName
    )
    return {
      encrypted: '' as Ciphertext,
      envelopes: [{ ...serverEnvelope, pubkey: serverPubkeyHex }],
    }
  }

  /**
   * Decrypt an envelope-encrypted field using the server's HPKE key.
   *
   * HPKE single-shot open — the envelope contains the sealed plaintext
   * directly. The `ct` parameter is ignored (legacy column compat).
   */
  async envelopeDecrypt(
    _ct: Ciphertext,
    envelope: RecipientEnvelope,
    label: CryptoLabel,
    recordId = '',
    fieldName = ''
  ): Promise<string> {
    const pt = await this.hpke.openForServer(envelope, label, recordId, fieldName)
    return new TextDecoder().decode(pt)
  }

  /**
   * Find the server's own envelope from a list and decrypt it.
   * Returns undefined if no server envelope is found.
   */
  async envelopeDecryptFromList(
    envelopes: RecipientEnvelope[],
    label: CryptoLabel,
    recordId = '',
    fieldName = ''
  ): Promise<string | undefined> {
    if (!envelopes?.length) return undefined
    const serverPubkey = await this.hpke.getServerPubkeyHex()
    const envelope = envelopes.find((e) => e.pubkey === serverPubkey)
    if (!envelope) return undefined
    try {
      return await this.envelopeDecrypt('' as Ciphertext, envelope, label, recordId, fieldName)
    } catch {
      return undefined
    }
  }

  /**
   * Envelope-encrypt binary data for multiple recipients.
   *
   * Uses the shared-ciphertext model: random data key → symmetric encrypt →
   * HPKE-seal the data key per recipient. Suitable for large binary data
   * (voicemail audio) where per-recipient copies would be wasteful.
   */
  async envelopeEncryptBinary(
    data: Uint8Array,
    _recipientPubkeys: string[],
    label: CryptoLabel
  ): Promise<{ encrypted: Ciphertext; envelopes: RecipientEnvelope[] }> {
    const dataKey = new Uint8Array(32)
    crypto.getRandomValues(dataKey)
    const encrypted = await symmetricEncrypt(data, dataKey, utf8ToBytes(label))
    // Seal data key for server's own X25519 HPKE key
    const serverPubkeyHex = await this.hpke.getServerPubkeyHex()
    const serverEnvelope = await this.hpke.sealForHex(
      dataKey,
      serverPubkeyHex,
      label,
      'envelope',
      'key-wrap'
    )
    dataKey.fill(0)
    return {
      encrypted,
      envelopes: [{ ...serverEnvelope, pubkey: serverPubkeyHex }],
    }
  }

  /**
   * Decrypt envelope-encrypted binary data using the server's HPKE key.
   */
  async envelopeDecryptBinary(
    ct: Ciphertext,
    envelope: RecipientEnvelope,
    label: CryptoLabel
  ): Promise<Uint8Array> {
    const dataKey = await this.hpke.openForServer(envelope, label, 'envelope', 'key-wrap')
    return symmetricDecrypt(ct, dataKey, utf8ToBytes(label)) as Promise<Uint8Array>
  }

  /** Get the server's HPKE X25519 public key hex (for envelope recipient lists). */
  async getServerPubkey(): Promise<string> {
    return this.hpke.getServerPubkeyHex()
  }
}

/**
 * Standalone helper: hash an IP address for rate limiting.
 * Uses HMAC-SHA256 with the server HMAC secret to prevent precomputation attacks.
 * Truncated to 24 hex chars for storage efficiency.
 */
export function hashIP(ip: string, secret: string): string {
  const key = hexToBytes(secret)
  const input = utf8ToBytes(`${HMAC_IP_PREFIX}${ip}`)
  return bytesToHex(hmacSha256(key, input)).slice(0, 24)
}
