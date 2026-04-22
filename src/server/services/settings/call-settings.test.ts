import { describe, expect, test } from 'bun:test'
import type { Database } from '../../db'
import type { CallSettings } from '../../types'
import { updateCallSettings } from './call-settings'

/**
 * Minimal in-memory fake for the drizzle query builder surface used by
 * call-settings.ts. Supports:
 *
 *   db.select().from(table).where(...).limit(1) → Promise<rows>
 *   db.insert(table).values(row).onConflictDoUpdate({ set }) → Promise<void>
 *
 * Only exercises the method-chain shape the service actually calls — we
 * intentionally do NOT implement the full drizzle surface.
 */
function makeFakeDb(initialRow: Partial<CallSettings> | null = null) {
  let row: (Partial<CallSettings> & { hubId: string }) | null = initialRow
    ? { hubId: 'global', ...initialRow }
    : null

  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: (_n: number) => Promise.resolve(row ? [row] : []),
  }

  const insertChain = {
    values: (v: Partial<CallSettings> & { hubId: string }) => {
      row = { ...(row ?? { hubId: 'global' }), ...v }
      return {
        onConflictDoUpdate: ({ set }: { target: unknown; set: Partial<CallSettings> }) => {
          row = { ...(row ?? { hubId: 'global' }), ...set }
          return Promise.resolve()
        },
      }
    },
  }

  const db = {
    select: () => selectChain,
    insert: () => insertChain,
  } as unknown as Database

  return {
    db,
    getRow: () => row,
  }
}

describe('updateCallSettings — voiceCallE2eePolicy validation', () => {
  test('accepts valid policy value "required"', async () => {
    const { db, getRow } = makeFakeDb()
    const result = await updateCallSettings(db, { voiceCallE2eePolicy: 'required' })
    expect(result.voiceCallE2eePolicy).toBe('required')
    expect(getRow()?.voiceCallE2eePolicy).toBe('required')
  })

  test('accepts valid policy value "preferred"', async () => {
    const { db } = makeFakeDb()
    const result = await updateCallSettings(db, { voiceCallE2eePolicy: 'preferred' })
    expect(result.voiceCallE2eePolicy).toBe('preferred')
  })

  test('accepts valid policy value "off"', async () => {
    const { db } = makeFakeDb()
    const result = await updateCallSettings(db, { voiceCallE2eePolicy: 'off' })
    expect(result.voiceCallE2eePolicy).toBe('off')
  })

  test('falls back to existing value when invalid policy provided', async () => {
    const { db } = makeFakeDb({ voiceCallE2eePolicy: 'required' })
    const result = await updateCallSettings(db, {
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      voiceCallE2eePolicy: 'bogus' as any,
    })
    // Invalid value is rejected, current value preserved.
    expect(result.voiceCallE2eePolicy).toBe('required')
  })

  test('defaults to "preferred" when no row exists and no value provided', async () => {
    const { db } = makeFakeDb()
    const result = await updateCallSettings(db, {})
    expect(result.voiceCallE2eePolicy).toBe('preferred')
  })

  test('leaves other call settings untouched when only updating policy', async () => {
    const { db } = makeFakeDb({
      queueTimeoutSeconds: 120,
      voicemailMaxSeconds: 200,
      voicemailMode: 'always',
      voiceCallE2eePolicy: 'off',
    })
    const result = await updateCallSettings(db, { voiceCallE2eePolicy: 'required' })
    expect(result.queueTimeoutSeconds).toBe(120)
    expect(result.voicemailMaxSeconds).toBe(200)
    expect(result.voicemailMode).toBe('always')
    expect(result.voiceCallE2eePolicy).toBe('required')
  })
})
