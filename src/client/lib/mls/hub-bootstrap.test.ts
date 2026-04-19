import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { CryptoWorkerClient } from '../crypto-worker-client'

// ---- Mock MLS API client ----

const mockBootstrapGroup = mock(async () => ({
  hubId: 'hub-new',
  groupId: 'llamenos:hub:hub-new',
  ciphersuite: 1,
  epoch: 0,
  createdAt: '2026-04-19T00:00:00Z',
}))

const mockUploadKeyPackages = mock(async () => ({ uploaded: 100 }))

const mockFetchCurrentEpoch = mock(async () => ({
  hubId: 'hub-new',
  groupId: 'llamenos:hub:hub-new',
  ciphersuite: 1,
  currentEpoch: 0,
  lastCommitAt: null,
}))

mock.module('./mls-api-client', () => ({
  bootstrapGroup: mockBootstrapGroup,
  uploadKeyPackages: mockUploadKeyPackages,
  fetchCurrentEpoch: mockFetchCurrentEpoch,
  toBase64: (bytes: Uint8Array) => {
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  },
  fromBase64: (b64: string) => {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  },
}))

// ---- Mock debug-log (dev-only, stripped in prod) ----
mock.module('@/lib/debug-log', () => ({
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional noop for test mock
  createDebugLog: () => () => {
    /* noop */
  },
}))

// ---- Build mock CryptoWorkerClient ----

function createMockWorker(overrides: Partial<CryptoWorkerClient> = {}): CryptoWorkerClient {
  return {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional noop for test mock
    mlsCreateGroup: mock(async () => {
      /* noop */
    }),
    mlsGenerateKeyPackages: mock(async (count: number) =>
      Array.from({ length: count }, (_, i) => new Uint8Array([i & 0xff, 0x01, 0x02, 0x03]))
    ),
    mlsCurrentEpoch: mock(async () => null),
    mlsExternalJoin: mock(async () => 'llamenos:hub:hub-new'),
    ...overrides,
  } as unknown as CryptoWorkerClient
}

// ---- Tests ----

describe('hub-bootstrap', () => {
  beforeEach(() => {
    mockBootstrapGroup.mockClear()
    mockUploadKeyPackages.mockClear()
    mockFetchCurrentEpoch.mockClear()
  })

  describe('bootstrapMlsForNewHub', () => {
    test('creates MLS group and uploads key packages', async () => {
      const { bootstrapMlsForNewHub } = await import('./hub-bootstrap')
      const worker = createMockWorker()

      const result = await bootstrapMlsForNewHub('hub-new', worker, 'device-1')

      expect(result).not.toBeNull()
      expect(worker.mlsCreateGroup).toHaveBeenCalledWith('llamenos:hub:hub-new')
      expect(mockBootstrapGroup).toHaveBeenCalledWith('hub-new', 'device-1', 'llamenos:hub:hub-new')
      expect(worker.mlsGenerateKeyPackages).toHaveBeenCalledWith(100)
      expect(mockUploadKeyPackages).toHaveBeenCalledTimes(1)

      // Verify key packages structure
      const uploadCall = mockUploadKeyPackages.mock.calls[0] as unknown as [
        string,
        string,
        Array<{ keyPackageRef: string; keyPackageData: string }>,
      ]
      expect(uploadCall[0]).toBe('hub-new')
      expect(uploadCall[1]).toBe('device-1')
      expect(uploadCall[2]).toHaveLength(100)
      // Each key package should have keyPackageRef and keyPackageData
      expect(uploadCall[2][0]).toHaveProperty('keyPackageRef')
      expect(uploadCall[2][0]).toHaveProperty('keyPackageData')
    })

    test('returns null on MLS group creation failure', async () => {
      const { bootstrapMlsForNewHub } = await import('./hub-bootstrap')
      const worker = createMockWorker({
        mlsCreateGroup: mock(async () => {
          throw new Error('core-crypto init failed')
        }),
      })

      const result = await bootstrapMlsForNewHub('hub-new', worker, 'device-1')

      expect(result).toBeNull()
    })

    test('returns null on key package upload failure', async () => {
      const { bootstrapMlsForNewHub } = await import('./hub-bootstrap')
      mockUploadKeyPackages.mockImplementationOnce(async () => {
        throw new Error('network error')
      })
      const worker = createMockWorker()

      const result = await bootstrapMlsForNewHub('hub-new', worker, 'device-1')

      // Group was created but key package upload failed — still returns null
      expect(result).toBeNull()
      expect(worker.mlsCreateGroup).toHaveBeenCalled()
    })
  })

  describe('hasMlsGroupState', () => {
    test('returns true when local state exists', async () => {
      const { hasMlsGroupState } = await import('./hub-bootstrap')
      const worker = createMockWorker({
        mlsCurrentEpoch: mock(async () => 3),
      })

      const result = await hasMlsGroupState('hub-new', worker)

      expect(result).toBe(true)
      expect(worker.mlsCurrentEpoch).toHaveBeenCalledWith('llamenos:hub:hub-new')
    })

    test('returns false when no local state', async () => {
      const { hasMlsGroupState } = await import('./hub-bootstrap')
      const worker = createMockWorker({
        mlsCurrentEpoch: mock(async () => null),
      })

      const result = await hasMlsGroupState('hub-new', worker)

      expect(result).toBe(false)
    })
  })

  describe('uploadKeyPackages', () => {
    test('generates and uploads specified count', async () => {
      const { uploadKeyPackages } = await import('./hub-bootstrap')
      const worker = createMockWorker()
      mockUploadKeyPackages.mockImplementationOnce(async () => ({ uploaded: 50 }))

      const uploaded = await uploadKeyPackages('hub-x', worker, 'device-2', 50)

      expect(uploaded).toBe(50)
      expect(worker.mlsGenerateKeyPackages).toHaveBeenCalledWith(50)
    })

    test('keyPackageRef is SHA-256 hash of key package data', async () => {
      const { uploadKeyPackages } = await import('./hub-bootstrap')
      const testBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03])
      const worker = createMockWorker({
        mlsGenerateKeyPackages: mock(async () => [testBytes]),
      })
      mockUploadKeyPackages.mockImplementationOnce(async () => ({ uploaded: 1 }))

      await uploadKeyPackages('hub-x', worker, 'device-2', 1)

      const uploadCall = mockUploadKeyPackages.mock.calls[0] as unknown as [
        string,
        string,
        Array<{ keyPackageRef: string; keyPackageData: string }>,
      ]
      const kp = uploadCall[2][0]

      // Verify the ref is the base64-encoded SHA-256 of the key package bytes
      const expectedHash = await crypto.subtle.digest('SHA-256', testBytes.buffer as ArrayBuffer)
      let binary = ''
      const hashArr = new Uint8Array(expectedHash)
      for (let i = 0; i < hashArr.byteLength; i++) {
        binary += String.fromCharCode(hashArr[i])
      }
      const expectedRef = btoa(binary)

      expect(kp.keyPackageRef).toBe(expectedRef)
    })
  })
})
