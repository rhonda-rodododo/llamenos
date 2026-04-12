#!/usr/bin/env bats
# Tests for preseed template rendering. Renders the template with fixture
# environment variables and diffs against a golden file.
#
# To regenerate goldens after a deliberate template change:
#   UPDATE_GOLDEN=1 bats tests/iso-builder/preseed-template.bats

setup() {
  TEMPLATE="${BATS_TEST_DIRNAME}/../../scripts/iso-builder/preseed.cfg.template"
  GOLDEN_DIR="${BATS_TEST_DIRNAME}/golden"
  TMPOUT="$(mktemp)"
}

teardown() {
  rm -f "$TMPOUT"
}

render() {
  # Use envsubst with an explicit variable allowlist to avoid expanding
  # things like $primary that should stay literal.
  envsubst '${HOSTNAME} ${USERNAME} ${LOCALE} ${TIMEZONE} ${DISK} ${UNLOCK_MODE} ${SSH_PUBKEY_B64} ${STATIC_IP} ${GATEWAY} ${DNS}' \
    < "$TEMPLATE"
}

assert_golden() {
  local golden_path="$1"
  if [ "${UPDATE_GOLDEN:-0}" = "1" ]; then
    cp "$TMPOUT" "$golden_path"
    echo "updated golden: $golden_path" >&2
    return 0
  fi
  diff -u "$golden_path" "$TMPOUT"
}

@test "renders dropbear/dhcp configuration" {
  export HOSTNAME="llamenos-01"
  export USERNAME="deploy"
  export LOCALE="en_US.UTF-8"
  export TIMEZONE="UTC"
  export DISK="/dev/sda"
  export UNLOCK_MODE="dropbear"
  export SSH_PUBKEY_B64="c3NoLWVkMjU1MTkgQUFBQUMzTnphQzFsWkRJMU5URTVBQUFBSURlc3QK"
  export STATIC_IP="dhcp"
  export GATEWAY=""
  export DNS="9.9.9.9,149.112.112.112"
  render > "$TMPOUT"
  assert_golden "${GOLDEN_DIR}/preseed-dropbear-dhcp.cfg"
}

@test "renders console/static-ip configuration" {
  export HOSTNAME="llamenos-iceland-01"
  export USERNAME="deploy"
  export LOCALE="is_IS.UTF-8"
  export TIMEZONE="Atlantic/Reykjavik"
  export DISK="/dev/vda"
  export UNLOCK_MODE="console"
  export SSH_PUBKEY_B64="c3NoLWVkMjU1MTkgQUFBQUMzTnphQzFsWkRJMU5URTVBQUFBSURlc3QK"
  export STATIC_IP="93.95.226.10/24"
  export GATEWAY="93.95.226.1"
  export DNS="9.9.9.9"
  render > "$TMPOUT"
  assert_golden "${GOLDEN_DIR}/preseed-console-static.cfg"
}

@test "rendered preseed contains the hostname" {
  export HOSTNAME="testhost42"
  export USERNAME="deploy" LOCALE="en_US.UTF-8" TIMEZONE="UTC" DISK="/dev/sda"
  export UNLOCK_MODE="dropbear" SSH_PUBKEY_B64="x" STATIC_IP="dhcp" GATEWAY="" DNS=""
  render > "$TMPOUT"
  grep -q 'd-i netcfg/get_hostname string testhost42' "$TMPOUT"
}

@test "rendered preseed contains the disk path" {
  export HOSTNAME="h" USERNAME="deploy" LOCALE="en_US.UTF-8" TIMEZONE="UTC"
  export DISK="/dev/vda"
  export UNLOCK_MODE="dropbear" SSH_PUBKEY_B64="x" STATIC_IP="dhcp" GATEWAY="" DNS=""
  render > "$TMPOUT"
  grep -q 'd-i partman-auto/disk string /dev/vda' "$TMPOUT"
  grep -q 'd-i grub-installer/bootdev string /dev/vda' "$TMPOUT"
}

@test "rendered preseed preserves literal partman variables (\$primary, \$lvmok)" {
  export HOSTNAME="h" USERNAME="deploy" LOCALE="en_US.UTF-8" TIMEZONE="UTC"
  export DISK="/dev/sda"
  export UNLOCK_MODE="dropbear" SSH_PUBKEY_B64="x" STATIC_IP="dhcp" GATEWAY="" DNS=""
  render > "$TMPOUT"
  grep -q '\$primary' "$TMPOUT"
  grep -q '\$lvmok' "$TMPOUT"
  grep -q '\$bootable' "$TMPOUT"
}

@test "rendered preseed locks root login" {
  export HOSTNAME="h" USERNAME="deploy" LOCALE="en_US.UTF-8" TIMEZONE="UTC"
  export DISK="/dev/sda"
  export UNLOCK_MODE="dropbear" SSH_PUBKEY_B64="x" STATIC_IP="dhcp" GATEWAY="" DNS=""
  render > "$TMPOUT"
  grep -q 'd-i passwd/root-login boolean false' "$TMPOUT"
  grep -q 'd-i passwd/user-password-crypted password !' "$TMPOUT"
}

@test "rendered preseed has NO preseeded LUKS passphrase" {
  export HOSTNAME="h" USERNAME="deploy" LOCALE="en_US.UTF-8" TIMEZONE="UTC"
  export DISK="/dev/sda"
  export UNLOCK_MODE="dropbear" SSH_PUBKEY_B64="x" STATIC_IP="dhcp" GATEWAY="" DNS=""
  render > "$TMPOUT"
  ! grep -qE 'partman-crypto/passphrase\s+password' "$TMPOUT"
}
