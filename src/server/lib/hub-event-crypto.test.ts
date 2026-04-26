import { describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import { decryptHubEvent, deriveServerEventKey, encryptHubEvent } from './hub-event-crypto'

describe('deriveServerEventKey', () => {
  test('deterministic — same secret produces same key', () => {
    const secret = 'ab'.repeat(32)
    const a = deriveServerEventKey(secret)
    const b = deriveServerEventKey(secret)
    expect(bytesToHex(a)).toBe(bytesToHex(b))
  })

  test('different secrets produce different keys', () => {
    const a = deriveServerEventKey('ab'.repeat(32))
    const b = deriveServerEventKey('cd'.repeat(32))
    expect(bytesToHex(a)).not.toBe(bytesToHex(b))
  })

  test('returns exactly 32 bytes', () => {
    const key = deriveServerEventKey('ab'.repeat(32))
    expect(key).toHaveLength(32)
  })
})

describe('encryptHubEvent / decryptHubEvent', () => {
  const eventKey = deriveServerEventKey('ab'.repeat(32))

  test('roundtrip — encrypt then decrypt recovers original', async () => {
    const content = { type: 'call.started', hubId: 'hub-123', data: { callSid: 'CA456' } }
    const encrypted = await encryptHubEvent(content, eventKey)
    const decrypted = await decryptHubEvent(encrypted, eventKey)
    expect(decrypted).toEqual(content)
  })

  test('wrong key returns null', async () => {
    const wrongKey = deriveServerEventKey('cd'.repeat(32))
    const encrypted = await encryptHubEvent({ test: true }, eventKey)
    const result = await decryptHubEvent(encrypted, wrongKey)
    expect(result).toBeNull()
  })

  test('nonce uniqueness — same input produces different ciphertext', async () => {
    const content = { same: 'data' }
    const a = await encryptHubEvent(content, eventKey)
    const b = await encryptHubEvent(content, eventKey)
    expect(a).not.toBe(b)
  })

  test('handles complex payloads — nested objects, arrays, unicode', async () => {
    const content = {
      type: 'notification',
      data: {
        nested: { deep: true },
        list: [1, 'two', null],
        unicode: '¡Hola! 你好 🔐',
      },
    }
    const encrypted = await encryptHubEvent(content, eventKey)
    const decrypted = await decryptHubEvent(encrypted, eventKey)
    expect(decrypted).toEqual(content)
  })
})
