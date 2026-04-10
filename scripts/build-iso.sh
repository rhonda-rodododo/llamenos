#!/usr/bin/env bash
# scripts/build-iso.sh — host entrypoint for building a Llamenos FDE ISO.
# Validates flags and invokes the pinned Docker builder.
# See docs/deployment/iso-install.md for the operator guide.

set -euo pipefail

# Defaults
HOSTNAME=""
SSH_KEY=""
UNLOCK="dropbear"
STATIC_IP="dhcp"
GATEWAY=""
DNS="9.9.9.9,149.112.112.112"
LOCALE="en_US.UTF-8"
TIMEZONE="UTC"
USERNAME="deploy"
DISK="/dev/sda"
DEBIAN_VERSION="13.4.0"
OUT_DIR="./dist/iso"
NO_CACHE=0
OFFLINE=0

usage() {
  cat <<'EOF'
Usage: scripts/build-iso.sh [OPTIONS]

Build a Llamenos FDE ISO based on Debian 13 netinst.

Required:
  --hostname HOSTNAME           Initial hostname for the installed system
  --ssh-key PATH                Path to SSH public key (ed25519 recommended)
                                  Used for both initramfs dropbear unlock AND
                                  the post-install deploy user's authorized_keys

Optional:
  --unlock {dropbear|console}   Unlock mechanism (default: dropbear)
  --static-ip CIDR              Static IP for initramfs network (default: dhcp)
  --gateway IP                  Gateway IP (required if --static-ip is set)
  --dns IP[,IP]                 DNS servers (default: 9.9.9.9,149.112.112.112)
  --locale LOCALE               Locale (default: en_US.UTF-8)
  --timezone TZ                 Timezone (default: UTC)
  --user USERNAME               Initial sudo user (default: deploy)
  --disk DEVICE                 Target disk device (default: /dev/sda)
                                  Use /dev/vda for paravirt VPS providers
  --debian-version VERSION      Debian point release (default: 13.4.0)
  --out PATH                    Output directory (default: ./dist/iso/)
  --no-cache                    Re-download upstream ISO even if cached
  --offline                     Refuse to fetch anything; require local cache
  -h, --help                    Show this help

See docs/deployment/iso-install.md for the operator guide.
EOF
}

err() {
  echo "build-iso: $*" >&2
  exit 2
}

# Parse flags
while [ $# -gt 0 ]; do
  case "$1" in
    --hostname) HOSTNAME="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --unlock) UNLOCK="$2"; shift 2 ;;
    --static-ip) STATIC_IP="$2"; shift 2 ;;
    --gateway) GATEWAY="$2"; shift 2 ;;
    --dns) DNS="$2"; shift 2 ;;
    --locale) LOCALE="$2"; shift 2 ;;
    --timezone) TIMEZONE="$2"; shift 2 ;;
    --user) USERNAME="$2"; shift 2 ;;
    --disk) DISK="$2"; shift 2 ;;
    --debian-version) DEBIAN_VERSION="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --no-cache) NO_CACHE=1; shift ;;
    --offline) OFFLINE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "unknown flag: $1" ;;
  esac
done

# Validate required
[ -n "$HOSTNAME" ] || err "--hostname is required"
[ -n "$SSH_KEY" ] || err "--ssh-key is required"

# Validate hostname (RFC 1123 label)
if ! printf '%s' "$HOSTNAME" | grep -qE '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'; then
  err "invalid hostname: $HOSTNAME (must match ^[a-z0-9]([a-z0-9-]*[a-z0-9])?\$)"
fi

# Validate ssh key file exists and is readable
[ -r "$SSH_KEY" ] || err "ssh key not found or not readable: $SSH_KEY"

# Validate ssh key type — reject RSA
KEY_TYPE="$(awk '{print $1}' "$SSH_KEY" 2>/dev/null || echo unknown)"
case "$KEY_TYPE" in
  ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521) ;;
  ssh-rsa) err "unsupported ssh key type: ssh-rsa (use ed25519 — RSA is rejected for dropbear-initramfs in this builder)" ;;
  *) err "unsupported ssh key type: $KEY_TYPE (allowed: ssh-ed25519, ecdsa-sha2-*)" ;;
esac

# Validate unlock mode
case "$UNLOCK" in
  dropbear|console) ;;
  *) err "--unlock must be one of: dropbear, console (got: $UNLOCK)" ;;
esac

# Validate static-ip / gateway pairing
if [ "$STATIC_IP" != "dhcp" ]; then
  [ -n "$GATEWAY" ] || err "--gateway is required when --static-ip is set"
fi

# Validate disk path (must look like /dev/<word>)
if ! printf '%s' "$DISK" | grep -qE '^/dev/[a-z][a-z0-9]*$'; then
  err "invalid --disk: $DISK (must match /dev/[a-z][a-z0-9]*, e.g. /dev/sda or /dev/vda)"
fi

# Validate debian version (Debian 13 only in this PR)
if ! printf '%s' "$DEBIAN_VERSION" | grep -qE '^13\.[0-9]+\.[0-9]+$'; then
  err "--debian-version: only Debian 13 supported in this builder (got: $DEBIAN_VERSION)"
fi

# Validate out dir is writable (or creatable)
mkdir -p "$OUT_DIR"
[ -w "$OUT_DIR" ] || err "output directory not writable: $OUT_DIR"

# Resolve absolute paths
SSH_KEY_ABS="$(readlink -f "$SSH_KEY")"
OUT_DIR_ABS="$(readlink -f "$OUT_DIR")"

if [ "${BUILD_ISO_DRY_RUN:-0}" = "1" ]; then
  echo "DRY RUN — resolved arguments:"
  echo "  hostname=$HOSTNAME"
  echo "  ssh_key=$SSH_KEY_ABS"
  echo "  unlock=$UNLOCK"
  echo "  static_ip=$STATIC_IP"
  echo "  gateway=$GATEWAY"
  echo "  dns=$DNS"
  echo "  locale=$LOCALE"
  echo "  timezone=$TIMEZONE"
  echo "  username=$USERNAME"
  echo "  disk=$DISK"
  echo "  debian_version=$DEBIAN_VERSION"
  echo "  out_dir=$OUT_DIR_ABS"
  echo "  no_cache=$NO_CACHE"
  echo "  offline=$OFFLINE"
  exit 0
fi

# Real run path: build the image (cached) and run the container.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILDER_DIR="${SCRIPT_DIR}/iso-builder"

echo "==> Building builder image (uses cache when possible)"
docker build -t llamenos-iso-builder:latest "$BUILDER_DIR" >/dev/null

CACHE_DIR="${HOME}/.cache/llamenos-iso"
mkdir -p "$CACHE_DIR"

# Read the SSH key contents into a variable to pass via env
SSH_PUBKEY_CONTENTS="$(cat "$SSH_KEY_ABS")"

# Network flags: pass --network=none if --offline; otherwise default network
NET_FLAGS=()
if [ "$OFFLINE" = "1" ]; then
  NET_FLAGS+=(--network=none)
fi

echo "==> Running builder container"
docker run --rm \
  "${NET_FLAGS[@]}" \
  -v "${CACHE_DIR}:/cache" \
  -v "${OUT_DIR_ABS}:/out" \
  -e HOSTNAME="$HOSTNAME" \
  -e USERNAME="$USERNAME" \
  -e LOCALE="$LOCALE" \
  -e TIMEZONE="$TIMEZONE" \
  -e DISK="$DISK" \
  -e UNLOCK_MODE="$UNLOCK" \
  -e STATIC_IP="$STATIC_IP" \
  -e GATEWAY="$GATEWAY" \
  -e DNS="$DNS" \
  -e SSH_PUBKEY="$SSH_PUBKEY_CONTENTS" \
  -e DEBIAN_VERSION="$DEBIAN_VERSION" \
  -e NO_CACHE="$NO_CACHE" \
  -e OFFLINE="$OFFLINE" \
  llamenos-iso-builder:latest

echo
echo "==> Done. Output:"
ls -lh "${OUT_DIR_ABS}/llamenos-debian13-${UNLOCK}.iso"{,.sha256}
