#!/usr/bin/env bash
#
# dev-hosts.sh — idempotently install the Llamenos split-origin dev hosts
# into /etc/hosts so local browsers can reach app.llamenos.localhost,
# api.llamenos.localhost, and crypto.llamenos.localhost.
#
# Tier 4 PR-A requires three origins even in development so that CORS,
# cookie scoping, and iframe sandboxing behave the same locally as in prod.
#
# Usage:
#   ./scripts/dev-hosts.sh            # adds entries if missing
#   ./scripts/dev-hosts.sh --check    # exit 0 if entries present, 1 if not
#   ./scripts/dev-hosts.sh --remove   # strips the managed block
#
# Requires: sudo (to write /etc/hosts). The script only calls sudo if a
# change is actually needed, so repeated runs on a configured system are no-ops.

set -euo pipefail

HOSTS_FILE="${HOSTS_FILE:-/etc/hosts}"
MARK_BEGIN="# >>> llamenos-dev-hosts >>>"
MARK_END="# <<< llamenos-dev-hosts <<<"

# When the caller points HOSTS_FILE at a temp path (for tests) we don't
# need elevated privileges; write directly. Otherwise /etc/hosts needs sudo.
if [[ "$HOSTS_FILE" == "/etc/hosts" ]]; then
  MAYBE_SUDO="sudo"
else
  MAYBE_SUDO=""
fi

HOSTS=(
  "app.llamenos.localhost"
  "api.llamenos.localhost"
  "crypto.llamenos.localhost"
)

block_present() {
  [[ -f "$HOSTS_FILE" ]] || return 1
  grep -qF "$MARK_BEGIN" "$HOSTS_FILE"
}

print_block() {
  echo "$MARK_BEGIN"
  for host in "${HOSTS[@]}"; do
    echo "127.0.0.1 $host"
  done
  echo "$MARK_END"
}

case "${1:-install}" in
  --check)
    if block_present; then
      echo "llamenos dev hosts already installed in $HOSTS_FILE"
      exit 0
    else
      echo "llamenos dev hosts NOT installed in $HOSTS_FILE"
      exit 1
    fi
    ;;
  --remove)
    if ! block_present; then
      echo "No llamenos dev hosts block found — nothing to remove."
      exit 0
    fi
    tmp="$(mktemp)"
    # Delete everything between the markers (inclusive)
    awk -v b="$MARK_BEGIN" -v e="$MARK_END" '
      $0 == b {skip=1; next}
      $0 == e {skip=0; next}
      !skip {print}
    ' "$HOSTS_FILE" >"$tmp"
    $MAYBE_SUDO cp "$tmp" "$HOSTS_FILE"
    rm -f "$tmp"
    echo "Removed llamenos dev hosts block from $HOSTS_FILE"
    ;;
  install|"")
    if block_present; then
      echo "llamenos dev hosts already installed — nothing to do."
      exit 0
    fi
    echo "Adding llamenos dev hosts to $HOSTS_FILE (requires sudo):"
    print_block | sed 's/^/  /'
    print_block | $MAYBE_SUDO tee -a "$HOSTS_FILE" >/dev/null
    echo "Done."
    ;;
  *)
    echo "Unknown arg: $1" >&2
    echo "Usage: $0 [install|--check|--remove]" >&2
    exit 2
    ;;
esac
