/**
 * Tier 1 — items_key indirection
 *
 * The byte-equivalence test is the point of this module: rotating items_key
 * must NOT rewrite any artifact ciphertext. If the rewrap ever stops being
 * byte-equivalent the whole motivation for the indirection collapses.
 */

import { describe, expect, test } from 'bun:test'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { LABEL_NOTE_KEY } from './crypto-labels'
import {
  generateItemsKey,
  rewrapItemsKey,
  unwrapPerArtifactKey,
  wrapPerArtifactKey,
} from './items-key'

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

async function encryptNote(
  perNoteKey: Uint8Array,
  noteId: string,
  plaintext: string
): Promise<{ iv: Uint8Array; ct: Uint8Array }> {
  const iv = randomBytes(12)
  const aad = utf8ToBytes(`${LABEL_NOTE_KEY}:${noteId}`)
  const ck = await crypto.subtle.importKey(
    'raw',
    perNoteKey.buffer as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    /* extractable */ false,
    ['encrypt']
  )
  const pt = utf8ToBytes(plaintext)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv.buffer as ArrayBuffer,
        additionalData: aad.buffer as ArrayBuffer,
      },
      ck,
      pt.buffer as ArrayBuffer
    )
  )
  return { iv, ct }
}

async function decryptNote(
  perNoteKey: Uint8Array,
  noteId: string,
  iv: Uint8Array,
  ct: Uint8Array
): Promise<string> {
  const aad = utf8ToBytes(`${LABEL_NOTE_KEY}:${noteId}`)
  const ck = await crypto.subtle.importKey(
    'raw',
    perNoteKey.buffer as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    /* extractable */ false,
    ['decrypt']
  )
  const pt = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv.buffer as ArrayBuffer,
        additionalData: aad.buffer as ArrayBuffer,
      },
      ck,
      ct.buffer as ArrayBuffer
    )
  )
  return new TextDecoder().decode(pt)
}

const ART_A = 'note-42'
const ART_B = 'note-99'

describe('items_key indirection', () => {
  test('generateItemsKey produces a non-extractable HKDF CryptoKey', async () => {
    const master = randomBytes(32)
    const key = await generateItemsKey(master, 1)
    expect(key.algorithm.name).toBe('HKDF')
    expect(key.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow()
  })

  test('generateItemsKey rejects non-32-byte master', async () => {
    await expect(generateItemsKey(new Uint8Array(16), 1)).rejects.toThrow(/32 bytes/)
  })

  test('generateItemsKey rejects negative / non-integer generation', async () => {
    const m = randomBytes(32)
    await expect(generateItemsKey(m, -1)).rejects.toThrow()
    await expect(generateItemsKey(m, 1.5)).rejects.toThrow()
  })

  test('same (master, generation, artifactId) yields the same wrapped bytes (deterministic)', async () => {
    const master = new Uint8Array(32).fill(7)
    const a = await generateItemsKey(master, 1)
    const b = await generateItemsKey(master, 1)
    const inner = randomBytes(32)
    const wa = await wrapPerArtifactKey(inner, a, ART_A)
    const wb = await wrapPerArtifactKey(inner, b, ART_A)
    expect(wa).toEqual(wb)
  })

  test('different generations yield different wrapped bytes', async () => {
    const master = new Uint8Array(32).fill(9)
    const g1 = await generateItemsKey(master, 1)
    const g2 = await generateItemsKey(master, 2)
    const inner = randomBytes(32)
    const w1 = await wrapPerArtifactKey(inner, g1, ART_A)
    const w2 = await wrapPerArtifactKey(inner, g2, ART_A)
    expect(w1).not.toEqual(w2)
  })

  test('wrap → unwrap round-trips the per-artifact key bytes', async () => {
    const master = randomBytes(32)
    const itemsKey = await generateItemsKey(master, 1)
    const inner = randomBytes(32)
    const wrapped = await wrapPerArtifactKey(inner, itemsKey, ART_A)
    expect(wrapped.length).toBe(40)
    const unwrapped = await unwrapPerArtifactKey(wrapped, itemsKey, ART_A)
    expect(unwrapped).toEqual(inner)
  })

  test('wrapPerArtifactKey rejects non-32-byte inner', async () => {
    const master = randomBytes(32)
    const itemsKey = await generateItemsKey(master, 1)
    await expect(wrapPerArtifactKey(new Uint8Array(16), itemsKey, ART_A)).rejects.toThrow(
      /32 bytes/
    )
  })

  test('wrapPerArtifactKey rejects empty artifactId', async () => {
    const master = randomBytes(32)
    const itemsKey = await generateItemsKey(master, 1)
    await expect(wrapPerArtifactKey(randomBytes(32), itemsKey, '')).rejects.toThrow(/non-empty/)
  })

  test('cross-user isolation: different masters cannot unwrap each other', async () => {
    const masterA = new Uint8Array(32).fill(1)
    const masterB = new Uint8Array(32).fill(2)
    const keyA = await generateItemsKey(masterA, 1)
    const keyB = await generateItemsKey(masterB, 1)
    const inner = randomBytes(32)
    const wrappedForA = await wrapPerArtifactKey(inner, keyA, ART_A)
    await expect(unwrapPerArtifactKey(wrappedForA, keyB, ART_A)).rejects.toThrow()
  })

  test('cross-artifact binding: blob wrapped for artifact A cannot be unwrapped as artifact B', async () => {
    // Swap-detection: storage-layer attacker who swaps two wrapped keys under
    // the same items_key must be rejected at the wrap layer, not deferred
    // into the outer artifact AEAD.
    const master = randomBytes(32)
    const itemsKey = await generateItemsKey(master, 1)
    const innerA = randomBytes(32)
    const innerB = randomBytes(32)
    const wrappedA = await wrapPerArtifactKey(innerA, itemsKey, ART_A)
    const wrappedB = await wrapPerArtifactKey(innerB, itemsKey, ART_B)

    // Same items_key, two different artifactIds => two different wrapped
    // blobs (different AES-KW subkeys).
    expect(wrappedA).not.toEqual(wrappedB)

    // Neither blob can be unwrapped under the other artifact's id.
    await expect(unwrapPerArtifactKey(wrappedA, itemsKey, ART_B)).rejects.toThrow()
    await expect(unwrapPerArtifactKey(wrappedB, itemsKey, ART_A)).rejects.toThrow()

    // But both still unwrap correctly under their own id.
    expect(await unwrapPerArtifactKey(wrappedA, itemsKey, ART_A)).toEqual(innerA)
    expect(await unwrapPerArtifactKey(wrappedB, itemsKey, ART_B)).toEqual(innerB)
  })

  test('per-note ciphertext is byte-identical across items_key rotation', async () => {
    const master = randomBytes(32)
    const itemsKeyV1 = await generateItemsKey(master, 1)
    const perNoteKey = randomBytes(32)
    const wrappedV1 = await wrapPerArtifactKey(perNoteKey, itemsKeyV1, ART_A)

    const { iv, ct } = await encryptNote(perNoteKey, ART_A, 'hello world')
    const ctBefore = new Uint8Array(ct)

    const itemsKeyV2 = await generateItemsKey(master, 2)
    const wrappedV2 = await rewrapItemsKey(wrappedV1, itemsKeyV1, itemsKeyV2, ART_A)
    expect(wrappedV2).not.toEqual(wrappedV1)

    const unwrapped = await unwrapPerArtifactKey(wrappedV2, itemsKeyV2, ART_A)
    expect(unwrapped).toEqual(perNoteKey)

    const pt = await decryptNote(unwrapped, ART_A, iv, ctBefore)
    expect(pt).toBe('hello world')
    expect(Array.from(ctBefore)).toEqual(Array.from(ct))
  })

  test('rewrap fails under the wrong old items_key (AES-KW integrity check)', async () => {
    const master = randomBytes(32)
    const right = await generateItemsKey(master, 1)
    const wrong = await generateItemsKey(master, 2)
    const next = await generateItemsKey(master, 3)
    const inner = randomBytes(32)
    const wrapped = await wrapPerArtifactKey(inner, right, ART_A)
    await expect(rewrapItemsKey(wrapped, wrong, next, ART_A)).rejects.toThrow()
  })

  test('rewrap fails when artifactId diverges between sides', async () => {
    const master = randomBytes(32)
    const v1 = await generateItemsKey(master, 1)
    const v2 = await generateItemsKey(master, 2)
    const inner = randomBytes(32)
    const wrapped = await wrapPerArtifactKey(inner, v1, ART_A)
    await expect(rewrapItemsKey(wrapped, v1, v2, ART_B)).rejects.toThrow()
  })
})
