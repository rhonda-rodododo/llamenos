import { beforeEach, describe, expect, test } from 'bun:test'
import 'fake-indexeddb/auto'
import type { RootKekEnvelope, RootKekEnvelopeBundle } from '@shared/schemas/root-kek-envelope'
import {
  InvalidBundleError,
  MinFactorsError,
  ROOT_KEK_ACTIVE_KEY,
  ROOT_KEK_DB_NAME,
  ROOT_KEK_STORE_NAME,
  appendEnvelope,
  assertMinFactorInvariant,
  buildRotatedBundle,
  clearBundleFromIdb,
  decodeBundle,
  encodeBundle,
  loadBundleFromIdb,
  removeEnvelope,
  storeBundleInIdb,
} from './root-kek-store'

const UUID_USER = '11111111-2222-4333-8444-555555555555'
const UUID_ROOT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const SALT = '0'.repeat(64)
const WRAPPED = '0'.repeat(80)

function mkEnvelope(factorType: RootKekEnvelope['factorType'], factorId: string): RootKekEnvelope {
  return {
    v: 3,
    factorType,
    factorId,
    hkdfSalt: SALT,
    wrappedKey: WRAPPED,
    createdAt: '2026-04-11T00:00:00.000Z',
  }
}

function mkBundle(envelopes: RootKekEnvelope[]): RootKekEnvelopeBundle {
  return {
    v: 3,
    userId: UUID_USER,
    rootKeyId: UUID_ROOT,
    envelopes,
    createdAt: '2026-04-11T00:00:00.000Z',
  }
}

async function wipeIdb() {
  const idb = (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB
  await new Promise<void>((resolve, reject) => {
    const req = idb.deleteDatabase(ROOT_KEK_DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  await wipeIdb()
})

describe('encode/decode', () => {
  test('round-trips a valid bundle', () => {
    const bundle = mkBundle([mkEnvelope('prf', 'c1'), mkEnvelope('opaque', 'o1')])
    expect(decodeBundle(encodeBundle(bundle))).toEqual(bundle)
  })

  test('decodeBundle throws InvalidBundleError on malformed JSON', () => {
    expect(() => decodeBundle('{not json}')).toThrow(InvalidBundleError)
  })

  test('decodeBundle throws InvalidBundleError on schema mismatch', () => {
    expect(() => decodeBundle(JSON.stringify({ v: 2 }))).toThrow(InvalidBundleError)
  })
})

describe('assertMinFactorInvariant', () => {
  test('accepts ≥2 distinct factors', () => {
    expect(() =>
      assertMinFactorInvariant(mkBundle([mkEnvelope('prf', 'c1'), mkEnvelope('opaque', 'o1')]))
    ).not.toThrow()
  })

  test('rejects 1 factor', () => {
    // Skip schema by passing a hand-crafted bundle — this is specifically
    // testing the imperative assertion.
    const bundle: RootKekEnvelopeBundle = {
      ...mkBundle([mkEnvelope('prf', 'c1')]),
      envelopes: [mkEnvelope('prf', 'c1')],
    }
    expect(() => assertMinFactorInvariant(bundle)).toThrow(MinFactorsError)
  })

  test('rejects duplicate (factorType, factorId)', () => {
    const bundle: RootKekEnvelopeBundle = {
      ...mkBundle([mkEnvelope('prf', 'c1'), mkEnvelope('prf', 'c1')]),
      envelopes: [mkEnvelope('prf', 'c1'), mkEnvelope('prf', 'c1')],
    }
    expect(() => assertMinFactorInvariant(bundle)).toThrow(InvalidBundleError)
  })
})

describe('appendEnvelope', () => {
  test('replaces an existing envelope with the same (type, id)', () => {
    const bundle = mkBundle([mkEnvelope('prf', 'c1'), mkEnvelope('opaque', 'o1')])
    const replaced = { ...mkEnvelope('prf', 'c1'), createdAt: '2026-05-01T00:00:00.000Z' }
    const next = appendEnvelope(bundle, replaced)
    expect(next.envelopes).toHaveLength(2)
    const prf = next.envelopes.find((e) => e.factorType === 'prf' && e.factorId === 'c1')
    expect(prf?.createdAt).toBe('2026-05-01T00:00:00.000Z')
  })

  test('appends a new factor', () => {
    const bundle = mkBundle([mkEnvelope('prf', 'c1'), mkEnvelope('opaque', 'o1')])
    const next = appendEnvelope(bundle, mkEnvelope('recoveryPhrase', 'rp1'))
    expect(next.envelopes).toHaveLength(3)
  })
})

describe('removeEnvelope', () => {
  test('removes a matching envelope and keeps invariant', () => {
    const bundle = mkBundle([
      mkEnvelope('prf', 'c1'),
      mkEnvelope('opaque', 'o1'),
      mkEnvelope('recoveryPhrase', 'rp1'),
    ])
    const next = removeEnvelope(bundle, 'recoveryPhrase', 'rp1')
    expect(next.envelopes).toHaveLength(2)
  })

  test('throws MinFactorsError if removing would drop below 2', () => {
    const bundle = mkBundle([mkEnvelope('prf', 'c1'), mkEnvelope('opaque', 'o1')])
    expect(() => removeEnvelope(bundle, 'opaque', 'o1')).toThrow(MinFactorsError)
  })

  test('throws InvalidBundleError when no envelope matches', () => {
    const bundle = mkBundle([mkEnvelope('prf', 'c1'), mkEnvelope('opaque', 'o1')])
    expect(() => removeEnvelope(bundle, 'prf', 'nope')).toThrow(InvalidBundleError)
  })
})

describe('buildRotatedBundle', () => {
  test('builds a bundle with a fresh rootKeyId and validates', () => {
    const next = buildRotatedBundle({
      userId: UUID_USER,
      newRootKeyId: UUID_ROOT,
      envelopes: [mkEnvelope('prf', 'c1'), mkEnvelope('opaque', 'o1')],
    })
    expect(next.rootKeyId).toBe(UUID_ROOT)
  })
})

describe('IDB persistence', () => {
  test('store + load round trip', async () => {
    const bundle = mkBundle([mkEnvelope('prf', 'c1'), mkEnvelope('opaque', 'o1')])
    await storeBundleInIdb(bundle)
    const loaded = await loadBundleFromIdb()
    expect(loaded).toEqual(bundle)
  })

  test('loadBundleFromIdb returns null when nothing is stored', async () => {
    expect(await loadBundleFromIdb()).toBeNull()
  })

  test('clearBundleFromIdb wipes the active bundle', async () => {
    const bundle = mkBundle([mkEnvelope('prf', 'c1'), mkEnvelope('opaque', 'o1')])
    await storeBundleInIdb(bundle)
    await clearBundleFromIdb()
    expect(await loadBundleFromIdb()).toBeNull()
  })

  test('storeBundleInIdb rejects a single-factor bundle', async () => {
    const bundle: RootKekEnvelopeBundle = {
      ...mkBundle([mkEnvelope('prf', 'c1')]),
      envelopes: [mkEnvelope('prf', 'c1')],
    }
    await expect(storeBundleInIdb(bundle)).rejects.toThrow(MinFactorsError)
  })

  test('IDB constants match the canonical names', () => {
    expect(ROOT_KEK_DB_NAME).toBe('llamenos-root-kek')
    expect(ROOT_KEK_STORE_NAME).toBe('bundles')
    expect(ROOT_KEK_ACTIVE_KEY).toBe('active')
  })
})
