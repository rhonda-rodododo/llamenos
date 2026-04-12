import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  type CryptoLabel,
  HMAC_IP_PREFIX,
  LABEL_HUB_KEY_WRAP,
  LABEL_SERVER_NOSTR_KEY,
  LABEL_SERVER_NOSTR_KEY_INFO,
} from '@shared/crypto-labels'
import {
  eciesUnwrapKey,
  eciesWrapKey,
  hkdfDerive,
  hmacSha256,
  symmetricDecrypt,
  symmetricEncrypt,
} from '@shared/crypto-primitives'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import { hubFieldAad } from '@shared/lib/hub-field-aad'
import type { RecipientEnvelope } from '@shared/types'

/**
 * Server-side cryptographic operations.
 *
 * Encryption tiers (in order of preference):
 * 1. Envelope E2EE (ECIES per-recipient) — contacts, notes, PII, user/invite phone
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
  private cachedServerPrivateKey: Uint8Array | null = null
  private cachedServerPubkey: string | null = null
  private cachedHmacKey: Uint8Array | null = null

  constructor(
    private readonly serverSecret: string,
    private readonly hmacSecret: string
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

  private getServerPrivateKey(): { privateKey: Uint8Array; pubkey: string } {
    if (!this.cachedServerPrivateKey) {
      this.cachedServerPrivateKey = hkdfDerive(
        hexToBytes(this.serverSecret),
        utf8ToBytes(LABEL_SERVER_NOSTR_KEY),
        utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO),
        32
      )
      this.cachedServerPubkey = bytesToHex(
        secp256k1.getPublicKey(this.cachedServerPrivateKey, true).slice(1)
      )
    }
    return { privateKey: this.cachedServerPrivateKey, pubkey: this.cachedServerPubkey! }
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

  envelopeEncrypt(
    plaintext: string,
    recipientPubkeys: string[],
    label: CryptoLabel
  ): { encrypted: Ciphertext; envelopes: RecipientEnvelope[] } {
    const messageKey = new Uint8Array(32)
    crypto.getRandomValues(messageKey)
    const encrypted = symmetricEncrypt(utf8ToBytes(plaintext), messageKey, utf8ToBytes(label))
    const envelopes: RecipientEnvelope[] = recipientPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKey(messageKey, pk, label),
    }))
    return { encrypted, envelopes }
  }

  envelopeDecrypt(
    ct: Ciphertext,
    envelope: RecipientEnvelope,
    secretKey: Uint8Array,
    label: CryptoLabel
  ): string {
    const messageKey = eciesUnwrapKey(envelope, secretKey, label)
    return new TextDecoder().decode(symmetricDecrypt(ct, messageKey, utf8ToBytes(label)))
  }

  envelopeEncryptBinary(
    data: Uint8Array,
    recipientPubkeys: string[],
    label: CryptoLabel
  ): { encrypted: Ciphertext; envelopes: RecipientEnvelope[] } {
    const dataKey = new Uint8Array(32)
    crypto.getRandomValues(dataKey)
    const encrypted = symmetricEncrypt(data, dataKey, utf8ToBytes(label))
    const envelopes: RecipientEnvelope[] = recipientPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKey(dataKey, pk, label),
    }))
    return { encrypted, envelopes }
  }

  envelopeDecryptBinary(
    ct: Ciphertext,
    envelope: RecipientEnvelope,
    secretKey: Uint8Array,
    label: CryptoLabel
  ): Uint8Array {
    const dataKey = eciesUnwrapKey(envelope, secretKey, label)
    return symmetricDecrypt(ct, dataKey, utf8ToBytes(label))
  }

  unwrapHubKey(
    envelopes: Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>
  ): Uint8Array {
    const { privateKey, pubkey } = this.getServerPrivateKey()
    const envelope = envelopes.find((e) => e.pubkey === pubkey)
    if (!envelope) {
      throw new Error(`No hub key envelope for server pubkey ${pubkey}`)
    }
    return eciesUnwrapKey(envelope, privateKey, LABEL_HUB_KEY_WRAP)
  }

  /** Get the server's x-only public key hex (for hub key envelope inclusion). */
  getServerPubkey(): string {
    return this.getServerPrivateKey().pubkey
  }

  /**
   * Generate a random hub key and ECIES-wrap it for each recipient pubkey.
   * Always includes the server's own pubkey so the server can later re-wrap
   * for new members (e.g., when an invite is redeemed).
   */
  generateAndWrapHubKey(recipientPubkeys: string[]): {
    hubKey: Uint8Array
    envelopes: Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>
  } {
    const hubKey = crypto.getRandomValues(new Uint8Array(32))
    const serverPubkey = this.getServerPubkey()
    const allPubkeys = [...new Set([...recipientPubkeys, serverPubkey])]
    const envelopes = allPubkeys.map((pubkey) => {
      const { wrappedKey, ephemeralPubkey } = eciesWrapKey(hubKey, pubkey, LABEL_HUB_KEY_WRAP)
      return { pubkey, wrappedKey, ephemeralPubkey }
    })
    return { hubKey, envelopes }
  }

  /**
   * Wrap an existing hub key for a new recipient pubkey.
   * Server unwraps its own envelope, then ECIES-wraps for the new recipient.
   */
  wrapHubKeyForNewMember(
    existingEnvelopes: Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>,
    newMemberPubkey: string
  ): { pubkey: string; wrappedKey: string; ephemeralPubkey: string } {
    const hubKey = this.unwrapHubKey(existingEnvelopes)
    const { wrappedKey, ephemeralPubkey } = eciesWrapKey(
      hubKey,
      newMemberPubkey,
      LABEL_HUB_KEY_WRAP
    )
    return { pubkey: newMemberPubkey, wrappedKey, ephemeralPubkey }
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
