/**
 * Wiring tests for `useAuditChainIntegrity` + `deriveAuditTrustAnchorPubkeys`.
 *
 * The isolated Tier 0 verifier is exhaustively tested in
 * `src/client/lib/audit-chain-verifier.test.ts`. This file covers the delta
 * introduced by the wiring branch: trust-anchor derivation from the
 * admin-visible user list, and the happy-path contract that the hook hands
 * the derived anchor to `verifyAuditChain` and surfaces the result.
 */
import { describe, expect, test } from 'bun:test'
import { deriveAuditTrustAnchorPubkeys } from './audit'

const HUB = '11111111-1111-4111-8111-111111111111'
const OTHER_HUB = '22222222-2222-4222-8222-222222222222'
const PUB = (b: number) => b.toString(16).padStart(2, '0').repeat(32)

describe('deriveAuditTrustAnchorPubkeys', () => {
  test('includes users with global role-admin', () => {
    const set = deriveAuditTrustAnchorPubkeys(
      [
        { pubkey: PUB(0xaa), roles: ['role-admin'], hubRoles: [] },
        { pubkey: PUB(0xbb), roles: ['role-volunteer'], hubRoles: [] },
      ],
      HUB
    )
    expect(set.has(PUB(0xaa))).toBe(true)
    expect(set.has(PUB(0xbb))).toBe(false)
  })

  test('includes users with global role-super-admin', () => {
    const set = deriveAuditTrustAnchorPubkeys(
      [{ pubkey: PUB(0xcc), roles: ['role-super-admin'], hubRoles: [] }],
      HUB
    )
    expect(set.has(PUB(0xcc))).toBe(true)
  })

  test('includes users with hub-scoped admin role on this hub', () => {
    const set = deriveAuditTrustAnchorPubkeys(
      [
        {
          pubkey: PUB(0xdd),
          roles: ['role-volunteer'],
          hubRoles: [{ hubId: HUB, roleIds: ['role-admin'] }],
        },
      ],
      HUB
    )
    expect(set.has(PUB(0xdd))).toBe(true)
  })

  test('excludes users whose admin role is on a different hub', () => {
    const set = deriveAuditTrustAnchorPubkeys(
      [
        {
          pubkey: PUB(0xee),
          roles: ['role-volunteer'],
          hubRoles: [{ hubId: OTHER_HUB, roleIds: ['role-admin'] }],
        },
      ],
      HUB
    )
    expect(set.has(PUB(0xee))).toBe(false)
  })

  test('handles legacy role aliases (admin, super_admin)', () => {
    const set = deriveAuditTrustAnchorPubkeys(
      [
        { pubkey: PUB(0x11), roles: ['admin'], hubRoles: [] },
        { pubkey: PUB(0x22), roles: ['super_admin'], hubRoles: [] },
      ],
      HUB
    )
    expect(set.has(PUB(0x11))).toBe(true)
    expect(set.has(PUB(0x22))).toBe(true)
  })

  test('deduplicates via Set semantics', () => {
    const set = deriveAuditTrustAnchorPubkeys(
      [
        {
          pubkey: PUB(0x33),
          roles: ['role-admin', 'role-super-admin'],
          hubRoles: [{ hubId: HUB, roleIds: ['role-admin'] }],
        },
      ],
      HUB
    )
    expect(set.size).toBe(1)
    expect(set.has(PUB(0x33))).toBe(true)
  })

  test('tolerates missing hubRoles array', () => {
    const set = deriveAuditTrustAnchorPubkeys([{ pubkey: PUB(0x44), roles: ['role-admin'] }], HUB)
    expect(set.has(PUB(0x44))).toBe(true)
  })

  test('returns an empty set when no admins exist', () => {
    const set = deriveAuditTrustAnchorPubkeys(
      [{ pubkey: PUB(0x55), roles: ['role-volunteer'], hubRoles: [] }],
      HUB
    )
    expect(set.size).toBe(0)
  })
})
