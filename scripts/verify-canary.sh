#!/usr/bin/env bash
#
# verify-canary.sh — friendly CLI wrapper around the warrant canary
# signature verifier.
#
# Usage:
#   scripts/verify-canary.sh \
#     --in  docs/security/WARRANT_CANARY.md \
#     --sig docs/security/WARRANT_CANARY.md.sig \
#     --pub <base64 pubkey>
#
# The --pub argument may also be supplied via the WARRANT_CANARY_PUBKEY
# environment variable. The same public key MUST match the value that
# was pinned into the client bundle at build time via
# VITE_WARRANT_CANARY_PUBKEY, otherwise browser and CLI verification
# will diverge.
#
# Exit codes:
#   0 — signature valid
#   1 — signature invalid (tampering, wrong key, or wrong sig)
#   2 — verification unavailable (no public key provided)
#   3 — argument or IO error

set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  echo "verify-canary.sh: 'bun' is required and not on PATH" >&2
  exit 3
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

exec bun run "${REPO_ROOT}/scripts/verify-warrant-canary.ts" "$@"
