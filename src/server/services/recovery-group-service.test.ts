/**
 * Unit tests for RecoveryGroupService validation logic and error classes.
 * The full DB integration tests live in tests/api/recovery-group.spec.ts.
 */
import { describe, expect, test } from 'bun:test'
import { RecoveryGroupDelayError, RecoveryGroupThresholdError } from './recovery-group-service'

describe('RecoveryGroupService error classes', () => {
  test('RecoveryGroupDelayError exposes remainingMs', () => {
    const err = new RecoveryGroupDelayError(3600_000)
    expect(err.remainingMs).toBe(3600_000)
    expect(err.message).toContain('3600000')
    expect(err.name).toBe('RecoveryGroupDelayError')
  })

  test('RecoveryGroupThresholdError exposes have/need', () => {
    const err = new RecoveryGroupThresholdError(1, 2)
    expect(err.message).toContain('1 < 2')
    expect(err.name).toBe('RecoveryGroupThresholdError')
  })
})

describe('RecoveryGroupService input validation', () => {
  test('enrollHub requires shareEnvelopes.length === totalShares', () => {
    // This tests the validation that happens before any DB call
    const { RecoveryGroupService } = require('./recovery-group-service') as typeof import(
      './recovery-group-service'
    )
    const service = new RecoveryGroupService(null as never)
    expect(
      service.enrollHub({
        hubId: '00000000-0000-4000-8000-000000000001',
        threshold: 2,
        totalShares: 3,
        groupPublicKey: '00'.repeat(32),
        shareEnvelopes: [
          { adminPubkey: 'aa'.repeat(32), envelope: 'x' },
          { adminPubkey: 'bb'.repeat(32), envelope: 'y' },
        ],
        shareCommitments: ['11'.repeat(32), '22'.repeat(32), '33'.repeat(32)],
      })
    ).rejects.toThrow(/shareEnvelopes length/)
  })

  test('enrollHub requires shareCommitments.length === totalShares', () => {
    const { RecoveryGroupService } = require('./recovery-group-service') as typeof import(
      './recovery-group-service'
    )
    const service = new RecoveryGroupService(null as never)
    expect(
      service.enrollHub({
        hubId: '00000000-0000-4000-8000-000000000001',
        threshold: 2,
        totalShares: 3,
        groupPublicKey: '00'.repeat(32),
        shareEnvelopes: [
          { adminPubkey: 'aa'.repeat(32), envelope: 'x' },
          { adminPubkey: 'bb'.repeat(32), envelope: 'y' },
          { adminPubkey: 'cc'.repeat(32), envelope: 'z' },
        ],
        shareCommitments: ['11'.repeat(32), '22'.repeat(32)],
      })
    ).rejects.toThrow(/shareCommitments length/)
  })
})
