# FDE ISO Builder — Design Spec

**Date:** 2026-04-09
**Status:** Draft (pending user review)
**Companion spec:** [2026-04-09-ansible-distro-abstraction-design.md](./2026-04-09-ansible-distro-abstraction-design.md)
**Depends on:** Companion ansible distro abstraction PR landing first (or co-developing)

## Overview

Llamenos's threat model in `CLAUDE.md` calls out *"well-funded adversaries (nation states, right-wing groups, private hacking firms)"*. Several VPS providers — most notably 1984 Hosting in Iceland, but also dozens of EU-based hosts — accept custom ISO uploads. This spec defines a reproducible builder that produces a hardened **Debian 13 (trixie) netinst ISO** with **LUKS2 + LVM full disk encryption**, **dropbear-initramfs SSH-based remote unlock** (with optional VPS-console-unlock fallback), and a minimal post-install footprint that hands off to the Ansible playbook.

The output is a single .iso file an operator can upload to any VPS provider that supports ISO installation, walk through the installer once via the provider's web console, then hand off to the Ansible playbook for hardening and Llamenos deployment. The ISO contains no Llamenos secrets and no Llamenos code — it produces a *substrate* that the existing Ansible playbook can manage.

This is **PR 2** of a two-PR effort. It depends on the companion Ansible distro abstraction PR so that ISOs built from Debian boot into a system the playbook can actually configure.

---

## Goals

1. **Produce a bootable Debian 13 netinst ISO with LUKS2+LVM full disk encryption** in a single command, from a clean checkout of the repo, requiring only Docker on the operator's host.
2. **Default unlock mechanism: dropbear-initramfs SSH** (no passphrase via VPS console for normal boots). Operator pre-stages an SSH public key at build time; first boot is via the provider's console (one-time install), every subsequent boot is unlocked over SSH.
3. **Optional VPS-console-unlock mode** as an escape hatch for less technical operators or providers without reliable network access in initramfs.
4. **Verified provenance.** The upstream Debian netinst ISO is GPG-verified against Debian's release signing key inside the build container before it's modified. Repacked output includes a SHA-256 checksum.
5. **Reproducible builds** in the same spirit as `Dockerfile.build` and `verify-build.sh`. Two operators on different machines, building from the same git SHA + same upstream ISO + same flags, produce byte-identical outputs.
6. **Hardened post-install baseline** ready for Ansible takeover: no password auth, no root login, SSH key-only, minimal package set, `sudo`-capable user with the operator's pre-staged SSH key.
7. **No secrets in the ISO.** All Llamenos configuration, env vars, hub keys, and credentials are injected later by the operator running the Ansible playbook against the new host.

## Non-goals

- Bake the entire Llamenos stack into the ISO. The ISO is a substrate, not a deployment.
- Support every Linux distribution. Debian 13 only in this PR. Ubuntu support would mean Subiquity/cloud-init autoinstall, which is structurally different — separate effort if ever needed.
- Bare-metal hardware support beyond what Debian netinst already supports. We're targeting VPSes, which all use virtio or fully emulated devices; exotic NICs and storage controllers are not in scope.
- Secure Boot / measured boot. VPS hosts rarely expose firmware controls and the threat model is dominated by provider-level access, not local bootloader tampering. Documented as a known gap.
- TPM-bound LUKS keys. VPSes don't expose TPMs.
- A web UI for ISO building. CLI only.

## Threat model

The ISO defends against, at a minimum:

1. **Disk image theft from the VPS provider.** Provider snapshot of the disk reveals only `/boot` (kernel, initramfs, dropbear keys, no userdata) plus a LUKS2 container the provider cannot decrypt without the unlock passphrase or dropbear SSH key.
2. **VPS provider keystroke capture via web console.** Default dropbear mode means the unlock passphrase never traverses the provider's console — only the operator's SSH client and the dropbear server in initramfs see it. Console mode is documented as weaker.
3. **Tampered upstream ISO downloads.** GPG verification against Debian's signing key is mandatory and not a flag — the build fails if verification fails.
4. **Build-time compromise of the operator's machine.** Out of scope; if the operator's laptop is compromised, the SSH key they pre-stage is also compromised. The ISO only has to defend the *server*, not the operator.

The ISO does NOT defend against:

1. **Hot RAM extraction at the VPS host level.** A sufficiently motivated provider with hypervisor access can dump guest memory and recover the LUKS master key. Documented as a known limitation; mitigated only by choosing a trustworthy provider.
2. **Cold boot attacks.** VPSes don't have persistent memory between reboots in any reachable way for an attacker.
3. **Physical attacks against the VPS hardware.** The provider has it; we don't.

---

## 1. High-Level Flow

```
Operator (laptop)                   Build container                  VPS provider
─────────────────                   ───────────────                  ────────────
  scripts/build-iso.sh              docker run debian:13
       │                                  │
       │  flags + ssh public key          │
       │ ────────────────────────────────▶│
       │                                  │
       │                                  │ download Debian 13.4.0 netinst.iso
       │                                  │ verify GPG signature
       │                                  │ extract iso → ./build/iso-root
       │                                  │ render preseed.cfg from template
       │                                  │ embed preseed in initrd
       │                                  │ inject late-command + dropbear keys
       │                                  │ xorriso repack hybrid BIOS+UEFI
       │                                  │ sha256sum ./out/llamenos-debian13.iso
       │ ◀────────────────────────────────│
       │  llamenos-debian13.iso           │
       │  llamenos-debian13.iso.sha256    │
       │                                  │
       │   upload via provider web UI ──────────────────────────────▶
       │                                                              │
       │   open provider console  ─────────────────────────────────▶  │  installer runs
       │   (one-time, types LUKS passphrase + watches install)        │  preseed answers everything
       │                                                              │  reboots to installed system
       │                                                              │
       │   ssh -p 2222 root@vps                                       │
       │   (dropbear in initramfs)                                    │
       │   types LUKS passphrase  ──────────────────────────────────▶ │  cryptroot-unlock → boots
       │                                                              │  systemd starts
       │   ssh deploy@vps  ─────────────────────────────────────────▶ │  ready for ansible
       │                                                              │
       │   cd deploy/ansible && just deploy-demo                      │
```

## 2. CLI Interface

`scripts/build-iso.sh` is the operator entrypoint. All flags are mandatory unless marked default.

```
Usage: scripts/build-iso.sh [OPTIONS]

Required:
  --hostname HOSTNAME           Initial hostname for the installed system
  --ssh-key PATH                Path to SSH public key (ed25519 recommended)
                                  Used for both initramfs dropbear unlock AND
                                  the post-install deploy user's authorized_keys

Optional:
  --unlock {dropbear|console}   Unlock mechanism for subsequent boots
                                  default: dropbear
  --static-ip CIDR              Static IP for initramfs network (e.g., 192.0.2.10/24)
                                  default: dhcp
  --gateway IP                  Gateway IP (required if --static-ip is set)
  --dns IP[,IP]                 DNS servers (default: 9.9.9.9,149.112.112.112)
  --locale LOCALE               Locale (default: en_US.UTF-8)
  --timezone TZ                 Timezone (default: UTC)
  --user USERNAME               Initial sudo user (default: deploy)
  --disk DEVICE                 Target disk device (default: /dev/sda)
                                  Use /dev/vda for paravirt VPS providers
  --debian-version VERSION      Debian point release to fetch (default: 13.4.0)
  --out PATH                    Output directory (default: ./dist/iso/)
  --no-cache                    Re-download upstream ISO even if cached
  --offline                     Refuse to fetch anything; require local cache
  -h, --help                    Show usage

Example:
  scripts/build-iso.sh \
    --hostname llamenos-iceland-01 \
    --ssh-key ~/.ssh/id_ed25519.pub \
    --unlock dropbear \
    --static-ip 93.95.226.10/24 \
    --gateway 93.95.226.1 \
    --timezone Atlantic/Reykjavik
```

### Validation

Before invoking Docker, the entrypoint script validates:

- `--hostname` matches `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`
- `--ssh-key` exists, is readable, and `ssh-keygen -l -f $key` succeeds (rejects invalid keys)
- The key type is in an allowlist: `ssh-ed25519`, `ecdsa-sha2-nistp256`, `ecdsa-sha2-nistp384`, `ecdsa-sha2-nistp521`. RSA is **rejected** because dropbear-initramfs in trixie supports ed25519 cleanly and RSA is structurally weaker for this use.
- `--unlock` is one of the two values
- If `--static-ip` is set, `--gateway` must also be set
- `--disk` matches the form `/dev/[a-z]+` (sda, vda, nvme0n1 are all valid; arbitrary paths are rejected)
- `--debian-version` matches the form `13.X.Y` (regex)
- The output directory is writable

Validation failures print a single-line error and exit non-zero. No Docker invocation, no half-built state.

---

## 3. Builder Container

`scripts/iso-builder/Dockerfile` is a pinned Debian 13 image used solely for building. Multi-stage to keep the build context tiny.

### Pinning

```dockerfile
# scripts/iso-builder/Dockerfile
FROM debian:13.4-slim@sha256:<pinned-digest>

# Reproducible-build env
ENV SOURCE_DATE_EPOCH=1735689600
ENV DEBIAN_FRONTEND=noninteractive
ENV LC_ALL=C
ENV TZ=UTC

# Pin tool versions explicitly to support reproducible output
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
      sha256sum-coreutils=9.4-3 \
      busybox-static \
      && rm -rf /var/lib/apt/lists/*

# Copy in scripts
COPY build-inside.sh /usr/local/bin/build-inside.sh
COPY preseed.cfg.template /usr/local/share/llamenos-iso/preseed.cfg.template
COPY late-command.sh /usr/local/share/llamenos-iso/late-command.sh
COPY dropbear-setup.sh /usr/local/share/llamenos-iso/dropbear-setup.sh

ENTRYPOINT ["/usr/local/bin/build-inside.sh"]
```

The base image SHA256 digest is pinned. The Dockerfile is rebuilt only when one of: the base image is updated, a tool version is bumped, or a script is modified. The `scripts/build-iso.sh` host wrapper invokes `docker build` first (which is a no-op if cached) and then `docker run`.

### Why a container

- **Host-independence.** Operators on Mac, Linux, or WSL all get the same `xorriso`, `cpio`, and `wget` versions.
- **Provenance for tooling.** The build steps run in a known, GPG-verifiable image, not whatever the operator's OS happened to ship.
- **Aligns with the existing reproducible-build pattern.** `Dockerfile.build` does the same thing for the application binary.

### Why not Bun/TypeScript

The script talks to `xorriso`, `cpio`, `wget`, `gpg`, and `dd` — every operation is a one-liner shell invocation. A TypeScript wrapper would be a thin veneer over `Bun.spawn`, providing zero benefit and more friction for operators debugging the build. Plain `bash` with `set -euo pipefail` is the right tool. The Llamenos repo already has shell scripts in `scripts/` (`docker-setup.sh`, `dev-certs.sh`, `download-dbip.sh`, etc.), so this fits the local convention.

---

## 4. Upstream ISO Verification

Inside the container, before any modification:

```bash
# Pinned URLs (interpolated from --debian-version flag)
ISO_URL="https://cdimage.debian.org/debian-cd/13.4.0/amd64/iso-cd/debian-13.4.0-amd64-netinst.iso"
SUMS_URL="https://cdimage.debian.org/debian-cd/13.4.0/amd64/iso-cd/SHA512SUMS"
SIGN_URL="https://cdimage.debian.org/debian-cd/13.4.0/amd64/iso-cd/SHA512SUMS.sign"

# Fetch
wget -nv -O upstream.iso "$ISO_URL"
wget -nv -O SHA512SUMS "$SUMS_URL"
wget -nv -O SHA512SUMS.sign "$SIGN_URL"

# Verify signature using debian-keyring (NOT apt-key, which is removed in trixie)
gpg --no-default-keyring \
    --keyring /usr/share/keyrings/debian-role-keys.gpg \
    --verify SHA512SUMS.sign SHA512SUMS

# Verify checksum
grep 'debian-13.4.0-amd64-netinst.iso$' SHA512SUMS \
  | sha512sum -c -
```

The `debian-keyring` package on the build container provides the trusted role keys. If either the signature verification or the checksum check fails, the script exits with a clear error and **no further work happens** — no half-built ISO, no fallback download.

### Caching

If `~/.cache/llamenos-iso/debian-13.4.0-amd64-netinst.iso` exists with a matching SHA-512, the download is skipped. The cache directory is mounted into the container as a read-write volume. `--no-cache` forces a fresh download. `--offline` requires the cache hit and refuses any network access.

---

## 5. Preseed Configuration

The preseed file is rendered from a template inside the container, with operator-supplied values substituted via simple `envsubst` (no Jinja, no Python — the template uses `${VARIABLE}` placeholders, and we ship the env vars to the container).

### Template

`scripts/iso-builder/preseed.cfg.template` (excerpt — full file in implementation):

```preseed
#--- Localization ---
d-i debian-installer/locale string ${LOCALE}
d-i keyboard-configuration/xkb-keymap select us

#--- Network ---
d-i netcfg/choose_interface select auto
d-i netcfg/get_hostname string ${HOSTNAME}
d-i netcfg/get_domain string local
d-i netcfg/wireless_wep string

#--- Mirror (pinned to debian.org for trust; HTTPS) ---
d-i mirror/protocol string https
d-i mirror/country string manual
d-i mirror/https/hostname string deb.debian.org
d-i mirror/https/directory string /debian
d-i mirror/https/proxy string

#--- Account setup ---
# Disable root login entirely
d-i passwd/root-login boolean false
d-i passwd/make-user boolean true
d-i passwd/user-fullname string ${USERNAME}
d-i passwd/username string ${USERNAME}
# Random password — never used; SSH key is the only access path
d-i passwd/user-password-crypted password !
d-i passwd/user-default-groups string sudo

#--- Clock and timezone ---
d-i clock-setup/utc boolean true
d-i time/zone string ${TIMEZONE}
d-i clock-setup/ntp boolean true

#--- Partitioning: LUKS2 + LVM full disk encryption ---
d-i partman-auto/method string crypto
d-i partman-auto/disk string ${DISK}
d-i partman-auto-lvm/new_vg_name string vg0
d-i partman-auto-lvm/guided_size string max
d-i partman-lvm/device_remove_lvm boolean true
d-i partman-lvm/confirm boolean true
d-i partman-lvm/confirm_nooverwrite boolean true
d-i partman-md/device_remove_md boolean true
d-i partman-auto/purge_lvm_from_device boolean true

# Passphrase is set INTERACTIVELY at install time via the provider console.
# We do NOT preseed the passphrase — it would land in the ISO and defeat FDE.
# (The installer will prompt; this is the only manual step.)

d-i partman-auto/expert_recipe string                         \
  custom ::                                                   \
    1024 1024 1024 ext4                                       \
      $primary{ } $bootable{ }                                \
      method{ format } format{ }                              \
      use_filesystem{ } filesystem{ ext4 }                    \
      mountpoint{ /boot } .                                   \
    2048 4096 200% linux-swap                                 \
      $lvmok{ } lv_name{ swap }                               \
      in_vg { vg0 }                                           \
      method{ swap } format{ } .                              \
    4096 100000 -1 ext4                                       \
      $lvmok{ } lv_name{ root }                               \
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

#--- Late command (see §6) ---
# Both helper scripts live on the ISO root (under /llamenos/) and are copied
# into the installer chroot before being run. They are deleted afterwards so
# nothing operator-supplied lingers in the installed system.
d-i preseed/late_command string \
  cp /cdrom/llamenos/late-command.sh /cdrom/llamenos/dropbear-setup.sh /target/tmp/ && \
  in-target chmod +x /tmp/late-command.sh /tmp/dropbear-setup.sh && \
  in-target /tmp/late-command.sh "${UNLOCK_MODE}" "${SSH_PUBKEY_B64}" "${STATIC_IP}" "${GATEWAY}" "${DNS}" && \
  in-target rm /tmp/late-command.sh /tmp/dropbear-setup.sh

#--- Reboot when done ---
d-i finish-install/reboot_in_progress note
```

### Critical preseed decisions

1. **No preseeded passphrase.** Bundling the LUKS passphrase in the ISO would defeat the entire purpose. The operator types it once at the provider's web console during install. After install, they SSH into dropbear at every boot (or to the console if `--unlock console`).
2. **Random user password, ssh-key only.** The password field is set to `!` (locked). The only way to log in is the SSH key embedded by the late command.
3. **Root login disabled.** No `passwd/root-login`, no root password. `sudo` is the only privilege escalation path.
4. **`unattended-upgrades` enabled at install time.** First boot already has security updates configured.
5. **Mirror is HTTPS-only and pinned to `deb.debian.org`.** Slightly slower than the geo-mirror but provides TLS to the trust path.
6. **Target disk is configurable via `--disk` (default `/dev/sda`).** Most VPS providers including 1984 Hosting use `/dev/sda` (SCSI emulation), but paravirtualized providers expose `/dev/vda`. The flag accepts any `/dev/...` path that matches the validation regex; the value is substituted into both the partman recipe (via the recipe's implicit "first detected disk" behavior — partman-auto picks `/dev/sda` if only one disk is present, so we also pin `partman-auto/disk` explicitly to `${DISK}`) and the GRUB bootdev preseed answer.

---

## 6. Late Command

`scripts/iso-builder/late-command.sh` runs inside the chroot of the freshly installed system, just before reboot. It receives the unlock mode, the operator's SSH public key (base64-encoded, since it has spaces), and optional network parameters.

```bash
#!/bin/sh
# late-command.sh — runs in the installer chroot before reboot
# Args: $1=UNLOCK_MODE  $2=SSH_PUBKEY_B64  $3=STATIC_IP  $4=GATEWAY  $5=DNS
set -eu

UNLOCK_MODE="$1"
SSH_PUBKEY="$(echo "$2" | base64 -d)"
STATIC_IP="$3"
GATEWAY="$4"
DNS="$5"

# 1. Stage operator's SSH key for the deploy user
USER_HOME="/home/deploy"   # USERNAME from preseed
mkdir -p "$USER_HOME/.ssh"
echo "$SSH_PUBKEY" > "$USER_HOME/.ssh/authorized_keys"
chmod 700 "$USER_HOME/.ssh"
chmod 600 "$USER_HOME/.ssh/authorized_keys"
chown -R deploy:deploy "$USER_HOME/.ssh"

# 2. Harden sshd to a sane baseline (full hardening happens in Ansible)
cat > /etc/ssh/sshd_config.d/00-llamenos-baseline.conf <<EOF
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
# (dropbear-setup.sh was copied alongside this script by the preseed late_command — see §5)
if [ "$UNLOCK_MODE" = "dropbear" ]; then
  /tmp/dropbear-setup.sh "$SSH_PUBKEY" "$STATIC_IP" "$GATEWAY" "$DNS"
fi

# 4. Ensure NTP is on (chrony) — Ansible will reconfigure with hub-specific servers
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
    ansible-playbook setup.yml -i 'this-host,'
    just deploy-demo   # or your production playbook

EOF

exit 0
```

The script is short by design — every line that lives here is a line we'd otherwise have to wedge into the preseed `late_command` string, which has terrible quoting properties. Anything more elaborate (firewall, kernel hardening, fail2ban) is the Ansible playbook's job.

---

## 7. Dropbear Initramfs Setup

`scripts/iso-builder/dropbear-setup.sh`, also run from the chroot. This is the most novel piece and the most carefully reviewed.

```bash
#!/bin/sh
# dropbear-setup.sh — configure dropbear-initramfs for remote LUKS unlock
# Args: $1=SSH_PUBKEY  $2=STATIC_IP_OR_DHCP  $3=GATEWAY  $4=DNS
set -eu

# Helper functions must be defined BEFORE first use (POSIX shell does not hoist).
cidr_to_netmask() {
  # Inline POSIX-portable CIDR-to-dotted-quad conversion (no python in initramfs)
  cidr="$1"; mask=""
  full=$((cidr / 8)); part=$((cidr % 8))
  i=1
  while [ $i -le 4 ]; do
    if [ $i -le $full ]; then mask="${mask}255"
    elif [ $i -eq $((full + 1)) ]; then
      case $part in
        0) mask="${mask}0" ;;
        1) mask="${mask}128" ;;
        2) mask="${mask}192" ;;
        3) mask="${mask}224" ;;
        4) mask="${mask}240" ;;
        5) mask="${mask}248" ;;
        6) mask="${mask}252" ;;
        7) mask="${mask}254" ;;
      esac
    else mask="${mask}0"
    fi
    [ $i -lt 4 ] && mask="${mask}."
    i=$((i + 1))
  done
  echo "$mask"
}

SSH_PUBKEY="$1"
STATIC_IP="$2"
GATEWAY="$3"
# (DNS is intentionally NOT threaded through — initramfs does no name
#  resolution, and the DROPBEAR_OPTIONS forced command is cryptroot-unlock
#  which never opens an outbound connection.)

# Install dropbear-initramfs.
# DEBIAN_FRONTEND=noninteractive is REQUIRED: the dropbear-initramfs
# postinst triggers debconf prompts that would otherwise block on a tty
# that doesn't exist inside the d-i late_command chroot, hanging the
# installer indefinitely at "Finishing the installation". Discovered
# during headless qemu T11 testing on 2026-04-11.
export DEBIAN_FRONTEND=noninteractive
apt-get install -y --no-install-recommends \
  -o Dpkg::Options::="--force-confdef" \
  -o Dpkg::Options::="--force-confold" \
  dropbear-initramfs

# Trixie path (NOT the bookworm /etc/dropbear-initramfs/ path)
mkdir -p /etc/dropbear/initramfs
echo "$SSH_PUBKEY" > /etc/dropbear/initramfs/authorized_keys
chmod 600 /etc/dropbear/initramfs/authorized_keys

# Constrain dropbear in initramfs:
#   -I 300 : idle timeout 5 min
#   -j -k  : disable local + remote port forwarding
#   -p 2222: port 2222 (avoid clash with installed sshd on 22)
#   -s     : disable password auth
#   -c cryptroot-unlock : forced command — only thing this key can do
cat > /etc/dropbear/initramfs/dropbear.conf <<'EOF'
DROPBEAR_OPTIONS="-I 300 -j -k -p 2222 -s -c cryptroot-unlock"
EOF

# Network config for initramfs
if [ "$STATIC_IP" = "dhcp" ]; then
  echo "IP=dhcp" >> /etc/initramfs-tools/initramfs.conf
else
  # klibc 7-field syntax: ip=<client>::<gw>:<netmask>::<iface>:off
  IP_ADDR="${STATIC_IP%/*}"
  CIDR="${STATIC_IP#*/}"
  NETMASK="$(cidr_to_netmask "$CIDR")"   # helper defined inline below
  IP_LINE="ip=${IP_ADDR}::${GATEWAY}:${NETMASK}::eth0:off"
  echo "IP=${IP_LINE}" >> /etc/initramfs-tools/initramfs.conf
fi

# Rebuild initramfs to include dropbear, keys, network
update-initramfs -u -k all
```

### Operator unlock flow (dropbear mode)

1. VPS boots, kernel decompresses, initramfs starts
2. Network comes up (DHCP or static per build flags)
3. Dropbear starts on port 2222
4. Operator from laptop: `ssh -p 2222 -i ~/.ssh/id_ed25519 root@vps-ip`
5. Dropbear runs the forced command `cryptroot-unlock`, which prompts for the LUKS passphrase
6. Operator types the passphrase
7. `cryptroot-unlock` decrypts the root volume and signals the main boot to continue
8. Dropbear's session terminates; the rest of boot proceeds; sshd on port 22 comes up
9. Operator now SSHes normally as `deploy`

### Operator unlock flow (console mode)

1. VPS boots
2. The standard `cryptsetup` prompt appears on console TTY1
3. Operator opens the provider's web console (VNC/serial)
4. Types the LUKS passphrase
5. Boot continues

### Why port 2222 for dropbear

Dropbear runs on port 22 by default in initramfs. The installed sshd also defaults to 22. If we leave dropbear on 22, the operator's SSH client will reuse known-hosts entries from the live system and warn or refuse. Putting dropbear on 2222 makes the unlock connection visibly distinct and the host-key fingerprint clearly separate. The post-install sshd config (§6) does NOT change port 22 — that's Ansible's job (the ssh-hardening role can shift it to a non-standard port if desired).

### Why ed25519 only

`dropbear-initramfs` 2022.83+ (which trixie ships) supports ed25519 host and client keys. RSA is supported too, but ed25519 keys are smaller (less initramfs bloat) and structurally stronger. We disable RSA at the entrypoint validation step (§2) so operators can't accidentally embed a weak key.

---

## 8. ISO Repacking with xorriso

After preseed and late-command files are staged, the build script extracts the upstream ISO, injects the new files, and repacks with `xorriso` preserving hybrid BIOS+UEFI bootability.

```bash
# Extract MBR template (first 432 bytes — the isohybrid MBR)
dd if=upstream.iso bs=1 count=432 of=/tmp/isohdpfx.bin status=none

# Mount upstream ISO read-only
xorriso -osirrox on -indev upstream.iso \
  -extract / /tmp/iso-root

chmod -R u+w /tmp/iso-root

# --- Stage helper scripts on the ISO root (NOT in the initrd) ---
# These are read by the preseed late_command from /cdrom/llamenos/ at install time.
# The initrd-installed installer mounts the ISO as /cdrom inside its environment.
mkdir -p /tmp/iso-root/llamenos
cp /tmp/late-command.sh /tmp/iso-root/llamenos/late-command.sh
cp /tmp/dropbear-setup.sh /tmp/iso-root/llamenos/dropbear-setup.sh
chmod +x /tmp/iso-root/llamenos/late-command.sh /tmp/iso-root/llamenos/dropbear-setup.sh

# --- Inject preseed into the initrd ---
# preseed.cfg MUST live inside the initrd at /preseed.cfg because that's where
# debian-installer looks when invoked with `preseed/file=/preseed.cfg` on the
# kernel command line. Helper scripts cannot live here because the chroot the
# late_command runs in is the /target system, not the initrd environment.
mkdir -p /tmp/initrd-extract
cd /tmp/initrd-extract
gunzip < /tmp/iso-root/install.amd/initrd.gz | cpio -id

cp /tmp/preseed.cfg ./preseed.cfg

find . | cpio -H newc -o --reproducible 2>/dev/null \
  | gzip -9 -n > /tmp/iso-root/install.amd/initrd.gz

# Patch boot menu to use the preseed automatically
cat > /tmp/iso-root/isolinux/txt.cfg <<'EOF'
default install
label install
  menu label ^Install Llamenos Hotline (Debian 13 + LUKS)
  kernel /install.amd/vmlinuz
  append vga=788 initrd=/install.amd/initrd.gz auto=true priority=critical preseed/file=/preseed.cfg --- quiet
EOF

# Patch GRUB EFI menu identically
sed -i 's|set default="0"|set default="0"\nset timeout=5|' /tmp/iso-root/boot/grub/grub.cfg
# (full patch in implementation — adds preseed/file to the linux line)

# Update SHA256SUM for boot files (used by debian-installer integrity check)
cd /tmp/iso-root
md5sum $(find -follow -type f) > md5sum.txt 2>/dev/null

# Repack as hybrid BIOS + UEFI bootable
xorriso -as mkisofs \
  -r -V 'Llamenos Debian 13' \
  -o /out/llamenos-debian13-${UNLOCK_MODE}.iso \
  -J -joliet-long -cache-inodes \
  -isohybrid-mbr /tmp/isohdpfx.bin \
  -b isolinux/isolinux.bin \
  -c isolinux/boot.cat \
  -boot-load-size 4 -boot-info-table -no-emul-boot \
  -eltorito-alt-boot \
  -e boot/grub/efi.img \
  -no-emul-boot -isohybrid-gpt-basdat -isohybrid-apm-hfsplus \
  /tmp/iso-root

# Emit SHA-256 sidecar
cd /out
sha256sum llamenos-debian13-${UNLOCK_MODE}.iso > llamenos-debian13-${UNLOCK_MODE}.iso.sha256
```

### Reproducibility notes

- `cpio -H newc -o --reproducible` produces deterministic initrd contents
- `gzip -n` strips the timestamp from the gzip header
- `SOURCE_DATE_EPOCH` is set in the Dockerfile
- The xorriso `mkisofs` command does not include any timestamps that aren't already deterministic given the input
- Two operators with the same git SHA, same flags, same upstream Debian ISO bytes get the same output SHA-256

### Verification helper

`scripts/verify-iso.sh` (mirroring `scripts/verify-build.sh`): given a built ISO and the build flags, re-runs the build in a fresh container and compares SHA-256. Same shape as the existing reproducible-build verification flow.

---

## 9. File Layout in this PR

```
scripts/
├── build-iso.sh                            # NEW — host entrypoint, validates flags + invokes docker
├── verify-iso.sh                           # NEW — reproducibility verifier
└── iso-builder/                            # NEW
    ├── Dockerfile                          # Pinned Debian 13 builder image
    ├── build-inside.sh                     # Container entrypoint, runs the actual build
    ├── preseed.cfg.template                # envsubst template (see §5)
    ├── late-command.sh                     # Runs in installer chroot (see §6)
    ├── dropbear-setup.sh                   # Configures dropbear-initramfs (see §7)
    └── README.md                           # Internal docs for the builder pieces

docs/deployment/
└── iso-install.md                          # NEW — operator guide (see §11)

tests/iso-builder/                          # NEW
├── build-iso-args.bats                     # bats tests for argument validation
├── preseed-template.bats                   # rendering tests
└── README.md                               # how to run iso-builder tests

CLAUDE.md                                   # MODIFIED — add ISO builder note to "Development Commands"
```

### Deliberately not in this PR

- A GitHub Actions workflow that builds ISOs on tag. Worth doing later, but ties this PR to release plumbing decisions that should be made separately.
- Pre-built ISO downloads on GitHub Releases. Same reasoning.
- A signed-with-our-key ISO. Requires us to manage a Llamenos signing key, which is a much bigger conversation about key custody.

---

## 10. Testing Strategy

### Unit-style: `bats` tests

The build script has two units worth testing in isolation:

1. **Argument parsing and validation** — every error path (missing flag, bad hostname format, weak SSH key type, missing gateway when static IP set, etc.) covered by a bats case asserting the script exits non-zero with a recognizable error message.
2. **Preseed template rendering** — given a fixed set of env vars, the rendered preseed should match a golden file. Catches typos in the template and silent variable-substitution bugs.

These tests run in CI on every PR touching `scripts/iso-builder/` or `scripts/build-iso.sh`. They do not need Docker (the script's `docker run` is mocked or guarded).

### Integration: actual ISO build in CI

A separate, slower CI job (gated to pushes to `main` and PR-labelled `iso-build`) actually runs `scripts/build-iso.sh` end-to-end inside the GitHub Actions runner with a fixture SSH key. Asserts:

- The script exits 0
- The output ISO file exists and is non-empty
- `xorriso -indev <iso> -find / | wc -l` is non-zero (sanity check)
- The SHA-256 sidecar is present and matches `sha256sum <iso>`

### Manual: boot in qemu

A documented procedure (in `tests/iso-builder/README.md`) for an operator or reviewer to boot the built ISO in qemu and verify the install proceeds, the LUKS passphrase prompt works, dropbear comes up on port 2222 after reboot, and `ssh -p 2222 root@<qemu-ip>` runs `cryptroot-unlock`.

### Manual: boot on a real VPS

A documented test against 1984 Hosting (or any provider) before the PR is merged, with a screenshot or text log in the PR description proving the unlock cycle worked end-to-end.

### What we explicitly do NOT test

- Every possible LUKS / LVM / partition layout. We test the one layout we ship.
- Every Debian point release. We test the one we pin to (`13.4.0`).
- Every VPS provider. We test 1984 + qemu and trust that other providers' ISO upload + console flows work the same way.

---

## 11. Operator Documentation

`docs/deployment/iso-install.md` walks an operator through end-to-end. Content outline:

1. **Why custom ISO + FDE.** One paragraph on the threat model.
2. **Prerequisites.** Docker on your laptop. An ed25519 SSH key (`ssh-keygen -t ed25519` if you don't have one). A VPS provider that accepts ISO uploads (1984, Hetzner Cloud via cloud-init bypass, OVH, etc.).
3. **Building the ISO.** The `scripts/build-iso.sh` invocation with example flags.
4. **Uploading to 1984 Hosting.** Step-by-step screenshots of the 1984 control panel: create VPS, attach ISO, boot from ISO. (Generic step-by-step for "any provider that accepts ISOs" too.)
5. **First boot via provider console.** Open the provider's web console, watch the installer, type the LUKS passphrase when prompted. ~5–10 minutes.
6. **Unlocking on subsequent boots (dropbear mode).** From your laptop: `ssh -p 2222 -i ~/.ssh/id_ed25519 root@<vps-ip>`, type the passphrase. The session closes automatically after unlock.
7. **Unlocking on subsequent boots (console mode).** Open the provider's web console, type the passphrase.
8. **Handing off to Ansible.** From your laptop: `cd deploy/ansible && ansible-playbook setup.yml -i '<vps-ip>,'` (with the appropriate vars file).
9. **Troubleshooting.** Dropbear doesn't start: probably wrong network config; see `--static-ip` / `--gateway` flags. Wrong host key warning: dropbear and sshd have different host keys, which is correct — see the dropbear known-hosts setup section. Forgotten LUKS passphrase: rebuild the host (no recovery; this is by design).
10. **Threat model caveats.** What this defends against, what it doesn't. Pointer to the spec.

---

## 12. Risks and Open Questions

### Risks

- **Debian 13 is only 8 months old.** Trixie point releases have been stable, but we're on the early side of the LTS cycle. Mitigated by: pinning to a specific point release, monitoring Debian security advisories, and the option to switch to bookworm with a flag if a regression appears.
- **Dropbear-initramfs is sensitive to network config.** A wrong static-IP / gateway means the operator can't unlock and has to fall back to console mode (or rebuild). Mitigated by: clear validation in the entrypoint, documented troubleshooting, and the option to default to DHCP which "just works" on most VPSes.
- **VPS provider quirks.** Some providers virtualize disks in unusual ways (`/dev/vda` instead of `/dev/sda`, missing console serial, weird firmware). Mitigated by: a `--disk` flag (P2 follow-up) and a list of known-tested providers in the docs.
- **Reproducible builds are fragile.** xorriso, cpio, gzip, and the upstream Debian initrd are all sources of non-determinism if we touch them wrong. Mitigated by: a CI job that builds the ISO twice in clean containers and asserts byte-equality on every PR touching the builder.
- **Custom ISO surface area is novel for the project.** Nobody on the team has built one before. Mitigated by: research already done (see spec), conservative design (vendoring the upstream installer rather than rolling our own), and the manual test against a real VPS as part of merge.

### Resolved decisions

- **LUKS passphrase: interactive prompt at install time, NOT preseeded.** Operator types it once at the provider's web console during the one-time install. After install, dropbear handles every subsequent boot. Avoids the security tradeoff of embedding the passphrase in any build artifact. The 30-second console interaction is the only manual step in the install.
- **ISO does NOT bundle the Ansible playbook.** The operator's laptop runs Ansible against the new VPS over the network. Avoids ISO bloat and the staleness problem of bundled deployment code. Documented in `iso-install.md` as the assumed model.
- **`--disk` flag is in scope** (default `/dev/sda`) so paravirt VPS providers can target `/dev/vda` without rebuilding the ISO image generator. See §2 and §5.
- **No `--unlock=tang` in this PR.** See follow-up note below.

### Follow-up: `--unlock=tang` (Tang/Clevis network-bound disk encryption)

Tang/Clevis is the standard for "unlock the disk automatically when the host is on a trusted network." Compared to dropbear it eliminates the manual passphrase step on every boot, but requires:

- A separately deployed and maintained Tang server (its own VPS, its own hardening, its own backup story) — Tang servers are stateful and their compromise is equivalent to disclosing all bound LUKS keys
- Network-path trust assumptions (the operator must define what "trusted network" means in their threat model)
- Coordination with our existing `key-store-v2` multi-factor KEK story so two parallel "what unlocks what" mental models don't confuse operators

This is worth doing eventually for operators running multiple Llamenos hotlines who don't want to type a passphrase per server per boot, but it's a deployment of its own and needs its own design spec. **Tracked as a follow-up in `docs/NEXT_BACKLOG.md` (item to be added when this spec is approved):** *"FDE ISO: add `--unlock=tang` mode with bundled Tang server deployment role."*

---

## Acceptance Criteria

This PR is done when:

- [ ] `scripts/build-iso.sh` exists, validates all flags per §2 (including `--disk` allowlist), and produces a Debian 13 ISO via the container builder
- [ ] `scripts/iso-builder/Dockerfile` is pinned to a specific Debian 13 image SHA + tool versions
- [ ] Upstream Debian netinst ISO is GPG-verified against `debian-keyring` inside the build container; build fails loudly on verification failure
- [ ] Preseed produces an unattended install with LUKS2+LVM, unencrypted /boot, encrypted swap inside LVM
- [ ] LUKS passphrase is set interactively at install time (NOT preseeded)
- [ ] Dropbear-initramfs config uses the trixie path (`/etc/dropbear/initramfs/`), not the bookworm path
- [ ] `--unlock=dropbear` produces a working remote unlock on port 2222 with operator's SSH key as forced command
- [ ] `--unlock=console` produces a working console-prompted unlock with no dropbear installed
- [ ] Output ISO is hybrid BIOS+UEFI bootable; verified in qemu with both firmware types
- [ ] SHA-256 sidecar is emitted; `verify-iso.sh` proves byte-reproducibility against a fresh container build
- [ ] `scripts/build-iso.sh --help` prints the full usage from §2
- [ ] `tests/iso-builder/*.bats` covers all flag-validation error paths and template rendering
- [ ] CI runs the bats tests on every PR touching the builder
- [ ] CI runs the full ISO build on PRs labelled `iso-build` and on push to `main`
- [ ] `docs/deployment/iso-install.md` is written per §11 and reviewed
- [ ] PR description includes a screenshot or text log proving end-to-end install + dropbear unlock + Ansible takeover on a real 1984 Hosting VPS (or equivalent)
- [ ] `docs/NEXT_BACKLOG.md` has a follow-up entry for the Tang/Clevis `--unlock=tang` mode
- [ ] `package.json` `scripts` section gains `"build:iso": "scripts/build-iso.sh"` so the command appears in `bun run` autocompletion
- [ ] `CLAUDE.md` "Development Commands" section lists `bun run build:iso` with a one-line description and link to `docs/deployment/iso-install.md`
