import { describe, expect, test } from 'bun:test'
import {
  BUNDLE_ATTEST_KIND,
  BundleAttestContentSchema,
  GossipNostrEventSchema,
  ReleaseManifestSchema,
  SignedReleaseManifestSchema,
} from './gossip-version'

const HEX64 = 'a'.repeat(64)
const HEX128 = 'b'.repeat(128)

describe('ReleaseManifestSchema', () => {
  test('accepts a minimal, well-formed manifest', () => {
    const parsed = ReleaseManifestSchema.parse({
      version: 1,
      releaseTag: 'v1.2.3',
      builtAt: 1_700_000_000,
      files: { 'index.html': HEX64, 'assets/main.js': HEX64 },
    })
    expect(parsed.releaseTag).toBe('v1.2.3')
  })

  test('rejects absolute paths', () => {
    const result = ReleaseManifestSchema.safeParse({
      version: 1,
      releaseTag: 'v1',
      builtAt: 1,
      files: { '/etc/passwd': HEX64 },
    })
    expect(result.success).toBe(false)
  })

  test('rejects parent-segment paths', () => {
    const result = ReleaseManifestSchema.safeParse({
      version: 1,
      releaseTag: 'v1',
      builtAt: 1,
      files: { '../../oops': HEX64 },
    })
    expect(result.success).toBe(false)
  })

  test('rejects non-64-hex file hashes', () => {
    const result = ReleaseManifestSchema.safeParse({
      version: 1,
      releaseTag: 'v1',
      builtAt: 1,
      files: { 'index.html': 'nothex' },
    })
    expect(result.success).toBe(false)
  })

  test('accepts optional commit SHA-1 and SBOM block', () => {
    const parsed = ReleaseManifestSchema.parse({
      version: 1,
      releaseTag: 'v1',
      commit: 'e'.repeat(40),
      builtAt: 1,
      files: {},
      sbom: { format: 'cyclonedx-json', sha256: HEX64 },
    })
    expect(parsed.commit).toBe('e'.repeat(40))
    expect(parsed.sbom?.format).toBe('cyclonedx-json')
  })

  test('rejects non-40-char commit', () => {
    const result = ReleaseManifestSchema.safeParse({
      version: 1,
      releaseTag: 'v1',
      commit: 'abc',
      builtAt: 1,
      files: {},
    })
    expect(result.success).toBe(false)
  })
})

describe('SignedReleaseManifestSchema', () => {
  test('accepts a manifest with signature + pinned key', () => {
    const parsed = SignedReleaseManifestSchema.parse({
      manifest: {
        version: 1,
        releaseTag: 'v1',
        builtAt: 1,
        files: {},
      },
      signature: HEX128,
      signingKey: HEX64,
    })
    expect(parsed.signingKey).toBe(HEX64)
  })

  test('rejects a short signature', () => {
    const result = SignedReleaseManifestSchema.safeParse({
      manifest: { version: 1, releaseTag: 'v1', builtAt: 1, files: {} },
      signature: 'ab',
      signingKey: HEX64,
    })
    expect(result.success).toBe(false)
  })
})

describe('BundleAttestContentSchema', () => {
  test('accepts a valid attest', () => {
    const parsed = BundleAttestContentSchema.parse({
      version: 1,
      bundleHash: HEX64,
      bundleVersion: '1.2.3',
      releaseTag: 'v1.2.3',
      timestamp: 1_700_000_000,
      userAgent: 'Mozilla/5.0 (X11)',
    })
    expect(parsed.bundleHash).toBe(HEX64)
  })

  test('rejects non-hex bundle hashes', () => {
    expect(
      BundleAttestContentSchema.safeParse({
        version: 1,
        bundleHash: 'not a hash',
        bundleVersion: '1',
        releaseTag: 'v1',
        timestamp: 1,
        userAgent: 'x',
      }).success
    ).toBe(false)
  })

  test('rejects oversized user-agent strings (covert channel guard)', () => {
    const bigUa = 'a'.repeat(257)
    expect(
      BundleAttestContentSchema.safeParse({
        version: 1,
        bundleHash: HEX64,
        bundleVersion: '1',
        releaseTag: 'v1',
        timestamp: 1,
        userAgent: bigUa,
      }).success
    ).toBe(false)
  })

  test('rejects future version literals', () => {
    expect(
      BundleAttestContentSchema.safeParse({
        version: 2,
        bundleHash: HEX64,
        bundleVersion: '1',
        releaseTag: 'v1',
        timestamp: 1,
        userAgent: 'x',
      }).success
    ).toBe(false)
  })
})

describe('GossipNostrEventSchema', () => {
  test('accepts a well-formed gossip event', () => {
    const parsed = GossipNostrEventSchema.parse({
      id: HEX64,
      pubkey: HEX64,
      created_at: 1,
      kind: BUNDLE_ATTEST_KIND,
      tags: [['t', 'llamenos-gossip-attest']],
      content: '{}',
      sig: HEX128,
    })
    expect(parsed.kind).toBe(20002)
  })

  test('rejects wrong kind', () => {
    expect(
      GossipNostrEventSchema.safeParse({
        id: HEX64,
        pubkey: HEX64,
        created_at: 1,
        kind: 1,
        tags: [],
        content: '{}',
        sig: HEX128,
      }).success
    ).toBe(false)
  })

  test('rejects oversized content payload', () => {
    expect(
      GossipNostrEventSchema.safeParse({
        id: HEX64,
        pubkey: HEX64,
        created_at: 1,
        kind: BUNDLE_ATTEST_KIND,
        tags: [],
        content: 'x'.repeat(2049),
        sig: HEX128,
      }).success
    ).toBe(false)
  })
})
