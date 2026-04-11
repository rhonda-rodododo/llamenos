#!/usr/bin/env bash
set -euo pipefail

DIST="${1:-dist/client}"

if [ ! -d "$DIST" ]; then
  echo "verify-no-console: $DIST not found; run build first." >&2
  exit 1
fi

# Grep for actual console call invocations (console.METHOD() with open paren)
# in built JS, excluding known third-party / Workbox bundles.
#
# Pattern requires '(' immediately after the method name to avoid false positives
# from guard expressions like `typeof console<"u"&&console.warn&&...` (recharts etc.)
#
# Excluded paths:
#   assets/workbox-*.js      — Workbox runtime (precaching, routing)
#   service-worker.js        — Generated SW (Workbox injectManifest output)
#   sw.js                    — Alternate SW name
#   registerSW.js            — vite-plugin-pwa SW registration shim
#   assets/transcription-worker-*.js — @huggingface/transformers WASM bundle
HITS=$(grep -rEn 'console\.(log|warn|info|debug|error)\(' "$DIST" --include='*.js' \
  | grep -vE 'assets/workbox-[^:]*\.js:|service-worker\.js:|sw\.js:|registerSW\.js:|assets/transcription-worker-[^:]*\.js:' || true)

if [ -n "$HITS" ]; then
  echo "verify-no-console: FAIL — console.* found in production bundle:" >&2
  echo "$HITS" >&2
  exit 1
fi

echo "verify-no-console: OK — no console.* in production bundle."
