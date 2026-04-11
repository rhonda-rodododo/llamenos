import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { type CryptoLabel, HKDF_CONTEXT_DRAFTS, HKDF_SALT } from '@shared/crypto-labels'
import {
  eciesUnwrapKey,
  eciesWrapKey,
  hkdfDerive,
  symmetricDecrypt,
  symmetricEncrypt,
} from '@shared/crypto-primitives'
import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'

export class ClientCryptoService {
  constructor(
    private readonly secretKey: Uint8Array,
    private readonly pubkey: string
  ) {}

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

  envelopeDecrypt(ct: Ciphertext, envelopes: RecipientEnvelope[], label: CryptoLabel): string {
    const envelope = envelopes.find((e) => e.pubkey === this.pubkey)
    if (!envelope) throw new Error(`No envelope for pubkey ${this.pubkey}`)
    const messageKey = eciesUnwrapKey(envelope, this.secretKey, label)
    return new TextDecoder().decode(symmetricDecrypt(ct, messageKey, utf8ToBytes(label)))
  }

  hubEncrypt(plaintext: string, hubKey: Uint8Array, label: CryptoLabel): Ciphertext {
    return symmetricEncrypt(utf8ToBytes(plaintext), hubKey, utf8ToBytes(label))
  }

  hubDecrypt(ct: Ciphertext, hubKey: Uint8Array, label: CryptoLabel): string | null {
    try {
      return new TextDecoder().decode(symmetricDecrypt(ct, hubKey, utf8ToBytes(label)))
    } catch {
      return null
    }
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
    envelopes: RecipientEnvelope[],
    label: CryptoLabel
  ): Uint8Array {
    const envelope = envelopes.find((e) => e.pubkey === this.pubkey)
    if (!envelope) throw new Error(`No envelope for pubkey ${this.pubkey}`)
    const dataKey = eciesUnwrapKey(envelope, this.secretKey, label)
    return symmetricDecrypt(ct, dataKey, utf8ToBytes(label))
  }

  encryptDraft(plaintext: string): Ciphertext {
    const key = hkdfDerive(
      this.secretKey,
      utf8ToBytes(HKDF_SALT),
      utf8ToBytes(HKDF_CONTEXT_DRAFTS),
      32
    )
    // Draft encryption uses the derived key with empty AAD (local-only, no domain cross-reuse risk)
    return symmetricEncrypt(utf8ToBytes(plaintext), key, new Uint8Array(0))
  }

  decryptDraft(ct: Ciphertext): string {
    const key = hkdfDerive(
      this.secretKey,
      utf8ToBytes(HKDF_SALT),
      utf8ToBytes(HKDF_CONTEXT_DRAFTS),
      32
    )
    return new TextDecoder().decode(symmetricDecrypt(ct, key, new Uint8Array(0)))
  }
}
