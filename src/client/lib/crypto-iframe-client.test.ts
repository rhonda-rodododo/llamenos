import { describe, expect, test } from 'bun:test'
import { CryptoIframeClient, CryptoRpcError } from './crypto-iframe-client'

const CRYPTO_ORIGIN = 'https://crypto.llamenos.example'
const OPAQUE_ORIGIN = 'null' // Production sandbox="allow-scripts" iframe origin
const EVIL_ORIGIN = 'https://evil.example'
const NIL_NONCE = '0'.repeat(64)
const OTHER_NONCE = 'ff'.repeat(32)

type IframeRequest = { op: string; id: string; nonceHex: string }

type FakeHarness = {
  iframe: {
    contentWindow: {
      postMessage: (req: unknown, origin: string) => void
    }
  }
  registerIncomingHandler: (h: (ev: MessageEvent) => void) => void
  sendToClient: (data: unknown, origin: string) => void
  outbox: Array<{ data: unknown; origin: string }>
}

/**
 * Create a fake iframe harness. The harness:
 *   - Records every postMessage the client sends (outbox).
 *   - Lets the test drive incoming messages to the client via sendToClient.
 *   - By default, auto-replies to every call with a scripted responder.
 *
 * The responder MUST echo the incoming request's `nonceHex` — the client
 * now verifies that the response nonce matches the outstanding-request
 * nonce and silently drops any mismatch. The default helper path below
 * takes care of that so most tests don't need to think about it.
 */
function createFake(
  responder?: (req: IframeRequest) => unknown,
  options?: { responseOrigin?: string; nonceOverride?: string }
): FakeHarness {
  const incomingHandlers: Array<(ev: MessageEvent) => void> = []
  const outbox: FakeHarness['outbox'] = []
  const responseOrigin = options?.responseOrigin ?? OPAQUE_ORIGIN

  const sendToClient = (data: unknown, origin: string) => {
    const ev = { data, origin } as unknown as MessageEvent
    for (const h of incomingHandlers) h(ev)
  }

  return {
    iframe: {
      contentWindow: {
        postMessage: (req: unknown, origin: string) => {
          outbox.push({ data: req, origin })
          if (responder) {
            queueMicrotask(() => {
              const typed = req as IframeRequest
              const result = responder(typed)
              sendToClient(
                {
                  kind: 'success',
                  id: typed.id,
                  nonceHex: options?.nonceOverride ?? typed.nonceHex,
                  result,
                },
                responseOrigin
              )
            })
          }
        },
      },
    },
    registerIncomingHandler: (h) => incomingHandlers.push(h),
    sendToClient,
    outbox,
  }
}

describe('CryptoIframeClient', () => {
  test('throws on empty cryptoOrigin', () => {
    expect(
      () =>
        new CryptoIframeClient({
          cryptoOrigin: '',
          fakeIframeForTests: createFake(),
        })
    ).toThrow()
  })

  test('ready resolves when sandbox broadcasts ready from the opaque origin', async () => {
    const fake = createFake()
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      fakeIframeForTests: fake,
    })
    // Production shape: iframe has opaque origin, delivered as `"null"`.
    fake.sendToClient({ kind: 'ready', protocol: 1 }, OPAQUE_ORIGIN)
    await client.ready
    client.destroy()
  })

  test('ready also resolves when sandbox broadcasts from the configured crypto origin', async () => {
    const fake = createFake()
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      fakeIframeForTests: fake,
    })
    // Test/dev shape: iframe delivered from a real origin (test harness).
    fake.sendToClient({ kind: 'ready', protocol: 1 }, CRYPTO_ORIGIN)
    await client.ready
    client.destroy()
  })

  test('ready ignores ready broadcast from an unrelated wrong origin', async () => {
    const fake = createFake()
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      bootTimeoutMs: 50,
      fakeIframeForTests: fake,
    })
    // Hostile non-null, non-matching origin tries to spoof ready — must be ignored.
    fake.sendToClient({ kind: 'ready', protocol: 1 }, EVIL_ORIGIN)
    await expect(client.ready).rejects.toThrow(/failed to broadcast ready/)
    client.destroy()
  })

  test('isUnlocked returns false via RPC round trip (opaque origin)', async () => {
    const fake = createFake((req) => (req.op === 'isUnlocked' ? false : null))
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      fakeIframeForTests: fake,
    })
    fake.sendToClient({ kind: 'ready', protocol: 1 }, OPAQUE_ORIGIN)
    await client.ready

    expect(await client.isUnlocked()).toBe(false)
    expect(fake.outbox.length).toBe(1)
    // Opaque-origin targets require postMessage targetOrigin of '*'.
    expect(fake.outbox[0]?.origin).toBe('*')
    const sent = fake.outbox[0]?.data as IframeRequest
    expect(sent.op).toBe('isUnlocked')
    // Every request MUST carry a fresh 32-byte nonce (64 hex chars).
    expect(sent.nonceHex).toMatch(/^[0-9a-f]{64}$/)
    client.destroy()
  })

  test('request nonces are unique per call', async () => {
    const fake = createFake((req) => (req.op === 'isUnlocked' ? false : null))
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      fakeIframeForTests: fake,
    })
    fake.sendToClient({ kind: 'ready', protocol: 1 }, OPAQUE_ORIGIN)
    await client.ready

    await client.isUnlocked()
    await client.isUnlocked()
    await client.isUnlocked()

    const nonces = fake.outbox.map((e) => (e.data as IframeRequest).nonceHex)
    expect(new Set(nonces).size).toBe(nonces.length)
    client.destroy()
  })

  test('responses whose nonce does not match the outstanding request are dropped', async () => {
    // Responder echoes a fixed wrong nonce — client must treat as mismatch.
    const fake = createFake((req) => (req.op === 'isUnlocked' ? false : null), {
      responseOrigin: OPAQUE_ORIGIN,
      nonceOverride: OTHER_NONCE,
    })
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      callTimeoutMs: 80,
      fakeIframeForTests: fake,
    })
    fake.sendToClient({ kind: 'ready', protocol: 1 }, OPAQUE_ORIGIN)
    await client.ready

    // The scripted responder replies but with the wrong nonce, so the
    // client drops it and the pending call times out.
    await expect(client.isUnlocked()).rejects.toThrow(/timed out/)
    client.destroy()
  })

  test('responses from wrong origin are dropped', async () => {
    const fake = createFake()
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      callTimeoutMs: 100,
      fakeIframeForTests: fake,
    })
    fake.sendToClient({ kind: 'ready', protocol: 1 }, OPAQUE_ORIGIN)
    await client.ready

    // Kick off an isUnlocked call but DO NOT have the fake auto-reply —
    // the fake above has no responder. We manually deliver a forged
    // response from the evil origin (with the correct nonce) — origin
    // check must drop it regardless of nonce.
    const pending = client.isUnlocked()
    await new Promise((r) => setTimeout(r, 0))
    const sent = fake.outbox[0]?.data as IframeRequest
    fake.sendToClient(
      { kind: 'success', id: sent.id, nonceHex: sent.nonceHex, result: true },
      EVIL_ORIGIN
    )
    await expect(pending).rejects.toThrow(/timed out/)
    client.destroy()
  })

  test('error response surfaces as CryptoRpcError with code', async () => {
    const fake = createFake()
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      callTimeoutMs: 500,
      fakeIframeForTests: fake,
    })
    fake.sendToClient({ kind: 'ready', protocol: 1 }, OPAQUE_ORIGIN)
    await client.ready

    const pending = client.isUnlocked()
    await new Promise((r) => setTimeout(r, 0))
    const sent = fake.outbox[0]?.data as IframeRequest
    fake.sendToClient(
      {
        kind: 'error',
        id: sent.id,
        nonceHex: sent.nonceHex,
        code: 'locked',
        message: 'vault is locked',
      },
      OPAQUE_ORIGIN
    )
    let caught: unknown = null
    try {
      await pending
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CryptoRpcError)
    if (caught instanceof CryptoRpcError) {
      expect(caught.code).toBe('locked')
    }
    client.destroy()
  })

  test('outgoing postMessage targetOrigin is always the broadcast wildcard (opaque origin)', async () => {
    const fake = createFake((req) => (req.op === 'isUnlocked' ? false : null))
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      fakeIframeForTests: fake,
    })
    fake.sendToClient({ kind: 'ready', protocol: 1 }, OPAQUE_ORIGIN)
    await client.ready

    await client.isUnlocked()
    await client.isUnlocked()
    await client.isUnlocked()

    for (const entry of fake.outbox) {
      expect(entry.origin).toBe('*')
    }
    client.destroy()
  })

  test('call timeout rejects when sandbox never responds', async () => {
    const fake = createFake() // no responder
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      callTimeoutMs: 80,
      fakeIframeForTests: fake,
    })
    fake.sendToClient({ kind: 'ready', protocol: 1 }, OPAQUE_ORIGIN)
    await client.ready

    await expect(client.isUnlocked()).rejects.toThrow(/timed out/)
    client.destroy()
  })

  test('malformed response shape is dropped (not resolved as success)', async () => {
    const fake = createFake()
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      callTimeoutMs: 80,
      fakeIframeForTests: fake,
    })
    fake.sendToClient({ kind: 'ready', protocol: 1 }, OPAQUE_ORIGIN)
    await client.ready

    const pending = client.isUnlocked()
    await new Promise((r) => setTimeout(r, 0))
    const sent = fake.outbox[0]?.data as IframeRequest
    // Send a response that doesn't match CryptoRpcResponseSchema (missing kind)
    fake.sendToClient({ id: sent.id, nonceHex: sent.nonceHex, result: true }, OPAQUE_ORIGIN)
    await expect(pending).rejects.toThrow(/timed out/)
    client.destroy()
  })

  test('response with nil nonce (schema-valid) is rejected on mismatch', async () => {
    // Schema-valid but nonce is the nil placeholder, not the one we stored.
    const fake = createFake((req) => (req.op === 'isUnlocked' ? false : null), {
      responseOrigin: OPAQUE_ORIGIN,
      nonceOverride: NIL_NONCE,
    })
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      callTimeoutMs: 80,
      fakeIframeForTests: fake,
    })
    fake.sendToClient({ kind: 'ready', protocol: 1 }, OPAQUE_ORIGIN)
    await client.ready

    await expect(client.isUnlocked()).rejects.toThrow(/timed out/)
    client.destroy()
  })
})
