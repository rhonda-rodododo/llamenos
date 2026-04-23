import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { createDatabase } from '@server/db'
import { CryptoService } from '@server/lib/crypto-service'
import { ContactService } from '@server/services/contacts'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'

const RUN_PREFIX = `test-hub-contacts-${crypto.randomUUID().slice(0, 8)}`

let db: ReturnType<typeof createDatabase>
let service: ContactService
const cryptoSvc = new CryptoService('0'.repeat(64), '1'.repeat(64))

// Helpers to produce branded types without real encryption in tests
const fakeCiphertext = (s: string) => s as Ciphertext
const fakeHmacHash = (s: string) => s as HmacHash

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, {
    migrationsFolder: path.resolve(import.meta.dir, '../../../drizzle/migrations'),
  })
  service = new ContactService(db, cryptoSvc)
})

afterAll(async () => {
  // Clean up all hubs created in this run
  await service.resetForTest(`${RUN_PREFIX}-t1`)
  await service.resetForTest(`${RUN_PREFIX}-t2`)
  await service.resetForTest(`${RUN_PREFIX}-t3`)
  await service.resetForTest(`${RUN_PREFIX}-t4`)
  await service.resetForTest(`${RUN_PREFIX}-t5`)
  await service.resetForTest(`${RUN_PREFIX}-t6`)
  await service.resetForTest(`${RUN_PREFIX}-t7`)
  await service.resetForTest(`${RUN_PREFIX}-t8`)
  await service.resetForTest(`${RUN_PREFIX}-t9`)
  db.$client.close()
})

describe('ContactService', () => {
  // ------------------------------------------------------------------ createContact (Tier 1)

  test('createContact with Tier 1 fields only', async () => {
    const hub = `${RUN_PREFIX}-t1`
    const contact = await service.createContact({
      hubId: hub,
      contactType: 'caller',
      riskLevel: 'low',
      tags: ['first-time'],
      encryptedDisplayName: fakeCiphertext('enc-display'),
      displayNameEnvelopes: [],
      createdBy: 'user-pubkey-abc',
    })

    expect(contact.id).toBeString()
    expect(contact.hubId).toBe(hub)
    expect(contact.contactType).toBe('caller')
    expect(contact.riskLevel).toBe('low')
    expect(contact.tags).toEqual(['first-time'])
    expect(contact.encryptedDisplayName).toBe(fakeCiphertext('enc-display'))
    expect(contact.encryptedPhone).toBeNull()
    expect(contact.identifierHash).toBeNull()
    expect(contact.createdBy).toBe('user-pubkey-abc')
    expect(contact.lastInteractionAt).toBeNull()
  })

  // ------------------------------------------------------------------ createContact (Tier 2)

  test('createContact with Tier 2 fields and identifierHash', async () => {
    const hub = `${RUN_PREFIX}-t2`
    const idHash = fakeHmacHash('hmac-hash-phone-abc')

    const contact = await service.createContact({
      hubId: hub,
      contactType: 'caller',
      riskLevel: 'high',
      tags: ['repeat', 'vip'],
      identifierHash: idHash,
      encryptedDisplayName: fakeCiphertext('enc-display-2'),
      displayNameEnvelopes: [
        {
          pubkey: 'admin-pk',
          v: 3 as const,
          labelId: 1,
          enc: btoa('test-enc'),
          ct: btoa('test-ct'),
        },
      ],
      encryptedFullName: fakeCiphertext('enc-fullname'),
      fullNameEnvelopes: [],
      encryptedPhone: fakeCiphertext('enc-phone'),
      phoneEnvelopes: [],
      encryptedPII: fakeCiphertext('enc-pii'),
      piiEnvelopes: [],
      createdBy: 'admin-pubkey-xyz',
    })

    expect(contact.identifierHash).toBe(idHash)
    expect(contact.riskLevel).toBe('high')
    expect(contact.encryptedFullName).toBe(fakeCiphertext('enc-fullname'))
    expect(contact.encryptedPhone).toBe(fakeCiphertext('enc-phone'))
    expect(contact.encryptedPII).toBe(fakeCiphertext('enc-pii'))
    expect((contact.displayNameEnvelopes as unknown[]).length).toBe(1)
  })

  // ------------------------------------------------------------------ listContacts (hub filter)

  test('listContacts filtered by hub', async () => {
    const hub = `${RUN_PREFIX}-t3`
    const otherHub = `${RUN_PREFIX}-t3-other`

    await service.createContact({
      hubId: hub,
      contactType: 'caller',
      riskLevel: 'low',
      tags: [],
      encryptedDisplayName: fakeCiphertext('enc-a'),
      displayNameEnvelopes: [],
      createdBy: 'pk',
    })
    await service.createContact({
      hubId: otherHub,
      contactType: 'caller',
      riskLevel: 'low',
      tags: [],
      encryptedDisplayName: fakeCiphertext('enc-b'),
      displayNameEnvelopes: [],
      createdBy: 'pk',
    })

    const results = await service.listContacts({ hubId: hub })
    expect(results.length).toBe(1)
    expect(results[0].hubId).toBe(hub)

    // Cleanup the other hub too
    await service.resetForTest(otherHub)
  })

  // ------------------------------------------------------------------ listContacts (contactType filter)

  test('listContacts filtered by contactType', async () => {
    const hub = `${RUN_PREFIX}-t4`

    await service.createContact({
      hubId: hub,
      contactType: 'caller',
      riskLevel: 'low',
      tags: [],
      encryptedDisplayName: fakeCiphertext('enc-caller'),
      displayNameEnvelopes: [],
      createdBy: 'pk',
    })
    await service.createContact({
      hubId: hub,
      contactType: 'admin',
      riskLevel: 'low',
      tags: [],
      encryptedDisplayName: fakeCiphertext('enc-admin'),
      displayNameEnvelopes: [],
      createdBy: 'pk',
    })

    const callers = await service.listContacts({ hubId: hub, contactType: 'caller' })
    expect(callers.length).toBe(1)
    expect(callers[0].contactType).toBe('caller')

    const all = await service.listContacts({ hubId: hub })
    expect(all.length).toBe(2)
  })

  // ------------------------------------------------------------------ updateContact

  test('updateContact plaintext and encrypted fields', async () => {
    const hub = `${RUN_PREFIX}-t5`

    const contact = await service.createContact({
      hubId: hub,
      contactType: 'caller',
      riskLevel: 'low',
      tags: [],
      encryptedDisplayName: fakeCiphertext('original-display'),
      displayNameEnvelopes: [],
      createdBy: 'pk',
    })

    const updated = await service.updateContact(contact.id, hub, {
      riskLevel: 'high',
      tags: ['updated-tag'],
      encryptedDisplayName: fakeCiphertext('new-display'),
      displayNameEnvelopes: [
        {
          pubkey: 'pk2',
          v: 3 as const,
          labelId: 1,
          enc: btoa('test-enc-2'),
          ct: btoa('test-ct-2'),
        },
      ],
    })

    expect(updated).not.toBeNull()
    expect(updated?.riskLevel).toBe('high')
    expect(updated?.tags).toEqual(['updated-tag'])
    expect(updated?.encryptedDisplayName).toBe(fakeCiphertext('new-display'))
    expect((updated?.displayNameEnvelopes as unknown[]).length).toBe(1)
    // Unchanged field
    expect(updated?.contactType).toBe('caller')
  })

  // ------------------------------------------------------------------ deleteContact

  test('deleteContact removes the contact', async () => {
    const hub = `${RUN_PREFIX}-t6`

    const contact = await service.createContact({
      hubId: hub,
      contactType: 'caller',
      riskLevel: 'low',
      tags: [],
      encryptedDisplayName: fakeCiphertext('enc-del'),
      displayNameEnvelopes: [],
      createdBy: 'pk',
    })

    await service.deleteContact(contact.id, hub)

    const fetched = await service.getContact(contact.id, hub)
    expect(fetched).toBeNull()
  })

  // ------------------------------------------------------------------ checkDuplicate

  test('checkDuplicate returns contact when found', async () => {
    const hub = `${RUN_PREFIX}-t7`
    const idHash = fakeHmacHash('unique-hash-for-dedup')

    await service.createContact({
      hubId: hub,
      contactType: 'caller',
      riskLevel: 'low',
      tags: [],
      identifierHash: idHash,
      encryptedDisplayName: fakeCiphertext('enc-dup'),
      displayNameEnvelopes: [],
      createdBy: 'pk',
    })

    const found = await service.checkDuplicate(idHash, hub)
    expect(found).not.toBeNull()
    expect(found?.identifierHash).toBe(idHash)
  })

  test('checkDuplicate returns null when not found', async () => {
    const hub = `${RUN_PREFIX}-t7`
    const notFound = await service.checkDuplicate(fakeHmacHash('no-such-hash'), hub)
    expect(notFound).toBeNull()
  })

  // ------------------------------------------------------------------ relationships

  test('createRelationship + listRelationships + deleteRelationship', async () => {
    const hub = `${RUN_PREFIX}-t8`

    const rel = await service.createRelationship({
      hubId: hub,
      encryptedPayload: fakeCiphertext('enc-rel-payload'),
      payloadEnvelopes: [
        { pubkey: 'pk-a', v: 3 as const, labelId: 1, enc: btoa('test-enc'), ct: btoa('test-ct') },
      ],
      createdBy: 'pk-a',
    })

    expect(rel.id).toBeString()
    expect(rel.encryptedPayload).toBe(fakeCiphertext('enc-rel-payload'))

    const list = await service.listRelationships(hub)
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(rel.id)

    await service.deleteRelationship(rel.id, hub)

    const listAfter = await service.listRelationships(hub)
    expect(listAfter.length).toBe(0)
  })

  // ------------------------------------------------------------------ linkCall / getLinkedCallIds / unlinkCall

  test('linkCall + getLinkedCallIds + unlinkCall', async () => {
    const hub = `${RUN_PREFIX}-t9`

    const contact = await service.createContact({
      hubId: hub,
      contactType: 'caller',
      riskLevel: 'low',
      tags: [],
      encryptedDisplayName: fakeCiphertext('enc-link-test'),
      displayNameEnvelopes: [],
      createdBy: 'pk',
    })

    expect(contact.lastInteractionAt).toBeNull()

    const callId1 = 'call-id-001'
    const callId2 = 'call-id-002'

    await service.linkCall(contact.id, callId1, hub, 'auto')
    await service.linkCall(contact.id, callId2, hub, 'user-pk')

    const ids = await service.getLinkedCallIds(contact.id)
    expect(ids).toContain(callId1)
    expect(ids).toContain(callId2)
    expect(ids.length).toBe(2)

    // Verify lastInteractionAt was updated
    const updated = await service.getContact(contact.id, hub)
    expect(updated?.lastInteractionAt).not.toBeNull()

    // Unlink one call
    await service.unlinkCall(contact.id, callId1)

    const idsAfter = await service.getLinkedCallIds(contact.id)
    expect(idsAfter).not.toContain(callId1)
    expect(idsAfter).toContain(callId2)
    expect(idsAfter.length).toBe(1)
  })
})
