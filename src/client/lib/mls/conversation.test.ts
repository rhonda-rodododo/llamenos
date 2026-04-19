import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { CryptoWorkerClient } from '../crypto-worker-client'

// ---- Mock API client ----

const mockBootstrapGroup = mock(async () => ({
  hubId: 'hub-1',
  groupId: 'llamenos:hub:hub-1',
  ciphersuite: 1,
  epoch: 0,
  createdAt: '2026-01-01T00:00:00Z',
}))

const mockSubmitCommit = mock(async () => ({
  id: 'commit-1',
  epoch: 1,
  hubId: 'hub-1',
  createdAt: '2026-01-01T00:00:01Z',
}))

const mockFetchCommits = mock(async () => ({
  commits: [
    {
      id: 'commit-1',
      epoch: 1,
      committerDeviceId: 'device-other',
      commitData: btoa(String.fromCharCode(...new Uint8Array([1, 2, 3]))),
      welcomeData: null,
      createdAt: '2026-01-01T00:00:01Z',
    },
  ],
}))

mock.module('./mls-api-client', () => ({
  bootstrapGroup: mockBootstrapGroup,
  submitCommit: mockSubmitCommit,
  fetchCommits: mockFetchCommits,
  fetchCurrentEpoch: mock(async () => ({
    hubId: 'hub-1',
    groupId: 'llamenos:hub:hub-1',
    ciphersuite: 1,
    currentEpoch: 0,
    lastCommitAt: null,
  })),
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

// ---- Mock crypto worker ----

function createMockWorker(): CryptoWorkerClient {
  return {
    mlsCreateGroup: mock(async () => undefined),
    mlsProcessWelcome: mock(async () => 'llamenos:hub:hub-1'),
    mlsExternalJoin: mock(async () => 'llamenos:hub:hub-1'),
    mlsEncryptMessage: mock(async () => new Uint8Array([10, 20, 30])),
    mlsDecryptMessage: mock(
      async () =>
        ({
          message: new Uint8Array([1, 2, 3]),
          senderClientId: 'user1:device1',
          hasEpochChanged: false,
          isActive: true,
        }) as {
          message: Uint8Array | undefined
          senderClientId: string | undefined
          hasEpochChanged: boolean
          isActive: boolean
        }
    ),
    mlsAddMembers: mock(async () => ({
      commit: new Uint8Array([4, 5, 6]),
      welcome: new Uint8Array([7, 8, 9]),
      groupInfo: new Uint8Array([10, 11, 12]),
    })),
    mlsRemoveMembers: mock(async () => ({
      commit: new Uint8Array([13, 14, 15]),
      welcome: undefined,
      groupInfo: new Uint8Array([16, 17, 18]),
    })),
    mlsCurrentEpoch: mock(async () => 1),
    mlsWipeGroup: mock(async () => undefined),
  } as unknown as CryptoWorkerClient
}

const { MlsConversation } = await import('./conversation')

describe('MlsConversation', () => {
  let worker: CryptoWorkerClient

  beforeEach(() => {
    worker = createMockWorker()
    mockBootstrapGroup.mockClear()
    mockSubmitCommit.mockClear()
    mockFetchCommits.mockClear()
  })

  afterEach(() => {
    mock.restore()
  })

  // ---- groupIdForHub ----

  test('groupIdForHub produces deterministic bytes', () => {
    const id1 = MlsConversation.groupIdForHub('hub-1')
    const id2 = MlsConversation.groupIdForHub('hub-1')
    expect(id1).toEqual(id2)

    const expected = new TextEncoder().encode('llamenos:hub:hub-1')
    expect(id1).toEqual(expected)
  })

  test('groupIdForHub produces different bytes for different hubs', () => {
    const id1 = MlsConversation.groupIdForHub('hub-1')
    const id2 = MlsConversation.groupIdForHub('hub-2')
    expect(id1).not.toEqual(id2)
  })

  // ---- createGroup ----

  test('createGroup calls worker and bootstraps on server', async () => {
    const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')

    expect(conv.hubId).toBe('hub-1')
    expect(conv.groupIdStr).toBe('llamenos:hub:hub-1')
    expect(conv.groupId).toEqual(new TextEncoder().encode('llamenos:hub:hub-1'))
    expect(worker.mlsCreateGroup).toHaveBeenCalledWith('llamenos:hub:hub-1')
    expect(mockBootstrapGroup).toHaveBeenCalledWith('hub-1', 'device-1', 'llamenos:hub:hub-1')
  })

  // ---- joinViaWelcome ----

  test('joinViaWelcome processes welcome and extracts hub ID', async () => {
    const welcomeBytes = new Uint8Array([1, 2, 3])
    const conv = await MlsConversation.joinViaWelcome(welcomeBytes, worker, 'device-1')

    expect(worker.mlsProcessWelcome).toHaveBeenCalledWith(welcomeBytes)
    expect(conv.hubId).toBe('hub-1')
    expect(conv.groupIdStr).toBe('llamenos:hub:hub-1')
  })

  // ---- joinViaExternalCommit ----

  test('joinViaExternalCommit joins via GroupInfo', async () => {
    const groupInfoBytes = new Uint8Array([4, 5, 6])
    const conv = await MlsConversation.joinViaExternalCommit(
      'hub-1',
      groupInfoBytes,
      worker,
      'device-1'
    )

    expect(worker.mlsExternalJoin).toHaveBeenCalledWith(groupInfoBytes)
    expect(conv.hubId).toBe('hub-1')
  })

  // ---- encrypt / decrypt ----

  test('encrypt delegates to worker', async () => {
    const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
    const plaintext = new Uint8Array([42, 43, 44])
    const ciphertext = await conv.encrypt(plaintext)

    expect(worker.mlsEncryptMessage).toHaveBeenCalledWith('llamenos:hub:hub-1', plaintext)
    expect(ciphertext).toEqual(new Uint8Array([10, 20, 30]))
  })

  test('decrypt returns plaintext and sender info', async () => {
    const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
    const ciphertext = new Uint8Array([10, 20, 30])
    const result = await conv.decrypt(ciphertext)

    expect(worker.mlsDecryptMessage).toHaveBeenCalledWith('llamenos:hub:hub-1', ciphertext)
    expect(result.message).toEqual(new Uint8Array([1, 2, 3]))
    expect(result.senderClientId).toBe('user1:device1')
    expect(result.hasEpochChanged).toBe(false)
    expect(result.isActive).toBe(true)
  })

  // ---- addMembers ----

  test('addMembers calls worker and submits commit to server', async () => {
    const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
    const keyPackages = [new Uint8Array([100]), new Uint8Array([200])]
    const bundle = await conv.addMembers(keyPackages)

    expect(worker.mlsAddMembers).toHaveBeenCalledWith('llamenos:hub:hub-1', keyPackages)
    expect(bundle.commit).toEqual(new Uint8Array([4, 5, 6]))
    expect(bundle.welcome).toEqual(new Uint8Array([7, 8, 9]))
    expect(mockSubmitCommit).toHaveBeenCalledTimes(1)
    // Verify the commit was submitted for the right hub/device
    expect(mockSubmitCommit).toHaveBeenCalledWith(
      'hub-1',
      'device-1',
      expect.any(Number),
      expect.any(String),
      expect.any(String)
    )
  })

  // ---- removeMembers ----

  test('removeMembers calls worker and submits commit to server', async () => {
    const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
    const bundle = await conv.removeMembers(['user2:device2'])

    expect(worker.mlsRemoveMembers).toHaveBeenCalledWith('llamenos:hub:hub-1', ['user2:device2'])
    expect(bundle.commit).toEqual(new Uint8Array([13, 14, 15]))
    expect(bundle.welcome).toBeUndefined()
    expect(mockSubmitCommit).toHaveBeenCalledTimes(1)
  })

  // ---- processCommit ----

  test('processCommit decrypts commit message via worker', async () => {
    const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
    const commitBytes = new Uint8Array([99, 98, 97])
    await conv.processCommit(commitBytes)

    expect(worker.mlsDecryptMessage).toHaveBeenCalledWith('llamenos:hub:hub-1', commitBytes)
  })

  // ---- catchUp ----

  test('catchUp fetches and processes commits from server', async () => {
    const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
    const processed = await conv.catchUp(0)

    expect(mockFetchCommits).toHaveBeenCalledWith('hub-1', 0)
    expect(processed).toBe(1)
    expect(worker.mlsDecryptMessage).toHaveBeenCalledTimes(1)
  })

  test('catchUp uses local epoch when sinceEpoch not provided', async () => {
    const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
    await conv.catchUp()

    // mlsCurrentEpoch returns 1, so sinceEpoch should be 1
    expect(mockFetchCommits).toHaveBeenCalledWith('hub-1', 1)
  })

  // ---- currentEpoch ----

  test('currentEpoch returns epoch from worker', async () => {
    const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
    const epoch = await conv.currentEpoch()

    expect(worker.mlsCurrentEpoch).toHaveBeenCalledWith('llamenos:hub:hub-1')
    expect(epoch).toBe(1)
  })

  test('currentEpoch returns 0 when group does not exist locally', async () => {
    ;(worker.mlsCurrentEpoch as ReturnType<typeof mock>).mockImplementation(async () => null)
    const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
    const epoch = await conv.currentEpoch()

    expect(epoch).toBe(0)
  })

  // ---- destroy ----

  test('destroy wipes local group state', async () => {
    const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
    await conv.destroy()

    expect(worker.mlsWipeGroup).toHaveBeenCalledWith('llamenos:hub:hub-1')
  })
})
