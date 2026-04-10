#!/usr/bin/env bash
# build-inside.sh — runs inside the pinned Debian 13 builder container.
# Invoked by scripts/build-iso.sh on the host.
#
# Reads operator config from environment variables (set by the host wrapper):
#   HOSTNAME USERNAME LOCALE TIMEZONE DISK
#   UNLOCK_MODE STATIC_IP GATEWAY DNS
#   SSH_PUBKEY (full key contents)
#   DEBIAN_VERSION
#   NO_CACHE OFFLINE
#
# Bind mounts (set up by host wrapper):
#   /out      — output directory (writable)
#   /cache    — upstream ISO cache (read-write)
#
# Outputs (placed in /out):
#   llamenos-debian13-${UNLOCK_MODE}.iso
#   llamenos-debian13-${UNLOCK_MODE}.iso.sha256
set -euo pipefail

require_env() {
  local var="$1"
  if [ -z "${!var:-}" ]; then
    echo "build-inside.sh: required env var $var is unset" >&2
    exit 2
  fi
}

require_env HOSTNAME
require_env USERNAME
require_env LOCALE
require_env TIMEZONE
require_env DISK
require_env UNLOCK_MODE
require_env STATIC_IP
require_env DNS
require_env SSH_PUBKEY
require_env DEBIAN_VERSION

GATEWAY="${GATEWAY:-}"
NO_CACHE="${NO_CACHE:-0}"
OFFLINE="${OFFLINE:-0}"

CACHE_DIR="${CACHE_DIR:-/cache}"
OUT_DIR="${OUT_DIR:-/out}"
WORK_DIR="${WORK_DIR:-/work}"

mkdir -p "$CACHE_DIR" "$OUT_DIR" "$WORK_DIR"
cd "$WORK_DIR"

ISO_NAME="debian-${DEBIAN_VERSION}-amd64-netinst.iso"
ISO_URL="https://cdimage.debian.org/debian-cd/${DEBIAN_VERSION}/amd64/iso-cd/${ISO_NAME}"
SUMS_URL="https://cdimage.debian.org/debian-cd/${DEBIAN_VERSION}/amd64/iso-cd/SHA512SUMS"
SIGN_URL="https://cdimage.debian.org/debian-cd/${DEBIAN_VERSION}/amd64/iso-cd/SHA512SUMS.sign"

CACHED_ISO="${CACHE_DIR}/${ISO_NAME}"

# --- 1. Fetch upstream ISO + verify ---
fetch_with_offline_check() {
  local url="$1"
  local dest="$2"
  if [ "$OFFLINE" = "1" ]; then
    if [ ! -f "$dest" ]; then
      echo "build-inside.sh: --offline set but $dest is missing" >&2
      exit 2
    fi
    return 0
  fi
  wget -nv -O "$dest" "$url"
}

if [ "$NO_CACHE" = "1" ] || [ ! -f "$CACHED_ISO" ]; then
  echo "==> Downloading upstream ISO"
  fetch_with_offline_check "$ISO_URL" "$CACHED_ISO"
fi

echo "==> Downloading SHA512SUMS + signature"
fetch_with_offline_check "$SUMS_URL" "${WORK_DIR}/SHA512SUMS"
fetch_with_offline_check "$SIGN_URL" "${WORK_DIR}/SHA512SUMS.sign"

echo "==> Verifying GPG signature against debian-keyring"
gpg --no-default-keyring \
    --keyring /usr/share/keyrings/debian-role-keys.gpg \
    --verify "${WORK_DIR}/SHA512SUMS.sign" "${WORK_DIR}/SHA512SUMS"

echo "==> Verifying SHA512 of cached ISO"
(
  cd "$CACHE_DIR"
  grep "  ${ISO_NAME}\$" "${WORK_DIR}/SHA512SUMS" | sha512sum -c -
)

# --- 2. Extract ISO ---
echo "==> Extracting upstream ISO"
rm -rf "${WORK_DIR}/iso-root"
mkdir -p "${WORK_DIR}/iso-root"
xorriso -osirrox on -indev "$CACHED_ISO" -extract / "${WORK_DIR}/iso-root" >/dev/null
chmod -R u+w "${WORK_DIR}/iso-root"

# --- 3. Stage helper scripts on ISO root ---
echo "==> Staging helper scripts on ISO root"
mkdir -p "${WORK_DIR}/iso-root/llamenos"
cp /usr/local/share/llamenos-iso/late-command.sh \
   /usr/local/share/llamenos-iso/dropbear-setup.sh \
   "${WORK_DIR}/iso-root/llamenos/"
chmod +x "${WORK_DIR}/iso-root/llamenos/late-command.sh" \
         "${WORK_DIR}/iso-root/llamenos/dropbear-setup.sh"

# --- 4. Render preseed ---
echo "==> Rendering preseed"
SSH_PUBKEY_B64="$(printf '%s' "$SSH_PUBKEY" | base64 -w 0)"
export HOSTNAME USERNAME LOCALE TIMEZONE DISK UNLOCK_MODE
export SSH_PUBKEY_B64 STATIC_IP GATEWAY DNS

envsubst '${HOSTNAME} ${USERNAME} ${LOCALE} ${TIMEZONE} ${DISK} ${UNLOCK_MODE} ${SSH_PUBKEY_B64} ${STATIC_IP} ${GATEWAY} ${DNS}' \
  < /usr/local/share/llamenos-iso/preseed.cfg.template \
  > "${WORK_DIR}/preseed.cfg"

# --- 5. Inject preseed into initrd ---
echo "==> Injecting preseed into initrd"
INITRD_PATH=""
for candidate in install.amd/initrd.gz install.amd/gtk/initrd.gz install/initrd.gz; do
  if [ -f "${WORK_DIR}/iso-root/${candidate}" ]; then
    INITRD_PATH="${WORK_DIR}/iso-root/${candidate}"
    break
  fi
done
if [ -z "$INITRD_PATH" ]; then
  echo "build-inside.sh: could not find initrd in extracted ISO" >&2
  exit 2
fi
echo "    using initrd: $INITRD_PATH"

INITRD_WORK="${WORK_DIR}/initrd-extract"
rm -rf "$INITRD_WORK"
mkdir -p "$INITRD_WORK"
(
  cd "$INITRD_WORK"
  gunzip < "$INITRD_PATH" | cpio -id --quiet
  cp "${WORK_DIR}/preseed.cfg" ./preseed.cfg
  find . | cpio -H newc -o --quiet --reproducible \
    | gzip -9 -n > "$INITRD_PATH"
)

# --- 6. Patch boot menus to auto-load preseed ---
echo "==> Patching boot menus"
# isolinux (BIOS)
if [ -f "${WORK_DIR}/iso-root/isolinux/txt.cfg" ]; then
  cat > "${WORK_DIR}/iso-root/isolinux/txt.cfg" <<'EOF'
default install
label install
  menu label ^Install Llamenos Hotline (Debian 13 + LUKS)
  kernel /install.amd/vmlinuz
  append vga=788 initrd=/install.amd/initrd.gz auto=true priority=critical preseed/file=/preseed.cfg --- quiet
EOF
fi

# GRUB (UEFI)
if [ -f "${WORK_DIR}/iso-root/boot/grub/grub.cfg" ]; then
  python3 - "${WORK_DIR}/iso-root/boot/grub/grub.cfg" <<'PY'
import sys, re
path = sys.argv[1]
with open(path) as f:
    txt = f.read()
# Inject preseed/file into the linux line of the first menuentry
txt = re.sub(
    r'(menuentry .* \{[^}]*linux\s+/install\.amd/vmlinuz)([^\n]*)',
    r'\1 auto=true priority=critical preseed/file=/preseed.cfg\2',
    txt,
    count=1,
)
with open(path, 'w') as f:
    f.write(txt)
PY
fi

# --- 7. Update md5sum.txt for d-i integrity check ---
echo "==> Refreshing md5sum.txt"
(
  cd "${WORK_DIR}/iso-root"
  rm -f md5sum.txt
  find . -follow -type f ! -name md5sum.txt -print0 \
    | xargs -0 md5sum > md5sum.txt
)

# --- 8. Extract isohybrid MBR template + repack ---
echo "==> Extracting isohybrid MBR template"
dd if="$CACHED_ISO" bs=1 count=432 of="${WORK_DIR}/isohdpfx.bin" status=none

OUT_ISO="${OUT_DIR}/llamenos-debian13-${UNLOCK_MODE}.iso"
echo "==> Repacking ISO -> ${OUT_ISO}"
xorriso -as mkisofs \
  -r -V 'Llamenos Debian 13' \
  -o "$OUT_ISO" \
  -J -joliet-long -cache-inodes \
  -isohybrid-mbr "${WORK_DIR}/isohdpfx.bin" \
  -b isolinux/isolinux.bin \
  -c isolinux/boot.cat \
  -boot-load-size 4 -boot-info-table -no-emul-boot \
  -eltorito-alt-boot \
  -e boot/grub/efi.img \
  -no-emul-boot -isohybrid-gpt-basdat -isohybrid-apm-hfsplus \
  "${WORK_DIR}/iso-root"

# --- 9. SHA-256 sidecar ---
echo "==> Emitting SHA-256"
(
  cd "$OUT_DIR"
  sha256sum "$(basename "$OUT_ISO")" > "$(basename "$OUT_ISO").sha256"
)

echo
echo "==> Build complete:"
ls -lh "$OUT_ISO" "${OUT_ISO}.sha256"
