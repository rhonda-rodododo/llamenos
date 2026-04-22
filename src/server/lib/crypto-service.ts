import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
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
  serverEncrypt(plaintext: string, label: CryptoLabel): Ciphertext {
    return symmetricEncrypt(utf8ToBytes(plaintext), this.deriveKey(label), utf8ToBytes(label))
  }

  /**
   * Decrypt a server-encrypted ciphertext.
   * AAD is derived from the label — must match what was used during encryption.
   */
  serverDecrypt(ct: Ciphertext, label: CryptoLabel): string {
    return new TextDecoder().decode(symmetricDecrypt(ct, this.deriveKey(label), utf8ToBytes(label)))
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
  hubEncryptField(
    plaintext: string,
    hubKey: Uint8Array,
    recordId: string,
    fieldName: string
  ): Ciphertext {
    return symmetricEncrypt(utf8ToBytes(plaintext), hubKey, hubFieldAad(recordId, fieldName))
  }

  /**
   * Decrypt a hub-scoped record field. Returns null on auth failure.
   * Must be called with the same `(recordId, fieldName)` tuple used at encrypt.
   */
  hubDecryptField(
    ct: Ciphertext,
    hubKey: Uint8Array,
    recordId: string,
    fieldName: string
  ): string | null {
    try {
      return new TextDecoder().decode(
        symmetricDecrypt(ct, hubKey, hubFieldAad(recordId, fieldName))
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
  hubEncryptPrimitive(plaintext: string, hubKey: Uint8Array, label: CryptoLabel): Ciphertext {
    return symmetricEncrypt(utf8ToBytes(plaintext), hubKey, utf8ToBytes(label))
  }

  /** Raw hub-key AEAD primitive (decrypt). See {@link hubEncryptPrimitive}. */
  hubDecryptPrimitive(ct: Ciphertext, hubKey: Uint8Array, label: CryptoLabel): string | null {
    try {
      return new TextDecoder().decode(symmetricDecrypt(ct, hubKey, utf8ToBytes(label)))
    } catch {
      return null
    }
  }

  hmac(input: string, label: string): HmacHash {
    const data = utf8ToBytes(`${label}${input}`)
    return bytesToHex(hmacSha256(this.getHmacKey(), data)) as HmacHash
  }

  /**
   * Envelope-encrypt a plaintext string for multiple recipients.
   *
   * Generates a random message key, symmetric-encrypts the plaintext,
   * then HPKE-seals the message key per recipient. Returns the shared
   * ciphertext and per-recipient HPKE envelopes.
   */
  async envelopeEncrypt(
    plaintext: string,
    recipientPubkeys: string[],
    label: CryptoLabel
  ): Promise<{ encrypted: Ciphertext; envelopes: RecipientEnvelope[] }> {
    const messageKey = new Uint8Array(32)
    crypto.getRandomValues(messageKey)
    const encrypted = symmetricEncrypt(utf8ToBytes(plaintext), messageKey, utf8ToBytes(label))
    const envelopes: RecipientEnvelope[] = await Promise.all(
      recipientPubkeys.map(async (pk) => {
        const envelope = await this.hpke.sealForHex(messageKey, pk, label, 'envelope', 'key-wrap')
        return { ...envelope, pubkey: pk }
      })
    )
    messageKey.fill(0)
    return { encrypted, envelopes }
  }

  /**
   * Decrypt an envelope-encrypted ciphertext using the server's HPKE key.
   *
   * Opens the HPKE envelope to recover the message key, then
   * symmetric-decrypts the shared ciphertext. Server-only — the
   * server's HPKE private key is used automatically.
   */
  async envelopeDecrypt(
    ct: Ciphertext,
    envelope: RecipientEnvelope,
    label: CryptoLabel
  ): Promise<string> {
    const messageKey = await this.hpke.openForServer(envelope, label, 'envelope', 'key-wrap')
    return new TextDecoder().decode(symmetricDecrypt(ct, messageKey, utf8ToBytes(label)))
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
    recipientPubkeys: string[],
    label: CryptoLabel
  ): Promise<{ encrypted: Ciphertext; envelopes: RecipientEnvelope[] }> {
    const dataKey = new Uint8Array(32)
    crypto.getRandomValues(dataKey)
    const encrypted = symmetricEncrypt(data, dataKey, utf8ToBytes(label))
    const envelopes: RecipientEnvelope[] = await Promise.all(
      recipientPubkeys.map(async (pk) => {
        const envelope = await this.hpke.sealForHex(dataKey, pk, label, 'envelope', 'key-wrap')
        return { ...envelope, pubkey: pk }
      })
    )
    dataKey.fill(0)
    return { encrypted, envelopes }
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
    return symmetricDecrypt(ct, dataKey, utf8ToBytes(label))
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
