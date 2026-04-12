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

### Verifying reproducibility (optional)

Llamenos ISOs are reproducible: building twice from the same source with
the same arguments must produce a byte-identical ISO. If you want to
verify this yourself:

```bash
./scripts/verify-iso.sh dist/iso/llamenos-debian13-dropbear.iso -- \
  --hostname llamenos-01 --ssh-key ~/.ssh/id_ed25519.pub
```

Expected output: `==> REPRODUCIBLE: SHAs match`.

## Choosing a provider

Before choosing a VPS provider, read the [deployment tier analysis in
THREAT_MODEL.md](../security/THREAT_MODEL.md#provider-jurisdiction-and-deployment-tiers).
Not every provider is suitable — FDE only works against a subset of adversaries,
and provider corporate jurisdiction matters at least as much as the datacenter
location. In short:

- **Do use:** Non-US providers — Hetzner (Germany), OVH (France/Canada), Scaleway
  (France), 1984 Hosting (Iceland) only for stock images, or self-hosting on
  owned hardware.
- **Do NOT use for this threat model:** AWS, GCP, Azure, Vultr, Linode, DigitalOcean,
  and Cloudflare paid products — all are US-subject regardless of datacenter
  location (CLOUD Act reach) and stacking FDE on top of a US-subject host is a
  false sense of security.

## Uploading to your VPS provider

### Hetzner Cloud (recommended)

Hetzner Cloud is the recommended provider for the default threat model: German
jurisdiction (outside US CLOUD Act reach), KVM with virtio disks, EU datacenters
(Falkenstein, Nuremberg, Helsinki), cheap. The trade-off is that Hetzner custom
ISO uploads are NOT self-service — you open a support ticket and they add your
ISO to your account's library within a business day.

1. Build the ISO with `--disk /dev/sda` (Hetzner Cloud uses the traditional
   device name despite being KVM):

   ```bash
   bun run build:iso \
     --hostname llamenos-01 \
     --ssh-key ~/.ssh/id_ed25519.pub
   ```

2. Host the ISO at a publicly accessible URL. Any non-US S3-compatible object
   storage works (Hetzner Object Storage, Scaleway Object Storage, Infomaniak,
   Exoscale). For a throwaway test, you can also use a GitHub release draft
   temporarily.

3. Open a Hetzner support ticket at <https://console.hetzner.cloud/> → Support,
   with:

   - Subject: **Please add custom ISO to my account**
   - Body: the public HTTPS URL of your ISO, and its SHA-256 from
     `llamenos-debian13-dropbear.iso.sha256`
   - They will verify the file and add it to your account's ISO library (usually
     within a business day, Germany hours)

4. Once the ISO appears in your account's ISO list: create a new Cloud server
   in the Hetzner Console, **Cloud** → **Servers** → **Add Server**:

   - Location: **Falkenstein**, **Nuremberg**, or **Helsinki** (EU)
   - Image: any (will be replaced)
   - Type: **CPX21** or larger (2 vCPU / 4 GB RAM is the minimum for Llamenos,
     `cpx31` 4 vCPU / 8 GB RAM is comfortable)
   - SSH keys: add your public key

5. After creation, go to the server detail page → **ISO Images** tab →
   select your custom ISO → **Mount**.

6. Power-cycle the server (**Power** → **Reset**). It will boot from the
   mounted ISO.

7. Open **Console** (noVNC) from the server detail page. The installer should
   start automatically. Type your LUKS passphrase when prompted. Wait for
   install to complete and reboot.

8. After install completes, **unmount the ISO** from the ISO Images tab so the
   server boots from disk on future reboots.

> **Rescue-mode alternative (no support ticket).** If you don't want to wait
> for Hetzner support, you can boot the server into Hetzner's rescue system
> and run the installer inside `qemu-system-x86_64` with host disk passthrough,
> then reboot out of rescue. This is more error-prone and not formally
> documented here yet — open a tracking issue before relying on it.

### OVHcloud / Scaleway (direct custom ISO upload)

OVHcloud (France, Canada) and Scaleway (France) both support self-service
custom ISO uploads on their dedicated servers and (for Scaleway) some Public
Cloud instance types. Their workflows change often; consult their current
docs and follow the same principle: upload the ISO, attach it to the instance,
boot from it, type LUKS passphrase at the console.

### 1984 Hosting (stock images only)

1984 Hosting (Iceland) is excellent for Llamenos deployments on jurisdictional
grounds (Iceland has strong journalist-source protections and is outside the
EU/US/UK surveillance frameworks), **but does not accept custom ISO uploads**.
You can deploy Llamenos on a 1984 VPS using one of their stock Debian images,
accepting that the installer-time FDE path in this guide does not apply. The
resulting deployment is **Tier 4** in the threat model table and is still a
valid choice for operators whose primary adversary class does not include
compelled runtime instrumentation.

### Self-hosting on your own hardware

The highest-assurance deployment is Tier 1: install the FDE ISO directly on
physical hardware you own (a mini PC, a server in a closet, a rented
colocated U). The ISO works identically on bare metal — boot it from a USB
stick (use `dd` to write it), walk through the installer, and continue from
"Subsequent boots — dropbear unlock" below. See
[`docs/security/THREAT_MODEL.md`](../security/THREAT_MODEL.md#provider-jurisdiction-and-deployment-tiers)
for the full tier analysis.

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
