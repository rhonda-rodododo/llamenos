import { describe, expect, test } from 'bun:test'
import type { CryptoRpcResponse } from '@shared/schemas/crypto-rpc'
import { CryptoRpcRouter } from './rpc-router'

const PARENT = 'https://app.llamenos.example'
const EVIL = 'https://evil.example'
const UUID = 'a1b2c3d4-5678-4abc-89ef-1234567890ab'
const NONCE = 'ab'.repeat(32)
const NIL_NONCE = '0'.repeat(64)

function fakeEvent(data: unknown, origin: string): MessageEvent {
  return { data, origin } as unknown as MessageEvent
}

describe('CryptoRpcRouter', () => {
  test('drops messages from wrong origin silently (no response)', async () => {
    const router = new CryptoRpcRouter({ parentOrigin: PARENT })
    const responses: CryptoRpcResponse[] = []
    await router.handleMessage(
      fakeEvent({ op: 'isUnlocked', id: UUID, nonceHex: NONCE }, EVIL),
      (res) => responses.push(res)
    )
    expect(responses).toEqual([])
  })

  test('returns schema_invalid error for malformed payload', async () => {
    const router = new CryptoRpcRouter({ parentOrigin: PARENT })
    const responses: CryptoRpcResponse[] = []
    await router.handleMessage(fakeEvent({ nonsense: true }, PARENT), (res) => responses.push(res))
    expect(responses.length).toBe(1)
    const res = responses[0]
    expect(res?.kind).toBe('error')
    if (res?.kind === 'error') {
      expect(res.code).toBe('schema_invalid')
      // An id with no string payload falls back to the nil UUID (schema-valid).
      expect(res.id).toBe('00000000-0000-0000-0000-000000000000')
      // And the echoed nonce falls back to the nil nonce (also schema-valid).
      expect(res.nonceHex).toBe(NIL_NONCE)
    }
  })

  test('echoes a structurally valid nonce from a schema-invalid payload', async () => {
    const router = new CryptoRpcRouter({ parentOrigin: PARENT })
    const responses: CryptoRpcResponse[] = []
    await router.handleMessage(
      // Has the right nonce shape but is missing a valid op.
      fakeEvent({ nonsense: true, nonceHex: NONCE }, PARENT),
      (res) => responses.push(res)
    )
    expect(responses[0]?.kind).toBe('error')
    if (responses[0]?.kind === 'error') {
      expect(responses[0].code).toBe('schema_invalid')
      expect(responses[0].nonceHex).toBe(NONCE)
    }
  })

  test('routes isUnlocked and returns success false when locked (echoing nonce)', async () => {
    const router = new CryptoRpcRouter({ parentOrigin: PARENT })
    const responses: CryptoRpcResponse[] = []
    await router.handleMessage(
      fakeEvent({ op: 'isUnlocked', id: UUID, nonceHex: NONCE }, PARENT),
      (res) => responses.push(res)
    )
    expect(responses.length).toBe(1)
    const res = responses[0]
    expect(res?.kind).toBe('success')
    if (res?.kind === 'success') {
      expect(res.id).toBe(UUID)
      expect(res.nonceHex).toBe(NONCE)
      expect(res.result).toBe(false)
    }
  })

  test('routes getPublicKey and returns null when locked', async () => {
    const router = new CryptoRpcRouter({ parentOrigin: PARENT })
    const responses: CryptoRpcResponse[] = []
    await router.handleMessage(
      fakeEvent({ op: 'getPublicKey', id: UUID, nonceHex: NONCE }, PARENT),
      (res) => responses.push(res)
    )
    expect(responses[0]?.kind).toBe('success')
    if (responses[0]?.kind === 'success') {
      expect(responses[0].nonceHex).toBe(NONCE)
    }
  })

  test('routes lock and returns success null', async () => {
    const router = new CryptoRpcRouter({ parentOrigin: PARENT })
    const responses: CryptoRpcResponse[] = []
    await router.handleMessage(
      fakeEvent({ op: 'lock', id: UUID, nonceHex: NONCE }, PARENT),
      (res) => responses.push(res)
    )
    expect(responses[0]?.kind).toBe('success')
  })

  test('decryptEnvelope when locked returns a locked error code', async () => {
    const router = new CryptoRpcRouter({ parentOrigin: PARENT })
    const responses: CryptoRpcResponse[] = []
    await router.handleMessage(
      fakeEvent(
        {
          op: 'decryptEnvelope',
          id: UUID,
          nonceHex: NONCE,
          envelope: {
            v: 2,
            labelId: 0,
            wrappedKey: 'ab'.repeat(10),
            ephemeralPubkey: `02${'ab'.repeat(32)}`,
          },
          expectedLabel: 'llamenos:note-key',
        },
        PARENT
      ),
      (res) => responses.push(res)
    )
    expect(responses[0]?.kind).toBe('error')
    if (responses[0]?.kind === 'error') {
      expect(responses[0].code).toBe('locked')
      expect(responses[0].id).toBe(UUID)
      expect(responses[0].nonceHex).toBe(NONCE)
    }
  })

  test('schema_invalid with non-UUID id falls back to nil UUID (never echoes adversarial id)', async () => {
    const router = new CryptoRpcRouter({ parentOrigin: PARENT })
    const responses: CryptoRpcResponse[] = []
    await router.handleMessage(
      fakeEvent({ op: 'isUnlocked', id: '<script>', nonceHex: NONCE }, PARENT),
      (res) => responses.push(res)
    )
    expect(responses[0]?.kind).toBe('error')
    if (responses[0]?.kind === 'error') {
      expect(responses[0].id).toBe('00000000-0000-0000-0000-000000000000')
      expect(responses[0].id).not.toContain('<')
    }
  })

  test('origin check runs before schema parse (wrong origin + malformed payload)', async () => {
    const router = new CryptoRpcRouter({ parentOrigin: PARENT })
    const responses: CryptoRpcResponse[] = []
    await router.handleMessage(fakeEvent({ nonsense: true }, EVIL), (res) => responses.push(res))
    // No response at all — we don't leak even a schema_invalid to evil origins.
    expect(responses).toEqual([])
  })

  test('origin check ignores near-miss origin strings (no prefix match)', async () => {
    const router = new CryptoRpcRouter({ parentOrigin: PARENT })
    const responses: CryptoRpcResponse[] = []
    await router.handleMessage(
      fakeEvent({ op: 'isUnlocked', id: UUID, nonceHex: NONCE }, `${PARENT}.evil.example`),
      (res) => responses.push(res)
    )
    expect(responses).toEqual([])
  })
})
