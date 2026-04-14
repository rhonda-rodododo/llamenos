/**
 * E2EE Note Encryption Verification Tests (headless API)
 *
 * Verifies that call notes are genuinely encrypted at rest — not just UI assertions.
 *
 * Tests:
 *   1.1: Note content is encrypted at rest (plaintext never in raw API response)
 *   1.2: Admin can decrypt their own note via authorEnvelope
 *   1.3: Per-note forward secrecy — two notes have different envelopes
 *   1.4: Unauthorized user cannot decrypt another user's note
 *
 * Uses direct crypto imports — no browser context needed.
 */

import { expect, test } from '@playwright/test'
import { decryptNoteWithKey, encryptNote } from '@shared/crypto-envelopes'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

// Build admin secret key bytes and pubkey from test nsec
const { data: adminSkBytes } = nip19.decode(ADMIN_NSEC) as { type: 'nsec'; data: Uint8Array }
const ADMIN_PUBKEY = getPublicKey(adminSkBytes)

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface RawNote {
  id: string
  encryptedContent?: string
  authorEnvelope?: { ephemeralPub: string; ciphertext: string }
  adminEnvelopes?: Array<{ pubkey: string; ephemeralPub: string; ciphertext: string }>
}

/** Create an encrypted note via the API and return its ID. */
async function createEncryptedNote(
  authedApi: ReturnType<typeof createAuthedRequestFromNsec>,
  noteText: string,
  callId: string
): Promise<string> {
  const { encryptedContent, authorEnvelope, adminEnvelopes } = encryptNote(
    { text: noteText },
    ADMIN_PUBKEY,
    [ADMIN_PUBKEY]
  )
  const res = await authedApi.post('/api/notes', {
    callId,
    encryptedContent,
    authorEnvelope,
    adminEnvelopes,
  })
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  const note = data.note ?? data
  return note.id as string
}

/** Fetch raw note list for a callId, returning the notes array. */
async function fetchRawNotes(
  authedApi: ReturnType<typeof createAuthedRequestFromNsec>,
  callId: string
): Promise<RawNote[]> {
  const res = await authedApi.get(`/api/notes?callId=${encodeURIComponent(callId)}`)
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  return data.notes ?? data
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('E2EE note encryption', () => {
  test.describe.configure({ mode: 'serial' })

  const CALL_ID = `test-call-e2ee-${Date.now()}`
  const NOTE_PLAINTEXT = 'Secret note content for E2EE verification'
  let noteId: string

  // ── Test 1.1: Note content is encrypted at rest ───────────────────────────

  test('note content is encrypted at rest (plaintext not in raw API response)', async ({
    request,
  }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    noteId = await createEncryptedNote(authedApi, NOTE_PLAINTEXT, CALL_ID)
    expect(noteId).toBeTruthy()

    const notes = await fetchRawNotes(authedApi, CALL_ID)
    const note = notes.find((n) => n.id === noteId)
    expect(note).toBeTruthy()

    // Raw API response must NOT contain the plaintext
    const noteJson = JSON.stringify(note)
    expect(noteJson).not.toContain(NOTE_PLAINTEXT)

    // Raw response MUST contain encrypted fields
    expect(note?.encryptedContent).toBeTruthy()
    expect(note?.authorEnvelope).toBeTruthy()
    expect(note?.adminEnvelopes).toBeTruthy()
    expect(Array.isArray(note?.adminEnvelopes)).toBe(true)
  })

  // ── Test 1.2: Admin can decrypt their note via authorEnvelope ─────────────

  test('admin can decrypt their own note using authorEnvelope', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Ensure note exists from previous test
    if (!noteId) {
      noteId = await createEncryptedNote(authedApi, NOTE_PLAINTEXT, CALL_ID)
    }

    const notes = await fetchRawNotes(authedApi, CALL_ID)
    const note = notes.find((n) => n.id === noteId)
    expect(note).toBeTruthy()

    // Decrypt using admin's secret key directly
    const payload = decryptNoteWithKey(note!.encryptedContent!, note!.authorEnvelope!, adminSkBytes)

    expect(payload).not.toBeNull()
    expect(payload!.text).toBe(NOTE_PLAINTEXT)
  })

  // ── Test 1.3: Per-note forward secrecy (unique envelope per note) ─────────

  test('two notes have different authorEnvelopes (per-note forward secrecy)', async ({
    request,
  }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    const callId2 = `${CALL_ID}-b`
    const noteId2 = await createEncryptedNote(authedApi, 'Second note for secrecy test', callId2)

    const notes1 = await fetchRawNotes(authedApi, CALL_ID)
    const notes2 = await fetchRawNotes(authedApi, callId2)

    const note1 = notes1.find((n) => n.id === noteId)
    const note2 = notes2.find((n) => n.id === noteId2)

    expect(note1?.authorEnvelope).toBeTruthy()
    expect(note2?.authorEnvelope).toBeTruthy()

    // Envelopes must differ — they wrap different per-note keys
    const env1 = JSON.stringify(note1?.authorEnvelope)
    const env2 = JSON.stringify(note2?.authorEnvelope)
    expect(env1).not.toBe(env2)
  })

  // ── Test 1.4: Unauthorized user cannot decrypt admin's note ──────────

  test('unauthorized user cannot decrypt note (wrong envelope)', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a user via the API with a generated keypair
    const volSecretKey = generateSecretKey()
    const userPubkey = getPublicKey(volSecretKey)
    const createRes = await authedApi.post('/api/users', {
      name: 'E2EE Test User',
      phone: `+1555${Date.now().toString().slice(-7)}`,
      pubkey: userPubkey,
      roleIds: ['role-volunteer'],
    })
    expect(createRes.ok()).toBeTruthy()

    // Fetch raw notes as admin
    const notes = await fetchRawNotes(authedApi, CALL_ID)
    const note = notes.find((n) => n.id === noteId)
    expect(note).toBeTruthy()

    // Attempt decryption using the user's secret key — should fail
    const payload = decryptNoteWithKey(note!.encryptedContent!, note!.authorEnvelope!, volSecretKey)

    // The user's key is not in this note's envelopes — decryption must fail
    expect(payload).toBeNull()
  })
})
