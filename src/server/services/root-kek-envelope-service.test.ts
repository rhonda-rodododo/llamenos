/**
 * Unit tests for RootKekEnvelopeService.
 * Tests validation logic that doesn't require a real DB.
 */
import { describe, expect, test } from 'bun:test'
import type { RootKekEnvelopeBundle } from '@shared/schemas/root-kek-envelope'
import { RootKekEnvelopeService } from './root-kek-envelope-service'

function makeBundle(
  userId: string,
  envelopes: { factorType: string; factorId: string }[]
): RootKekEnvelopeBundle {
  return {
    v: 3,
    userId,
    rootKeyId: crypto.randomUUID(),
    envelopes: envelopes.map((e) => ({
      v: 3 as const,
      factorType: e.factorType as 'prf' | 'opaque' | 'recoveryPhrase' | 'recoveryGroup',
      factorId: e.factorId,
      hkdfSalt: 'ab'.repeat(32),
      wrappedKey: 'ca'.repeat(40),
      createdAt: new Date().toISOString(),
    })),
    createdAt: new Date().toISOString(),
  }
}

describe('RootKekEnvelopeService', () => {
  test('putBundle rejects a bundle with <2 envelopes', async () => {
    const service = new RootKekEnvelopeService(null as never)
    const bundle = {
      v: 3 as const,
      userId: '00000000-0000-4000-8000-000000000001',
      rootKeyId: crypto.randomUUID(),
      envelopes: [
        {
          v: 3 as const,
          factorType: 'prf' as const,
          factorId: 'a',
          hkdfSalt: 'ab'.repeat(32),
          wrappedKey: 'ca'.repeat(40),
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
    }
    // Zod validation fires before any DB call
    await expect(service.putBundle(bundle as RootKekEnvelopeBundle)).rejects.toThrow()
  })

  test('putBundle rejects duplicate (factorType, factorId) envelopes', async () => {
    const service = new RootKekEnvelopeService(null as never)
    const bundle = makeBundle('00000000-0000-4000-8000-000000000001', [
      { factorType: 'prf', factorId: 'a' },
      { factorType: 'prf', factorId: 'a' },
    ])
    await expect(service.putBundle(bundle)).rejects.toThrow(/unique/)
  })

  test('removeEnvelope rejects dropping below 2', async () => {
    // Use a minimal stub DB that returns a 2-envelope bundle from getBundle
    const bundle = makeBundle('00000000-0000-4000-8000-000000000002', [
      { factorType: 'prf', factorId: 'a' },
      { factorType: 'recoveryPhrase', factorId: 'phrase' },
    ])
    const stubDb = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ bundle }]),
        }),
      }),
    }
    const service = new RootKekEnvelopeService(stubDb as never)
    await expect(
      service.removeEnvelope(bundle.userId, { factorType: 'prf', factorId: 'a' })
    ).rejects.toThrow(/min factor invariant/)
  })

  test('appendEnvelope rejects when bundle is missing', async () => {
    const stubDb = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    }
    const service = new RootKekEnvelopeService(stubDb as never)
    await expect(
      service.appendEnvelope('nonexistent', {
        v: 3,
        factorType: 'opaque',
        factorId: 'opaque-1',
        hkdfSalt: 'cd'.repeat(32),
        wrappedKey: 'ef'.repeat(40),
        createdAt: new Date().toISOString(),
      })
    ).rejects.toThrow(/bundle missing/)
  })
})
