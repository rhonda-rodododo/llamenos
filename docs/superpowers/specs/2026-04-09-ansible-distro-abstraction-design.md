# Ansible Distro Abstraction — Design Spec

**Date:** 2026-04-09
**Status:** Draft (pending user review)
**Companion spec:** [2026-04-09-fde-iso-builder-design.md](./2026-04-09-fde-iso-builder-design.md)

## Overview

The current Ansible playbook in `deploy/ansible/` hard-codes Ubuntu 22.04/24.04. The Docker role pulls `download.docker.com/linux/ubuntu/gpg` directly, has a task literally named *"Get Ubuntu codename"*, and the Tart VM test infra clones `cirruslabs/ubuntu:24.04`. Nothing else in the eight roles is distro-gated, but the implicit Ubuntu assumption means a Debian, RHEL, or other Debian-derivative target would fail in the Docker role.

This spec refactors the Ansible playbook to support **Debian 12, Debian 13, Ubuntu 22.04, and Ubuntu 24.04** as first-class targets — all members of the Debian OS family — with a deliberate, documented extension path for RHEL family later. The work is modeled on `spantaleev/matrix-docker-ansible-deploy` (dispatcher pattern, vendored galaxy roles) and `nodiscc/xsrv` / `systemli` (preflight asserts, factored repo setup).

This is **PR 1** of a two-PR effort. The companion FDE ISO builder spec depends on this PR landing first (or co-developing) so that ISOs built from Debian boot into a system the Ansible playbook can actually configure.

---

## Goals

1. **Add Debian 12 + Debian 13 as supported targets** without breaking existing Ubuntu 22/24 deployments.
2. **Eliminate every hard-coded distro reference** in role tasks. Distro-specific values live in vars files or are sourced from `ansible_facts`.
3. **Fail fast and friendly** when an operator runs the playbook against an unsupported distro/version, with a clear allowlist message.
4. **Make RHEL-family addition straightforward later** — adding `vars/RedHat.yml` and `tasks/install_redhat.yml` files should be all that's required, with no churn to existing role bodies.
5. **Keep PR scope tight.** Refactor only what is required to add Debian; do not rewrite roles for the sake of cleanliness. The simplifier pass comes later.
6. **Update test infra to validate the matrix.** Tart VM tests must run against at least one Debian target in addition to Ubuntu 24.04.

## Non-goals

- RHEL/Fedora/Rocky/Alma support in this PR. The structure must accommodate it; the implementation does not deliver it.
- Arch / openSUSE / Alpine support. Out of scope indefinitely unless requested.
- Replacing every custom role with galaxy equivalents. Only the Docker role is replaced (see §3); the rest are refactored in place.
- Containerizing the playbook (e.g., switching to Docker-based component installs like the `mash` jitsi role does). Native packages remain the model.

## Threat model + security constraints

- **Supply-chain integrity for galaxy dependencies.** Replacing the hand-rolled Docker role with `geerlingguy.docker` introduces a community dependency. Pin to a specific git tag *and* SHA in `requirements.yml`. Vendor the role into `roles/galaxy/` (gitignored) at `ansible-galaxy install` time.
- **No reduction in hardening posture.** The refactored Debian path must produce the same firewall rules, sysctl settings, fail2ban jails, SSH config, and unattended-upgrade behavior as the current Ubuntu path. Tart VM tests verify this.
- **Preflight must run before any role applies changes.** A misconfigured target should never get partway through hardening.

---

## 1. Repository Layout Changes

```
deploy/ansible/
├── requirements.yml             # NEW — pins geerlingguy.docker (and any future galaxy roles)
├── ansible.cfg                  # MODIFIED — add roles_path = roles:roles/galaxy
├── .gitignore                   # MODIFIED — ignore roles/galaxy/
├── README.md                    # MODIFIED — supported distros section
├── setup.yml                    # MODIFIED — preflight runs first
├── playbooks/
│   ├── preflight.yml            # MODIFIED — adds distro allowlist assert
│   └── harden.yml               # MODIFIED — drops `roles/docker`, uses geerlingguy
├── roles/
│   ├── common/                  # REFACTORED — dispatcher pattern
│   ├── ssh-hardening/           # REFACTORED — vars/Debian.yml
│   ├── firewall/                # REFACTORED — dispatcher pattern, vars file
│   ├── kernel-hardening/        # REFACTORED — vars file (for sysctl path differences if any)
│   ├── fail2ban/                # REFACTORED — dispatcher pattern, vars file
│   ├── docker/                  # DELETED — replaced by geerlingguy.docker
│   ├── geoip/                   # REFACTORED — vars file (only package name varies)
│   ├── kamailio/                # NOT TOUCHED — see Open Questions §10; deferred to follow-up PR
│   ├── llamenos/                # REFACTORED — uses ansible.builtin.package; LUKS task already family-agnostic
│   ├── backup/                  # REFACTORED — vars file (rclone install differs slightly)
│   └── galaxy/                  # CONVENTION — gitignored, populated by `ansible-galaxy install`
```

> **Note:** `roles/kamailio/` is intentionally untouched in this PR. Until the follow-up PR adds Debian-family support to it, the preflight allowlist for hosts that include the Kamailio role gets a temporary `kamailio_supported_distribution: Ubuntu` guard documented inline. See §10 for the rationale.
```

## 2. Preflight: Distro Allowlist Assert

The existing `playbooks/preflight.yml` validates required vars. Extend it with a distro-version allowlist that runs *before* any role does work, with a friendly error listing supported combinations.

### Implementation

`deploy/ansible/playbooks/preflight.yml` gains a new task block:

```yaml
- name: Validate target distribution
  hosts: all
  gather_facts: true
  tasks:
    - name: Assert supported distribution
      ansible.builtin.assert:
        that:
          - ansible_facts.os_family == 'Debian'
          - >
            (ansible_facts.distribution == 'Debian' and ansible_facts.distribution_major_version | int >= 12)
            or
            (ansible_facts.distribution == 'Ubuntu' and ansible_facts.distribution_release in supported_ubuntu_releases)
        fail_msg: |
          Unsupported target distribution: {{ ansible_facts.distribution }} {{ ansible_facts.distribution_version }} ({{ ansible_facts.distribution_release }})

          Supported targets:
            - Debian 12 (bookworm) or newer
            - Ubuntu 22.04 (jammy)
            - Ubuntu 24.04 (noble)

          RHEL-family support is planned but not yet implemented.
        success_msg: "Target {{ ansible_facts.distribution }} {{ ansible_facts.distribution_version }} is supported."
      vars:
        supported_ubuntu_releases:
          - jammy
          - noble
```

The allowlist is intentionally inline rather than a separate vars file — it changes rarely, and inlining makes the supported set obvious to anyone reading the playbook. When RHEL lands, the assert grows an `or ansible_facts.os_family == 'RedHat' and ...` branch.

### Why a single source of truth matters

The README section listing supported distros (§9) must agree with this assert. To prevent drift, both reference each other in comments. No lint enforcement — it's a 4-line list, manual review is fine.

---

## 3. Replace Custom Docker Role with `geerlingguy.docker`

The current `roles/docker/` is ~120 lines of Ubuntu-specific Docker CE installation, daemon hardening (`userns-remap`, `no-new-privileges`), and Compose plugin setup. Replacing it with `geerlingguy.docker` from Galaxy gives us multi-distro support for free, and the role is actively maintained against current Docker CE releases.

### Implementation

`deploy/ansible/requirements.yml` (new file):

```yaml
---
roles:
  - name: geerlingguy.docker
    src: https://github.com/geerlingguy/ansible-role-docker
    version: 8.0.0   # pinned tag; SHA verification via requirements-locked.yml below
collections:
  - name: community.docker
    version: ">=3.10.0,<4.0.0"
  - name: ansible.posix
    version: ">=1.5.0,<2.0.0"
```

`deploy/ansible/.gitignore` adds:
```
roles/galaxy/
```

`deploy/ansible/ansible.cfg` adds (or extends):
```ini
[defaults]
roles_path = roles:roles/galaxy
collections_paths = collections
```

Operators run once after pulling:
```bash
cd deploy/ansible
ansible-galaxy install -r requirements.yml -p roles/galaxy/
ansible-galaxy collection install -r requirements.yml
```

The `justfile` gets a `bootstrap` recipe that runs both, so first-time setup is `just bootstrap && just deploy-demo`.

### Hardening parity

Our current Docker role configures:
- `userns-remap=default`
- `no-new-privileges=true`
- `live-restore=true`
- `log-driver=json-file` with rotation limits
- DOCKER-USER iptables chain interaction (none — handled by ufw role)

`geerlingguy.docker` exposes all of these via vars. We pass them in `group_vars/all/docker.yml` (new):

```yaml
docker_daemon_options:
  userns-remap: default
  no-new-privileges: true
  live-restore: true
  log-driver: json-file
  log-opts:
    max-size: "10m"
    max-file: "5"
docker_users: []                       # do not auto-add users to docker group
docker_install_compose_plugin: true
docker_compose_package: docker-compose-plugin
docker_compose_package_state: present
```

### Verification

A Tart VM smoke test asserts:
1. `docker info` returns the expected daemon options
2. `docker compose version` works
3. `id <app-user>` shows the user is *not* in the `docker` group

If any of these fails on Debian 12, Debian 13, or Ubuntu 24.04, the swap is reverted.

### Rollback path

If `geerlingguy.docker` proves unsuitable (e.g., a regression we can't tolerate), we restore `roles/docker/` from git history and fork the Docker role internally. The custom role's last commit before deletion is tagged as `pre-galaxy-docker` for one-command revert.

### Dependency review cadence

`geerlingguy.docker` is pinned by tag and SHA. A monthly review (calendar reminder, owned by whoever holds the security hat) checks for new releases and reads the changelog. Same cadence applies to any future galaxy dependency.

---

## 4. Dispatcher Pattern for Distro-Specific Tasks

Adopted from matrix-docker-ansible-deploy. Each role that touches packages or services gains a `tasks/install.yml` (or equivalent split file) that includes a distro-family-specific sibling:

```yaml
# roles/common/tasks/install.yml
- name: Include Debian-family install tasks
  ansible.builtin.include_tasks: install_debian.yml
  when: ansible_facts.os_family == 'Debian'

- name: Include RedHat-family install tasks
  ansible.builtin.include_tasks: install_redhat.yml
  when: ansible_facts.os_family == 'RedHat'
```

Today only `install_debian.yml` is committed. The `install_redhat.yml` file is added when RHEL support lands; the dispatcher already handles dispatch.

### Roles that get the dispatcher

- `common` — `apt-get update` is Debian-family-specific; replace with dispatcher.
- `firewall` — `ufw` is Debian-family-specific; on RHEL we'd use `firewalld`.
- `fail2ban` — package name is the same but service name differs (`fail2ban` vs `fail2ban-server`).
- `geoip` — uses `download-dbip.sh`; the only distro-specific bit is `wget` vs `curl` install.

`kamailio` is **not** refactored in this PR — see §10 Open Questions.

### Roles that do NOT get the dispatcher (yet)

- `ssh-hardening` — pure config templating + service restart. `openssh-server` package + `ssh.service` unit names differ between Debian and RHEL, so a `vars/{OsFamily}.yml` file is enough — no task split needed.
- `kernel-hardening` — pure sysctl drop-ins, no package install. Same vars-file approach.
- `llamenos` — already family-agnostic. The LUKS task block uses `apt:` directly; switch to `ansible.builtin.package` and move package name to a vars file.
- `backup` — installs `rclone` via the upstream installer script, identical across distros.

The principle: **dispatcher for tasks that diverge structurally; vars files for tasks that just need different names.**

---

## 5. Per-Distro Vars Files

Roles that need package or service name overrides gain `vars/Debian.yml` (and a `vars/main.yml` fallback for shared defaults). Loaded via `first_found` so distro-specific files automatically override family-specific ones when added later.

### Implementation pattern

`roles/firewall/tasks/main.yml` first task:

```yaml
- name: Load OS-specific vars
  ansible.builtin.include_vars: "{{ lookup('ansible.builtin.first_found', params) }}"
  vars:
    params:
      files:
        - "{{ ansible_facts.distribution }}.yml"     # e.g., Ubuntu.yml
        - "{{ ansible_facts.os_family }}.yml"        # e.g., Debian.yml
        - main.yml                                   # fallback
      paths:
        - "{{ role_path }}/vars"
```

`roles/firewall/vars/Debian.yml`:
```yaml
firewall_package: ufw
firewall_service: ufw
firewall_default_incoming: deny
firewall_default_outgoing: allow
```

`roles/firewall/vars/main.yml` (defaults that apply everywhere):
```yaml
firewall_allowed_tcp_ports:
  - 22
  - 80
  - 443
```

`roles/firewall/tasks/install_debian.yml`:
```yaml
- name: Install firewall package
  ansible.builtin.apt:
    name: "{{ firewall_package }}"
    state: present
    update_cache: true
    cache_valid_time: 3600
```

Task bodies elsewhere reference `{{ firewall_service }}` via `ansible.builtin.systemd` — zero distro conditionals.

### Vars file inventory

Role-by-role list of vars-file additions:

| Role | Variables abstracted |
|------|---------------------|
| `common` | `base_packages` (list), `chrony_service`, `unattended_upgrades_package` |
| `ssh-hardening` | `sshd_package`, `sshd_service`, `sshd_config_path` |
| `firewall` | `firewall_package`, `firewall_service` |
| `fail2ban` | `fail2ban_package`, `fail2ban_service`, `fail2ban_jail_path` |
| `kernel-hardening` | `sysctl_drop_in_dir` (almost always `/etc/sysctl.d`, kept as a var for safety) |
| `geoip` | `geoip_install_packages` (the small set of packages `download-dbip.sh` needs) |
| `backup` | `backup_install_packages` |
| `llamenos` | `cryptsetup_package` (already abstracted via `ansible.builtin.apt` → switch to `ansible.builtin.package` + var) |

The Ubuntu values match the current behavior exactly (pulled directly from existing role tasks); no behavior change for Ubuntu targets.

---

## 6. Use `ansible.builtin.package` Instead of `ansible.builtin.apt`

Where the only thing distro-specific about a task is the package manager module, replace `apt:` with `package:` and let Ansible auto-detect. Cache management (`update_cache`, `cache_valid_time`) stays in `install_debian.yml` because it's apt-specific.

**Scope:** all `apt:` invocations in roles, except the cache-update task in `common` and any apt-specific options like `force_apt_get` or `dpkg_options`. Audit:

```bash
grep -rn "ansible.builtin.apt:" deploy/ansible/roles/
```

Each match is either (a) replaced with `ansible.builtin.package:` if it's a simple install, or (b) moved into `install_debian.yml` if it uses apt-specific options.

---

## 7. Test Infrastructure Updates

The Tart VM test in `deploy/ansible/justfile:117` currently clones a single Ubuntu 24.04 image. Extend it to a matrix:

```just
test-matrix:
    #!/usr/bin/env bash
    set -euo pipefail
    for image in \
        ghcr.io/cirruslabs/ubuntu:24.04 \
        ghcr.io/cirruslabs/debian:13 \
    ; do
        name="llamenos-test-$(basename "$image" | tr ':' '-')"
        ssh mac "source ~/.zprofile && tart clone $image $name && tart set $name --cpu 4 --memory 8192 --disk-size 20"
        # ... existing test flow against $name
    done
```

### Test matrix priority

| Image | Priority | Notes |
|-------|----------|-------|
| Ubuntu 24.04 (noble) | P0 | Current production target |
| Debian 13 (trixie)   | P0 | New primary target for ISO |
| Debian 12 (bookworm) | P1 | Common stable target on existing VPSes |
| Ubuntu 22.04 (jammy) | P1 | LTS, still common |

P0 runs on every CI pass affecting `deploy/ansible/`. P1 runs nightly + on release tags.

### Cirruslabs image availability (must verify during implementation)

The plan assumes `cirruslabs/ubuntu:22.04`, `cirruslabs/ubuntu:24.04`, `cirruslabs/debian:12`, and `cirruslabs/debian:13` are all published and current. **The implementer must verify each tag at `ghcr.io/cirruslabs/<image>:<tag>` before relying on it** — `gh api` against the GHCR registry, or a `tart pull` smoke run. If a tag is missing, that row drops to "manual test" against a generic Debian/Ubuntu cloud image until cirruslabs publishes it. Do not silently swap to another base image; record the gap in the PR description.

### Smoke assertions

After `setup.yml` runs against a fresh image, the test asserts (via SSH):

1. `ufw status` shows incoming default deny + 22/80/443 allow
2. `systemctl is-active fail2ban` returns `active`
3. `systemctl is-active docker` returns `active`
4. `docker info --format '{{.SecurityOptions}}'` includes `name=userns`
5. `sshd -T | grep -E '^(passwordauthentication|permitrootlogin)'` shows both `no`
6. `sysctl net.ipv4.tcp_syncookies` returns `1`
7. `apt list --installed unattended-upgrades 2>/dev/null` shows the package present

These are the same regardless of distro and verify hardening parity.

---

## 8. Documentation Updates

### `deploy/ansible/README.md`

New "Supported targets" section near the top:

```markdown
## Supported targets

This playbook is tested on:

- **Debian 12** (bookworm) — supported
- **Debian 13** (trixie) — primary target for new deployments
- **Ubuntu 22.04** (jammy) — supported
- **Ubuntu 24.04** (noble) — supported

Other distributions, including RHEL family, are not yet supported. The
preflight check will fail with a clear error if you try.
```

### `deploy/ansible/justfile`

Add a `bootstrap` recipe that runs `ansible-galaxy install` for both roles and collections from `requirements.yml`. Document it in the README's quickstart.

### `CLAUDE.md`

Update the "Tech Stack" section's deployment line to read `**Deployment**: VPS (Ansible/Docker), Debian 12+/Ubuntu 22.04+, EU/GDPR-compatible hosting`. Add a one-line note under "Gotchas" that role refactors must use the dispatcher pattern.

### `docs/deployment/`

If a generic "deploying with Ansible" doc exists, update it. If not, defer documentation creation to the FDE ISO PR which has its own deployment doc.

---

## 9. Migration & Rollout

This is a refactor with no new user-facing surface. Rollout plan:

1. Land the dispatcher refactor in this PR. CI runs the full Tart matrix.
2. Manually verify against a real Debian 13 VPS at 1984 Hosting (or any provider). Document the run in the PR description.
3. Once merged, update the demo deployment to Debian 13 in a follow-up PR. Existing Ubuntu demos keep working untouched.
4. The FDE ISO builder PR (companion spec) lands next, producing Debian 13 ISOs that the Ansible playbook can configure end-to-end.

No data migration. No env var changes. No version bump (it's a deploy-only change).

---

## 10. Risks and Open Questions

### Risks

- **`geerlingguy.docker` regression.** Mitigated by pinned version, monthly review cadence, and tagged rollback commit. The role is downloaded > 50M times on Galaxy and is one of the most actively maintained roles in the ecosystem; risk is low but non-zero.
- **Dispatcher pattern adds indirection.** Operators reading the playbook for the first time will need to chase one extra include to find what runs. Mitigated by consistent naming (`install.yml` → `install_{family}.yml`) and a one-paragraph explanation in the README.
- **Tart matrix increases CI cost.** Two P0 images double the Mac runner time for ansible changes. Mitigated by the existing `changes.yml` filter — non-Ansible PRs don't trigger the matrix.
- **Vars-file lookup ordering bugs.** `first_found` is well-tested but easy to misconfigure (wrong path, wrong filename). Mitigated by a small test case in `tests/ansible-vars-lookup.test.yml` that asserts the loaded values match expectations on each tested distro.

### Open questions

- **Should `kamailio` get the dispatcher in this PR or a follow-up?** Kamailio is the most distro-divergent role (different repo, different package set). Including it doubles the surface area of this PR. **Recommendation: defer to a follow-up PR specifically for SIP-related distro support.** This PR's preflight allowlist already includes Debian; if the kamailio role breaks on Debian, the role gets a `when: ansible_distribution == 'Ubuntu'` guard and a clear error. Better to ship the core hardening on Debian and chase Kamailio separately.
- **`geerlingguy.docker` vs vendoring inline?** Vendoring (copying the role into our repo as-is, removing the galaxy dependency) is an option that trades supply-chain control for maintenance burden. **Recommendation: galaxy dependency for now.** Revisit if Geerling ever stops maintaining or makes a breaking change.
- **Ubuntu 20.04 (focal)?** Out of LTS standard support April 2025; ESM only. **Recommendation: do not add to allowlist.** Operators on focal should upgrade to jammy.

---

## Acceptance Criteria

This PR is done when:

- [ ] `requirements.yml` exists, pins `geerlingguy.docker` to a specific version + SHA
- [ ] `roles/galaxy/` is gitignored; `just bootstrap` populates it
- [ ] `roles/docker/` is deleted; `harden.yml` references `geerlingguy.docker`
- [ ] `playbooks/preflight.yml` asserts the supported distro allowlist with a friendly message
- [ ] Every role with package installs uses the dispatcher pattern OR a vars file (per §4)
- [ ] Every `ansible.builtin.apt:` call is justified (cache update or apt-specific option) or replaced with `ansible.builtin.package:`
- [ ] Tart VM test runs against Ubuntu 24.04 + Debian 13 in CI on every Ansible-touching PR
- [ ] All seven smoke assertions in §7 pass on both P0 distros
- [ ] `deploy/ansible/README.md` lists supported distros and matches the preflight allowlist
- [ ] `CLAUDE.md` deployment notes updated
- [ ] Manually verified against a real Debian 13 VPS; PR description includes the run log
- [ ] No regression in Ubuntu 24.04 deployment (verified via Tart and demo deploy)
