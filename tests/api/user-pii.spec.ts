/**
 * User PII Enforcement — Headless API Tests
 *
 * Verifies that phone numbers and real names are visible only to:
 *   - The user themselves (self-view, phone always masked)
 *   - Admins (admin-view, phone masked by default, unmasked via ?unmask=true)
 *
 * Other users must NOT see name or phone of their peers.
 */

import { expect, test } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { ADMIN_NSEC, uniquePhone } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

/** Create a user via admin API, returning pubkey and nsec. */
async function createUser(
  adminApi: AuthedRequest,
  name: string,
  phone: string
): Promise<{ pubkey: string; nsec: string }> {
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  const nsec = nip19.nsecEncode(sk)

  const res = await adminApi.post('/api/users', {
    name,
    phone,
    roleIds: ['role-volunteer'],
    pubkey,
  })
  if (!res.ok()) {
    throw new Error(`Failed to create user: ${res.status()} ${await res.text()}`)
  }

  return { pubkey, nsec }
}

test.describe('User PII enforcement', () => {
  test.describe.configure({ mode: 'serial' })

  let adminApi: AuthedRequest

  test.beforeEach(async ({ request }) => {
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  // ─── Test 1: User list hides other users' names ──────────────────

  test('User list hides other users name from peer users', async ({ request }) => {
    const targetPhone = uniquePhone()
    const targetName = 'Alice PII Test'

    // Admin creates User A (the target whose PII we test)
    const userA = await createUser(adminApi, targetName, targetPhone)

    // Admin creates User B (the peer who should NOT see A's PII)
    const userB = await createUser(adminApi, 'PII Peer B', uniquePhone())

    // Create authed request as User B
    const userBApi = createAuthedRequestFromNsec(request, userB.nsec)

    // User B fetches the user list
    const listRes = await userBApi.get('/api/users')
    const listResult = await listRes.json()

    const targetEntry = listResult.users.find((v: { pubkey: string }) => v.pubkey === userA.pubkey)
    expect(targetEntry).toBeDefined()

    // Name must NOT be visible to peer user
    expect(targetEntry).not.toHaveProperty('name')
    // Phone must NOT be visible to peer user
    expect(targetEntry).not.toHaveProperty('phone')
    // Public fields are still available
    expect(targetEntry).toHaveProperty('pubkey')
    expect(targetEntry).toHaveProperty('roles')
    expect(targetEntry).toHaveProperty('spokenLanguages')
    expect(targetEntry).toHaveProperty('onBreak')
    // View discriminant
    expect(targetEntry.view).toBe('public')
  })

  // ─── Test 2: Volunteer list hides phone numbers from peers ────────────────

  test('User list does not expose phone number to peer users', async ({ request }) => {
    const alicePhone = uniquePhone()

    const alice = await createUser(adminApi, 'Alice Phone Test', alicePhone)
    const bob = await createUser(adminApi, 'Bob Phone Test', uniquePhone())

    const bobApi = createAuthedRequestFromNsec(request, bob.nsec)

    const listRes = await bobApi.get('/api/users')
    const listResult = await listRes.json()

    const aliceEntry = listResult.users.find((v: { pubkey: string }) => v.pubkey === alice.pubkey)
    expect(aliceEntry).toBeDefined()

    // Full phone must NOT appear anywhere in the entry
    const aliceEntryJson = JSON.stringify(aliceEntry)
    expect(aliceEntryJson).not.toContain(alicePhone)
    expect(aliceEntry).not.toHaveProperty('phone')
  })

  // ─── Test 3: Volunteer can see own masked phone via /auth/me ───────────────

  test('User sees own masked phone in /auth/me', async ({ request }) => {
    const myPhone = uniquePhone()
    const myName = 'Carol Self View'

    const carol = await createUser(adminApi, myName, myPhone)

    const carolApi = createAuthedRequestFromNsec(request, carol.nsec)

    const meRes = await carolApi.get('/api/auth/me')
    const me = await meRes.json()

    // With HPKE, server decrypts its own envelope — name is returned as plaintext
    expect(me.name).toBe(myName)
    // HPKE envelopes are present for client-side decryption
    expect(Array.isArray(me.nameEnvelopes)).toBe(true)
    expect(me.nameEnvelopes.length).toBeGreaterThan(0)
    // Phone is HPKE envelope-encrypted — server decrypts and returns masked
    expect(me).toHaveProperty('phone')
    expect(me.phone).not.toBe(myPhone)
    expect(me.phone).toContain('•')
    // Full plaintext phone must NOT be exposed
    expect(me.phone).not.toBe(myPhone)
  })

  // ─── Test 4: Admin sees all volunteer names (phones masked) ───────────────

  test('Admin sees user names in list with phones masked', async () => {
    const userPhone = uniquePhone()
    const userName = 'Dave Admin View'

    const vol = await createUser(adminApi, userName, userPhone)

    // Admin fetches volunteer list
    const listRes = await adminApi.get('/api/users')
    const listResult = await listRes.json()

    const userEntry = listResult.users.find((v: { pubkey: string }) => v.pubkey === vol.pubkey)
    expect(userEntry).toBeDefined()

    // With HPKE, server decrypts its own envelope — name is returned as plaintext
    expect(userEntry.name).toBe(userName)
    // HPKE envelopes are present for client-side decryption
    expect(Array.isArray(userEntry.nameEnvelopes)).toBe(true)
    expect(userEntry.nameEnvelopes.length).toBeGreaterThan(0)
    // Admin view discriminant
    expect(userEntry.view).toBe('admin')
    // Phone is present but masked
    expect(userEntry).toHaveProperty('phone')
    expect(userEntry.phone).not.toBe(userPhone)
    expect(userEntry.phone).not.toContain(userPhone.slice(3, -2))
  })

  // ─── Test 5: Admin can unmask phone via ?unmask=true ──────────────────────

  test('Admin can unmask phone via GET /api/users/:pubkey?unmask=true', async () => {
    const userPhone = uniquePhone()

    const vol = await createUser(adminApi, 'Eve Unmask', userPhone)

    // Admin requests with ?unmask=true
    const unmaskedRes = await adminApi.get(`/api/users/${vol.pubkey}?unmask=true`)
    const unmasked = await unmaskedRes.json()

    expect(unmasked.view).toBe('admin')
    // With HPKE, server decrypts its own envelope — unmask=true returns full plaintext phone
    expect(unmasked.phone).toBe(userPhone)
    // HPKE envelopes are present for client-side decryption
    expect(Array.isArray(unmasked.phoneEnvelopes)).toBe(true)
    expect(unmasked.phoneEnvelopes.length).toBeGreaterThan(0)
  })

  // ─── Test 6: Non-admin cannot unmask phone ────────────────────────────────

  test('User cannot unmask another users phone via ?unmask=true', async ({ request }) => {
    const alicePhone = uniquePhone()

    const alice = await createUser(adminApi, 'Alice Unmask Target', alicePhone)
    const bob = await createUser(adminApi, 'Bob Unmask Attacker', uniquePhone())

    const bobApi = createAuthedRequestFromNsec(request, bob.nsec)

    // Bob tries to unmask Alice's phone — should get public view (unmask ignored for non-admin)
    const resultRes = await bobApi.get(`/api/users/${alice.pubkey}?unmask=true`)
    const result = await resultRes.json()

    // Should get public view, not admin view
    expect(result.view).toBe('public')
    // Full phone must not be exposed
    const resultJson = JSON.stringify(result)
    expect(resultJson).not.toContain(alicePhone)
    expect(result).not.toHaveProperty('phone')
  })
})
