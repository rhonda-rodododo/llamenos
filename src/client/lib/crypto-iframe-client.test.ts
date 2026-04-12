import { describe, expect, test } from 'bun:test'
import { CryptoIframeClient, CryptoRpcError } from './crypto-iframe-client'

const CRYPTO_ORIGIN = 'https://crypto.llamenos.example'
const EVIL_ORIGIN = 'https://evil.example'

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
 */
function createFake(responder?: (req: { op: string; id: string }) => unknown): FakeHarness {
  const incomingHandlers: Array<(ev: MessageEvent) => void> = []
  const outbox: FakeHarness['outbox'] = []

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
              const typed = req as { op: string; id: string }
              const result = responder(typed)
              sendToClient({ kind: 'success', id: typed.id, result }, CRYPTO_ORIGIN)
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

  test('ready resolves when sandbox broadcasts ready from the crypto origin', async () => {
    const fake = createFake()
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      fakeIframeForTests: fake,
    })
    fake.sendToClient({ kind: 'ready', protocol: 1 }, CRYPTO_ORIGIN)
    await client.ready
    client.destroy()
  })

  test('ready ignores ready broadcast from wrong origin', async () => {
    const fake = createFake()
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      bootTimeoutMs: 50,
      fakeIframeForTests: fake,
    })
    // Hostile origin tries to spoof ready — must be ignored.
    fake.sendToClient({ kind: 'ready', protocol: 1 }, EVIL_ORIGIN)
    await expect(client.ready).rejects.toThrow(/failed to broadcast ready/)
    client.destroy()
  })

  test('isUnlocked returns false via RPC round trip', async () => {
    const fake = createFake((req) => (req.op === 'isUnlocked' ? false : null))
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      fakeIframeForTests: fake,
    })
    fake.sendToClient({ kind: 'ready', protocol: 1 }, CRYPTO_ORIGIN)
    await client.ready

    expect(await client.isUnlocked()).toBe(false)
    expect(fake.outbox.length).toBe(1)
    expect(fake.outbox[0]?.origin).toBe(CRYPTO_ORIGIN)
    const sent = fake.outbox[0]?.data as { op: string }
    expect(sent.op).toBe('isUnlocked')
    client.destroy()
  })

  test('responses from wrong origin are dropped', async () => {
    const fake = createFake()
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      callTimeoutMs: 100,
      fakeIframeForTests: fake,
    })
    fake.sendToClient({ kind: 'ready', protocol: 1 }, CRYPTO_ORIGIN)
    await client.ready

    // Kick off an isUnlocked call but DO NOT have the fake auto-reply —
    // the fake above has no responder. We manually deliver a forged
    // response from the evil origin, then verify the call times out.
    const pending = client.isUnlocked()
    // Give the client a tick to register the pending call id.
    await new Promise((r) => setTimeout(r, 0))
    const sent = fake.outbox[0]?.data as { id: string }
    fake.sendToClient({ kind: 'success', id: sent.id, result: true }, EVIL_ORIGIN)
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
    fake.sendToClient({ kind: 'ready', protocol: 1 }, CRYPTO_ORIGIN)
    await client.ready

    const pending = client.isUnlocked()
    await new Promise((r) => setTimeout(r, 0))
    const sent = fake.outbox[0]?.data as { id: string }
    fake.sendToClient(
      {
        kind: 'error',
        id: sent.id,
        code: 'locked',
        message: 'vault is locked',
      },
      CRYPTO_ORIGIN
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

  test('postMessage target origin is always the exact crypto origin (never *)', async () => {
    const fake = createFake((req) => (req.op === 'isUnlocked' ? false : null))
    const client = new CryptoIframeClient({
      cryptoOrigin: CRYPTO_ORIGIN,
      fakeIframeForTests: fake,
    })
    fake.sendToClient({ kind: 'ready', protocol: 1 }, CRYPTO_ORIGIN)
    await client.ready

    await client.isUnlocked()
    await client.isUnlocked()
    await client.isUnlocked()

    for (const entry of fake.outbox) {
      expect(entry.origin).toBe(CRYPTO_ORIGIN)
      expect(entry.origin).not.toBe('*')
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
    fake.sendToClient({ kind: 'ready', protocol: 1 }, CRYPTO_ORIGIN)
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
    fake.sendToClient({ kind: 'ready', protocol: 1 }, CRYPTO_ORIGIN)
    await client.ready

    const pending = client.isUnlocked()
    await new Promise((r) => setTimeout(r, 0))
    const sent = fake.outbox[0]?.data as { id: string }
    // Send a response that doesn't match CryptoRpcResponseSchema (missing kind)
    fake.sendToClient({ id: sent.id, result: true }, CRYPTO_ORIGIN)
    await expect(pending).rejects.toThrow(/timed out/)
    client.destroy()
  })
})
