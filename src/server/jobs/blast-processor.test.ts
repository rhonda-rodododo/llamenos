import { describe, expect, mock, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import { CryptoService } from '../lib/crypto-service'
import type { MessagingAdapter, SendMessageParams, SendResult } from '../messaging/adapter'
import type { Blast, BlastDelivery, Subscriber, SubscriberChannel } from '../types'
import { BlastProcessor } from './blast-processor'

const testServerSecret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
const testHmacSecret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
const testCrypto = new CryptoService(testServerSecret, testHmacSecret)

// ── Helpers ──

const makeSub = (id: string, overrides: Partial<Subscriber> = {}): Subscriber => ({
  id,
  hubId: 'hub-1',
  identifierHash: `hash-${id}`,
  encryptedIdentifier: `encrypted-${id}`,
  channels: [{ type: 'sms', verified: true }] as SubscriberChannel[],
  tags: [],
  language: 'en',
  status: 'active',
  doubleOptInConfirmed: true,
  subscribedAt: new Date(),
  preferenceToken: `tok-${id}`,
  createdAt: new Date(),
  ...overrides,
})

const makeBlast = (overrides: Partial<Blast> = {}): Blast => ({
  id: 'blast-1',
  hubId: 'hub-1',
  name: 'Test Blast',
  targetChannels: [],
  targetTags: [],
  targetLanguages: [],
  encryptedContent: 'Hello world',
  contentEnvelopes: [],
  status: 'sending',
  stats: { totalRecipients: 0, sent: 0, delivered: 0, failed: 0, optedOut: 0 },
  createdAt: new Date(),
  sentAt: null,
  scheduledAt: null,
  error: null,
  ...overrides,
})

function createMockAdapter(): MessagingAdapter {
  return {
    channelType: 'sms',
    parseIncomingMessage: mock(() => Promise.resolve({} as never)),
    validateWebhook: mock(() => Promise.resolve(true)),
    sendMessage: mock(
      (_params: SendMessageParams): Promise<SendResult> =>
        Promise.resolve({ success: true, externalId: 'ext-1' })
    ),
    sendMediaMessage: mock(() => Promise.resolve({ success: true })),
    getChannelStatus: mock(() => Promise.resolve({ connected: true })),
  }
}

function createMockServices(overrides: Record<string, unknown> = {}) {
  const deliveries: BlastDelivery[] = []

  return {
    blasts: {
      findBlastsToProcess: mock(() => Promise.resolve([] as Blast[])),
      getBlast: mock((_id: string) => Promise.resolve(null as Blast | null)),
      updateBlast: mock((_id: string, _data: Record<string, unknown>) =>
        Promise.resolve(makeBlast())
      ),
      listSubscribers: mock((_hubId?: string) => Promise.resolve([] as Subscriber[])),
      getDeliveredSubscriberIds: mock((_blastId: string) => Promise.resolve(new Set<string>())),
      createDelivery: mock((data: Record<string, unknown>) => {
        const delivery: BlastDelivery = {
          id: crypto.randomUUID(),
          blastId: data.blastId as string,
          subscriberId: data.subscriberId as string,
          channelType: (data.channelType as string) ?? 'sms',
          status: (data.status as string) ?? 'pending',
          error: data.error as string | undefined,
        }
        deliveries.push(delivery)
        return Promise.resolve(delivery)
      }),
      ...(overrides.blasts as Record<string, unknown> | undefined),
    },
    settings: {
      getHubKeyEnvelopes: mock(() => Promise.resolve([])),
      ...(overrides.settings as Record<string, unknown> | undefined),
    },
    records: {
      addAuditEntry: mock(() => Promise.resolve()),
      ...(overrides.records as Record<string, unknown> | undefined),
    },
    // Track deliveries for assertions
    _deliveries: deliveries,
  }
}

function createProcessor(services: ReturnType<typeof createMockServices>) {
  const processor = new BlastProcessor(services as never, testCrypto, 'server-secret')
  // Override crypto/adapter helpers — no real crypto in unit tests
  processor._getHubKey = mock(() => Promise.resolve(new Uint8Array(32)))
  processor._decryptBlastContent = mock(() => 'Hello world')
  processor._decryptIdentifier = mock(
    (_subscriberId: string, encrypted: string, _hubKey: Uint8Array) =>
      Promise.resolve(`+1555${encrypted.replace('encrypted-', '')}`)
  )
  const mockAdapter = createMockAdapter()
  processor._getAdapter = mock(() => Promise.resolve(mockAdapter))
  return { processor, mockAdapter }
}

// ── Tests ──

describe('BlastProcessor', () => {
  test('processOnce does nothing when no blasts to process', async () => {
    const services = createMockServices()
    const { processor } = createProcessor(services)

    await processor.processOnce()

    expect(services.blasts.findBlastsToProcess).toHaveBeenCalledTimes(1)
    expect(services.blasts.listSubscribers).not.toHaveBeenCalled()
    expect(services.blasts.createDelivery).not.toHaveBeenCalled()
  })

  test('processes a blast with subscribers and creates deliveries', async () => {
    const blast = makeBlast()
    const subs = [makeSub('sub-1'), makeSub('sub-2')]

    const services = createMockServices()
    services.blasts.findBlastsToProcess = mock(() => Promise.resolve([blast]))
    services.blasts.listSubscribers = mock(() => Promise.resolve(subs))

    const { processor } = createProcessor(services)

    await processor.processOnce()

    // Should create 2 deliveries (one per subscriber)
    expect(services.blasts.createDelivery).toHaveBeenCalledTimes(2)
    expect(services._deliveries).toHaveLength(2)
    expect(services._deliveries[0].subscriberId).toBe('sub-1')
    expect(services._deliveries[1].subscriberId).toBe('sub-2')
    expect(services._deliveries[0].status).toBe('sent')
    expect(services._deliveries[1].status).toBe('sent')

    // Should update blast to 'sent' at the end
    const updateCalls = (services.blasts.updateBlast as ReturnType<typeof mock>).mock.calls
    const lastUpdate = updateCalls[updateCalls.length - 1]
    expect(lastUpdate[1]).toMatchObject({ status: 'sent' })
  })

  test('skips subscribers already delivered (resume)', async () => {
    const blast = makeBlast()
    const subs = [makeSub('sub-1'), makeSub('sub-2')]

    const services = createMockServices()
    services.blasts.findBlastsToProcess = mock(() => Promise.resolve([blast]))
    services.blasts.listSubscribers = mock(() => Promise.resolve(subs))
    // sub-1 was already delivered
    services.blasts.getDeliveredSubscriberIds = mock(() => Promise.resolve(new Set(['sub-1'])))

    const { processor } = createProcessor(services)

    await processor.processOnce()

    // Only sub-2 should get a delivery
    expect(services.blasts.createDelivery).toHaveBeenCalledTimes(1)
    expect(services._deliveries).toHaveLength(1)
    expect(services._deliveries[0].subscriberId).toBe('sub-2')
  })

  test('promotes scheduled blast to sending when due', async () => {
    const blast = makeBlast({
      status: 'scheduled',
      scheduledAt: new Date(Date.now() - 60_000), // 1 minute ago
    })

    const services = createMockServices()
    services.blasts.findBlastsToProcess = mock(() => Promise.resolve([blast]))
    services.blasts.listSubscribers = mock(() => Promise.resolve([]))

    const { processor } = createProcessor(services)

    await processor.processOnce()

    // Should have called updateBlast with status='sending'
    const updateCalls = (services.blasts.updateBlast as ReturnType<typeof mock>).mock.calls
    const promotionCall = updateCalls.find(
      (call: unknown[]) => (call[1] as Record<string, unknown>).status === 'sending'
    )
    expect(promotionCall).toBeDefined()
    expect(promotionCall![0]).toBe('blast-1')

    // Should have logged blastScheduled audit entry
    expect(services.records.addAuditEntry).toHaveBeenCalledWith(
      'hub-1',
      'blastScheduled',
      'system',
      expect.objectContaining({ blastId: 'blast-1' })
    )
  })

  test('stops processing when blast is cancelled between batches', async () => {
    const blast = makeBlast()
    // Create 55 subscribers with whatsapp (50ms delay) to keep test fast
    const subs = Array.from({ length: 55 }, (_, i) =>
      makeSub(`sub-${i}`, {
        channels: [{ type: 'whatsapp', verified: true }] as SubscriberChannel[],
      })
    )

    const services = createMockServices()
    services.blasts.findBlastsToProcess = mock(() => Promise.resolve([blast]))
    services.blasts.listSubscribers = mock(() => Promise.resolve(subs))

    // After the first batch boundary (i=50), return cancelled status
    let getBlastCallCount = 0
    services.blasts.getBlast = mock((_id: string) => {
      getBlastCallCount++
      return Promise.resolve(makeBlast({ status: 'cancelled' }))
    })

    const { processor } = createProcessor(services)

    await processor.processOnce()

    // Should have delivered exactly 50 (first batch), then stopped
    expect(services._deliveries).toHaveLength(50)

    // Should have logged blastCancelled
    expect(services.records.addAuditEntry).toHaveBeenCalledWith(
      'hub-1',
      'blastCancelled',
      'system',
      expect.objectContaining({
        blastId: 'blast-1',
        sent: 50,
        remaining: 5,
      })
    )
  })
})
