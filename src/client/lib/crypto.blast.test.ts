import { describe, expect, test } from 'bun:test'
import {
  decryptBlastContentWithKey,
  encryptBlastContent,
  encryptMessage,
} from '@shared/crypto-envelopes'
import { generateKeyPair } from '@shared/crypto-primitives'
import type { BlastContent } from '@shared/types'

describe('blast content encryption', () => {
  const admin1 = generateKeyPair()
  const admin2 = generateKeyPair()
  const server = generateKeyPair()

  const content: BlastContent = { text: 'Hello subscribers!' }

  test('encrypt → decrypt roundtrip with admin key', () => {
    const { encryptedContent, contentEnvelopes } = encryptBlastContent(content, [
      admin1.publicKey,
      server.publicKey,
    ])
    expect(encryptedContent).toBeTruthy()
    expect(contentEnvelopes).toHaveLength(2)
    const decrypted = decryptBlastContentWithKey(
      encryptedContent,
      contentEnvelopes,
      admin1.secretKey,
      admin1.publicKey
    )
    expect(decrypted).toEqual(content)
  })

  test('encrypt → decrypt roundtrip with server key', () => {
    const { encryptedContent, contentEnvelopes } = encryptBlastContent(content, [
      admin1.publicKey,
      server.publicKey,
    ])
    const decrypted = decryptBlastContentWithKey(
      encryptedContent,
      contentEnvelopes,
      server.secretKey,
      server.publicKey
    )
    expect(decrypted).toEqual(content)
  })

  test('multi-admin: both admins can decrypt', () => {
    const { encryptedContent, contentEnvelopes } = encryptBlastContent(content, [
      admin1.publicKey,
      admin2.publicKey,
      server.publicKey,
    ])
    expect(contentEnvelopes).toHaveLength(3)
    expect(
      decryptBlastContentWithKey(
        encryptedContent,
        contentEnvelopes,
        admin1.secretKey,
        admin1.publicKey
      )
    ).toEqual(content)
    expect(
      decryptBlastContentWithKey(
        encryptedContent,
        contentEnvelopes,
        admin2.secretKey,
        admin2.publicKey
      )
    ).toEqual(content)
  })

  test('wrong key returns null', () => {
    const { encryptedContent, contentEnvelopes } = encryptBlastContent(content, [
      admin1.publicKey,
      server.publicKey,
    ])
    const wrongKey = generateKeyPair()
    expect(
      decryptBlastContentWithKey(
        encryptedContent,
        contentEnvelopes,
        wrongKey.secretKey,
        wrongKey.publicKey
      )
    ).toBeNull()
  })

  test('domain separation: LABEL_BLAST_CONTENT vs LABEL_MESSAGE are incompatible', () => {
    const { encryptedContent, readerEnvelopes } = encryptMessage('hello', [admin1.publicKey])
    // readerEnvelopes has same shape as contentEnvelopes, try to decrypt as blast
    const decrypted = decryptBlastContentWithKey(
      encryptedContent,
      readerEnvelopes,
      admin1.secretKey,
      admin1.publicKey
    )
    expect(decrypted).toBeNull()
  })

  test('empty content envelopes returns null', () => {
    const { encryptedContent } = encryptBlastContent(content, [admin1.publicKey])
    expect(
      decryptBlastContentWithKey(encryptedContent, [], admin1.secretKey, admin1.publicKey)
    ).toBeNull()
  })

  test('nonce uniqueness — same content produces different ciphertext', () => {
    const a = encryptBlastContent(content, [admin1.publicKey])
    const b = encryptBlastContent(content, [admin1.publicKey])
    expect(a.encryptedContent).not.toBe(b.encryptedContent)
  })
})
