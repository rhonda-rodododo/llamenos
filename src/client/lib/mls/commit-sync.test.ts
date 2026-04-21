import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// ---- Mock dependencies ----

const mockCatchUp = mock(async () => 2)
const mockGetMlsConversation = mock(
  async (): Promise<{
    catchUp: typeof mockCatchUp
    currentEpoch: () => Promise<number>
  } | null> => ({
    catchUp: mockCatchUp,
    currentEpoch: mock(async () => 3),
  })
)

mock.module('./get-mls-conversation', () => ({
  getMlsConversation: mockGetMlsConversation,
}))

// Mock crypto-worker-client to provide a truthy cryptoWorker
mock.module('@/lib/crypto-worker-client', () => ({
  cryptoWorker: { mlsCurrentEpoch: mock(async () => 1) },
}))

mock.module('@/lib/device-identity-store', () => ({
  getDeviceKeypair: mock(async () => ({ deviceId: 'device-1' })),
}))

mock.module('@/lib/debug-log', () => ({
  createDebugLog: () => () => {},
}))

mock.module('@/lib/config', () => ({
  useConfig: () => ({ currentHubId: 'hub-1' }),
}))

const { syncMlsCommits } = await import('./commit-sync')

describe('syncMlsCommits', () => {
  beforeEach(() => {
    mockCatchUp.mockClear()
    mockGetMlsConversation.mockClear()
  })

  test('fetches and processes pending commits for a hub', async () => {
    const processed = await syncMlsCommits('hub-1')

    expect(mockGetMlsConversation).toHaveBeenCalledWith('hub-1')
    expect(mockCatchUp).toHaveBeenCalled()
    expect(processed).toBe(2)
  })

  test('returns 0 when no MLS conversation available', async () => {
    mockGetMlsConversation.mockImplementationOnce(async () => null)

    const processed = await syncMlsCommits('hub-1')
    expect(processed).toBe(0)
  })

  test('returns 0 when already up to date', async () => {
    mockCatchUp.mockImplementationOnce(async () => 0)

    const processed = await syncMlsCommits('hub-1')
    expect(processed).toBe(0)
  })
})
