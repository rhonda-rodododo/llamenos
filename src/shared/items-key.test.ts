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

describe('items_key indirection', () => {
  test('generateItemsKey produces a non-extractable AES-KW CryptoKey', async () => {
    const master = randomBytes(32)
    const key = await generateItemsKey(master, 1)
    expect(key.algorithm.name).toBe('AES-KW')
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

  test('same (master, generation) yields the same items_key (deterministic)', async () => {
    const master = new Uint8Array(32).fill(7)
    const a = await generateItemsKey(master, 1)
    const b = await generateItemsKey(master, 1)
    const inner = randomBytes(32)
    const wa = await wrapPerArtifactKey(inner, a)
    const wb = await wrapPerArtifactKey(inner, b)
    expect(wa).toEqual(wb)
  })

  test('different generations yield different items_keys', async () => {
    const master = new Uint8Array(32).fill(9)
    const g1 = await generateItemsKey(master, 1)
    const g2 = await generateItemsKey(master, 2)
    const inner = randomBytes(32)
    const w1 = await wrapPerArtifactKey(inner, g1)
    const w2 = await wrapPerArtifactKey(inner, g2)
    expect(w1).not.toEqual(w2)
  })

  test('wrap → unwrap round-trips the per-artifact key bytes', async () => {
    const master = randomBytes(32)
    const itemsKey = await generateItemsKey(master, 1)
    const inner = randomBytes(32)
    const wrapped = await wrapPerArtifactKey(inner, itemsKey)
    expect(wrapped.length).toBe(40)
    const unwrapped = await unwrapPerArtifactKey(wrapped, itemsKey)
    expect(unwrapped).toEqual(inner)
  })

  test('wrapPerArtifactKey rejects non-32-byte inner', async () => {
    const master = randomBytes(32)
    const itemsKey = await generateItemsKey(master, 1)
    await expect(wrapPerArtifactKey(new Uint8Array(16), itemsKey)).rejects.toThrow(/32 bytes/)
  })

  test('cross-user isolation: different masters cannot unwrap each other', async () => {
    const masterA = new Uint8Array(32).fill(1)
    const masterB = new Uint8Array(32).fill(2)
    const keyA = await generateItemsKey(masterA, 1)
    const keyB = await generateItemsKey(masterB, 1)
    const inner = randomBytes(32)
    const wrappedForA = await wrapPerArtifactKey(inner, keyA)
    await expect(unwrapPerArtifactKey(wrappedForA, keyB)).rejects.toThrow()
  })

  test('per-note ciphertext is byte-identical across items_key rotation', async () => {
    const master = randomBytes(32)
    const itemsKeyV1 = await generateItemsKey(master, 1)
    const perNoteKey = randomBytes(32)
    const wrappedV1 = await wrapPerArtifactKey(perNoteKey, itemsKeyV1)

    const noteId = 'note-42'
    const { iv, ct } = await encryptNote(perNoteKey, noteId, 'hello world')
    const ctBefore = new Uint8Array(ct)

    const itemsKeyV2 = await generateItemsKey(master, 2)
    const wrappedV2 = await rewrapItemsKey(wrappedV1, itemsKeyV1, itemsKeyV2)
    expect(wrappedV2).not.toEqual(wrappedV1)

    const unwrapped = await unwrapPerArtifactKey(wrappedV2, itemsKeyV2)
    expect(unwrapped).toEqual(perNoteKey)

    const pt = await decryptNote(unwrapped, noteId, iv, ctBefore)
    expect(pt).toBe('hello world')
    expect(Array.from(ctBefore)).toEqual(Array.from(ct))
  })

  test('rewrap fails under the wrong old items_key (AES-KW integrity check)', async () => {
    const master = randomBytes(32)
    const right = await generateItemsKey(master, 1)
    const wrong = await generateItemsKey(master, 2)
    const next = await generateItemsKey(master, 3)
    const inner = randomBytes(32)
    const wrapped = await wrapPerArtifactKey(inner, right)
    await expect(rewrapItemsKey(wrapped, wrong, next)).rejects.toThrow()
  })
})
