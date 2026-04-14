# Vendored Dependency Provenance

This file records the chain-of-custody for every third-party module in `vendor/`.
Updates are made via PR, never directly to `main`.

## @wireapp/core-crypto

- **Purpose:** Messaging Layer Security (RFC 9420) implementation via Rust/WASM.
  Supports PQ ciphersuites via `draft-ietf-mls-pq-ciphersuites` (XWing,
  ML-KEM-1024). Vendored to pin our MLS dependency against untracked upstream
  changes and to include the distribution in reproducible builds.
- **Upstream:** https://github.com/wireapp/core-crypto
- **npm package:** @wireapp/core-crypto@9.3.3
- **Tarball SHA-256:** `4573bd8d966e4530797ab35c1cacd1133b48febe2fbb8ae477c2ccd49def01eb`
- **License:** GPL-3.0 (see `vendor/@wireapp/core-crypto/README.md`). GPL-3.0
  obligations apply to distribution of the vendored source; Llamenos' overall
  license posture is GPL-compatible and this PROVENANCE.md documents the license
  chain. Core-crypto's JS bindings (`@wireapp/core-crypto`) are the same license
  as the upstream Rust crate.
- **Vendored on:** 2026-04-12
- **Audit status:** PENDING — commissioned audit scheduled; see
  `docs/security/VENDOR_AUDIT.md`.
- **API surface used:** Llamenos calls only the MLS API surface, never the
  Proteus one. See `src/client/lib/mls/` for the integration layer.
- **Update procedure:** Run `./scripts/vendor-core-crypto.sh <new-version>`,
  commit the diff to a PR, run the full test suite, and update this file with
  the new version and tarball hash.
