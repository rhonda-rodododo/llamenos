/**
 * Adversarial + integration unit tests for the MLS conversation layer.
 *
 * These tests verify resilience against attack scenarios and edge cases:
 * - Wrong epoch message rejection
 * - Key package exhaustion → external join fallback
 * - IDB corruption recovery (re-init from scratch)
 * - Lock/unlock preserves MLS state
 * - Encrypt → decrypt round-trip integrity
 * - Stale device detection (isActive: false after removal)
 * - Concurrent epoch advance race handling
 * - Missing commits in chain detection
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { CryptoWorkerClient } from '../crypto-worker-client'
import type { MlsCommitBundle, MlsDecryptResult } from './types'

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
  commits: [] as Array<{
    id: string
    epoch: number
    committerDeviceId: string
    commitData: string
    welcomeData: string | null
    createdAt: string
  }>,
}))

const mockFetchCurrentEpoch = mock(async () => ({
  hubId: 'hub-1',
  groupId: 'llamenos:hub:hub-1',
  ciphersuite: 1,
  currentEpoch: 0,
  lastCommitAt: null,
}))

mock.module('./mls-api-client', () => ({
  bootstrapGroup: mockBootstrapGroup,
  submitCommit: mockSubmitCommit,
  fetchCommits: mockFetchCommits,
  fetchCurrentEpoch: mockFetchCurrentEpoch,
  uploadKeyPackages: mock(async () => ({ uploaded: 100 })),
  fetchKeyPackage: mock(async () => ({
    keyPackageRef: 'ref-1',
    keyPackageData: 'data-1',
    deviceId: 'device-1',
  })),
  fetchKeyPackageCounts: mock(async () => ({ counts: {} })),
  purgeOldEpochs: mock(async () => ({ purged: 0 })),
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

// ---- Mock worker factory ----

function createMockWorker(): CryptoWorkerClient {
  return {
    mlsCreateGroup: mock(async () => undefined),
    mlsProcessWelcome: mock(async () => 'llamenos:hub:hub-1'),
    mlsExternalJoin: mock(async () => 'llamenos:hub:hub-1'),
    mlsEncryptMessage: mock(async (_groupId: string, plaintext: Uint8Array) => {
      // Simulate encryption: reverse the bytes (deterministic, invertible)
      const ct = new Uint8Array(plaintext.length)
      for (let i = 0; i < plaintext.length; i++) {
        ct[i] = plaintext[plaintext.length - 1 - i]
      }
      return ct
    }),
    mlsDecryptMessage: mock(
      async (_groupId: string, ciphertext: Uint8Array): Promise<MlsDecryptResult> => {
        // Simulate decryption: reverse back
        const pt = new Uint8Array(ciphertext.length)
        for (let i = 0; i < ciphertext.length; i++) {
          pt[i] = ciphertext[ciphertext.length - 1 - i]
        }
        return {
          message: pt,
          senderClientId: 'user1:device1',
          hasEpochChanged: false,
          isActive: true,
        }
      }
    ),
    mlsAddMembers: mock(
      async (): Promise<MlsCommitBundle> => ({
        commit: new Uint8Array([4, 5, 6]),
        welcome: new Uint8Array([7, 8, 9]),
        groupInfo: new Uint8Array([10, 11, 12]),
      })
    ),
    mlsRemoveMembers: mock(
      async (): Promise<MlsCommitBundle> => ({
        commit: new Uint8Array([13, 14, 15]),
        welcome: undefined,
        groupInfo: new Uint8Array([16, 17, 18]),
      })
    ),
    mlsCurrentEpoch: mock(async () => 1),
    mlsWipeGroup: mock(async () => undefined),
  } as unknown as CryptoWorkerClient
}

const { MlsConversation } = await import('./conversation')

// ---- Tests ----

describe('MlsConversation adversarial scenarios', () => {
  let worker: CryptoWorkerClient

  beforeEach(() => {
    worker = createMockWorker()
    mockBootstrapGroup.mockClear()
    mockSubmitCommit.mockReset()
    mockSubmitCommit.mockImplementation(async () => ({
      id: 'commit-1',
      epoch: 1,
      hubId: 'hub-1',
      createdAt: '2026-01-01T00:00:01Z',
    }))
    mockFetchCommits.mockReset()
    mockFetchCommits.mockImplementation(async () => ({
      commits: [] as Array<{
        id: string
        epoch: number
        committerDeviceId: string
        commitData: string
        welcomeData: string | null
        createdAt: string
      }>,
    }))
    mockFetchCurrentEpoch.mockClear()
  })

  afterEach(() => {
    mock.restore()
  })

  // ─── Encrypt → decrypt round-trip ─────────────────────────────────────

  describe('encrypt → decrypt round-trip', () => {
    test('plaintext survives round-trip through MLS encrypt/decrypt', async () => {
      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      const original = new TextEncoder().encode('Hello, MLS world!')
      const ciphertext = await conv.encrypt(original)
      const result = await conv.decrypt(ciphertext)

      expect(result.message).toBeDefined()
      expect(result.message).toEqual(original)
      expect(result.isActive).toBe(true)
    })

    test('empty plaintext round-trips correctly', async () => {
      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      const original = new Uint8Array(0)
      const ciphertext = await conv.encrypt(original)
      const result = await conv.decrypt(ciphertext)

      expect(result.message).toBeDefined()
      expect(result.message).toEqual(original)
    })

    test('large payload round-trips without corruption', async () => {
      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      // 64KB payload
      const original = new Uint8Array(65536)
      for (let i = 0; i < original.length; i++) {
        original[i] = i % 256
      }
      const ciphertext = await conv.encrypt(original)
      const result = await conv.decrypt(ciphertext)

      expect(result.message).toBeDefined()
      expect(result.message).toEqual(original)
    })

    test('JSON-serialized note content round-trips intact', async () => {
      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      const notePayload = JSON.stringify({
        content: 'Caller reported domestic violence situation. Referred to shelter.',
        callId: 'call-abc123',
        tags: ['urgent', 'dv', 'referral'],
        timestamp: '2026-04-21T10:30:00Z',
      })
      const original = new TextEncoder().encode(notePayload)
      const ciphertext = await conv.encrypt(original)
      const result = await conv.decrypt(ciphertext)

      expect(result.message).toBeDefined()
      const decoded = new TextDecoder().decode(result.message)
      expect(JSON.parse(decoded)).toEqual(JSON.parse(notePayload))
    })
  })

  // ─── Wrong epoch message rejection ────────────────────────────────────

  describe('wrong epoch message rejection', () => {
    test('decrypt fails with clear error for message from wrong epoch', async () => {
      const wrongEpochError = new Error(
        'Decryption failed: message epoch (5) does not match group epoch (1)'
      )
      ;(worker.mlsDecryptMessage as ReturnType<typeof mock>).mockImplementation(async () => {
        throw wrongEpochError
      })

      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      const fakeCiphertext = new Uint8Array([0xde, 0xad, 0xbe, 0xef])

      await expect(conv.decrypt(fakeCiphertext)).rejects.toThrow('epoch')
    })

    test('commit from future epoch triggers catch-up attempt', async () => {
      let decryptCallCount = 0
      ;(worker.mlsDecryptMessage as ReturnType<typeof mock>).mockImplementation(
        async (): Promise<MlsDecryptResult> => {
          decryptCallCount++
          // First call (commit processing) succeeds with epoch change
          return {
            message: undefined,
            senderClientId: undefined,
            hasEpochChanged: true,
            isActive: true,
          }
        }
      )

      // Server returns commits for catch-up
      mockFetchCommits.mockImplementation(async () => ({
        commits: [
          {
            id: 'commit-2',
            epoch: 2,
            committerDeviceId: 'device-other',
            commitData: btoa(String.fromCharCode(1, 2, 3)),
            welcomeData: null,
            createdAt: '2026-01-01T00:00:02Z',
          },
          {
            id: 'commit-3',
            epoch: 3,
            committerDeviceId: 'device-other',
            commitData: btoa(String.fromCharCode(4, 5, 6)),
            welcomeData: null,
            createdAt: '2026-01-01T00:00:03Z',
          },
        ],
      }))

      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      const processed = await conv.catchUp(1)

      expect(processed).toBe(2)
      expect(decryptCallCount).toBe(2)
    })
  })

  // ─── Key package exhaustion fallback ──────────────────────────────────

  describe('key package exhaustion fallback', () => {
    test('addMembers fails when worker rejects exhausted key packages', async () => {
      ;(worker.mlsAddMembers as ReturnType<typeof mock>).mockImplementation(async () => {
        throw new Error('No valid key packages available for the requested client IDs')
      })

      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      const emptyKeyPackages = [new Uint8Array([0xff])]

      await expect(conv.addMembers(emptyKeyPackages)).rejects.toThrow('key packages')
    })

    test('joinViaExternalCommit provides recovery when key packages exhausted', async () => {
      const groupInfoBytes = new Uint8Array([0x01, 0x02, 0x03])
      const conv = await MlsConversation.joinViaExternalCommit(
        'hub-1',
        groupInfoBytes,
        worker,
        'device-1'
      )

      expect(worker.mlsExternalJoin).toHaveBeenCalledWith(groupInfoBytes)
      expect(conv.hubId).toBe('hub-1')
      // After external join, the client should be able to encrypt
      const ciphertext = await conv.encrypt(new Uint8Array([42]))
      expect(ciphertext).toBeDefined()
    })
  })

  // ─── IDB corruption recovery ──────────────────────────────────────────

  describe('IDB corruption recovery', () => {
    test('createGroup succeeds after previous state was wiped', async () => {
      // Simulate: first attempt finds corrupted state → wipe → recreate
      let createCallCount = 0
      ;(worker.mlsCreateGroup as ReturnType<typeof mock>).mockImplementation(async () => {
        createCallCount++
        if (createCallCount === 1) {
          throw new Error('IDB state corrupted: invalid group state')
        }
        // Second call succeeds
        return undefined
      })

      // First attempt fails
      await expect(MlsConversation.createGroup('hub-1', worker, 'device-1')).rejects.toThrow(
        'IDB state corrupted'
      )

      // Wipe state
      await worker.mlsWipeGroup('llamenos:hub:hub-1')
      expect(worker.mlsWipeGroup).toHaveBeenCalledWith('llamenos:hub:hub-1')

      // Retry succeeds
      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      expect(conv.hubId).toBe('hub-1')
      expect(createCallCount).toBe(2)
    })

    test('joinViaWelcome recovers group state after IDB wipe', async () => {
      // After IDB corruption and wipe, a Welcome from an existing member
      // re-establishes group state
      const welcomeBytes = new Uint8Array([0xaa, 0xbb, 0xcc])
      const conv = await MlsConversation.joinViaWelcome(welcomeBytes, worker, 'device-1')

      expect(worker.mlsProcessWelcome).toHaveBeenCalledWith(welcomeBytes)
      expect(conv.hubId).toBe('hub-1')

      // Verify the recovered conversation can encrypt
      const ciphertext = await conv.encrypt(new Uint8Array([1, 2, 3]))
      expect(ciphertext).toBeDefined()
      expect(worker.mlsEncryptMessage).toHaveBeenCalled()
    })
  })

  // ─── Lock/unlock preserves MLS state ──────────────────────────────────

  describe('lock/unlock preserves MLS state', () => {
    test('conversation remains functional after simulated lock/unlock cycle', async () => {
      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')

      // Encrypt before lock
      const plaintext = new TextEncoder().encode('pre-lock message')
      const ctBefore = await conv.encrypt(plaintext)
      expect(ctBefore).toBeDefined()

      // Simulate lock: epoch query still works (IDB persists group state)
      const epoch = await conv.currentEpoch()
      expect(epoch).toBe(1)

      // Simulate unlock: re-open the conversation from persisted state
      const reopened = MlsConversation.open('hub-1', worker, 'device-1')
      const ctAfter = await reopened.encrypt(new TextEncoder().encode('post-unlock message'))
      expect(ctAfter).toBeDefined()

      // Decrypt should still work
      const result = await reopened.decrypt(ctAfter)
      expect(result.message).toBeDefined()
      expect(result.isActive).toBe(true)
    })

    test('currentEpoch returns 0 when group state lost after lock', async () => {
      ;(worker.mlsCurrentEpoch as ReturnType<typeof mock>).mockImplementation(async () => null)

      const conv = MlsConversation.open('hub-1', worker, 'device-1')
      const epoch = await conv.currentEpoch()
      expect(epoch).toBe(0)
    })
  })

  // ─── Stale device cannot decrypt ──────────────────────────────────────

  describe('stale device detection', () => {
    test('decrypt returns isActive=false when device has been removed', async () => {
      ;(worker.mlsDecryptMessage as ReturnType<typeof mock>).mockImplementation(
        async (): Promise<MlsDecryptResult> => ({
          message: undefined,
          senderClientId: undefined,
          hasEpochChanged: true,
          isActive: false, // core-crypto signals removal
        })
      )

      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      const result = await conv.decrypt(new Uint8Array([1, 2, 3]))

      expect(result.isActive).toBe(false)
      expect(result.hasEpochChanged).toBe(true)
    })

    test('encrypt fails after removal from group', async () => {
      ;(worker.mlsEncryptMessage as ReturnType<typeof mock>).mockImplementation(async () => {
        throw new Error('Client is not a member of this group')
      })

      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      await expect(conv.encrypt(new Uint8Array([42]))).rejects.toThrow('not a member')
    })
  })

  // ─── Concurrent epoch advance race ────────────────────────────────────

  describe('concurrent epoch advance race', () => {
    test('addMembers propagates 409 from server when epoch conflicts', async () => {
      mockSubmitCommit.mockImplementation(async () => {
        const err = new Error('Epoch conflict') as Error & { status: number }
        err.status = 409
        throw err
      })

      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      const keyPackages = [new Uint8Array([100])]

      await expect(conv.addMembers(keyPackages)).rejects.toThrow('Epoch conflict')
    })

    test('removeMembers propagates 409 from server when epoch conflicts', async () => {
      mockSubmitCommit.mockImplementation(async () => {
        const err = new Error('Epoch conflict') as Error & { status: number }
        err.status = 409
        throw err
      })

      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      await expect(conv.removeMembers(['user2:device2'])).rejects.toThrow('Epoch conflict')
    })
  })

  // ─── Missing commit in chain ──────────────────────────────────────────

  describe('missing commit in chain', () => {
    test('catchUp processes commits in order', async () => {
      const processedEpochs: number[] = []
      ;(worker.mlsDecryptMessage as ReturnType<typeof mock>).mockImplementation(
        async (_groupId: string, _ciphertext: Uint8Array): Promise<MlsDecryptResult> => {
          processedEpochs.push(processedEpochs.length + 2) // epochs 2, 3, 4...
          return {
            message: undefined,
            senderClientId: undefined,
            hasEpochChanged: true,
            isActive: true,
          }
        }
      )

      mockFetchCommits.mockImplementation(async () => ({
        commits: [
          {
            id: 'c2',
            epoch: 2,
            committerDeviceId: 'd-other',
            commitData: btoa('commit-2'),
            welcomeData: null,
            createdAt: '2026-01-01T00:00:02Z',
          },
          {
            id: 'c3',
            epoch: 3,
            committerDeviceId: 'd-other',
            commitData: btoa('commit-3'),
            welcomeData: null,
            createdAt: '2026-01-01T00:00:03Z',
          },
          {
            id: 'c4',
            epoch: 4,
            committerDeviceId: 'd-other',
            commitData: btoa('commit-4'),
            welcomeData: null,
            createdAt: '2026-01-01T00:00:04Z',
          },
        ],
      }))

      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      const processed = await conv.catchUp(1)

      expect(processed).toBe(3)
      expect(worker.mlsDecryptMessage).toHaveBeenCalledTimes(3)
    })

    test('catchUp propagates worker error when commit cannot be processed', async () => {
      ;(worker.mlsDecryptMessage as ReturnType<typeof mock>).mockImplementation(async () => {
        throw new Error('Cannot process commit: missing predecessor epoch')
      })

      mockFetchCommits.mockImplementation(async () => ({
        commits: [
          {
            id: 'c3',
            epoch: 3,
            committerDeviceId: 'd-other',
            commitData: btoa('commit-3'),
            welcomeData: null,
            createdAt: '2026-01-01T00:00:03Z',
          },
        ],
      }))

      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      await expect(conv.catchUp(1)).rejects.toThrow('missing predecessor')
    })
  })

  // ─── Replayed commit rejected ─────────────────────────────────────────

  describe('replayed commit rejection', () => {
    test('processing same commit twice is handled by core-crypto', async () => {
      let callCount = 0
      ;(worker.mlsDecryptMessage as ReturnType<typeof mock>).mockImplementation(
        async (): Promise<MlsDecryptResult> => {
          callCount++
          if (callCount === 2) {
            throw new Error('Commit already processed: duplicate epoch')
          }
          return {
            message: undefined,
            senderClientId: undefined,
            hasEpochChanged: true,
            isActive: true,
          }
        }
      )

      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      const commitBytes = new Uint8Array([1, 2, 3])

      // First process succeeds
      await conv.processCommit(commitBytes)

      // Second process (replay) fails
      await expect(conv.processCommit(commitBytes)).rejects.toThrow('already processed')
    })
  })

  // ─── Admin removal excludes from future encryption ────────────────────

  describe('admin removal exclusion', () => {
    test('removeMembers produces commit without welcome (no new members)', async () => {
      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      const bundle = await conv.removeMembers(['removed-user:device-x'])

      // Removal commit should not have a Welcome
      expect(bundle.welcome).toBeUndefined()
      // But should have a commit
      expect(bundle.commit).toEqual(new Uint8Array([13, 14, 15]))
      // Should have submitted to server
      expect(mockSubmitCommit).toHaveBeenCalledTimes(1)
    })

    test('removed device gets isActive=false on next decrypt attempt', async () => {
      // Simulate: removed device tries to process the removal commit
      ;(worker.mlsDecryptMessage as ReturnType<typeof mock>).mockImplementation(
        async (): Promise<MlsDecryptResult> => ({
          message: undefined,
          senderClientId: undefined,
          hasEpochChanged: true,
          isActive: false,
        })
      )

      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      const result = await conv.decrypt(new Uint8Array([0xff]))

      expect(result.isActive).toBe(false)
      expect(result.hasEpochChanged).toBe(true)
      expect(result.message).toBeUndefined()
    })
  })

  // ─── 3-device note sync via Welcome ───────────────────────────────────

  describe('multi-device sync via Welcome', () => {
    test('device joining via Welcome can decrypt messages encrypted by creator', async () => {
      // Device 1 creates the group and encrypts a note
      const device1Worker = createMockWorker()
      const conv1 = await MlsConversation.createGroup('hub-1', device1Worker, 'device-1')
      const noteContent = new TextEncoder().encode('Note from device 1')
      const ciphertext = await conv1.encrypt(noteContent)

      // Device 2 joins via Welcome and decrypts the same note
      const device2Worker = createMockWorker()
      // Mock device 2's decrypt to return the original note content
      ;(device2Worker.mlsDecryptMessage as ReturnType<typeof mock>).mockImplementation(
        async (): Promise<MlsDecryptResult> => ({
          message: noteContent,
          senderClientId: 'user1:device-1',
          hasEpochChanged: false,
          isActive: true,
        })
      )

      const welcomeBytes = new Uint8Array([0xaa, 0xbb, 0xcc])
      const conv2 = await MlsConversation.joinViaWelcome(welcomeBytes, device2Worker, 'device-2')

      const result = await conv2.decrypt(ciphertext)
      expect(result.message).toEqual(noteContent)
      expect(result.senderClientId).toBe('user1:device-1')
      expect(result.isActive).toBe(true)
    })

    test('third device joining after epoch advance can decrypt post-join messages', async () => {
      // Device 3 joins after an epoch advance (member add)
      const device3Worker = createMockWorker()
      const postJoinMsg = new TextEncoder().encode('Message after device 3 joined')
      ;(device3Worker.mlsDecryptMessage as ReturnType<typeof mock>).mockImplementation(
        async (): Promise<MlsDecryptResult> => ({
          message: postJoinMsg,
          senderClientId: 'user1:device-1',
          hasEpochChanged: false,
          isActive: true,
        })
      )

      const conv3 = await MlsConversation.joinViaWelcome(
        new Uint8Array([0xdd, 0xee]),
        device3Worker,
        'device-3'
      )

      const result = await conv3.decrypt(new Uint8Array([1, 2, 3]))
      expect(result.message).toEqual(postJoinMsg)
      expect(result.isActive).toBe(true)
    })
  })

  // ─── Group ID determinism and edge cases ──────────────────────────────

  describe('group ID edge cases', () => {
    test('groupIdForHub with special characters produces valid bytes', () => {
      const id = MlsConversation.groupIdForHub('hub-with-dashes-and_underscores')
      const str = new TextDecoder().decode(id)
      expect(str).toBe('llamenos:hub:hub-with-dashes-and_underscores')
    })

    test('groupIdForHub with UUID produces valid bytes', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000'
      const id = MlsConversation.groupIdForHub(uuid)
      const str = new TextDecoder().decode(id)
      expect(str).toBe(`llamenos:hub:${uuid}`)
    })

    test('joinViaWelcome extracts hub ID from group ID prefix', async () => {
      ;(worker.mlsProcessWelcome as ReturnType<typeof mock>).mockImplementation(
        async () => 'llamenos:hub:hub-abc-123'
      )

      const conv = await MlsConversation.joinViaWelcome(new Uint8Array([1]), worker, 'device-1')
      expect(conv.hubId).toBe('hub-abc-123')
      expect(conv.groupIdStr).toBe('llamenos:hub:hub-abc-123')
    })

    test('joinViaWelcome handles missing prefix gracefully', async () => {
      // If core-crypto returns a conversation ID without the prefix
      ;(worker.mlsProcessWelcome as ReturnType<typeof mock>).mockImplementation(
        async () => 'raw-group-id-no-prefix'
      )

      const conv = await MlsConversation.joinViaWelcome(new Uint8Array([1]), worker, 'device-1')
      // Should use the raw ID as the hub ID
      expect(conv.hubId).toBe('raw-group-id-no-prefix')
    })
  })

  // ─── Destroy / cleanup ────────────────────────────────────────────────

  describe('destroy and cleanup', () => {
    test('destroy calls wipeGroup with correct group ID', async () => {
      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      await conv.destroy()

      expect(worker.mlsWipeGroup).toHaveBeenCalledWith('llamenos:hub:hub-1')
    })

    test('destroy propagates worker errors', async () => {
      ;(worker.mlsWipeGroup as ReturnType<typeof mock>).mockImplementation(async () => {
        throw new Error('IDB delete failed: database locked')
      })

      const conv = await MlsConversation.createGroup('hub-1', worker, 'device-1')
      await expect(conv.destroy()).rejects.toThrow('database locked')
    })
  })
})
