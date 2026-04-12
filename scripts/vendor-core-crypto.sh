#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?usage: $0 <npm-version> (e.g. 9.3.3)}"
VENDOR_DIR="vendor/@wireapp/core-crypto"
TMP_DIR="$(mktemp -d)"

echo "Downloading @wireapp/core-crypto@${VERSION} from npm..."
(cd "$TMP_DIR" && npm pack "@wireapp/core-crypto@${VERSION}" --silent)

echo "Extracting package..."
tar xzf "$TMP_DIR/wireapp-core-crypto-${VERSION}.tgz" -C "$TMP_DIR"

echo "Removing existing vendor tree..."
rm -rf "$VENDOR_DIR"
mkdir -p "$VENDOR_DIR"

echo "Copying distribution files..."
cp -r "$TMP_DIR/package/src" "$VENDOR_DIR/src"
cp "$TMP_DIR/package/package.json" "$VENDOR_DIR/package.json"
cp "$TMP_DIR/package/README.md" "$VENDOR_DIR/README.md"

TARBALL_SHA256=$(sha256sum "$TMP_DIR/wireapp-core-crypto-${VERSION}.tgz" | cut -d' ' -f1)

echo "Writing vendor pin marker..."
cat > "$VENDOR_DIR/VENDOR.md" <<MARKER
# @wireapp/core-crypto (vendored)

- Upstream: https://github.com/wireapp/core-crypto
- npm package: @wireapp/core-crypto@${VERSION}
- Tarball SHA-256: ${TARBALL_SHA256}
- Vendored: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- License: GPL-3.0
MARKER

rm -rf "$TMP_DIR"
echo "Vendored @wireapp/core-crypto@${VERSION} into $VENDOR_DIR"
echo "Tarball SHA-256: ${TARBALL_SHA256}"
