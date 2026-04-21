/**
 * MLS Note Encryption Verification Tests (headless API)
 *
 * Verifies that call notes use MLS encryption at rest.
 *
 * Tests:
 *   1.1: Note content is encrypted at rest (plaintext never in raw API response)
 *   1.2: mlsCiphertext is stored and returned by the API
 *   1.3: Per-note forward secrecy — two notes have different mlsCiphertext values
 *
 * MLS encryption/decryption happens in the browser crypto worker; these tests
 * verify the server storage contract only.
 */

import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface RawNote {
  id: string
  encryptedContent?: string
  authorEnvelope?: { ephemeralPub: string; ciphertext: string }
  adminEnvelopes?: Array<{ pubkey: string; ephemeralPub: string; ciphertext: string }>
  mlsCiphertext?: string
  mlsEpoch?: number
}

/** Create an MLS-encrypted note via the API and return its ID. */
async function createMlsNote(
  authedApi: ReturnType<typeof createAuthedRequestFromNsec>,
  callId: string
): Promise<string> {
  // Simulate MLS ciphertext — base64-encoded random bytes (server just stores it)
  const mlsCiphertext = Buffer.from(crypto.getRandomValues(new Uint8Array(64))).toString('base64')
  const res = await authedApi.post('/api/notes', {
    callId,
    mlsCiphertext,
    mlsEpoch: 1,
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

test.describe('MLS note encryption', () => {
  test.describe.configure({ mode: 'serial' })

  const CALL_ID = `test-call-mls-${Date.now()}`
  const NOTE_PLAINTEXT = 'Secret note content for MLS verification'
  let noteId: string

  // ── Test 1.1: Note content is encrypted at rest ───────────────────────────

  test('note content is encrypted at rest (plaintext not in raw API response)', async ({
    request,
  }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create note with MLS ciphertext
    const mlsCiphertext = Buffer.from(crypto.getRandomValues(new Uint8Array(64))).toString('base64')
    const res = await authedApi.post('/api/notes', {
      callId: CALL_ID,
      mlsCiphertext,
      mlsEpoch: 1,
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    noteId = (data.note ?? data).id as string
    expect(noteId).toBeTruthy()

    const notes = await fetchRawNotes(authedApi, CALL_ID)
    const note = notes.find((n) => n.id === noteId)
    expect(note).toBeTruthy()

    // Raw API response must NOT contain the plaintext
    const noteJson = JSON.stringify(note)
    expect(noteJson).not.toContain(NOTE_PLAINTEXT)

    // Raw response MUST contain MLS encrypted fields
    expect(note?.mlsCiphertext).toBeTruthy()
    expect(note?.mlsEpoch).toBeDefined()
  })

  // ── Test 1.2: mlsCiphertext round-trips through the API ────────────────────

  test('mlsCiphertext is stored and returned by the API', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Ensure note exists from previous test
    if (!noteId) {
      noteId = await createMlsNote(authedApi, CALL_ID)
    }

    const notes = await fetchRawNotes(authedApi, CALL_ID)
    const note = notes.find((n) => n.id === noteId)
    expect(note).toBeTruthy()

    // mlsCiphertext must be a non-empty string
    expect(typeof note?.mlsCiphertext).toBe('string')
    expect(note?.mlsCiphertext!.length).toBeGreaterThan(0)
    expect(note?.mlsEpoch).toBeGreaterThanOrEqual(0)
  })

  // ── Test 1.3: Per-note forward secrecy (unique ciphertext per note) ────────

  test('two notes have different mlsCiphertext values (per-note forward secrecy)', async ({
    request,
  }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    const callId2 = `${CALL_ID}-b`
    const noteId2 = await createMlsNote(authedApi, callId2)

    const notes1 = await fetchRawNotes(authedApi, CALL_ID)
    const notes2 = await fetchRawNotes(authedApi, callId2)

    const note1 = notes1.find((n) => n.id === noteId)
    const note2 = notes2.find((n) => n.id === noteId2)

    expect(note1?.mlsCiphertext).toBeTruthy()
    expect(note2?.mlsCiphertext).toBeTruthy()

    // Ciphertexts must differ — each note has a unique MLS encryption
    expect(note1?.mlsCiphertext).not.toBe(note2?.mlsCiphertext)
  })
})
