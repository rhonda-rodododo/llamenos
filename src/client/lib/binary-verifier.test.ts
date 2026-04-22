import { describe, expect, test } from 'bun:test'
import { ed25519 } from '@noble/curves/ed25519.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { ReleaseManifest } from '@shared/schemas/gossip-version'
import {
  canonicalizeJson,
  listLoadedResources,
  runBinaryVerifier,
  VerifierFailure,
  verifyManifestSignature,
  verifyOrThrow,
} from './binary-verifier'

// ---- Test helpers ----------------------------------------------------------

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function newKeypair(): { sk: Uint8Array; pk: Uint8Array; pkHex: string } {
  const sk = new Uint8Array(32)
  crypto.getRandomValues(sk)
  const pk = ed25519.getPublicKey(sk)
  return { sk, pk, pkHex: bytesToHex(pk) }
}

function signManifest(
  manifest: ReleaseManifest,
  sk: Uint8Array,
  pkHex: string
): { manifest: ReleaseManifest; signature: string; signingKey: string } {
  const canonical = canonicalizeJson(manifest)
  const msg = new TextEncoder().encode(canonical)
  const sig = ed25519.sign(msg, sk)
  return { manifest, signature: bytesToHex(sig), signingKey: pkHex }
}

interface ServedFile {
  url: string
  bytes: Uint8Array
  status?: number
}

function makeFakeDocument(urls: string[]): Pick<Document, 'querySelectorAll'> {
  const scriptEls = urls
    .filter((u) => u.endsWith('.js'))
    .map((u) => ({ src: u }) as unknown as Element)
  const linkEls = urls
    .filter((u) => u.endsWith('.css'))
    .map((u) => ({ href: u }) as unknown as Element)
  return {
    querySelectorAll: ((selector: string) => {
      if (selector === 'script[src]') return scriptEls as unknown as NodeListOf<Element>
      if (selector === 'link[rel="stylesheet"][href]')
        return linkEls as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    }) as Document['querySelectorAll'],
  }
}

function makeFakeFetch(signed: unknown, served: ServedFile[], apiOrigin: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString()
    if (url === `${apiOrigin}/api/releases/latest/manifest`) {
      return new Response(JSON.stringify(signed), { status: 200 })
    }
    const hit = served.find((f) => f.url === url)
    if (!hit) return new Response('not found', { status: 404 })
    if (hit.status && hit.status !== 200) return new Response('', { status: hit.status })
    return new Response(hit.bytes as BodyInit, { status: 200 })
  }) as typeof fetch
}

// ---- canonicalizeJson ------------------------------------------------------

describe('canonicalizeJson', () => {
  test('sorts object keys recursively', () => {
    expect(canonicalizeJson({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}')
  })

  test('is stable across equivalent object orderings', () => {
    const a = canonicalizeJson({ x: 1, y: 2 })
    const b = canonicalizeJson({ y: 2, x: 1 })
    expect(a).toBe(b)
  })

  test('preserves array order', () => {
    expect(canonicalizeJson([3, 1, 2])).toBe('[3,1,2]')
  })

  test('drops undefined object fields', () => {
    expect(canonicalizeJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  test('handles primitives and null', () => {
    expect(canonicalizeJson(null)).toBe('null')
    expect(canonicalizeJson(0)).toBe('0')
    expect(canonicalizeJson('hi')).toBe('"hi"')
    expect(canonicalizeJson(true)).toBe('true')
  })
})

// ---- signature verification -----------------------------------------------

describe('verifyManifestSignature', () => {
  test('valid signature round-trips', () => {
    const { sk, pkHex } = newKeypair()
    const manifest: ReleaseManifest = {
      version: 1,
      releaseTag: 'v1.0.0',
      builtAt: 1_700_000_000,
      files: {},
    }
    const signed = signManifest(manifest, sk, pkHex)
    expect(verifyManifestSignature(signed, pkHex)).toBe(true)
  })

  test('tampered manifest fails verification', () => {
    const { sk, pkHex } = newKeypair()
    const signed = signManifest({ version: 1, releaseTag: 'v1', builtAt: 1, files: {} }, sk, pkHex)
    const tampered = {
      ...signed,
      manifest: { ...signed.manifest, releaseTag: 'v2' },
    }
    expect(verifyManifestSignature(tampered, pkHex)).toBe(false)
  })

  test('wrong pinned key fails', () => {
    const { sk, pkHex } = newKeypair()
    const other = newKeypair()
    const signed = signManifest({ version: 1, releaseTag: 'v1', builtAt: 1, files: {} }, sk, pkHex)
    expect(verifyManifestSignature(signed, other.pkHex)).toBe(false)
  })
})

// ---- listLoadedResources ---------------------------------------------------

describe('listLoadedResources', () => {
  test('collects same-origin scripts + stylesheets + index.html', () => {
    const doc = makeFakeDocument([
      'https://app.test/assets/main.abc.js',
      'https://app.test/assets/style.def.css',
      'https://cdn.other/evil.js',
    ])
    const out = listLoadedResources('https://app.test', doc)
    expect(out).toContain('https://app.test/index.html')
    expect(out).toContain('https://app.test/assets/main.abc.js')
    expect(out).toContain('https://app.test/assets/style.def.css')
    expect(out).not.toContain('https://cdn.other/evil.js')
  })

  test('output is sorted + deduplicated', () => {
    const doc = makeFakeDocument([
      'https://app.test/a.js',
      'https://app.test/a.js',
      'https://app.test/b.js',
    ])
    const out = listLoadedResources('https://app.test', doc)
    expect(out).toEqual([
      'https://app.test/a.js',
      'https://app.test/b.js',
      'https://app.test/index.html',
    ])
  })
})

// ---- runBinaryVerifier end-to-end ------------------------------------------

describe('runBinaryVerifier', () => {
  const API = 'https://api.test'
  const APP = 'https://app.test'

  test('returns not-configured when the pinned key is empty', async () => {
    const res = await runBinaryVerifier({
      apiOrigin: API,
      appOrigin: APP,
      pinnedSigningKey: '',
      fetchFn: (async () => new Response('')) as unknown as typeof fetch,
      documentRef: makeFakeDocument([]),
    })
    expect(res.status).toBe('not-configured')
  })

  test('match status when every file hashes correctly', async () => {
    const { sk, pkHex } = newKeypair()
    const index = new TextEncoder().encode('<html>index</html>')
    const main = new TextEncoder().encode('console.log("ok")')
    const manifest: ReleaseManifest = {
      version: 1,
      releaseTag: 'v1.0.0',
      builtAt: 1,
      files: {
        'index.html': await sha256Hex(index),
        'assets/main.js': await sha256Hex(main),
      },
    }
    const signed = signManifest(manifest, sk, pkHex)
    const fetchFn = makeFakeFetch(
      signed,
      [
        { url: `${APP}/index.html`, bytes: index },
        { url: `${APP}/assets/main.js`, bytes: main },
      ],
      API
    )
    const doc = makeFakeDocument([`${APP}/assets/main.js`])
    const res = await runBinaryVerifier({
      apiOrigin: API,
      appOrigin: APP,
      pinnedSigningKey: pkHex,
      fetchFn,
      documentRef: doc,
    })
    expect(res.status).toBe('match')
    expect(res.checkedFiles).toBe(2)
    expect(res.mismatches).toEqual([])
  })

  test('mismatch status when a file hash differs', async () => {
    const { sk, pkHex } = newKeypair()
    const manifest: ReleaseManifest = {
      version: 1,
      releaseTag: 'v1',
      builtAt: 1,
      files: {
        'index.html': 'f'.repeat(64), // wrong on purpose
      },
    }
    const signed = signManifest(manifest, sk, pkHex)
    const fetchFn = makeFakeFetch(
      signed,
      [{ url: `${APP}/index.html`, bytes: new TextEncoder().encode('real html') }],
      API
    )
    const res = await runBinaryVerifier({
      apiOrigin: API,
      appOrigin: APP,
      pinnedSigningKey: pkHex,
      fetchFn,
      documentRef: makeFakeDocument([]),
    })
    expect(res.status).toBe('mismatch')
    expect(res.mismatches.length).toBe(1)
    expect(res.mismatches[0]?.path).toBe('index.html')
  })

  test('signature-invalid when pubkey is swapped out', async () => {
    const { sk } = newKeypair()
    const other = newKeypair()
    const manifest: ReleaseManifest = {
      version: 1,
      releaseTag: 'v1',
      builtAt: 1,
      files: {},
    }
    // Sign with sk1 but claim the pinned key (other.pkHex) signed it.
    const canonical = canonicalizeJson(manifest)
    const sig = ed25519.sign(new TextEncoder().encode(canonical), sk)
    const signed = { manifest, signature: bytesToHex(sig), signingKey: other.pkHex }
    const fetchFn = makeFakeFetch(signed, [], API)
    const res = await runBinaryVerifier({
      apiOrigin: API,
      appOrigin: APP,
      pinnedSigningKey: other.pkHex,
      fetchFn,
      documentRef: makeFakeDocument([]),
    })
    expect(res.status).toBe('signature-invalid')
  })

  test('key-not-pinned when manifest signed by a different key', async () => {
    const { sk, pkHex } = newKeypair()
    const other = newKeypair()
    const signed = signManifest({ version: 1, releaseTag: 'v1', builtAt: 1, files: {} }, sk, pkHex)
    const fetchFn = makeFakeFetch(signed, [], API)
    const res = await runBinaryVerifier({
      apiOrigin: API,
      appOrigin: APP,
      pinnedSigningKey: other.pkHex,
      fetchFn,
      documentRef: makeFakeDocument([]),
    })
    expect(res.status).toBe('key-not-pinned')
  })

  test('manifest-unparseable when server returns garbage', async () => {
    const fetchFn = (async () => new Response('{"garbage": true}')) as unknown as typeof fetch
    const res = await runBinaryVerifier({
      apiOrigin: API,
      appOrigin: APP,
      pinnedSigningKey: 'a'.repeat(64),
      fetchFn,
      documentRef: makeFakeDocument([]),
    })
    expect(res.status).toBe('manifest-unparseable')
  })

  test('fetch-error when manifest endpoint is down', async () => {
    const fetchFn = (async () => new Response('', { status: 503 })) as unknown as typeof fetch
    const res = await runBinaryVerifier({
      apiOrigin: API,
      appOrigin: APP,
      pinnedSigningKey: 'a'.repeat(64),
      fetchFn,
      documentRef: makeFakeDocument([]),
    })
    expect(res.status).toBe('fetch-error')
  })

  test('flags unlisted resources as mismatches', async () => {
    const { sk, pkHex } = newKeypair()
    const manifest: ReleaseManifest = {
      version: 1,
      releaseTag: 'v1',
      builtAt: 1,
      // index.html is listed, but the extra script isn't — injection attempt.
      files: { 'index.html': 'a'.repeat(64) },
    }
    const signed = signManifest(manifest, sk, pkHex)
    const fetchFn = makeFakeFetch(
      signed,
      [
        { url: `${APP}/index.html`, bytes: new TextEncoder().encode('ignored') },
        { url: `${APP}/injected.js`, bytes: new TextEncoder().encode('oops') },
      ],
      API
    )
    const doc = makeFakeDocument([`${APP}/injected.js`])
    const res = await runBinaryVerifier({
      apiOrigin: API,
      appOrigin: APP,
      pinnedSigningKey: pkHex,
      fetchFn,
      documentRef: doc,
    })
    expect(res.status).toBe('mismatch')
    expect(res.mismatches.some((m) => m.path === 'injected.js')).toBe(true)
  })
})

// ---- verifyOrThrow ---------------------------------------------------------

describe('verifyOrThrow', () => {
  const API = 'https://api.test'
  const APP = 'https://app.test'

  test('returns the result on match', async () => {
    const { sk, pkHex } = newKeypair()
    const manifest: ReleaseManifest = {
      version: 1,
      releaseTag: 'v1',
      builtAt: 1,
      files: {
        'index.html': await sha256Hex(new TextEncoder().encode('ok')),
      },
    }
    const signed = signManifest(manifest, sk, pkHex)
    const fetchFn = makeFakeFetch(
      signed,
      [{ url: `${APP}/index.html`, bytes: new TextEncoder().encode('ok') }],
      API
    )
    const res = await verifyOrThrow({
      apiOrigin: API,
      appOrigin: APP,
      pinnedSigningKey: pkHex,
      fetchFn,
      documentRef: makeFakeDocument([]),
    })
    expect(res.status).toBe('match')
  })

  test('throws VerifierFailure on mismatch', async () => {
    const { sk, pkHex } = newKeypair()
    const signed = signManifest(
      { version: 1, releaseTag: 'v1', builtAt: 1, files: { 'index.html': 'f'.repeat(64) } },
      sk,
      pkHex
    )
    const fetchFn = makeFakeFetch(
      signed,
      [{ url: `${APP}/index.html`, bytes: new TextEncoder().encode('real') }],
      API
    )
    await expect(
      verifyOrThrow({
        apiOrigin: API,
        appOrigin: APP,
        pinnedSigningKey: pkHex,
        fetchFn,
        documentRef: makeFakeDocument([]),
      })
    ).rejects.toBeInstanceOf(VerifierFailure)
  })

  test('throws on not-configured (fail closed in dev without a pinned key)', async () => {
    await expect(
      verifyOrThrow({
        apiOrigin: API,
        appOrigin: APP,
        pinnedSigningKey: '',
        fetchFn: (async () => new Response('')) as unknown as typeof fetch,
        documentRef: makeFakeDocument([]),
      })
    ).rejects.toBeInstanceOf(VerifierFailure)
  })

  test('throws on signature-invalid (forged signature)', async () => {
    const { sk } = newKeypair()
    const other = newKeypair()
    const manifest: ReleaseManifest = { version: 1, releaseTag: 'v1', builtAt: 1, files: {} }
    const canonical = canonicalizeJson(manifest)
    const sig = ed25519.sign(new TextEncoder().encode(canonical), sk)
    const signed = { manifest, signature: bytesToHex(sig), signingKey: other.pkHex }
    const fetchFn = makeFakeFetch(signed, [], API)
    await expect(
      verifyOrThrow({
        apiOrigin: API,
        appOrigin: APP,
        pinnedSigningKey: other.pkHex,
        fetchFn,
        documentRef: makeFakeDocument([]),
      })
    ).rejects.toBeInstanceOf(VerifierFailure)
  })

  test('throws on key-not-pinned (wrong signing key)', async () => {
    const { sk, pkHex } = newKeypair()
    const other = newKeypair()
    const signed = signManifest({ version: 1, releaseTag: 'v1', builtAt: 1, files: {} }, sk, pkHex)
    const fetchFn = makeFakeFetch(signed, [], API)
    await expect(
      verifyOrThrow({
        apiOrigin: API,
        appOrigin: APP,
        pinnedSigningKey: other.pkHex,
        fetchFn,
        documentRef: makeFakeDocument([]),
      })
    ).rejects.toBeInstanceOf(VerifierFailure)
  })

  test('throws on manifest-unparseable (server returns garbage)', async () => {
    const fetchFn = (async () => new Response('{"garbage": true}')) as unknown as typeof fetch
    await expect(
      verifyOrThrow({
        apiOrigin: API,
        appOrigin: APP,
        pinnedSigningKey: 'a'.repeat(64),
        fetchFn,
        documentRef: makeFakeDocument([]),
      })
    ).rejects.toBeInstanceOf(VerifierFailure)
  })

  test('throws on fetch-error (manifest endpoint down)', async () => {
    const fetchFn = (async () => new Response('', { status: 503 })) as unknown as typeof fetch
    await expect(
      verifyOrThrow({
        apiOrigin: API,
        appOrigin: APP,
        pinnedSigningKey: 'a'.repeat(64),
        fetchFn,
        documentRef: makeFakeDocument([]),
      })
    ).rejects.toBeInstanceOf(VerifierFailure)
  })

  test('VerifierFailure exposes the underlying result', async () => {
    const { sk, pkHex } = newKeypair()
    const other = newKeypair()
    const signed = signManifest({ version: 1, releaseTag: 'v1', builtAt: 1, files: {} }, sk, pkHex)
    const fetchFn = makeFakeFetch(signed, [], API)
    try {
      await verifyOrThrow({
        apiOrigin: API,
        appOrigin: APP,
        pinnedSigningKey: other.pkHex,
        fetchFn,
        documentRef: makeFakeDocument([]),
      })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(VerifierFailure)
      const failure = err as VerifierFailure
      expect(failure.result.status).toBe('key-not-pinned')
      expect(failure.message).toContain('key-not-pinned')
    }
  })
})
