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
location.

The test is **strict**: a provider must have **zero US operations** — no US
datacenters, no US subsidiary, no US office, no US employees. A foreign parent
company with a US cloud subsidiary is still reachable through the US arm for
data stored anywhere in its network.

**Clean list** (single-jurisdiction, no US operations, verified 2026-04-12):

- **Scaleway** (France) — EU-only datacenters, mature cloud product line, custom
  image support. Best candidate for managed deployments.
- **FlokiNET** (Iceland, Romania, Netherlands, Finland) — purpose-built for civil
  society and whistleblower projects, no ID required, accepts crypto.
- **1984 Hosting** (Iceland) — stock images only unless support attaches a
  custom ISO; strong jurisdictional posture.
- **Infomaniak** (Switzerland) — Swiss data protection law, more expensive.
- **Exoscale** (Switzerland, with additional EU datacenters) — Swiss parent.
- **Self-hosting** on operator-owned hardware — the highest-assurance option.

**Disqualified** (as of 2026-04-12 — verify before assuming current status):

- **US-headquartered:** AWS, GCP, Azure, Vultr, Linode (Akamai), DigitalOcean,
  Cloudflare paid products, Backblaze.
- **Foreign parent with US operations:** **Hetzner** (operates US cloud
  datacenters in Ashburn VA since 2021 and Hillsboro OR since 2023), **OVHcloud**
  (operates OVHcloud US LLC subsidiary with two US datacenters and ~200
  employees). Both are disqualified despite non-US headquarters because their
  US presence creates personal-jurisdiction hooks for US legal process.
- **Chinese clouds:** Alibaba Cloud, Tencent Cloud, Huawei Cloud, Baidu Cloud.
  China National Intelligence Law Art. 7 compels cooperation with PRC state
  intelligence. Alibaba additionally operates Santa Clara CA datacenters,
  creating dual jurisdictional exposure.

Stacking FDE on top of a disqualified host is a false sense of security — a
compelled hypervisor can capture the LUKS key from running VM memory. Pick a
provider that passes the strict test, then use FDE on top for defense in depth.

## Uploading to your VPS provider

## Hosting the ISO for your provider to fetch

Most providers that support custom ISO installation take a URL rather than a
direct upload. You need to host the built ISO somewhere public before you start.

**ISO hosting threat model is not the same as app hosting threat model.** The
ISO is built from public source, fully reproducible, and its SHA-256 is
published alongside every release. A malicious host substituting a modified ISO
is detectable by any operator who verifies the hash (and the whole point of
reproducible builds is that you can rebuild from source and compare). This
means ISO hosting does **not** need to inherit the non-US-subject rule from
the app hosting deployment — US-subject S3 providers (Vultr, Backblaze B2, etc.)
are acceptable for ISO distribution as long as the SHA-256 is published
out-of-band via GitHub Releases.

Llamenos's canonical ISO is published to each GitHub Release with its SHA-256.
Self-hosters are encouraged to either download from the release page and verify,
or to rebuild from source and compare (`scripts/verify-iso.sh`). Either path
ensures the host cannot tamper with the ISO you install.

For your own throwaway testing, any publicly reachable HTTPS URL works. Vultr
Object Storage, Scaleway Object Storage, S3, or even a short-lived GitHub
Release asset are all fine.

## Hetzner Cloud (recommended)

Hetzner Cloud is the recommended provider for the default threat model: German
jurisdiction (outside US CLOUD Act reach), KVM with virtio disks, EU datacenters
(Falkenstein, Nuremberg, Helsinki), and among the cheapest EU providers.

There are **two equally valid paths** for installing the Llamenos FDE ISO on a
clean-list provider. Pick based on whether you want a business-day wait for a
cleaner UX, or a fully self-service flow that you can run immediately:

| Path | Support ticket? | Time to first boot | UX |
|------|-----------------|---------------------|-----|
| **A. Support-ticket ISO attach** | Yes, usually within one business day | 1 day + ~10 minutes | Mount ISO in the web UI, boot, type LUKS passphrase in the noVNC console |
| **B. Rescue-mode qemu install** | **No** | ~15 minutes total | Boot provider's rescue system, run the installer inside `qemu-system-x86_64` against the real disk, type LUKS passphrase through a VNC tunnel |

Both paths run the **same** FDE ISO against the **same** real disk and produce
an identical installed system. Path B runs the installer in nested virtualization
during install only — once installed, the VM boots natively.

The step-by-step instructions below were originally written against Hetzner
Cloud's UI and rescue system; the workflow is the same on any clean-list provider
with a similar feature set (Scaleway, 1984, FlokiNET). **Substitute panel
navigation and rescue system details from your chosen provider's docs.** The
qemu commands in Path B are generic and should work anywhere the rescue
environment can install qemu and pass `/dev/sda` through to a guest.

### Path A: Support-ticket ISO attach

1. Build the ISO (default `--disk /dev/sda` is correct for Hetzner Cloud):

   ```bash
   bun run build:iso \
     --hostname llamenos-01 \
     --ssh-key ~/.ssh/id_ed25519.pub
   ```

2. Host the ISO at a publicly accessible HTTPS URL (see *Hosting the ISO*
   above).

3. Open a Hetzner support ticket at <https://console.hetzner.cloud/> → Support:

   - Subject: **Please add custom ISO to my account**
   - Body: the public HTTPS URL of your ISO, and its SHA-256 from
     `llamenos-debian13-dropbear.iso.sha256`

   They verify the file and add it to your account's ISO library, usually
   within a business day (Germany working hours).

4. Once the ISO appears in your ISO list, create a Cloud server: **Cloud** →
   **Servers** → **Add Server**:

   - Location: **Falkenstein**, **Nuremberg**, or **Helsinki** (EU)
   - Image: any — will be replaced
   - Type: `cpx21` (2 vCPU / 4 GB) minimum, `cpx31` (4 vCPU / 8 GB) recommended
   - SSH keys: add your public key

5. On the server detail page → **ISO Images** tab → select your ISO → **Mount**.

6. **Power** → **Reset**. The VM boots from the mounted ISO.

7. Open the **Console** (noVNC). The installer runs automatically and prompts
   for the LUKS passphrase. Type it; wait for install + auto-reboot.

8. **Unmount the ISO** from the ISO Images tab so the server boots from disk on
   future reboots.

9. Continue to [Subsequent boots — dropbear unlock](#subsequent-boots--dropbear-unlock-default) below.

### Path B: Rescue-mode qemu install (no support ticket)

This path uses Hetzner's built-in Rescue System (a minimal Debian live
environment) to run the Llamenos installer inside `qemu-system-x86_64` with
the VM's real disk passed through as the installer's target. Nested KVM is
available on Hetzner Cloud, so installation speed is close to native.

This is a well-established Hetzner community pattern for installing operating
systems that don't fit Hetzner's standard image catalog (Proxmox, FreeBSD, ZFS
root, etc.). The Llamenos case is the same: an installer ISO with a preseeded
partitioner that does LUKS + LVM on `/dev/vda` (as seen by the installer inside
qemu) and drops dropbear-initramfs into the resulting root.

**Prerequisites on your laptop:**

- An SSH client (any)
- A VNC client — TigerVNC, RealVNC, Remmina, or any noVNC-capable browser

**On Hetzner, create the VM:**

1. **Cloud** → **Servers** → **Add Server**:
   - Location: Falkenstein / Nuremberg / Helsinki (EU)
   - Image: Debian 12 or 13 (any — it will be replaced)
   - Type: `cpx21` or larger; Llamenos recommends `cpx31`
   - SSH keys: add your laptop's public key
   - Name: `llamenos-01` (or whatever)

2. Once the server is provisioned, enable the Rescue System: server detail →
   **Rescue** tab → **Enable Rescue & Power Cycle**. Hetzner will show you a
   **one-time root password** for the rescue system — copy it. Rescue system
   activation is valid for one boot and expires in 60 minutes if not used.

3. SSH into the rescue system from your laptop, with a local port forward for
   VNC:

   ```bash
   ssh -L 5901:127.0.0.1:5901 root@<server-ip>
   # Paste the one-time rescue password
   ```

4. Inside the rescue system, download the ISO and install qemu:

   ```bash
   # Install qemu (rescue is a minimal Debian; qemu is not pre-installed)
   apt-get update && apt-get install -y qemu-system-x86 qemu-utils

   # Fetch the ISO from wherever you hosted it
   wget -O /tmp/llamenos.iso \
     https://<your-iso-host>/llamenos-debian13-dropbear.iso

   # Verify SHA-256 against the published value
   echo "<expected-sha256>  /tmp/llamenos.iso" | sha256sum -c -
   ```

5. Check the rescue system sees the real disk as `/dev/sda` (standard on
   Hetzner Cloud):

   ```bash
   lsblk
   # Expected: sda with a large size (40G+ depending on CPX tier)
   ```

6. Boot the installer inside qemu with the real disk passed through:

   ```bash
   qemu-system-x86_64 \
     -enable-kvm \
     -cpu host \
     -m 4096 \
     -smp 2 \
     -drive file=/dev/sda,format=raw,if=virtio,cache=none \
     -cdrom /tmp/llamenos.iso \
     -boot d \
     -netdev user,id=n0 \
     -device virtio-net-pci,netdev=n0 \
     -vnc 127.0.0.1:1 \
     -daemonize
   ```

   Key flags:

   - `-drive file=/dev/sda,format=raw,if=virtio` — passes the real disk
     directly to the installer, which sees it as `/dev/vda`. The installer's
     partitioner will do LUKS + LVM on this device, i.e., on your actual
     Hetzner disk.
   - `-vnc 127.0.0.1:1` — VNC on rescue port 5901, which your SSH tunnel
     forwards to laptop localhost 5901.
   - `-daemonize` — qemu runs in the background; the installer continues
     running even if the SSH session has hiccups.

7. Point your VNC client at **`localhost:5901`**. The Debian installer boot
   menu should appear. Press **Enter** (or wait for the auto-boot) to start
   the installer.

8. The installer runs the Llamenos preseed automatically. When it prompts for
   the **LUKS encryption passphrase**, type a strong one (30+ chars, 5+ random
   words). Confirm. Wait ~5–10 minutes for the install to finish.

9. When the installer says it is rebooting: inside the rescue system, kill the
   qemu process instead of letting it reboot inside the nested VM:

   ```bash
   pkill qemu-system-x86_64
   ```

10. Disable the Rescue System and power-cycle: in the Hetzner Console, server
    detail → **Power Off** → **Power On**. The VM boots from its real disk
    (which now contains the installed Llamenos system with LUKS + dropbear).

11. Continue to [Subsequent boots — dropbear unlock](#subsequent-boots--dropbear-unlock-default) below.

**Troubleshooting Path B:**

- **VNC shows a blank screen** — wait 30 seconds; the installer's kernel takes
  a moment to boot. If it's still blank, kill qemu, re-run with `-serial
  stdio` instead of `-vnc` and watch the boot log.
- **qemu says `Could not access KVM kernel module: Permission denied`** — you
  are not running as root, or nested KVM is disabled. Rescue is always root;
  Hetzner Cloud supports nested KVM on all CPX tiers. If still failing, drop
  `-enable-kvm` (installer will run slower but still work).
- **Network doesn't work after first real boot** — the installed Debian's
  `/etc/network/interfaces` expects `eth0` to get DHCP. If Hetzner exposes the
  interface under a different name (`ens3`, `enp1s0`), boot rescue again and
  rename the interface in `/etc/network/interfaces`. Systemd's predictable
  naming should give the same name in qemu and native boot, but verify.
- **Dropbear doesn't answer on port 2222 after reboot** — likely the same
  network issue. Boot rescue, mount the installed LV, check
  `/etc/network/interfaces` and the initramfs's
  `/conf/conf.d/initramfs.conf`.

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
