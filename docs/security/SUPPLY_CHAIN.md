# Supply Chain Security

**Last Updated:** 2026-04-11
**Tier:** 0 (Foundation)
**Status:** Shipped

Llamenos uses a layered supply chain security model: reproducible builds, cryptographic signing, software bill of materials (SBOM), and provenance attestation. This document explains what's signed, what's attested, how to verify, and where the trust roots live.

## Architecture Overview

```
Source Code (GitHub)
    │
    ├─ CI Build (GitHub Actions)
    │     ├─ Reproducible Docker build (SOURCE_DATE_EPOCH)
    │     ├─ CHECKSUMS.txt (SHA-256 of every build artifact)
    │     ├─ CycloneDX SBOM (sbom.cdx.json)
    │     └─ SLSA Build Provenance attestation
    │
    ├─ Signing (in release job)
    │     ├─ Cosign keyless signatures (OIDC from GitHub Actions)
    │     ├─ Cosign SBOM attestation
    │     └─ GPG detached signature (optional, if key configured)
    │
    └─ GitHub Release
          ├─ CHECKSUMS.txt + .cosign.sig + .cosign.pem + .asc
          ├─ provenance.json + .cosign.sig + .cosign.pem
          ├─ sbom.cdx.json + .att
          └─ SLSA provenance (GitHub Attestations API)
```

## Trust Roots

| Root | Type | Location |
|------|------|----------|
| **Sigstore / Fulcio** | OIDC-based code signing CA | Public transparency log (Rekor) |
| **GitHub Actions OIDC** | Identity provider for keyless signing | `https://token.actions.githubusercontent.com` |
| **GPG release key** | Traditional detached signatures | Key ID in `RELEASE_GPG_KEY_ID` secret |
| **GitHub Attestations** | SLSA build provenance | `gh attestation verify` |

Cosign keyless signing uses Sigstore's Fulcio CA: GitHub Actions presents an OIDC token proving the workflow identity, Fulcio issues a short-lived certificate, and the signature + certificate are logged in Rekor (a public transparency log). No private keys are stored in secrets — the trust anchor is the GitHub Actions OIDC identity.

## What's Signed and Attested

### Cosign Keyless Signatures

| Artifact | Signature | Certificate | Verifies |
|----------|-----------|-------------|----------|
| `CHECKSUMS.txt` | `.cosign.sig` | `.cosign.pem` | Build output integrity |
| `provenance.json` | `.cosign.sig` | `.cosign.pem` | Build metadata integrity |

### SBOM Attestation

| Artifact | Attestation | Format | Verifies |
|----------|-------------|--------|----------|
| `CHECKSUMS.txt` | `sbom.cdx.json.att` | CycloneDX 1.5 | Dependency inventory matches build |

The SBOM attestation binds the CycloneDX SBOM to the build checksums — it proves that the listed dependencies were present during the build that produced those checksums.

### SLSA Build Provenance

GitHub's `attest-build-provenance` action creates a SLSA v1.0 provenance attestation covering `CHECKSUMS.txt` and all JS/CSS build outputs. This proves:
- The build ran in GitHub Actions (not a developer laptop)
- The specific workflow file and commit that produced the artifacts
- The build inputs (source repo, ref, commit SHA)

### GPG Signature (Optional)

If `RELEASE_GPG_PRIVATE_KEY` and `RELEASE_GPG_KEY_ID` secrets are configured, `CHECKSUMS.txt` also gets a traditional GPG detached signature (`CHECKSUMS.txt.asc`).

## Reproducible Builds

The build is deterministic:

1. **`SOURCE_DATE_EPOCH`**: Set to the git commit timestamp. Vite and all build tools use this instead of wall-clock time.
2. **`Dockerfile.build`**: Pins the build environment (OS, Node/Bun version, system packages).
3. **Content-hashed filenames**: Vite outputs `[name]-[hash].js` — same source produces same hash.
4. **`bun.lockb`**: Lockfile ensures exact dependency versions. Its SHA-256 is included in `CHECKSUMS.txt`.

To reproduce locally:

```bash
git clone --branch v0.18.0 https://github.com/rhonda-rodododo/llamenos.git
cd llamenos
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
docker build -f Dockerfile.build \
  --build-arg SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH \
  --build-arg GITHUB_SHA=$(git rev-parse HEAD) \
  -t llamenos-verify .
```

## Verification

### Quick Verification (Signatures Only)

```bash
SKIP_DOCKER_BUILD=1 ./scripts/verify-build.sh v0.18.0
```

This downloads release artifacts and verifies:
1. Cosign keyless signatures on `CHECKSUMS.txt` and `provenance.json`
2. SBOM attestation on `CHECKSUMS.txt`
3. GPG signature (if available)

Takes ~10 seconds. Requires `cosign` and `gh` CLI.

### Full Verification (Signatures + Reproducible Build)

```bash
./scripts/verify-build.sh v0.18.0
```

Does everything above, plus:
4. Clones source at the tagged version
5. Builds in Docker with the same `SOURCE_DATE_EPOCH`
6. Compares local checksums against published `CHECKSUMS.txt`

Takes ~5 minutes (Docker build). Requires `cosign`, `gh`, `git`, and `docker`.

### Manual Cosign Verification

```bash
# Verify CHECKSUMS.txt signature
cosign verify-blob \
  --signature CHECKSUMS.txt.cosign.sig \
  --certificate CHECKSUMS.txt.cosign.pem \
  --certificate-identity-regexp "https://github.com/rhonda-rodododo/llamenos/" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  CHECKSUMS.txt

# Verify SBOM attestation
cosign verify-blob-attestation \
  --signature sbom.cdx.json.att \
  --type cyclonedx \
  --certificate-identity-regexp "https://github.com/rhonda-rodododo/llamenos/" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  CHECKSUMS.txt
```

### SLSA Provenance Verification

```bash
gh attestation verify CHECKSUMS.txt \
  --repo rhonda-rodododo/llamenos
```

## SBOM Details

The CycloneDX SBOM (`sbom.cdx.json`) is generated by `@cyclonedx/cdxgen` during CI. It catalogs:

- All npm/bun dependencies (direct and transitive)
- Their versions, licenses, and package URLs (purls)
- The dependency tree structure

Downstream users can feed the SBOM into vulnerability scanners (Grype, Trivy, OWASP Dependency-Track) to check for known CVEs in the dependency tree.

## Incident Response

If a supply chain compromise is suspected:

1. **Compare checksums**: Run `./scripts/verify-build.sh` against the deployed version
2. **Check Rekor**: Search the Sigstore transparency log for unexpected signatures on the repo
3. **Audit SBOM**: Diff `sbom.cdx.json` between releases to identify added/changed dependencies
4. **Review provenance**: Verify the `provenance.json` build parameters match expectations
5. **Check GitHub audit log**: Review Actions workflow runs for unauthorized modifications

## Related Documents

- [Deployment Hardening](DEPLOYMENT_HARDENING.md) — infrastructure security for operators
- [Threat Model](THREAT_MODEL.md) — adversaries and attack surfaces
- [Data Classification](DATA_CLASSIFICATION.md) — what data exists and where
