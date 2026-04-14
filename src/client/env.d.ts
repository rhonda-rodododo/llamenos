/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string
  readonly VITE_CRYPTO_ORIGIN?: string
  readonly VITE_APP_ORIGIN?: string
  /**
   * Ed25519 public key (32 bytes, hex-encoded → 64 chars) of the release
   * signer. Baked into the bundle at build time by `vite.config.ts` so the
   * binary verifier has a tamper-evident key to check the release manifest
   * signature against. Empty string disables boot verification and the
   * fail-closed boot gate will refuse to start.
   */
  readonly VITE_RELEASE_SIGNING_PUBKEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
