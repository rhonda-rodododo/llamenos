import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { type CryptoLabel, HKDF_CONTEXT_DRAFTS, HKDF_SALT } from '@shared/crypto-labels'
import { hkdfDerive, symmetricDecrypt, symmetricEncrypt } from '@shared/crypto-primitives'
import { createHpkeSuite } from '@shared/crypto-suite'
import type { Ciphertext } from '@shared/crypto-types'
import { buildAad, hpkeOpen, hpkeSeal } from '@shared/hpke-primitives'
import type { X25519EncryptionKey } from '@shared/types'
import { asX25519EncryptionKey, type RecipientEnvelope } from '@shared/types'

export class ClientCryptoService {
  private constructor(
    private readonly secretKey: Uint8Array,
    private readonly pubkey: string,
    private readonly hpkePrivateKey: X25519EncryptionKey
  ) {}

  /**
   * Create a ClientCryptoService by importing the raw secret key into the
   * HPKE KEM as a non-extractable X25519 private CryptoKey.
   */
  static async create(secretKey: Uint8Array, pubkey: string): Promise<ClientCryptoService> {
    const suite = createHpkeSuite()
    const privateKey = asX25519EncryptionKey(
      (await suite.kem.importKey('raw', secretKey.buffer as ArrayBuffer, false)) as CryptoKey
    )
    return new ClientCryptoService(secretKey, pubkey, privateKey)
  }

  async envelopeEncrypt(
    plaintext: string,
    recipientPubkeys: string[],
    label: CryptoLabel
  ): Promise<{ encrypted: Ciphertext; envelopes: RecipientEnvelope[] }> {
    const messageKey = new Uint8Array(32)
    crypto.getRandomValues(messageKey)
    const aad = utf8ToBytes(label)
    const encrypted = await symmetricEncrypt(utf8ToBytes(plaintext), messageKey, aad)
    const suite = createHpkeSuite()
    const envelopes: RecipientEnvelope[] = await Promise.all(
      recipientPubkeys.map(async (pk) => {
        const recipientKey = asX25519EncryptionKey(
          (await suite.kem.deserializePublicKey(hexToBytes(pk))) as CryptoKey
        )
        const envelope = await hpkeSeal(
          messageKey,
          recipientKey,
          label,
          buildAad(label, pk, 'envelope')
        )
        return { pubkey: pk, ...envelope }
      })
    )
    return { encrypted, envelopes }
  }

  async envelopeDecrypt(
    ct: Ciphertext,
    envelopes: RecipientEnvelope[],
    label: CryptoLabel
  ): Promise<string> {
    const envelope = envelopes.find((e) => e.pubkey === this.pubkey)
    if (!envelope) throw new Error(`No envelope for pubkey ${this.pubkey}`)
    const aad = buildAad(label, this.pubkey, 'envelope')
    const messageKey = await hpkeOpen(envelope, this.hpkePrivateKey, label, aad)
    return new TextDecoder().decode(await symmetricDecrypt(ct, messageKey, utf8ToBytes(label)))
  }

  async envelopeEncryptBinary(
    data: Uint8Array,
    recipientPubkeys: string[],
    label: CryptoLabel
  ): Promise<{ encrypted: Ciphertext; envelopes: RecipientEnvelope[] }> {
    const dataKey = new Uint8Array(32)
    crypto.getRandomValues(dataKey)
    const aad = utf8ToBytes(label)
    const encrypted = await symmetricEncrypt(data, dataKey, aad)
    const suite = createHpkeSuite()
    const envelopes: RecipientEnvelope[] = await Promise.all(
      recipientPubkeys.map(async (pk) => {
        const recipientKey = asX25519EncryptionKey(
          (await suite.kem.deserializePublicKey(hexToBytes(pk))) as CryptoKey
        )
        const envelope = await hpkeSeal(
          dataKey,
          recipientKey,
          label,
          buildAad(label, pk, 'envelope')
        )
        return { pubkey: pk, ...envelope }
      })
    )
    return { encrypted, envelopes }
  }

  async envelopeDecryptBinary(
    ct: Ciphertext,
    envelopes: RecipientEnvelope[],
    label: CryptoLabel
  ): Promise<Uint8Array> {
    const envelope = envelopes.find((e) => e.pubkey === this.pubkey)
    if (!envelope) throw new Error(`No envelope for pubkey ${this.pubkey}`)
    const aad = buildAad(label, this.pubkey, 'envelope')
    const dataKey = await hpkeOpen(envelope, this.hpkePrivateKey, label, aad)
    return symmetricDecrypt(ct, dataKey, utf8ToBytes(label))
  }

  async encryptDraft(plaintext: string): Promise<Ciphertext> {
    const key = hkdfDerive(
      this.secretKey,
      utf8ToBytes(HKDF_SALT),
      utf8ToBytes(HKDF_CONTEXT_DRAFTS),
      32
    )
    // Draft encryption uses the derived key with empty AAD (local-only, no domain cross-reuse risk)
    return symmetricEncrypt(utf8ToBytes(plaintext), key, new Uint8Array(0))
  }

  async decryptDraft(ct: Ciphertext): Promise<string> {
    const key = hkdfDerive(
      this.secretKey,
      utf8ToBytes(HKDF_SALT),
      utf8ToBytes(HKDF_CONTEXT_DRAFTS),
      32
    )
    return new TextDecoder().decode(await symmetricDecrypt(ct, key, new Uint8Array(0)))
  }
}
