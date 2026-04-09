# FDE ISO Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible, GPG-verified Debian 13 netinst ISO with LUKS2+LVM full disk encryption and dropbear-initramfs SSH-based remote unlock, suitable for upload to any VPS provider that accepts ISOs.

**Architecture:** A host shell wrapper (`scripts/build-iso.sh`) validates flags and invokes a pinned Debian 13 builder container. Inside the container, `build-inside.sh` GPG-verifies the upstream Debian netinst ISO, renders a preseed from a template, stages helper scripts on the ISO root, injects the preseed into the initrd, repacks with `xorriso` preserving hybrid BIOS+UEFI bootability, and emits a SHA-256 sidecar.

**Tech Stack:** Bash (POSIX-portable shell where it runs in initramfs), Docker, Debian 13 base image, `xorriso`, `cpio`, `dropbear-initramfs` (in target system), `gpg`, `debian-keyring`, `bats-core` for tests, `qemu-system-x86_64` for manual verification.

**Spec:** [`docs/superpowers/specs/2026-04-09-fde-iso-builder-design.md`](../specs/2026-04-09-fde-iso-builder-design.md)

**Branch:** This work belongs on the existing `feat/fde-iso-builder` branch in the `llamenos-hotline-fde-iso` worktree at `/media/rikki/recover2/projects/llamenos-hotline-fde-iso`. The specs already live there.

**Depends on:** The companion ansible distro abstraction PR (`feat/ansible-distro-abstraction`) landing first (or being merged before this PR completes manual VPS verification). The installed Debian 13 system from this ISO needs the multi-distro Ansible playbook to be deployable.

---

## File Structure

### Created files

| Path | Responsibility |
|------|----------------|
| `scripts/build-iso.sh` | Host entrypoint: validates flags, invokes Docker, copies output |
| `scripts/verify-iso.sh` | Reproducibility check: rebuilds in fresh container, asserts SHA equality |
| `scripts/iso-builder/Dockerfile` | Pinned Debian 13 builder image |
| `scripts/iso-builder/build-inside.sh` | Container entrypoint: orchestrates the actual build |
| `scripts/iso-builder/preseed.cfg.template` | Debian preseed with `${VAR}` placeholders |
| `scripts/iso-builder/late-command.sh` | Runs in installer chroot before reboot |
| `scripts/iso-builder/dropbear-setup.sh` | Configures dropbear-initramfs in chroot |
| `scripts/iso-builder/README.md` | Internal docs for the builder pieces |
| `tests/iso-builder/build-iso-args.bats` | Argument-validation tests |
| `tests/iso-builder/preseed-template.bats` | Template-rendering tests |
| `tests/iso-builder/golden/preseed-dropbear-dhcp.cfg` | Golden file for template test |
| `tests/iso-builder/golden/preseed-console-static.cfg` | Golden file for template test |
| `tests/iso-builder/README.md` | How to run iso-builder tests |
| `docs/deployment/iso-install.md` | Operator guide |
| `.github/workflows/iso-builder.yml` | CI: bats on every PR, full build on labelled PRs |

### Modified files

| Path | Change |
|------|--------|
| `package.json` | Add `"build:iso"` script entry |
| `CLAUDE.md` | Add `bun run build:iso` to development commands |
| `docs/NEXT_BACKLOG.md` | Add follow-up entry for `--unlock=tang` mode |

---

## Task 0: Verify worktree state and install bats locally

This work continues on the existing `feat/fde-iso-builder` worktree.

- [ ] **Step 1: Verify you are on the right branch and working tree**

```bash
cd /media/rikki/recover2/projects/llamenos-hotline-fde-iso
git status
git branch --show-current
```

Expected: branch `feat/fde-iso-builder`, working tree clean (the two specs are committed).

- [ ] **Step 2: Verify Docker is available**

```bash
docker info >/dev/null && echo "docker OK" || echo "FAIL: docker not running"
```

- [ ] **Step 3: Install bats-core for local testing**

```bash
which bats 2>/dev/null || (
  cd /tmp
  git clone --depth=1 https://github.com/bats-core/bats-core.git
  cd bats-core
  sudo ./install.sh /usr/local
)
bats --version
```

Expected: bats version printed (e.g., `Bats 1.11.0`).

---

## Task 1: Skeleton — directories, README placeholders, package.json script

**Files:**
- Create: `scripts/iso-builder/README.md`
- Create: `tests/iso-builder/README.md`
- Modify: `package.json`

- [ ] **Step 1: Create the directories**

```bash
cd /media/rikki/recover2/projects/llamenos-hotline-fde-iso
mkdir -p scripts/iso-builder tests/iso-builder/golden docs/deployment
```

- [ ] **Step 2: Add the `build:iso` script to package.json**

Read `package.json`. Find the `"scripts": { ... }` block. Add an entry:

```json
"build:iso": "scripts/build-iso.sh"
```

Use the Edit tool to insert it alphabetically among the other script entries. Preserve trailing commas correctly.

- [ ] **Step 3: Verify the script entry parses**

```bash
node -e 'console.log(require("./package.json").scripts["build:iso"])'
```

Expected: `scripts/build-iso.sh`.

- [ ] **Step 4: Write internal README for the builder dir**

Create `scripts/iso-builder/README.md`:

```markdown
# ISO Builder Internals

These files are invoked by `scripts/build-iso.sh` (the operator entrypoint)
inside a pinned Debian 13 Docker container. Operators should NOT run these
files directly.

| File | Purpose |
|------|---------|
| `Dockerfile` | Pinned Debian 13 builder image with xorriso, gpg, debian-keyring, etc. |
| `build-inside.sh` | Container entrypoint: GPG-verify upstream ISO, render preseed, stage helpers, repack |
| `preseed.cfg.template` | Debian preseed template with `${VAR}` placeholders |
| `late-command.sh` | Runs in installer chroot before reboot — stages SSH key, hardens sshd, calls dropbear-setup |
| `dropbear-setup.sh` | Runs in installer chroot — configures dropbear-initramfs for remote LUKS unlock |

See `docs/deployment/iso-install.md` for the operator guide and
`docs/superpowers/specs/2026-04-09-fde-iso-builder-design.md` for the design rationale.
```

- [ ] **Step 5: Write internal README for the tests dir**

Create `tests/iso-builder/README.md`:

```markdown
# ISO Builder Tests

Bats tests for the ISO builder. Run with:

    bats tests/iso-builder/

These tests cover argument parsing and template rendering. They do NOT
build a real ISO (that's a separate CI job — see `.github/workflows/iso-builder.yml`).

| File | Purpose |
|------|---------|
| `build-iso-args.bats` | Validates flag parsing and error paths in `scripts/build-iso.sh` |
| `preseed-template.bats` | Renders the preseed template with fixture inputs and diffs against golden files |
| `golden/*.cfg` | Expected preseed outputs for various flag combinations |

To regenerate a golden file after a deliberate template change:

    UPDATE_GOLDEN=1 bats tests/iso-builder/preseed-template.bats
```

- [ ] **Step 6: Commit**

```bash
git add scripts/iso-builder/README.md tests/iso-builder/README.md package.json
git commit -m "iso-builder: scaffold directories and bun run script entry"
```

---

## Task 2: Argument parsing — TDD with bats

**Files:**
- Create: `tests/iso-builder/build-iso-args.bats`
- Create: `scripts/build-iso.sh` (incrementally, test-driven)

- [ ] **Step 1: Write the failing arg-validation tests**

Create `tests/iso-builder/build-iso-args.bats`:

```bash
#!/usr/bin/env bats
# Tests for scripts/build-iso.sh argument validation.
# These tests intercept the docker invocation by setting BUILD_ISO_DRY_RUN=1,
# which makes the script print the resolved flags to stdout and exit 0
# before any docker call.

setup() {
  SCRIPT="${BATS_TEST_DIRNAME}/../../scripts/build-iso.sh"
  TMPKEY="$(mktemp -d)/test_ed25519.pub"
  ssh-keygen -t ed25519 -N '' -f "${TMPKEY%.*}" -C "test" >/dev/null 2>&1
  export BUILD_ISO_DRY_RUN=1
}

teardown() {
  rm -rf "$(dirname "$TMPKEY")"
}

@test "missing --hostname fails" {
  run "$SCRIPT" --ssh-key "$TMPKEY"
  [ "$status" -ne 0 ]
  [[ "$output" == *"--hostname is required"* ]]
}

@test "missing --ssh-key fails" {
  run "$SCRIPT" --hostname host01
  [ "$status" -ne 0 ]
  [[ "$output" == *"--ssh-key is required"* ]]
}

@test "invalid hostname format is rejected" {
  run "$SCRIPT" --hostname "Invalid_Host" --ssh-key "$TMPKEY"
  [ "$status" -ne 0 ]
  [[ "$output" == *"invalid hostname"* ]]
}

@test "valid hostname is accepted" {
  run "$SCRIPT" --hostname "host-01" --ssh-key "$TMPKEY"
  [ "$status" -eq 0 ]
  [[ "$output" == *"hostname=host-01"* ]]
}

@test "missing ssh-key file is rejected" {
  run "$SCRIPT" --hostname host01 --ssh-key /nonexistent/key.pub
  [ "$status" -ne 0 ]
  [[ "$output" == *"ssh key not found"* ]]
}

@test "RSA ssh key is rejected (ed25519/ECDSA only)" {
  rsakey="$(mktemp -d)/rsa.pub"
  ssh-keygen -t rsa -b 4096 -N '' -f "${rsakey%.*}" -C "test" >/dev/null 2>&1
  run "$SCRIPT" --hostname host01 --ssh-key "$rsakey"
  [ "$status" -ne 0 ]
  [[ "$output" == *"unsupported ssh key type"* ]]
  rm -rf "$(dirname "$rsakey")"
}

@test "ed25519 ssh key is accepted" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY"
  [ "$status" -eq 0 ]
}

@test "default unlock mode is dropbear" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY"
  [ "$status" -eq 0 ]
  [[ "$output" == *"unlock=dropbear"* ]]
}

@test "--unlock console is accepted" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" --unlock console
  [ "$status" -eq 0 ]
  [[ "$output" == *"unlock=console"* ]]
}

@test "--unlock invalid is rejected" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" --unlock magic
  [ "$status" -ne 0 ]
  [[ "$output" == *"--unlock must be"* ]]
}

@test "--static-ip without --gateway is rejected" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" --static-ip 192.0.2.10/24
  [ "$status" -ne 0 ]
  [[ "$output" == *"--gateway is required"* ]]
}

@test "--static-ip with --gateway is accepted" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" \
    --static-ip 192.0.2.10/24 --gateway 192.0.2.1
  [ "$status" -eq 0 ]
  [[ "$output" == *"static_ip=192.0.2.10/24"* ]]
  [[ "$output" == *"gateway=192.0.2.1"* ]]
}

@test "default disk is /dev/sda" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY"
  [ "$status" -eq 0 ]
  [[ "$output" == *"disk=/dev/sda"* ]]
}

@test "--disk /dev/vda is accepted" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" --disk /dev/vda
  [ "$status" -eq 0 ]
  [[ "$output" == *"disk=/dev/vda"* ]]
}

@test "--disk with arbitrary path is rejected" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" --disk /etc/passwd
  [ "$status" -ne 0 ]
  [[ "$output" == *"invalid --disk"* ]]
}

@test "--debian-version 13.4.0 is accepted" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" --debian-version 13.4.0
  [ "$status" -eq 0 ]
  [[ "$output" == *"debian_version=13.4.0"* ]]
}

@test "--debian-version 12.x is rejected (not Debian 13)" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" --debian-version 12.5.0
  [ "$status" -ne 0 ]
  [[ "$output" == *"only Debian 13"* ]]
}

@test "--help prints usage and exits 0" {
  run "$SCRIPT" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage: scripts/build-iso.sh"* ]]
  [[ "$output" == *"--hostname"* ]]
  [[ "$output" == *"--ssh-key"* ]]
  [[ "$output" == *"--unlock"* ]]
}
```

- [ ] **Step 2: Run the tests to confirm they fail (script doesn't exist)**

```bash
bats tests/iso-builder/build-iso-args.bats
```

Expected: every test fails with "command not found" or "no such file" because `scripts/build-iso.sh` doesn't exist yet.

- [ ] **Step 3: Write `scripts/build-iso.sh` with arg parsing only**

Create `scripts/build-iso.sh`:

```bash
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

# Real run path: invoke the docker builder. Filled in by Task 4.
echo "build-iso: docker invocation not yet implemented (see Task 4)" >&2
exit 1
```

```bash
chmod +x scripts/build-iso.sh
```

- [ ] **Step 4: Run the bats tests again to verify all pass**

```bash
bats tests/iso-builder/build-iso-args.bats
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-iso.sh tests/iso-builder/build-iso-args.bats
git commit -m "iso-builder: argument parsing + bats validation tests"
```

---

## Task 3: Builder Dockerfile

**Files:**
- Create: `scripts/iso-builder/Dockerfile`

- [ ] **Step 1: Find the current Debian 13.4-slim image digest**

```bash
docker pull debian:13.4-slim
docker inspect debian:13.4-slim --format '{{index .RepoDigests 0}}'
```

Capture the `sha256:...` digest. Use this exact digest in the FROM line below to make the build reproducible regardless of when it's built.

- [ ] **Step 2: Write the Dockerfile**

Create `scripts/iso-builder/Dockerfile` (substitute the digest from Step 1):

```dockerfile
# scripts/iso-builder/Dockerfile
# Pinned Debian 13 builder image used by scripts/build-iso.sh.
# All tool versions are pinned to support reproducible ISO output.

# Pinned base image. Update via:
#   docker pull debian:13.4-slim
#   docker inspect debian:13.4-slim --format '{{index .RepoDigests 0}}'
FROM debian:13.4-slim@sha256:REPLACE_WITH_DIGEST_FROM_STEP_1

# Reproducible-build env
ENV SOURCE_DATE_EPOCH=1735689600
ENV DEBIAN_FRONTEND=noninteractive
ENV LC_ALL=C
ENV TZ=UTC

# Install build tools.
# debian-keyring provides /usr/share/keyrings/debian-role-keys.gpg used by
# build-inside.sh to verify the upstream netinst ISO signature.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      debian-keyring \
      gnupg \
      wget \
      xorriso \
      isolinux \
      syslinux-utils \
      cpio \
      gzip \
      xz-utils \
      busybox-static \
    && rm -rf /var/lib/apt/lists/*

# Workspace
WORKDIR /work

# Copy in builder scripts. The host wrapper bind-mounts /out and /cache.
COPY build-inside.sh /usr/local/bin/build-inside.sh
COPY preseed.cfg.template /usr/local/share/llamenos-iso/preseed.cfg.template
COPY late-command.sh /usr/local/share/llamenos-iso/late-command.sh
COPY dropbear-setup.sh /usr/local/share/llamenos-iso/dropbear-setup.sh

RUN chmod +x /usr/local/bin/build-inside.sh

ENTRYPOINT ["/usr/local/bin/build-inside.sh"]
```

- [ ] **Step 3: Test that the Dockerfile builds (it will fail because COPY sources don't exist yet)**

```bash
docker build -t llamenos-iso-builder:dev scripts/iso-builder/ 2>&1 | tail -10
```

Expected: fails on `COPY build-inside.sh ...` because that file doesn't exist yet. That's fine — it confirms the FROM and RUN steps work. We'll re-run after Tasks 4–7 add the missing files.

- [ ] **Step 4: Commit**

```bash
git add scripts/iso-builder/Dockerfile
git commit -m "iso-builder: pinned Debian 13 builder Dockerfile"
```

---

## Task 4: Preseed template + rendering test

**Files:**
- Create: `scripts/iso-builder/preseed.cfg.template`
- Create: `tests/iso-builder/preseed-template.bats`
- Create: `tests/iso-builder/golden/preseed-dropbear-dhcp.cfg`
- Create: `tests/iso-builder/golden/preseed-console-static.cfg`

- [ ] **Step 1: Write the preseed template**

Create `scripts/iso-builder/preseed.cfg.template`:

```preseed
#--- Llamenos FDE ISO preseed template ---
# Rendered from scripts/iso-builder/preseed.cfg.template by build-inside.sh
# via envsubst. All ${...} placeholders must be set in the environment.

#--- Localization ---
d-i debian-installer/locale string ${LOCALE}
d-i keyboard-configuration/xkb-keymap select us

#--- Network ---
d-i netcfg/choose_interface select auto
d-i netcfg/get_hostname string ${HOSTNAME}
d-i netcfg/get_domain string local
d-i netcfg/wireless_wep string

#--- Mirror (HTTPS-only, pinned to deb.debian.org) ---
d-i mirror/protocol string https
d-i mirror/country string manual
d-i mirror/https/hostname string deb.debian.org
d-i mirror/https/directory string /debian
d-i mirror/https/proxy string

#--- Account setup ---
# Root login disabled — only the deploy user can log in, key-only.
d-i passwd/root-login boolean false
d-i passwd/make-user boolean true
d-i passwd/user-fullname string ${USERNAME}
d-i passwd/username string ${USERNAME}
# Locked password — SSH key is the only access path
d-i passwd/user-password-crypted password !
d-i passwd/user-default-groups string sudo

#--- Clock and timezone ---
d-i clock-setup/utc boolean true
d-i time/zone string ${TIMEZONE}
d-i clock-setup/ntp boolean true

#--- Partitioning: LUKS2 + LVM full disk encryption ---
# IMPORTANT: passphrase is set INTERACTIVELY at install time via the provider
# console. We do NOT preseed it — embedding the passphrase in the ISO would
# defeat the entire purpose of FDE.
d-i partman-auto/method string crypto
d-i partman-auto/disk string ${DISK}
d-i partman-auto-lvm/new_vg_name string vg0
d-i partman-auto-lvm/guided_size string max
d-i partman-lvm/device_remove_lvm boolean true
d-i partman-lvm/confirm boolean true
d-i partman-lvm/confirm_nooverwrite boolean true
d-i partman-md/device_remove_md boolean true
d-i partman-auto/purge_lvm_from_device boolean true

d-i partman-auto/expert_recipe string                         \
  custom ::                                                   \
    1024 1024 1024 ext4                                       \
      \$primary{ } \$bootable{ }                              \
      method{ format } format{ }                              \
      use_filesystem{ } filesystem{ ext4 }                    \
      mountpoint{ /boot } .                                   \
    2048 4096 200% linux-swap                                 \
      \$lvmok{ } lv_name{ swap }                              \
      in_vg { vg0 }                                           \
      method{ swap } format{ } .                              \
    4096 100000 -1 ext4                                       \
      \$lvmok{ } lv_name{ root }                              \
      in_vg { vg0 }                                           \
      method{ format } format{ }                              \
      use_filesystem{ } filesystem{ ext4 }                    \
      mountpoint{ / } .

d-i partman-partitioning/confirm_write_new_label boolean true
d-i partman/choose_partition select finish
d-i partman/confirm boolean true
d-i partman/confirm_nooverwrite boolean true

#--- Package selection ---
tasksel tasksel/first multiselect standard, ssh-server
d-i pkgsel/include string \
  ca-certificates \
  curl \
  gnupg \
  htop \
  python3 \
  python3-apt \
  rsync \
  sudo \
  unattended-upgrades \
  vim-tiny
d-i pkgsel/upgrade select full-upgrade
d-i pkgsel/update-policy select unattended-upgrades

#--- GRUB ---
d-i grub-installer/only_debian boolean true
d-i grub-installer/with_other_os boolean false
d-i grub-installer/bootdev string ${DISK}

#--- Late command ---
# Both helper scripts live on the ISO root under /llamenos/ and are copied
# into the installer chroot before being run.
d-i preseed/late_command string \
  cp /cdrom/llamenos/late-command.sh /cdrom/llamenos/dropbear-setup.sh /target/tmp/ && \
  in-target chmod +x /tmp/late-command.sh /tmp/dropbear-setup.sh && \
  in-target /tmp/late-command.sh "${UNLOCK_MODE}" "${SSH_PUBKEY_B64}" "${STATIC_IP}" "${GATEWAY}" "${DNS}" && \
  in-target rm /tmp/late-command.sh /tmp/dropbear-setup.sh

#--- Reboot when done ---
d-i finish-install/reboot_in_progress note
```

> Note: The `\$primary{ }` etc. escapes are deliberate. `envsubst` would otherwise try to expand `$primary` as an environment variable. The literal `$` chars must reach the preseed file as-is, so we escape them in the template.

- [ ] **Step 2: Write the bats test for template rendering**

Create `tests/iso-builder/preseed-template.bats`:

```bash
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
```

- [ ] **Step 3: Generate the golden files**

Run the bats test once with `UPDATE_GOLDEN=1` to create the golden files. The first run will warn that the goldens don't exist, then create them, then pass.

```bash
mkdir -p tests/iso-builder/golden
UPDATE_GOLDEN=1 bats tests/iso-builder/preseed-template.bats
```

Expected: all tests pass (the first two emit "updated golden:" notes).

- [ ] **Step 4: Run without UPDATE_GOLDEN to confirm the diff matches**

```bash
bats tests/iso-builder/preseed-template.bats
```

Expected: all tests pass.

- [ ] **Step 5: Inspect the goldens**

```bash
cat tests/iso-builder/golden/preseed-dropbear-dhcp.cfg | head -40
```

Sanity check: HOSTNAME, USERNAME, DISK should all be substituted; `$primary` and `$lvmok` should be present literally.

- [ ] **Step 6: Commit**

```bash
git add scripts/iso-builder/preseed.cfg.template tests/iso-builder/preseed-template.bats tests/iso-builder/golden/
git commit -m "iso-builder: preseed template with golden-file rendering tests"
```

---

## Task 5: Late-command and dropbear-setup scripts

**Files:**
- Create: `scripts/iso-builder/late-command.sh`
- Create: `scripts/iso-builder/dropbear-setup.sh`

- [ ] **Step 1: Write `late-command.sh`**

Create `scripts/iso-builder/late-command.sh`:

```bash
#!/bin/sh
# late-command.sh — runs in the installer chroot before reboot.
# Args: $1=UNLOCK_MODE  $2=SSH_PUBKEY_B64  $3=STATIC_IP  $4=GATEWAY  $5=DNS
#
# This script:
#   1. Stages the operator's SSH key for the deploy user
#   2. Drops a hardened sshd_config baseline (full hardening happens in Ansible)
#   3. Runs dropbear-setup.sh if --unlock=dropbear was selected
#   4. Writes a /etc/motd with next-step instructions
set -eu

UNLOCK_MODE="$1"
SSH_PUBKEY="$(echo "$2" | base64 -d)"
STATIC_IP="$3"
GATEWAY="$4"
DNS="$5"

# 1. Stage operator's SSH key for the deploy user
USER_HOME="/home/deploy"
mkdir -p "${USER_HOME}/.ssh"
echo "${SSH_PUBKEY}" > "${USER_HOME}/.ssh/authorized_keys"
chmod 700 "${USER_HOME}/.ssh"
chmod 600 "${USER_HOME}/.ssh/authorized_keys"
chown -R deploy:deploy "${USER_HOME}/.ssh"

# 2. Hardened sshd baseline (full hardening happens in Ansible)
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/00-llamenos-baseline.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
KbdInteractiveAuthentication no
UsePAM yes
PermitEmptyPasswords no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF

# 3. Set up dropbear-initramfs if requested
if [ "${UNLOCK_MODE}" = "dropbear" ]; then
  /tmp/dropbear-setup.sh "${SSH_PUBKEY}" "${STATIC_IP}" "${GATEWAY}" "${DNS}"
fi

# 4. Ensure NTP is on (chrony will replace this in Ansible)
systemctl enable systemd-timesyncd || true

# 5. First-boot welcome banner with next steps
cat > /etc/motd <<EOF

  Llamenos Hotline — fresh install (Debian 13)
  ──────────────────────────────────────────────
  Disk encryption:  LUKS2 + LVM (active)
  Unlock mode:      ${UNLOCK_MODE}
  SSH user:         deploy (sudo, key-only)

  NEXT STEP — from your workstation:

    cd <llamenos-checkout>/deploy/ansible
    just bootstrap   # if not already done
    ansible-playbook setup.yml -i 'this-host,'

EOF

exit 0
```

- [ ] **Step 2: Write `dropbear-setup.sh`**

Create `scripts/iso-builder/dropbear-setup.sh`:

```bash
#!/bin/sh
# dropbear-setup.sh — configure dropbear-initramfs for remote LUKS unlock.
# Runs in the installer chroot. Called by late-command.sh when --unlock=dropbear.
#
# Args: $1=SSH_PUBKEY  $2=STATIC_IP_OR_DHCP  $3=GATEWAY  $4=DNS
#
# Trixie path: /etc/dropbear/initramfs/ (NOT the bookworm /etc/dropbear-initramfs/)
set -eu

# Helper functions must be defined BEFORE first use (POSIX shell does not hoist).
cidr_to_netmask() {
  cidr="$1"
  mask=""
  full=$((cidr / 8))
  part=$((cidr % 8))
  i=1
  while [ "$i" -le 4 ]; do
    if [ "$i" -le "$full" ]; then
      mask="${mask}255"
    elif [ "$i" -eq $((full + 1)) ]; then
      case "$part" in
        0) mask="${mask}0" ;;
        1) mask="${mask}128" ;;
        2) mask="${mask}192" ;;
        3) mask="${mask}224" ;;
        4) mask="${mask}240" ;;
        5) mask="${mask}248" ;;
        6) mask="${mask}252" ;;
        7) mask="${mask}254" ;;
      esac
    else
      mask="${mask}0"
    fi
    if [ "$i" -lt 4 ]; then
      mask="${mask}."
    fi
    i=$((i + 1))
  done
  echo "$mask"
}

SSH_PUBKEY="$1"
STATIC_IP="$2"
GATEWAY="$3"
# DNS variable accepted for forward-compat but not used by initramfs config —
# resolved name lookups happen in the live system, not in initramfs.

# Install dropbear-initramfs
apt-get install -y --no-install-recommends dropbear-initramfs

# Trixie path
mkdir -p /etc/dropbear/initramfs
echo "${SSH_PUBKEY}" > /etc/dropbear/initramfs/authorized_keys
chmod 600 /etc/dropbear/initramfs/authorized_keys

# Constrain dropbear:
#   -I 300 : idle timeout 5 min
#   -j -k  : disable local + remote port forwarding
#   -p 2222: port 2222 (avoid clashing with installed sshd on 22)
#   -s     : disable password auth
#   -c cryptroot-unlock : forced command — only thing this key can do
cat > /etc/dropbear/initramfs/dropbear.conf <<'EOF'
DROPBEAR_OPTIONS="-I 300 -j -k -p 2222 -s -c cryptroot-unlock"
EOF

# Network config for initramfs
if [ "${STATIC_IP}" = "dhcp" ]; then
  echo "IP=dhcp" >> /etc/initramfs-tools/initramfs.conf
else
  IP_ADDR="${STATIC_IP%/*}"
  CIDR="${STATIC_IP#*/}"
  NETMASK="$(cidr_to_netmask "${CIDR}")"
  # klibc 7-field syntax: ip=<client>::<gw>:<netmask>::<iface>:off
  IP_LINE="ip=${IP_ADDR}::${GATEWAY}:${NETMASK}::eth0:off"
  echo "IP=${IP_LINE}" >> /etc/initramfs-tools/initramfs.conf
fi

# Rebuild initramfs to include dropbear, keys, and network config
update-initramfs -u -k all
```

- [ ] **Step 3: Lint both scripts with shellcheck**

```bash
which shellcheck || (apt-get install -y shellcheck 2>/dev/null || sudo apt-get install -y shellcheck)
shellcheck -s sh scripts/iso-builder/late-command.sh
shellcheck -s sh scripts/iso-builder/dropbear-setup.sh
```

Expected: no errors. Style warnings are acceptable but should be reviewed.

- [ ] **Step 4: Quick syntax check**

```bash
sh -n scripts/iso-builder/late-command.sh
sh -n scripts/iso-builder/dropbear-setup.sh
```

Expected: no output (clean syntax).

- [ ] **Step 5: Commit**

```bash
git add scripts/iso-builder/late-command.sh scripts/iso-builder/dropbear-setup.sh
git commit -m "iso-builder: late-command and dropbear-setup scripts"
```

---

## Task 6: `build-inside.sh` — orchestration inside the container

**Files:**
- Create: `scripts/iso-builder/build-inside.sh`

This is the largest single file in the PR. It runs inside the Docker container and does the actual ISO build.

- [ ] **Step 1: Write `build-inside.sh`**

Create `scripts/iso-builder/build-inside.sh`:

```bash
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
```

- [ ] **Step 2: shellcheck the script**

```bash
shellcheck scripts/iso-builder/build-inside.sh
```

Expected: no errors. Some style warnings (e.g., for `${!var}` indirect expansion) are acceptable.

- [ ] **Step 3: Build the Docker image now that all COPY sources exist**

```bash
docker build -t llamenos-iso-builder:dev scripts/iso-builder/
```

Expected: build succeeds. If the FROM digest from Task 3 is wrong, fix it now.

- [ ] **Step 4: Commit**

```bash
git add scripts/iso-builder/build-inside.sh
git commit -m "iso-builder: build-inside.sh orchestration script"
```

---

## Task 7: Wire `scripts/build-iso.sh` to invoke the container

**Files:**
- Modify: `scripts/build-iso.sh`

- [ ] **Step 1: Read the current `scripts/build-iso.sh`**

```bash
cat scripts/build-iso.sh | tail -30
```

Find the section that exits with `"docker invocation not yet implemented"` (added in Task 2 Step 3).

- [ ] **Step 2: Replace the placeholder with the real docker invocation**

Use Edit to replace this block:

```bash
# Real run path: invoke the docker builder. Filled in by Task 4.
echo "build-iso: docker invocation not yet implemented (see Task 4)" >&2
exit 1
```

with:

```bash
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
```

- [ ] **Step 3: Re-run the bats tests to make sure arg parsing still passes**

```bash
bats tests/iso-builder/build-iso-args.bats
```

Expected: all tests still pass (BUILD_ISO_DRY_RUN=1 short-circuits before the docker invocation).

- [ ] **Step 4: Commit**

```bash
git add scripts/build-iso.sh
git commit -m "iso-builder: wire host wrapper to docker builder invocation"
```

---

## Task 8: First end-to-end build (smoke test)

This task is a single integration milestone — actually run the builder end-to-end and confirm the ISO comes out.

- [ ] **Step 1: Generate a test SSH key**

```bash
mkdir -p /tmp/iso-test
ssh-keygen -t ed25519 -N '' -f /tmp/iso-test/test_key -C "iso-build-test" >/dev/null
```

- [ ] **Step 2: Run the builder**

```bash
cd /media/rikki/recover2/projects/llamenos-hotline-fde-iso
./scripts/build-iso.sh \
  --hostname llamenos-test-01 \
  --ssh-key /tmp/iso-test/test_key.pub \
  --unlock dropbear \
  --out /tmp/iso-test/out
```

Expected: completes successfully in 2-5 minutes (depending on network speed for the first download). Output:
```
==> Done. Output:
-rw-r--r-- 1 user user 500M ... llamenos-debian13-dropbear.iso
-rw-r--r-- 1 user user  100 ... llamenos-debian13-dropbear.iso.sha256
```

- [ ] **Step 3: Verify the ISO is non-empty and bootable-looking**

```bash
ls -lh /tmp/iso-test/out/
file /tmp/iso-test/out/llamenos-debian13-dropbear.iso
xorriso -indev /tmp/iso-test/out/llamenos-debian13-dropbear.iso -find / 2>/dev/null | head -20
```

Expected:
- ISO file ~400-500MB
- `file` reports `ISO 9660 CD-ROM filesystem data ... (bootable)`
- `xorriso -find` lists the files including `/llamenos/late-command.sh` and `/llamenos/dropbear-setup.sh` and `/preseed.cfg` (in the initrd, not directly visible — check `/install.amd/initrd.gz` exists)

- [ ] **Step 4: Verify the SHA-256 sidecar matches**

```bash
cd /tmp/iso-test/out
sha256sum -c llamenos-debian13-dropbear.iso.sha256
```

Expected: `llamenos-debian13-dropbear.iso: OK`.

- [ ] **Step 5: Verify the helper scripts landed on the ISO root**

```bash
xorriso -indev /tmp/iso-test/out/llamenos-debian13-dropbear.iso \
  -find /llamenos -type f
```

Expected:
```
/llamenos
/llamenos/late-command.sh
/llamenos/dropbear-setup.sh
```

- [ ] **Step 6: Build the console-mode variant for comparison**

```bash
./scripts/build-iso.sh \
  --hostname llamenos-test-02 \
  --ssh-key /tmp/iso-test/test_key.pub \
  --unlock console \
  --out /tmp/iso-test/out
```

Expected: a second ISO `llamenos-debian13-console.iso`.

- [ ] **Step 7: No commit — this task is a smoke milestone, not a code change**

If the build failed at any step, debug now. Common failure modes:
- Wrong Dockerfile FROM digest → update with the value from `docker inspect`
- Wrong initrd path inside the ISO → check `xorriso -indev ... -find / | grep initrd`
- GPG verification failure → confirm the upstream URL is reachable and the keyring file path is correct
- xorriso repack errors → check the boot menu paths inside the extracted ISO

---

## Task 9: `verify-iso.sh` reproducibility checker

**Files:**
- Create: `scripts/verify-iso.sh`

- [ ] **Step 1: Write the verifier**

Create `scripts/verify-iso.sh`:

```bash
#!/usr/bin/env bash
# verify-iso.sh — rebuild a Llamenos ISO in a fresh container and assert
# the output SHA-256 matches the original. Mirrors scripts/verify-build.sh.
#
# Usage: scripts/verify-iso.sh <iso-path> -- <build-iso flags...>
#
# Example:
#   scripts/verify-iso.sh dist/iso/llamenos-debian13-dropbear.iso \
#     -- --hostname test --ssh-key ~/.ssh/id_ed25519.pub --unlock dropbear

set -euo pipefail

if [ $# -lt 3 ]; then
  echo "Usage: $0 <iso-path> -- <build-iso flags...>" >&2
  exit 2
fi

ORIGINAL_ISO="$1"
shift
if [ "$1" != "--" ]; then
  echo "Usage: $0 <iso-path> -- <build-iso flags...>" >&2
  exit 2
fi
shift

if [ ! -f "$ORIGINAL_ISO" ]; then
  echo "verify-iso: original ISO not found: $ORIGINAL_ISO" >&2
  exit 2
fi

ORIG_SHA="$(sha256sum "$ORIGINAL_ISO" | awk '{print $1}')"
echo "==> Original SHA-256: $ORIG_SHA"

VERIFY_OUT="$(mktemp -d)"
trap 'rm -rf "$VERIFY_OUT"' EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Rebuilding into $VERIFY_OUT"
"${SCRIPT_DIR}/build-iso.sh" "$@" --out "$VERIFY_OUT" --no-cache

REBUILT_ISO="$(find "$VERIFY_OUT" -name '*.iso' | head -1)"
if [ -z "$REBUILT_ISO" ]; then
  echo "verify-iso: rebuild produced no ISO" >&2
  exit 1
fi

REBUILT_SHA="$(sha256sum "$REBUILT_ISO" | awk '{print $1}')"
echo "==> Rebuilt SHA-256:  $REBUILT_SHA"

if [ "$ORIG_SHA" = "$REBUILT_SHA" ]; then
  echo "==> REPRODUCIBLE: SHAs match"
  exit 0
else
  echo "==> NOT REPRODUCIBLE: SHA mismatch" >&2
  exit 1
fi
```

```bash
chmod +x scripts/verify-iso.sh
```

- [ ] **Step 2: Test reproducibility against the ISO from Task 8**

```bash
./scripts/verify-iso.sh /tmp/iso-test/out/llamenos-debian13-dropbear.iso -- \
  --hostname llamenos-test-01 \
  --ssh-key /tmp/iso-test/test_key.pub \
  --unlock dropbear
```

Expected: `==> REPRODUCIBLE: SHAs match`.

If the SHAs don't match, the build is not yet reproducible. Common causes:
- Timestamps in the ISO filesystem (check `xorriso` invocation)
- Non-deterministic gzip header (`gzip -n` should fix this)
- Non-deterministic cpio output (`cpio --reproducible` should fix this)
- A late_command that captures the current date/time

Debug with `diffoscope` if available:

```bash
diffoscope /tmp/iso-test/out/llamenos-debian13-dropbear.iso /tmp/<rebuilt>/llamenos-debian13-dropbear.iso 2>&1 | head -50
```

Fix until the verifier exits 0. **Do not skip this step** — reproducibility is a spec requirement.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-iso.sh
git commit -m "iso-builder: reproducibility verifier script"
```

---

## Task 10: CI workflow

**Files:**
- Create: `.github/workflows/iso-builder.yml`

- [ ] **Step 1: Read existing CI workflows for conventions**

```bash
ls .github/workflows/
head -30 .github/workflows/ci.yml 2>/dev/null
```

Note the action versions used (e.g., `actions/checkout@<sha>`). Use the same pinned SHAs in the new workflow for consistency.

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/iso-builder.yml`:

```yaml
name: ISO Builder

on:
  push:
    branches: [main]
    paths:
      - 'scripts/build-iso.sh'
      - 'scripts/verify-iso.sh'
      - 'scripts/iso-builder/**'
      - 'tests/iso-builder/**'
      - '.github/workflows/iso-builder.yml'
  pull_request:
    paths:
      - 'scripts/build-iso.sh'
      - 'scripts/verify-iso.sh'
      - 'scripts/iso-builder/**'
      - 'tests/iso-builder/**'
      - '.github/workflows/iso-builder.yml'

permissions:
  contents: read

jobs:
  bats:
    name: Bats tests (arg parsing + template rendering)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
      - name: Install bats and gettext
        run: |
          sudo apt-get update
          sudo apt-get install -y bats gettext-base shellcheck
      - name: Shellcheck builder scripts
        run: |
          shellcheck scripts/build-iso.sh scripts/verify-iso.sh
          shellcheck -s sh scripts/iso-builder/late-command.sh scripts/iso-builder/dropbear-setup.sh
          shellcheck scripts/iso-builder/build-inside.sh
      - name: Run bats
        run: bats tests/iso-builder/

  build:
    name: Full ISO build (gated)
    if: github.event_name == 'push' || contains(github.event.pull_request.labels.*.name, 'iso-build')
    runs-on: ubuntu-latest
    needs: bats
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
      - name: Generate test SSH key
        run: |
          mkdir -p ${{ runner.temp }}/key
          ssh-keygen -t ed25519 -N '' -f ${{ runner.temp }}/key/test_ed25519 -C ci-test
      - name: Build ISO
        run: |
          ./scripts/build-iso.sh \
            --hostname ci-test-host \
            --ssh-key ${{ runner.temp }}/key/test_ed25519.pub \
            --unlock dropbear \
            --out ${{ runner.temp }}/out
      - name: Verify output
        run: |
          ls -lh ${{ runner.temp }}/out/
          test -f ${{ runner.temp }}/out/llamenos-debian13-dropbear.iso
          test -f ${{ runner.temp }}/out/llamenos-debian13-dropbear.iso.sha256
          ( cd ${{ runner.temp }}/out && sha256sum -c llamenos-debian13-dropbear.iso.sha256 )
          test "$(stat -c%s ${{ runner.temp }}/out/llamenos-debian13-dropbear.iso)" -gt 100000000
      - name: Reproducibility check
        run: |
          ./scripts/verify-iso.sh ${{ runner.temp }}/out/llamenos-debian13-dropbear.iso -- \
            --hostname ci-test-host \
            --ssh-key ${{ runner.temp }}/key/test_ed25519.pub \
            --unlock dropbear
```

- [ ] **Step 3: Lint the workflow with `actionlint` if available**

```bash
which actionlint && actionlint .github/workflows/iso-builder.yml
```

If actionlint is not installed, skip — GitHub will lint it on push.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/iso-builder.yml
git commit -m "ci: iso-builder workflow (bats always, full build on label/main)"
```

---

## Task 11: Manual qemu boot test

This task does not produce code; it's a verification gate before the VPS test.

- [ ] **Step 1: Install qemu-system-x86_64 if missing**

```bash
which qemu-system-x86_64 || sudo apt-get install -y qemu-system-x86 ovmf
```

- [ ] **Step 2: Boot the dropbear-mode ISO in qemu (BIOS mode)**

```bash
qemu-system-x86_64 \
  -m 2048 -smp 2 \
  -drive file=/tmp/iso-test/disk.qcow2,format=qcow2 \
  -drive file=/tmp/iso-test/out/llamenos-debian13-dropbear.iso,media=cdrom \
  -boot d \
  -netdev user,id=n0,hostfwd=tcp::2222-:2222,hostfwd=tcp::2022-:22 \
  -device virtio-net-pci,netdev=n0
```

(If `disk.qcow2` doesn't exist: `qemu-img create -f qcow2 /tmp/iso-test/disk.qcow2 10G` first.)

Expected: installer boots, runs through preseed, prompts for LUKS passphrase. Type one, let it complete, reboot.

After reboot, expect the dropbear prompt on TTY1 (no normal login). Test the unlock from the host:

```bash
ssh -p 2222 -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no \
    -i /tmp/iso-test/test_key root@localhost
```

Expected: dropbear prompts for the LUKS passphrase. After entering it, the connection closes and the VM finishes booting. Then:

```bash
ssh -p 2022 -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no \
    -i /tmp/iso-test/test_key deploy@localhost
```

Expected: full login as `deploy`, motd shows the next-step instructions.

- [ ] **Step 3: Test UEFI boot with OVMF**

```bash
qemu-system-x86_64 \
  -m 2048 -smp 2 \
  -bios /usr/share/ovmf/OVMF.fd \
  -drive file=/tmp/iso-test/disk-uefi.qcow2,format=qcow2 \
  -drive file=/tmp/iso-test/out/llamenos-debian13-dropbear.iso,media=cdrom \
  -boot d
```

Expected: the GRUB menu (UEFI) appears; "Install Llamenos Hotline" auto-runs.

- [ ] **Step 4: Capture qemu test results in PR notes**

Note successful BIOS boot + UEFI boot + dropbear unlock + post-install login. No commit; this becomes part of the PR description.

---

## Task 12: Operator documentation

**Files:**
- Create: `docs/deployment/iso-install.md`

- [ ] **Step 1: Write the operator guide**

Create `docs/deployment/iso-install.md`:

```markdown
# Self-Hosting Llamenos: Custom ISO with Full Disk Encryption

This guide walks you through building a custom Debian 13 installer ISO with
LUKS2 + LVM full disk encryption, uploading it to a VPS provider, and
handing off to the Ansible playbook for the rest of your Llamenos setup.

This is the recommended path for self-hosters who:
- Want their VPS provider to be unable to read disk contents
- Are comfortable opening a web console once during install
- Have a Linux/macOS workstation with Docker installed

## Why a custom ISO

Llamenos's threat model assumes well-funded adversaries — including the
VPS provider itself. Standard provider images give the provider full read
access to your disk via snapshots, decommissioned hardware, or hypervisor
attack. Building your own ISO with full disk encryption from the install
moment forward closes that gap.

A LUKS2-encrypted disk is unreadable to the provider while powered off,
and the LUKS unlock passphrase never lives on the disk. Combined with
dropbear-initramfs SSH unlock (the default), the passphrase doesn't even
travel through the provider's web console on every boot.

## Prerequisites

- **Docker** on your workstation. The builder runs in a pinned Debian
  container so you don't need any other tools installed.
- **An ed25519 SSH key.** If you don't have one:
  ```bash
  ssh-keygen -t ed25519 -C "$(whoami)@llamenos"
  ```
- **A VPS provider that accepts ISO uploads.** Tested providers:
  - 1984 Hosting (Iceland) — recommended
  - Hetzner Cloud (rescue ISO upload)
  - OVH / Hetzner Robot dedicated servers
  - Any KVM-based VPS provider with a "boot from ISO" option

## Building the ISO

From a Llamenos checkout:

```bash
bun run build:iso \
  --hostname llamenos-01 \
  --ssh-key ~/.ssh/id_ed25519.pub
```

For VPS providers using paravirtualized disks (vda):

```bash
bun run build:iso \
  --hostname llamenos-01 \
  --ssh-key ~/.ssh/id_ed25519.pub \
  --disk /dev/vda
```

For static IP configuration (some providers don't run DHCP in initramfs):

```bash
bun run build:iso \
  --hostname llamenos-01 \
  --ssh-key ~/.ssh/id_ed25519.pub \
  --static-ip 93.95.226.10/24 \
  --gateway 93.95.226.1
```

For console unlock instead of dropbear (if your network is unreliable):

```bash
bun run build:iso \
  --hostname llamenos-01 \
  --ssh-key ~/.ssh/id_ed25519.pub \
  --unlock console
```

The output ISO appears in `dist/iso/`:

```
dist/iso/llamenos-debian13-dropbear.iso       # ~500 MB
dist/iso/llamenos-debian13-dropbear.iso.sha256
```

## Uploading to your VPS provider

### 1984 Hosting

1. Log in to the 1984 control panel
2. Create a new VPS, but do NOT pick a stock OS image — pick "Boot from custom ISO"
3. Upload `llamenos-debian13-dropbear.iso` via the provided ISO URL upload form
4. Wait for upload to complete (a few minutes)
5. Power on the VPS — it boots into the installer

### Generic provider (any KVM-based ISO upload)

1. Find the provider's "Custom ISO" or "ISO Boot" option in the VPS settings
2. Upload `llamenos-debian13-dropbear.iso`
3. Set the boot order to CD-ROM first
4. Boot the VPS

If your provider doesn't accept ISO uploads, this guide doesn't apply — see
the standard self-hosting docs in `deploy/ansible/README.md`.

## First boot — installer (one-time)

The installer is fully unattended **except** for one step: setting the LUKS
passphrase. This is the only thing the operator types during install. The
passphrase is **not** stored anywhere on the ISO — that would defeat full
disk encryption.

1. Open your provider's web console (VNC or serial)
2. Watch the Debian installer start automatically
3. After about a minute, the installer asks for the LUKS encryption passphrase
4. **Type a strong passphrase** (use a passphrase manager — at least 30
   characters, 5+ random words)
5. Confirm the passphrase
6. The install completes (5–10 minutes) and reboots automatically

> **Forgetting the passphrase means rebuilding from scratch.** Llamenos has
> no recovery mechanism for forgotten LUKS passphrases. This is by design.

## Subsequent boots — dropbear unlock (default)

After install, every boot pauses in the initramfs waiting for an SSH
connection. Unlock from your laptop:

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519 root@<vps-ip>
```

You'll be prompted for the LUKS passphrase. Type it; the connection closes
immediately and the VPS continues booting.

> **Why a separate port?** Dropbear runs on 2222 to avoid clashing with
> the post-install sshd on port 22. Their host keys are different — your
> SSH client will warn the first time. That's expected.

After the VPS finishes booting (~30 seconds), you can log in normally:

```bash
ssh deploy@<vps-ip>
```

You'll see the welcome banner with next-step instructions.

## Subsequent boots — console unlock (if you built with `--unlock console`)

1. Open your provider's web console
2. The standard `cryptsetup` prompt appears on TTY1
3. Type the LUKS passphrase
4. Boot continues

## Hand-off to Ansible

From your workstation, with the Llamenos checkout still open:

```bash
cd deploy/ansible
just bootstrap                # one-time
ansible-playbook setup.yml -i '<vps-ip>,'
```

This runs the full hardening + Llamenos deployment playbook against your
new VPS. See `deploy/ansible/README.md` for vars configuration.

## Troubleshooting

**Dropbear doesn't start (no port 2222 response after reboot)**

Most likely the network config is wrong. Either:
- The provider doesn't run DHCP in their network — rebuild with
  `--static-ip <CIDR> --gateway <ip>`
- The interface isn't `eth0` (rare on modern VPSes) — open an issue with
  the provider details so we can add support

**SSH host key warning when connecting on port 2222 vs port 22**

Expected — they're different SSH servers (dropbear in initramfs vs sshd in
the live system). Add both with separate aliases in `~/.ssh/config`:

```ssh-config
Host llamenos-unlock
  HostName <vps-ip>
  Port 2222
  User root
  UserKnownHostsFile ~/.ssh/known_hosts.dropbear

Host llamenos
  HostName <vps-ip>
  Port 22
  User deploy
```

**I forgot the LUKS passphrase**

Rebuild from scratch. There is no recovery.

**Build fails with GPG verification error**

Either your network has tampered with the upstream Debian ISO download,
or the Debian signing key has rotated and the builder needs an update.
Check `docs/superpowers/specs/2026-04-09-fde-iso-builder-design.md` and
file an issue.

**Disk shows up as `/dev/vda` not `/dev/sda` and install fails**

Rebuild with `--disk /dev/vda`.

## What this defends against (and what it doesn't)

**Defends against:**
- VPS provider reading your disk via snapshots or decommissioned hardware
- Disk image theft from the provider
- Keystroke capture on the VPS web console (dropbear mode only)
- Tampered upstream Debian ISO downloads (GPG-verified during build)

**Does NOT defend against:**
- A provider with hypervisor access dumping guest RAM at runtime
- Cold boot attacks against the VPS hardware (out of your control)
- Compromise of your workstation where you build the ISO
- Forgetting your LUKS passphrase

For the full threat model, see
[`docs/superpowers/specs/2026-04-09-fde-iso-builder-design.md`](../superpowers/specs/2026-04-09-fde-iso-builder-design.md).
```

- [ ] **Step 2: Commit**

```bash
git add docs/deployment/iso-install.md
git commit -m "docs: operator guide for FDE ISO install"
```

---

## Task 13: CLAUDE.md and NEXT_BACKLOG updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/NEXT_BACKLOG.md`

- [ ] **Step 1: Add `bun run build:iso` to CLAUDE.md development commands**

Read `CLAUDE.md`. Find the "## Development Commands" section. Add a new line in the appropriate place (alphabetical or grouped with other deploy commands):

```markdown
bun run build:iso                        # Build a Debian 13 FDE installer ISO (see docs/deployment/iso-install.md)
```

- [ ] **Step 2: Add the tang follow-up to NEXT_BACKLOG.md**

Read `docs/NEXT_BACKLOG.md`. Add a new entry under the appropriate section (probably "Deployment & ops" or similar):

```markdown
- **FDE ISO: `--unlock=tang` mode with bundled Tang server deployment role**
  Tang/Clevis network-bound disk encryption: unlocks the LUKS volume
  automatically when the host is on a trusted network. Eliminates the
  manual passphrase step on every boot for operators running multiple
  hotlines. Requires a separately deployed Tang server (its own VPS,
  hardening, backup story) and coordination with the existing
  `key-store-v2` multi-factor KEK story. See
  `docs/superpowers/specs/2026-04-09-fde-iso-builder-design.md` §12.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/NEXT_BACKLOG.md
git commit -m "docs: add FDE ISO commands + tang follow-up to backlog"
```

---

## Task 14: Manual VPS verification (merge gate)

This task is the merge gate. Do not skip.

- [ ] **Step 1: Provision a fresh VPS at 1984 Hosting (or your chosen provider)**

The smallest tier is fine — this is throwaway. Capture the VPS IP and the provider's "open console" URL.

- [ ] **Step 2: Build the production ISO with the real hostname**

```bash
bun run build:iso \
  --hostname llamenos-test-vps \
  --ssh-key ~/.ssh/id_ed25519.pub \
  --unlock dropbear
```

- [ ] **Step 3: Upload the ISO to the provider**

Follow the provider-specific steps from `docs/deployment/iso-install.md`.

- [ ] **Step 4: Boot the VPS from the ISO and complete the install**

Open the provider's web console. Watch the Debian installer run through the preseed automatically. Type a LUKS passphrase when prompted (this is the only manual step). Wait for install to complete and reboot.

**Capture screenshots of:**
- The LUKS passphrase prompt (proves preseed is doing FDE)
- The post-reboot console showing the dropbear "waiting for SSH" message

- [ ] **Step 5: Unlock via dropbear from your workstation**

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519 root@<vps-ip>
```

Expected: prompted for the LUKS passphrase. After typing it, the connection closes and the VPS continues booting.

**Capture the terminal output of this step.**

- [ ] **Step 6: Login normally and verify the motd**

```bash
ssh deploy@<vps-ip>
```

Expected: motd shows the next-step instructions.

- [ ] **Step 7: Run the Ansible playbook against the new VPS (depends on PR 1)**

If PR 1 (ansible distro abstraction) has merged or you're on a co-developed branch:

```bash
cd deploy/ansible
just bootstrap
ansible-playbook setup.yml -i '<vps-ip>,' \
  -u deploy --become --become-method sudo \
  -e @vars.example.yml --diff
```

Expected: completes successfully. Run the smoke assertions from PR 1's Task 15 Step 3 to verify the hardening landed.

- [ ] **Step 8: Reboot and verify the dropbear unlock cycle still works**

```bash
ssh deploy@<vps-ip> sudo systemctl reboot
```

Wait ~10 seconds. Verify the VPS is unreachable on port 22 but responds on port 2222:

```bash
nmap -p 22,2222 <vps-ip>
```

Expected: port 2222 open, port 22 filtered/closed. Then unlock + login again.

- [ ] **Step 9: Tear down the VPS**

Once you've captured all evidence, destroy the VPS to avoid charges.

- [ ] **Step 10: Compile evidence into a PR description block**

Create a temp file or paste directly into your PR description:

```markdown
## Manual verification

**Provider:** 1984 Hosting (or whichever)
**Date:** YYYY-MM-DD

### Build
- `bun run build:iso --hostname llamenos-test-vps ...`
- ISO output: 487 MB, SHA-256 verified
- Reproducibility check: PASS

### Install
- ISO uploaded via provider control panel
- LUKS passphrase prompt appeared as expected
- Install completed in 7m 42s
- Reboot succeeded

### Dropbear unlock
- `ssh -p 2222 root@<vps-ip>` prompted for passphrase
- After unlock, ssh session terminated automatically
- VPS finished booting in ~25 seconds

### Post-install
- `ssh deploy@<vps-ip>` succeeded with motd
- Ansible playbook run: PASS (no errors)
- All smoke assertions: PASS

### Reboot cycle
- `sudo reboot` → VPS unreachable on :22 → reachable on :2222
- Re-unlock + login: PASS
```

---

## Task 15: Final acceptance check

- [ ] **Step 1: Walk the spec acceptance criteria**

Open `docs/superpowers/specs/2026-04-09-fde-iso-builder-design.md`. Check each item in the "Acceptance Criteria" section against the current branch.

- [ ] **Step 2: Run the full test suite**

```bash
bats tests/iso-builder/
```

Expected: all tests pass.

- [ ] **Step 3: Run shellcheck across all builder scripts**

```bash
shellcheck scripts/build-iso.sh scripts/verify-iso.sh scripts/iso-builder/build-inside.sh
shellcheck -s sh scripts/iso-builder/late-command.sh scripts/iso-builder/dropbear-setup.sh
```

Expected: no errors.

- [ ] **Step 4: Verify reproducibility one more time**

```bash
./scripts/build-iso.sh --hostname final-check --ssh-key /tmp/iso-test/test_key.pub --out /tmp/final-check
./scripts/verify-iso.sh /tmp/final-check/llamenos-debian13-dropbear.iso -- \
  --hostname final-check --ssh-key /tmp/iso-test/test_key.pub
```

Expected: `==> REPRODUCIBLE: SHAs match`.

- [ ] **Step 5: Verify CI workflow file passes basic YAML validation**

```bash
python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/iso-builder.yml"))'
```

Expected: no output (no errors).

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin feat/fde-iso-builder
gh pr create --title "feat: FDE ISO builder for Debian 13 + dropbear unlock" \
  --body "$(cat <<'EOF'
## Summary

- Adds `scripts/build-iso.sh` (and `bun run build:iso`) that produces a Debian 13 netinst ISO with LUKS2+LVM full disk encryption
- Default `--unlock=dropbear` (SSH unlock from initramfs); `--unlock=console` as escape hatch
- Reproducible builds (verified via `scripts/verify-iso.sh`)
- GPG-verified upstream Debian ISO via `debian-keyring`
- Bats test suite (arg parsing + golden-file template rendering) runs in CI on every PR
- Full ISO build runs in CI on push to main and on PRs labelled `iso-build`
- Operator guide at `docs/deployment/iso-install.md`
- Tang/Clevis follow-up tracked in NEXT_BACKLOG

## Spec
docs/superpowers/specs/2026-04-09-fde-iso-builder-design.md

## Depends on
PR #<ansible-distro-abstraction PR number> for the ansible takeover step.
The ISO is functional on its own; the post-install Ansible run requires
the multi-distro support landing first.

## Test plan
- [x] CI: bats test suite passes
- [x] CI: shellcheck clean
- [x] CI: full ISO build green
- [x] CI: reproducibility check green
- [x] Manual: qemu BIOS boot
- [x] Manual: qemu UEFI boot
- [x] Manual: real VPS install at 1984 Hosting (see evidence below)
- [x] Manual: dropbear unlock cycle
- [x] Manual: Ansible takeover

## Manual verification evidence
<paste the block from Task 14 Step 10 here>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes for the implementer

- **Two scripts must NOT live in the initrd:** `late-command.sh` and `dropbear-setup.sh` live on the ISO root under `/llamenos/`. Only `preseed.cfg` goes into the initrd. The preseed late_command reads the helpers from `/cdrom/llamenos/`.
- **`envsubst` allowlist matters:** Use the explicit variable list (`'${HOSTNAME} ${USERNAME} ...'`) so that `$primary`, `$lvmok`, `$bootable` in the partman recipe survive untouched.
- **`cidr_to_netmask` ordering:** the function in `dropbear-setup.sh` MUST be defined before its first use. POSIX shell does not hoist function definitions.
- **Initrd vs chroot context:** the late_command runs in `/target` (the freshly installed root), NOT in the installer environment. `/cdrom` is mounted there during late_command but unmounted after reboot. Helper files should NOT survive into the installed system.
- **GPG verify before extract:** the `gpg --verify` happens BEFORE `xorriso -extract`. If the signature is bad, no work happens and no half-built artifacts are written.
- **Reproducibility traps:** `gzip -n`, `cpio --reproducible`, deterministic sort order in `find` (use `find ... | LC_ALL=C sort` if you ever add a `sort` step), and `SOURCE_DATE_EPOCH` set in the Dockerfile. If the verifier fails, the most likely culprit is a non-deterministic step in `build-inside.sh`.
- **Don't bake llamenos into the ISO:** the ISO is a substrate. No Llamenos source, no env vars, no secrets. Everything Llamenos-specific comes from the Ansible playbook running against the new host.
- **Don't preseed the LUKS passphrase, ever.** The 30-second console interaction is the security feature, not a missing automation.
