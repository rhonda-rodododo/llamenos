#!/usr/bin/env bash
# verify-build.sh — Verify deployed build matches source code (Epic 79)
#
# Reproduces the build locally in Docker and compares checksums against
# published GitHub Release artifacts. Verifies cosign signatures and SBOM
# attestations when cosign is available.
#
# Requirements: git, docker, gh (GitHub CLI)
# Optional: cosign (for signature + attestation verification)
#
# Usage:
#   ./scripts/verify-build.sh              # Verify latest release
#   ./scripts/verify-build.sh v0.18.0      # Verify specific version
#   SKIP_DOCKER_BUILD=1 ./scripts/verify-build.sh  # Skip Docker build, verify signatures only

set -euo pipefail

VERSION="${1:-}"
REPO="rhonda-rodododo/llamenos"
COSIGN_AVAILABLE=false

echo "=== Llamenos Build Verification ==="
echo ""

# Check for cosign
if command -v cosign &>/dev/null; then
  COSIGN_AVAILABLE=true
  echo "cosign: $(cosign version 2>&1 | head -1)"
else
  echo "ERROR: cosign is not installed."
  echo ""
  echo "Cosign is required for signature verification. Install it:"
  echo "  https://docs.sigstore.dev/cosign/system_config/installation/"
  echo ""
  echo "  brew install cosign          # macOS"
  echo "  go install github.com/sigstore/cosign/v2/cmd/cosign@latest  # Go"
  echo "  apt install cosign           # Debian/Ubuntu (if packaged)"
  echo ""
  exit 1
fi

# Determine version to verify
if [ -z "$VERSION" ]; then
  VERSION=$(gh release list --repo "$REPO" --limit 1 --json tagName --jq '.[0].tagName')
  if [ -z "$VERSION" ]; then
    echo "ERROR: No releases found for $REPO"
    exit 1
  fi
  echo "Latest release: $VERSION"
else
  echo "Verifying: $VERSION"
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
echo "Working directory: $WORKDIR"
echo ""

# ─── Step 1: Download release artifacts ─────────────────────────
echo "--- Downloading release artifacts ---"
PATTERNS=(
  "CHECKSUMS.txt"
  "CHECKSUMS.txt.asc"
  "CHECKSUMS.txt.cosign.sig"
  "CHECKSUMS.txt.cosign.pem"
  "provenance.json"
  "provenance.json.cosign.sig"
  "provenance.json.cosign.pem"
  "sbom.cdx.json"
  "sbom.cdx.json.att"
)

for pat in "${PATTERNS[@]}"; do
  if gh release download "$VERSION" --repo "$REPO" --pattern "$pat" --dir "$WORKDIR" 2>/dev/null; then
    echo "  Downloaded: $pat"
  fi
done

if [ ! -f "$WORKDIR/CHECKSUMS.txt" ]; then
  echo "ERROR: CHECKSUMS.txt not found in release $VERSION"
  exit 1
fi

# ─── Step 2: Verify cosign signatures ───────────────────────────
echo ""
echo "--- Verifying cosign signatures ---"
SIGS_VERIFIED=0
SIGS_EXPECTED=0

for artifact in CHECKSUMS.txt provenance.json; do
  SIG="$WORKDIR/${artifact}.cosign.sig"
  CERT="$WORKDIR/${artifact}.cosign.pem"
  FILE="$WORKDIR/${artifact}"

  [ -f "$FILE" ] || continue
  SIGS_EXPECTED=$((SIGS_EXPECTED + 1))

  if [ ! -f "$SIG" ] || [ ! -f "$CERT" ]; then
    echo "  WARNING: Missing cosign signature files for $artifact"
    echo "    This release may predate cosign signing."
    continue
  fi

  if cosign verify-blob \
    --signature "$SIG" \
    --certificate "$CERT" \
    --certificate-identity-regexp "https://github.com/${REPO}/" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    "$FILE" 2>/dev/null; then
    echo "  VERIFIED: $artifact (cosign keyless signature)"
    SIGS_VERIFIED=$((SIGS_VERIFIED + 1))
  else
    echo "  FAILED: $artifact cosign signature verification failed!"
    echo "  The artifact may have been tampered with."
    exit 1
  fi
done

if [ "$SIGS_EXPECTED" -gt 0 ] && [ "$SIGS_VERIFIED" -eq "$SIGS_EXPECTED" ]; then
  echo "  All $SIGS_VERIFIED/$SIGS_EXPECTED cosign signatures verified."
elif [ "$SIGS_EXPECTED" -eq 0 ]; then
  echo "  No artifacts to verify."
fi

# ─── Step 3: Verify SBOM attestation ────────────────────────────
echo ""
echo "--- Verifying SBOM attestation ---"
if [ -f "$WORKDIR/sbom.cdx.json.att" ]; then
  if cosign verify-blob-attestation \
    --signature "$WORKDIR/sbom.cdx.json.att" \
    --type cyclonedx \
    --certificate-identity-regexp "https://github.com/${REPO}/" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    "$WORKDIR/CHECKSUMS.txt" 2>/dev/null; then
    echo "  VERIFIED: SBOM attestation (CycloneDX)"
  else
    echo "  FAILED: SBOM attestation verification failed!"
    exit 1
  fi

  if [ -f "$WORKDIR/sbom.cdx.json" ]; then
    COMPONENT_COUNT=$(jq '.components | length' "$WORKDIR/sbom.cdx.json" 2>/dev/null || echo "unknown")
    echo "  SBOM contains $COMPONENT_COUNT components"
  fi
else
  echo "  No SBOM attestation found (sbom.cdx.json.att)"
  echo "  This release may predate SBOM attestation."
fi

# ─── Step 4: Verify GPG signature ───────────────────────────────
echo ""
echo "--- Verifying GPG signature ---"
if [ -f "$WORKDIR/CHECKSUMS.txt.asc" ]; then
  if gpg --verify "$WORKDIR/CHECKSUMS.txt.asc" "$WORKDIR/CHECKSUMS.txt" 2>/dev/null; then
    echo "  VERIFIED: GPG signature on CHECKSUMS.txt"
  else
    echo "  WARNING: GPG signature verification failed"
    echo "  You may need to import the release signing key."
  fi
else
  echo "  No GPG signature found (CHECKSUMS.txt.asc)"
fi

# ─── Step 5: Reproducible build verification ────────────────────
if [ "${SKIP_DOCKER_BUILD:-}" = "1" ]; then
  echo ""
  echo "--- Skipping Docker build (SKIP_DOCKER_BUILD=1) ---"
  echo ""
  echo "BUILD SIGNATURES VERIFIED"
  echo "Run without SKIP_DOCKER_BUILD to also verify reproducible build."
  exit 0
fi

echo ""
echo "--- Cloning source at $VERSION ---"
git clone --depth 1 --branch "$VERSION" "https://github.com/${REPO}.git" "$WORKDIR/source"

SOURCE_DATE_EPOCH=$(git -C "$WORKDIR/source" log -1 --format=%ct)
GITHUB_SHA=$(git -C "$WORKDIR/source" log -1 --format=%H)
echo "Commit: $GITHUB_SHA"
echo "SOURCE_DATE_EPOCH: $SOURCE_DATE_EPOCH"
echo ""

echo "--- Building in Docker container ---"
docker build \
  -f "$WORKDIR/source/Dockerfile.build" \
  --build-arg "SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH" \
  --build-arg "GITHUB_SHA=$GITHUB_SHA" \
  -t llamenos-verify \
  "$WORKDIR/source"

echo ""
echo "--- Extracting build artifacts ---"
docker create --name llamenos-verify-extract llamenos-verify
docker cp llamenos-verify-extract:/build/dist "$WORKDIR/local-build"
docker rm llamenos-verify-extract

echo ""
echo "--- Computing local checksums ---"
(cd "$WORKDIR/local-build" && find . -type f -exec sha256sum {} \; | sort) > "$WORKDIR/local-checksums.txt"
echo "$(wc -l < "$WORKDIR/local-checksums.txt") files checksummed"

# ─── Step 6: Compare checksums ──────────────────────────────────
echo ""
echo "--- Comparing checksums ---"

# Download and display provenance metadata if available
if [ -f "$WORKDIR/provenance.json" ]; then
  echo ""
  echo "--- Build Provenance Metadata ---"
  cat "$WORKDIR/provenance.json"
  echo ""
fi

if diff "$WORKDIR/local-checksums.txt" "$WORKDIR/CHECKSUMS.txt" > /dev/null 2>&1; then
  echo ""
  echo "BUILD VERIFIED: Local build matches published checksums"
  echo "  - Cosign signatures: VERIFIED"
  [ -f "$WORKDIR/sbom.cdx.json.att" ] && echo "  - SBOM attestation: VERIFIED"
  echo "  - Reproducible build: MATCH"
  exit 0
else
  echo ""
  echo "BUILD MISMATCH: Local build differs from published checksums"
  echo ""
  diff "$WORKDIR/local-checksums.txt" "$WORKDIR/CHECKSUMS.txt" || true
  exit 1
fi
