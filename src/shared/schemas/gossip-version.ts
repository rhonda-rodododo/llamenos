// Tier 4 PR-C — schemas for the gossip version attestation protocol and the
// signed release manifest consumed by the client-side binary verifier.
//
// Two surfaces:
//
// 1. ReleaseManifest / SignedReleaseManifest — fetched from the API over
//    HTTPS, verified against a pinned Ed25519 public key pair embedded in
//    the bundle at build time. The verifier fails CLOSED if the loaded
//    SPA does not match this manifest.
//
// 2. BundleAttestContent — the payload each running client publishes on the
//    Nostr relay as an ephemeral kind 20002 event so peers can detect a
//    targeted bundle injection. Every field is bounded; free-form strings
//    are capped so an attacker cannot use the attest channel as a covert
//    storage or amplification sink.
//
// See docs/superpowers/plans/2026-04-10-security-tier-4-delivery-hardening.md
// Workstream 4.C.

import { z } from '@hono/zod-openapi'

// ---- Shared primitives -----------------------------------------------------

const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'expected 64-char lowercase hex')
const Ed25519SigHex = z.string().regex(/^[0-9a-f]{128}$/, 'expected 128-char Ed25519 signature')
const Ed25519PubHex = z.string().regex(/^[0-9a-f]{64}$/, 'expected 32-byte Ed25519 pubkey hex')
const SchnorrPubHex = z.string().regex(/^[0-9a-f]{64}$/, 'expected x-only schnorr pubkey hex')
const SchnorrSigHex = z.string().regex(/^[0-9a-f]{128}$/, 'expected schnorr signature hex')

// ---- Release manifest (binary verifier) ------------------------------------

const RelativeFilePath = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9._/-]+$/, 'path must be relative and contain only [A-Za-z0-9._/-]')
  .refine((p) => !p.startsWith('/') && !p.includes('..'), {
    message: 'path must be relative and must not contain parent segments',
  })

export const ReleaseManifestSchema = z.object({
  version: z.literal(1),
  releaseTag: z.string().min(1).max(128),
  commit: z
    .string()
    .regex(/^[0-9a-f]{40}$/, 'expected 40-char lowercase git sha')
    .optional(),
  builtAt: z.number().int().nonnegative(),
  // Map of path -> SHA-256 hex. Keys are restricted to relative, safe paths.
  files: z.record(RelativeFilePath, Sha256Hex),
  sbom: z
    .object({
      format: z.enum(['cyclonedx-json', 'spdx-json']),
      sha256: Sha256Hex,
    })
    .optional(),
})
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>

export const SignedReleaseManifestSchema = z.object({
  manifest: ReleaseManifestSchema,
  signature: Ed25519SigHex,
  signingKey: Ed25519PubHex,
})
export type SignedReleaseManifest = z.infer<typeof SignedReleaseManifestSchema>

// ---- Gossip bundle attestation (Nostr kind 20002) --------------------------

export const BUNDLE_ATTEST_KIND = 20002 as const

export const BundleAttestContentSchema = z.object({
  version: z.literal(1),
  bundleHash: Sha256Hex,
  bundleVersion: z.string().min(1).max(64),
  releaseTag: z.string().min(1).max(128),
  timestamp: z.number().int().nonnegative(),
  // UA is truncated client-side to avoid covert-channel abuse. We enforce a
  // hard upper bound here regardless.
  userAgent: z.string().max(256),
})
export type BundleAttestContent = z.infer<typeof BundleAttestContentSchema>

// Minimal shape of a kind-20002 Nostr event we ever accept. Events with any
// extra top-level fields parse fine (zod strips them) but the inner content
// MUST round-trip through BundleAttestContentSchema before it counts.
export const GossipNostrEventSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  pubkey: SchnorrPubHex,
  created_at: z.number().int().nonnegative(),
  kind: z.literal(BUNDLE_ATTEST_KIND),
  tags: z.array(z.array(z.string())),
  content: z.string().max(2048),
  sig: SchnorrSigHex,
})
export type GossipNostrEvent = z.infer<typeof GossipNostrEventSchema>

// Tag marker so the relay operator can filter/rate-limit this event class
// without having to understand its payload.
export const GOSSIP_TAG = ['t', 'llamenos-gossip-attest'] as const
