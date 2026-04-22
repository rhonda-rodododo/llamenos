import { hexToBytes } from '@noble/hashes/utils.js'
import {
  type CryptoLabel,
  LABEL_HUB_KEY_WRAP,
  LABEL_SERVER_HPKE_KEY,
  LABEL_SERVER_HPKE_KEY_INFO,
} from '@shared/crypto-labels'
import { hkdfDerive } from '@shared/crypto-primitives'
import { createHpkeSuite } from '@shared/crypto-suite'
import type { HpkeEnvelope } from '@shared/hpke-envelope'
import { buildAad, hpkeOpen, hpkeSeal } from '@shared/hpke-primitives'
import { asX25519EncryptionKey, type X25519EncryptionKey } from '@shared/types'

/**
 * Server-side HPKE operations.
 *
 * The server owns a single deterministic HPKE X25519 keypair derived from
 * `SERVER_SECRET` via HKDF-SHA256 + RFC 9180 §7.1.3 `deriveKeyPair`. Rotation
 * is performed by bumping `LABEL_SERVER_HPKE_KEY_INFO` (append `:v2`, etc.).
 *
 * Responsibilities in Tier 1:
 *   - Hold the server HPKE keypair (lazily derived CryptoKey handles + the
 *     32-byte raw public key for distribution to clients)
 *   - Produce HPKE-sealed envelopes addressed to arbitrary recipient pubkeys
 *   - Open HPKE-sealed envelopes addressed to the server
 *
 * It is NOT yet wired into the hub-key-wrap flow — that integration is
 * deferred to the `hub-key-manager.ts` HPKE rewrite (tracked in the Tier 1
 * deferred list in `HPKE_MIGRATION_NOTES.md`). The design intent is that
 * every hub will include the server's HPKE public key as a recipient so the
 * server can re-wrap the hub key when members join/leave, but until the
 * hub-key-manager rewrite lands this class is only exercised by its own
 * tests.
 *
 * It does NOT:
 *   - Know any user PII or notes in plaintext (those will be addressed to
 *     user pubkeys, not the server pubkey)
 *   - Hold a symmetric server key (that responsibility remains on the
 *     existing CryptoService for runtime server-only fields)
 *
 * All seal/open operations MUST be bound with AAD via `buildAad(label, recordId, fieldName)`.
 */
export class HpkeService {
  private cachedPrivateKey: X25519EncryptionKey | null = null
  private cachedPublicKey: X25519EncryptionKey | null = null
  private cachedPublicKeyBytes: Uint8Array | null = null

  constructor(private readonly serverSecretHex: string) {}

  /**
   * Lazily derive the server HPKE keypair from SERVER_SECRET.
   * Uses HKDF(secret, salt=LABEL_SERVER_HPKE_KEY, info=LABEL_SERVER_HPKE_KEY_INFO, len=32)
   * as the IKM for `suite.kem.deriveKeyPair`, which is deterministic per RFC 9180.
   */
  private async getKeyPair(): Promise<{
    privateKey: X25519EncryptionKey
    publicKey: X25519EncryptionKey
  }> {
    if (this.cachedPrivateKey && this.cachedPublicKey) {
      return { privateKey: this.cachedPrivateKey, publicKey: this.cachedPublicKey }
    }
    const ikm = hkdfDerive(
      hexToBytes(this.serverSecretHex),
      new TextEncoder().encode(LABEL_SERVER_HPKE_KEY),
      new TextEncoder().encode(LABEL_SERVER_HPKE_KEY_INFO),
      32
    )
    const suite = createHpkeSuite()
    const kp = (await suite.kem.deriveKeyPair(ikm)) as CryptoKeyPair
    this.cachedPrivateKey = asX25519EncryptionKey(kp.privateKey)
    this.cachedPublicKey = asX25519EncryptionKey(kp.publicKey)
    return { privateKey: this.cachedPrivateKey, publicKey: this.cachedPublicKey }
  }

  async getPrivateKey(): Promise<X25519EncryptionKey> {
    return (await this.getKeyPair()).privateKey
  }

  async getPublicKey(): Promise<X25519EncryptionKey> {
    return (await this.getKeyPair()).publicKey
  }

  /**
   * Raw 32-byte X25519 public key for wire transport (e.g. advertising the
   * server HPKE pubkey to clients that need to include it in hub-key-wrap
   * envelope lists).
   */
  async getPublicKeyBytes(): Promise<Uint8Array> {
    if (this.cachedPublicKeyBytes) return this.cachedPublicKeyBytes
    const suite = createHpkeSuite()
    const pub = await this.getPublicKey()
    const bytes = new Uint8Array(await suite.kem.serializePublicKey(pub))
    this.cachedPublicKeyBytes = bytes
    return bytes
  }

  /**
   * Import a raw 32-byte X25519 public key as a CryptoKey suitable for
   * `hpkeSeal`. Used when the server wraps a hub key for a member given
   * only the member's raw public key bytes.
   */
  async importRecipientPublicKey(raw: Uint8Array): Promise<X25519EncryptionKey> {
    const suite = createHpkeSuite()
    return asX25519EncryptionKey((await suite.kem.deserializePublicKey(raw)) as CryptoKey)
  }

  /**
   * Seal `plaintext` for an arbitrary recipient. Caller supplies the recipient
   * public key (either a CryptoKey handle or 32 raw bytes to import).
   */
  async sealFor(
    plaintext: Uint8Array,
    recipientPublicKey: X25519EncryptionKey | Uint8Array,
    label: CryptoLabel,
    recordId: string,
    fieldName: string
  ): Promise<HpkeEnvelope> {
    const pk =
      recipientPublicKey instanceof Uint8Array
        ? await this.importRecipientPublicKey(recipientPublicKey)
        : recipientPublicKey
    return hpkeSeal(plaintext, pk, label, buildAad(label, recordId, fieldName))
  }

  /**
   * Open an HPKE envelope addressed to the server. Throws on any label/version
   * mismatch or AEAD failure — caller must not swallow errors or fall through.
   */
  async openForServer(
    envelope: HpkeEnvelope,
    expectedLabel: CryptoLabel,
    recordId: string,
    fieldName: string
  ): Promise<Uint8Array> {
    const priv = await this.getPrivateKey()
    return hpkeOpen(envelope, priv, expectedLabel, buildAad(expectedLabel, recordId, fieldName))
  }

  /**
   * Generate a random 32-byte hub key and wrap it (HPKE) for each member
   * pubkey, always including the server as a member so it can re-wrap later.
   *
   * Returns the plaintext hub key (caller discards after use) and the list
   * of per-member envelopes. The AAD binds each envelope to
   * `LABEL_HUB_KEY_WRAP:${memberPubkeyHex}:hub-key-wrap` so a wrapped key
   * cannot be moved between members.
   */
  async generateAndWrapHubKey(memberPubkeys: Uint8Array[]): Promise<{
    hubKey: Uint8Array
    envelopes: Array<{ pubkeyHex: string; envelope: HpkeEnvelope }>
  }> {
    const hubKey = crypto.getRandomValues(new Uint8Array(32))
    const serverPubBytes = await this.getPublicKeyBytes()

    const seen = new Set<string>()
    const all: Uint8Array[] = []
    for (const pk of [...memberPubkeys, serverPubBytes]) {
      const hex = toHex(pk)
      if (seen.has(hex)) continue
      seen.add(hex)
      all.push(pk)
    }

    const envelopes = await Promise.all(
      all.map(async (pk) => {
        const hex = toHex(pk)
        const envelope = await this.sealFor(hubKey, pk, LABEL_HUB_KEY_WRAP, hex, 'hub-key-wrap')
        return { pubkeyHex: hex, envelope }
      })
    )

    return { hubKey, envelopes }
  }

  /**
   * Open the server's own hub-key-wrap envelope from a list of member
   * envelopes. Throws if the server is not a member (callers typically
   * ensure this by construction — every hub has the server).
   */
  async unwrapHubKey(
    envelopes: Array<{ pubkeyHex: string; envelope: HpkeEnvelope }>
  ): Promise<Uint8Array> {
    const serverHex = toHex(await this.getPublicKeyBytes())
    const mine = envelopes.find((e) => e.pubkeyHex === serverHex)
    if (!mine) {
      throw new Error(`No hub-key-wrap envelope for server pubkey ${serverHex}`)
    }
    return this.openForServer(mine.envelope, LABEL_HUB_KEY_WRAP, serverHex, 'hub-key-wrap')
  }

  /**
   * Re-wrap an existing hub key for a new member. Server unwraps its own
   * envelope, produces a fresh HPKE envelope for the new member. Used when
   * a volunteer accepts an invite.
   */
  async wrapHubKeyForNewMember(
    existingEnvelopes: Array<{ pubkeyHex: string; envelope: HpkeEnvelope }>,
    newMemberPubkey: Uint8Array
  ): Promise<{ pubkeyHex: string; envelope: HpkeEnvelope }> {
    const hubKey = await this.unwrapHubKey(existingEnvelopes)
    const hex = toHex(newMemberPubkey)
    const envelope = await this.sealFor(
      hubKey,
      newMemberPubkey,
      LABEL_HUB_KEY_WRAP,
      hex,
      'hub-key-wrap'
    )
    return { pubkeyHex: hex, envelope }
  }
}

function toHex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}
