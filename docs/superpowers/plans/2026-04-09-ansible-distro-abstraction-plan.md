# Ansible Distro Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `deploy/ansible/` to support Debian 12, Debian 13, Ubuntu 22.04, and Ubuntu 24.04 as first-class targets, with a documented extension path for RHEL family later.

**Architecture:** Adopt the matrix-docker-ansible-deploy "dispatcher" pattern (`tasks/install_{family}.yml`) plus per-distro vars files loaded via `first_found`. Replace the hand-rolled `roles/docker/` with `geerlingguy.docker` from Galaxy, pinned in `requirements.yml`. Add a fail-fast preflight assert listing supported distros.

**Tech Stack:** Ansible 2.16+, geerlingguy.docker 8.0.0, ansible-lint, Tart VMs (cirruslabs base images), `bats-core` for any shell helpers, ansible.builtin.* + community.docker collections.

**Spec:** [`docs/superpowers/specs/2026-04-09-ansible-distro-abstraction-design.md`](../specs/2026-04-09-ansible-distro-abstraction-design.md)

**Branch:** Create a fresh worktree for this PR — do NOT use the `feat/fde-iso-builder` branch. Suggested branch name: `feat/ansible-distro-abstraction`. The companion ISO PR depends on this PR's preflight existing in `playbooks/preflight.yml`.

---

## File Structure

### Created files

| Path | Responsibility |
|------|----------------|
| `deploy/ansible/requirements.yml` | Pin galaxy roles + collections |
| `deploy/ansible/.gitignore` | Ignore `roles/galaxy/` |
| `deploy/ansible/group_vars/all/docker.yml` | `geerlingguy.docker` configuration |
| `deploy/ansible/roles/common/tasks/install.yml` | Distro dispatcher entrypoint |
| `deploy/ansible/roles/common/tasks/install_debian.yml` | Debian-family install steps |
| `deploy/ansible/roles/common/vars/Debian.yml` | Debian-family package/service names |
| `deploy/ansible/roles/common/vars/main.yml` | Cross-distro defaults |
| `deploy/ansible/roles/firewall/tasks/install.yml` | Dispatcher |
| `deploy/ansible/roles/firewall/tasks/install_debian.yml` | UFW install |
| `deploy/ansible/roles/firewall/vars/Debian.yml` | UFW vars |
| `deploy/ansible/roles/firewall/vars/main.yml` | Allowed-port defaults |
| `deploy/ansible/roles/fail2ban/tasks/install.yml` | Dispatcher |
| `deploy/ansible/roles/fail2ban/tasks/install_debian.yml` | fail2ban install |
| `deploy/ansible/roles/fail2ban/vars/Debian.yml` | fail2ban vars |
| `deploy/ansible/roles/ssh-hardening/vars/Debian.yml` | SSH package/service names |
| `deploy/ansible/roles/kernel-hardening/vars/Debian.yml` | sysctl path |
| `deploy/ansible/roles/geoip/tasks/install.yml` | Dispatcher |
| `deploy/ansible/roles/geoip/tasks/install_debian.yml` | wget/curl install |
| `deploy/ansible/roles/geoip/vars/Debian.yml` | install package list |
| `deploy/ansible/roles/backup/vars/Debian.yml` | rclone install vars |
| `deploy/ansible/roles/llamenos/vars/Debian.yml` | cryptsetup package |
| `tests/ansible-vars-lookup.test.yml` | Smoke test for first_found ordering |

### Modified files

| Path | Change |
|------|--------|
| `deploy/ansible/ansible.cfg` | Add `roles_path = roles:roles/galaxy` |
| `deploy/ansible/setup.yml` | Re-order so preflight runs first (it already does) — verify |
| `deploy/ansible/playbooks/preflight.yml` | Add distro allowlist assert task |
| `deploy/ansible/playbooks/harden.yml` | Replace `role: docker` with `role: geerlingguy.docker` |
| `deploy/ansible/roles/common/tasks/main.yml` | Use `include_tasks: install.yml`; switch `apt:` to `package:` where safe |
| `deploy/ansible/roles/firewall/tasks/main.yml` | Use dispatcher; reference `firewall_*` vars |
| `deploy/ansible/roles/fail2ban/tasks/main.yml` | Use dispatcher; reference `fail2ban_*` vars |
| `deploy/ansible/roles/ssh-hardening/tasks/main.yml` | Reference `sshd_*` vars |
| `deploy/ansible/roles/kernel-hardening/tasks/main.yml` | Reference `sysctl_drop_in_dir` var |
| `deploy/ansible/roles/geoip/tasks/main.yml` | Use dispatcher |
| `deploy/ansible/roles/backup/tasks/main.yml` | Reference `backup_install_packages` var |
| `deploy/ansible/roles/llamenos/tasks/luks.yml` | Switch `apt:` to `package:` |
| `deploy/ansible/roles/llamenos/tasks/main.yml` | Audit and switch `apt:` → `package:` where safe |
| `deploy/ansible/justfile` | Add `bootstrap` recipe; extend test matrix |
| `deploy/ansible/README.md` | Add "Supported targets" section |
| `CLAUDE.md` | Update deployment line + dispatcher gotcha |

### Deleted files

| Path | Reason |
|------|--------|
| `deploy/ansible/roles/docker/` (entire directory) | Replaced by `geerlingguy.docker` from Galaxy |

---

## Task 0: Create the worktree and verify clean baseline

This work belongs on its own branch, NOT on the `feat/fde-iso-builder` branch where the specs were committed.

- [ ] **Step 1: Create worktree as a sibling directory**

```bash
cd /media/rikki/recover2/projects/llamenos-hotline
git worktree add ../llamenos-hotline-ansible-distro -b feat/ansible-distro-abstraction main
cd ../llamenos-hotline-ansible-distro
```

- [ ] **Step 2: Verify clean baseline by running ansible-lint**

```bash
cd deploy/ansible
ansible-lint .
```

Expected: passes (or known warnings only). If it fails on `main`, stop and fix the baseline failure first — do not start refactoring on a broken baseline.

- [ ] **Step 3: Commit the empty starting state for traceability**

No-op commit not required; baseline is git HEAD.

---

## Task 1: Add `requirements.yml` and bootstrap plumbing

**Files:**
- Create: `deploy/ansible/requirements.yml`
- Create: `deploy/ansible/.gitignore` (if missing) or modify
- Modify: `deploy/ansible/ansible.cfg`
- Modify: `deploy/ansible/justfile`

- [ ] **Step 1: Write `requirements.yml`**

Create `deploy/ansible/requirements.yml`:

```yaml
---
# Galaxy roles vendored into roles/galaxy/ via `just bootstrap`
# Pinned by version tag. Verify SHA before bumping.
roles:
  - name: geerlingguy.docker
    src: https://github.com/geerlingguy/ansible-role-docker
    version: 8.0.0  # https://github.com/geerlingguy/ansible-role-docker/releases/tag/8.0.0

# Galaxy collections used by playbooks. Pinned to compatible ranges.
collections:
  - name: community.docker
    version: ">=3.10.0,<4.0.0"
  - name: ansible.posix
    version: ">=1.5.0,<2.0.0"
  - name: community.general
    version: ">=8.0.0,<11.0.0"
```

- [ ] **Step 2: Add `roles/galaxy/` to gitignore**

Check whether `deploy/ansible/.gitignore` exists:

```bash
cat deploy/ansible/.gitignore 2>/dev/null
```

If it exists, append `roles/galaxy/` and `collections/` if missing. If not, create it:

```bash
cat > deploy/ansible/.gitignore <<'EOF'
# Galaxy roles vendored at bootstrap time — see requirements.yml
roles/galaxy/
collections/

# Local vault password file
.vault-password

# Local vars overrides
vars.local.yml
inventory.local.yml
EOF
```

- [ ] **Step 3: Update `ansible.cfg` to include `roles/galaxy/` in the roles path**

Read `deploy/ansible/ansible.cfg` first.

If a `[defaults]` section already exists, add `roles_path = roles:roles/galaxy` (if missing). If no `[defaults]` exists, prepend:

```ini
[defaults]
roles_path = roles:roles/galaxy
collections_paths = collections
inventory = inventory.yml
```

Preserve existing keys (host_key_checking, retry_files_enabled, etc.).

- [ ] **Step 4: Add `bootstrap` recipe to the justfile**

Read `deploy/ansible/justfile`. Add this recipe near the top, before `deploy-demo`:

```just
# Install galaxy roles + collections from requirements.yml
# Run once after a fresh checkout, then re-run when requirements.yml changes
bootstrap:
    ansible-galaxy install -r requirements.yml -p roles/galaxy/ --force
    ansible-galaxy collection install -r requirements.yml --upgrade
```

- [ ] **Step 5: Run the bootstrap to vendor `geerlingguy.docker` and verify**

```bash
cd deploy/ansible
just bootstrap
ls roles/galaxy/geerlingguy.docker/tasks/main.yml
```

Expected: file exists. The directory should NOT show up in `git status` (because of the .gitignore added in Step 2).

```bash
git status deploy/ansible/roles/galaxy
```

Expected: no output (ignored).

- [ ] **Step 6: Commit**

```bash
git add deploy/ansible/requirements.yml deploy/ansible/.gitignore \
        deploy/ansible/ansible.cfg deploy/ansible/justfile
git commit -m "ansible: add requirements.yml and bootstrap plumbing"
```

---

## Task 2: Add the distro allowlist preflight assert

**Files:**
- Modify: `deploy/ansible/playbooks/preflight.yml`

- [ ] **Step 1: Read the current preflight to understand its shape**

```bash
cat deploy/ansible/playbooks/preflight.yml
```

Note: it currently validates required vars. We're adding a new task block that runs first.

- [ ] **Step 2: Add the distro allowlist assert task**

Add this task block at the top of the existing `tasks:` list (BEFORE the existing required-vars validation), changing `gather_facts: false` to `true` if needed. The assert needs facts.

```yaml
- name: Validate target distribution before any role runs
  hosts: all
  gather_facts: true
  tasks:
    - name: Assert supported distribution
      ansible.builtin.assert:
        that:
          - ansible_facts.os_family == 'Debian'
          - >
            (
              ansible_facts.distribution == 'Debian'
              and ansible_facts.distribution_major_version | int >= 12
            )
            or
            (
              ansible_facts.distribution == 'Ubuntu'
              and ansible_facts.distribution_release in supported_ubuntu_releases
            )
        fail_msg: |
          Unsupported target distribution.

          Detected: {{ ansible_facts.distribution }} {{ ansible_facts.distribution_version }} ({{ ansible_facts.distribution_release | default('unknown') }})

          Supported targets:
            - Debian 12 (bookworm) or newer
            - Ubuntu 22.04 (jammy)
            - Ubuntu 24.04 (noble)

          RHEL-family support is planned but not yet implemented.
          See deploy/ansible/README.md for the full supported list.
        success_msg: "Target {{ ansible_facts.distribution }} {{ ansible_facts.distribution_version }} is supported."
      vars:
        supported_ubuntu_releases:
          - jammy
          - noble
      tags: always
```

If the existing preflight is structured as a single play with multiple task blocks, add the assert as the first task in that play and set `gather_facts: true` on it.

- [ ] **Step 3: Lint the preflight**

```bash
cd deploy/ansible
ansible-lint playbooks/preflight.yml
```

Expected: no errors. If there are warnings, address them.

- [ ] **Step 4: Smoke test against the localhost inventory**

```bash
ansible-playbook playbooks/preflight.yml -i 'localhost,' -c local --check
```

On a Debian/Ubuntu host: expected to pass. On any other host: expected to fail with the friendly message. If you're not on a Debian-family host, simulate with:

```bash
ansible-playbook playbooks/preflight.yml -i 'localhost,' -c local --check \
  -e 'ansible_facts={"os_family":"RedHat","distribution":"Rocky","distribution_version":"9","distribution_major_version":"9"}'
```

Expected: fails with the friendly fail_msg. (Note: ansible_facts is gathered, so the override may need a different injection — fall back to running on a real Debian VM if local override doesn't work.)

- [ ] **Step 5: Commit**

```bash
git add deploy/ansible/playbooks/preflight.yml
git commit -m "ansible: add distro allowlist preflight assert"
```

---

## Task 3: Replace custom `roles/docker/` with `geerlingguy.docker`

**Files:**
- Delete: `deploy/ansible/roles/docker/` (entire directory)
- Create: `deploy/ansible/group_vars/all/docker.yml`
- Modify: `deploy/ansible/playbooks/harden.yml`

- [ ] **Step 1: Read the current `roles/docker/tasks/main.yml` and capture the daemon options**

```bash
cat deploy/ansible/roles/docker/tasks/main.yml
cat deploy/ansible/roles/docker/handlers/main.yml 2>/dev/null
```

Note these values for the next step (we want exact parity):
- `userns-remap` — current value
- `no-new-privileges` — current value
- `live-restore` — current value
- `log-driver`, `log-opts` — current values
- Whether the role adds users to the docker group (it should NOT — the deploy user uses sudo to invoke docker)

- [ ] **Step 2: Create `group_vars/all/docker.yml` to configure geerlingguy.docker**

Create the directory if needed:

```bash
mkdir -p deploy/ansible/group_vars/all
```

Create `deploy/ansible/group_vars/all/docker.yml`:

```yaml
---
# geerlingguy.docker configuration — preserves the hardening posture
# of the previous custom roles/docker/ role. See:
# https://github.com/geerlingguy/ansible-role-docker?tab=readme-ov-file#role-variables

# Install Docker CE (not docker.io) for current upstream
docker_edition: ce
docker_packages_state: present
docker_install_compose: false           # legacy v1 — we use the plugin
docker_install_compose_plugin: true
docker_compose_package: docker-compose-plugin
docker_compose_package_state: present

# Enable + start the daemon
docker_service_state: started
docker_service_enabled: true

# Hardening posture (parity with the deleted custom role)
docker_daemon_options:
  userns-remap: default
  no-new-privileges: true
  live-restore: true
  log-driver: json-file
  log-opts:
    max-size: "10m"
    max-file: "5"

# Do NOT add any users to the docker group; deploy user uses `sudo docker ...`
docker_users: []

# Restart on daemon config changes
docker_daemon_options_handler: restart docker
```

> If the previous role used different daemon options, copy them verbatim from your Step 1 notes. Parity with the previous role is required for the smoke tests to pass.

- [ ] **Step 3: Replace `role: docker` with `role: geerlingguy.docker` in the harden playbook**

Read `deploy/ansible/playbooks/harden.yml`. Find the `roles:` block. Replace:

```yaml
    - role: docker
      tags: [docker, harden]
```

with:

```yaml
    - role: geerlingguy.docker
      tags: [docker, harden]
```

- [ ] **Step 4: Delete the custom docker role**

```bash
git rm -r deploy/ansible/roles/docker/
```

- [ ] **Step 5: Verify the playbook still parses**

```bash
cd deploy/ansible
ansible-playbook playbooks/harden.yml --syntax-check -i inventory.example.yml
```

Expected: no syntax errors. If you see "role 'geerlingguy.docker' was not found", re-run `just bootstrap` from Task 1.

- [ ] **Step 6: Lint**

```bash
ansible-lint playbooks/harden.yml
```

Expected: no errors. Warnings about variables defined in `group_vars` are OK.

- [ ] **Step 7: Commit**

```bash
git add deploy/ansible/group_vars/all/docker.yml deploy/ansible/playbooks/harden.yml
git commit -m "ansible: replace custom docker role with geerlingguy.docker"
```

---

## Task 4: Refactor `common` role to dispatcher pattern

**Files:**
- Create: `deploy/ansible/roles/common/tasks/install.yml`
- Create: `deploy/ansible/roles/common/tasks/install_debian.yml`
- Create: `deploy/ansible/roles/common/vars/Debian.yml`
- Create: `deploy/ansible/roles/common/vars/main.yml`
- Modify: `deploy/ansible/roles/common/tasks/main.yml`

- [ ] **Step 1: Read the current `common` role tasks**

```bash
cat deploy/ansible/roles/common/tasks/main.yml
```

Identify the `apt:` calls and the things that are currently Debian-family-specific. Make a mental list:
- `apt: update_cache` (Debian-family-specific module)
- `apt: install base packages` (the package list itself is portable; the module is not)
- `community.general.timezone:` (portable)
- `ansible.builtin.locale_gen:` (portable, but locale-gen package may be distro-specific)
- `chrony` template (portable)
- `unattended-upgrades` config (Debian-family-specific package + path)

- [ ] **Step 2: Write `vars/main.yml` with cross-distro defaults**

Create `deploy/ansible/roles/common/vars/main.yml`:

```yaml
---
# Cross-distro defaults for the common role.
# Distro-specific overrides live in vars/{Family}.yml and are loaded via
# first_found in tasks/main.yml.

base_packages_common:
  - curl
  - gnupg
  - ca-certificates
  - rsync
  - sudo
  - htop
  - ncdu
  - tmux
  - jq
  - python3
  - python3-apt
```

- [ ] **Step 3: Write `vars/Debian.yml` with the Debian-family additions**

Create `deploy/ansible/roles/common/vars/Debian.yml`:

```yaml
---
# Debian-family overrides for the common role.
# Loaded by first_found when ansible_facts.os_family == 'Debian'.

base_packages_family:
  - apt-transport-https
  - software-properties-common
  - apt-listchanges
  - unattended-upgrades
  - vim-tiny

base_packages: "{{ base_packages_common + base_packages_family }}"

chrony_package: chrony
chrony_service: chrony
unattended_upgrades_package: unattended-upgrades
unattended_upgrades_config_path: /etc/apt/apt.conf.d/50unattended-upgrades
```

- [ ] **Step 4: Write `tasks/install.yml` (the dispatcher)**

Create `deploy/ansible/roles/common/tasks/install.yml`:

```yaml
---
- name: Include Debian-family install tasks
  ansible.builtin.include_tasks: install_debian.yml
  when: ansible_facts.os_family == 'Debian'

- name: Include RedHat-family install tasks (placeholder for future RHEL support)
  ansible.builtin.include_tasks: install_redhat.yml
  when: ansible_facts.os_family == 'RedHat'
```

- [ ] **Step 5: Write `tasks/install_debian.yml`**

Create `deploy/ansible/roles/common/tasks/install_debian.yml`:

```yaml
---
- name: Update apt cache
  ansible.builtin.apt:
    update_cache: true
    cache_valid_time: 3600

- name: Install base packages (Debian family)
  ansible.builtin.apt:
    name: "{{ base_packages }}"
    state: present
```

- [ ] **Step 6: Refactor `tasks/main.yml`**

Replace the contents of `deploy/ansible/roles/common/tasks/main.yml` with:

```yaml
---
# Common role: base packages, NTP, locale, unattended-upgrades
#
# Establishes a consistent, secure baseline across supported distros.
# See vars/{Family}.yml for distro-specific package lists and service names.

- name: Load OS-specific vars
  ansible.builtin.include_vars: "{{ lookup('ansible.builtin.first_found', params) }}"
  vars:
    params:
      files:
        - "{{ ansible_facts.distribution }}.yml"
        - "{{ ansible_facts.os_family }}.yml"
        - main.yml
      paths:
        - "{{ role_path }}/vars"

- name: Install base packages
  ansible.builtin.include_tasks: install.yml

- name: Set timezone
  community.general.timezone:
    name: "{{ timezone }}"

- name: Set locale
  ansible.builtin.locale_gen:
    name: "{{ locale }}"
    state: present

- name: Configure Chrony NTP servers
  ansible.builtin.template:
    src: chrony.conf.j2
    dest: /etc/chrony/chrony.conf
    owner: root
    group: root
    mode: "0644"
  notify: Restart chrony

- name: Enable and start Chrony
  ansible.builtin.systemd:
    name: "{{ chrony_service }}"
    enabled: true
    state: started

- name: Configure unattended-upgrades
  ansible.builtin.copy:
    dest: "{{ unattended_upgrades_config_path }}"
    owner: root
    group: root
    mode: "0644"
    content: |
      Unattended-Upgrade::Allowed-Origins {
              "${distro_id}:${distro_codename}";
              "${distro_id}:${distro_codename}-security";
              "${distro_id}ESMApps:${distro_codename}-apps-security";
              "${distro_id}ESM:${distro_codename}-infra-security";
      };
      Unattended-Upgrade::AutoFixInterruptedDpkg "true";
      Unattended-Upgrade::MinimalSteps "true";
      Unattended-Upgrade::Remove-Unused-Dependencies "true";
      Unattended-Upgrade::Automatic-Reboot "false";
```

> The `Allowed-Origins` block above is the existing Ubuntu-specific config. Verify against the current `tasks/main.yml` and copy any additional lines verbatim. ESM origins on Debian are no-ops (the keys don't exist) but harmless.

- [ ] **Step 7: Lint**

```bash
cd deploy/ansible
ansible-lint roles/common/
```

Expected: no errors.

- [ ] **Step 8: Syntax check the harden playbook**

```bash
ansible-playbook playbooks/harden.yml --syntax-check -i inventory.example.yml
```

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add deploy/ansible/roles/common/
git commit -m "ansible(common): refactor to dispatcher + per-family vars"
```

---

## Task 5: Refactor `firewall` role to dispatcher pattern

**Files:**
- Create: `deploy/ansible/roles/firewall/tasks/install.yml`
- Create: `deploy/ansible/roles/firewall/tasks/install_debian.yml`
- Create: `deploy/ansible/roles/firewall/vars/Debian.yml`
- Create: `deploy/ansible/roles/firewall/vars/main.yml`
- Modify: `deploy/ansible/roles/firewall/tasks/main.yml`

- [ ] **Step 1: Read the current firewall role**

```bash
cat deploy/ansible/roles/firewall/tasks/main.yml
cat deploy/ansible/roles/firewall/handlers/main.yml
```

Note: it uses `community.general.ufw` and installs `ufw` via `apt`.

- [ ] **Step 2: Write `vars/main.yml`**

Create `deploy/ansible/roles/firewall/vars/main.yml`:

```yaml
---
# Cross-distro defaults
firewall_default_incoming: deny
firewall_default_outgoing: allow
firewall_allowed_tcp_ports:
  - 22
  - 80
  - 443
firewall_logging: low
```

- [ ] **Step 3: Write `vars/Debian.yml`**

Create `deploy/ansible/roles/firewall/vars/Debian.yml`:

```yaml
---
# Debian-family: ufw
firewall_package: ufw
firewall_service: ufw
firewall_module: community.general.ufw
```

- [ ] **Step 4: Write `tasks/install.yml`**

Create `deploy/ansible/roles/firewall/tasks/install.yml`:

```yaml
---
- name: Include Debian-family install tasks
  ansible.builtin.include_tasks: install_debian.yml
  when: ansible_facts.os_family == 'Debian'
```

- [ ] **Step 5: Write `tasks/install_debian.yml`**

Create `deploy/ansible/roles/firewall/tasks/install_debian.yml`:

```yaml
---
- name: Install ufw
  ansible.builtin.apt:
    name: "{{ firewall_package }}"
    state: present
    update_cache: true
    cache_valid_time: 3600
```

- [ ] **Step 6: Refactor `tasks/main.yml`**

Replace `deploy/ansible/roles/firewall/tasks/main.yml` with:

```yaml
---
# Firewall role: deny-by-default, explicit allow for SSH/HTTP/HTTPS.
# UFW on Debian-family. Future RHEL support adds firewalld via dispatcher.

- name: Load OS-specific vars
  ansible.builtin.include_vars: "{{ lookup('ansible.builtin.first_found', params) }}"
  vars:
    params:
      files:
        - "{{ ansible_facts.distribution }}.yml"
        - "{{ ansible_facts.os_family }}.yml"
        - main.yml
      paths:
        - "{{ role_path }}/vars"

- name: Install firewall package
  ansible.builtin.include_tasks: install.yml

- name: Set firewall default incoming policy
  community.general.ufw:
    direction: incoming
    policy: "{{ firewall_default_incoming }}"

- name: Set firewall default outgoing policy
  community.general.ufw:
    direction: outgoing
    policy: "{{ firewall_default_outgoing }}"

- name: Allow configured TCP ports
  community.general.ufw:
    rule: allow
    port: "{{ item }}"
    proto: tcp
  loop: "{{ firewall_allowed_tcp_ports }}"

- name: Set firewall logging
  community.general.ufw:
    logging: "{{ firewall_logging }}"

- name: Enable firewall
  community.general.ufw:
    state: enabled

- name: Ensure firewall service is running and enabled
  ansible.builtin.systemd:
    name: "{{ firewall_service }}"
    enabled: true
    state: started
```

> Note: The `community.general.ufw` module is used directly because it has no portable equivalent in `ansible.builtin.package`. When RHEL support lands, the dispatcher pattern adds a parallel `firewalld` task block, and the `firewall_module` var becomes the gate for which task block runs.

- [ ] **Step 7: Lint and commit**

```bash
cd deploy/ansible
ansible-lint roles/firewall/
git add deploy/ansible/roles/firewall/
git commit -m "ansible(firewall): refactor to dispatcher + per-family vars"
```

---

## Task 6: Refactor `fail2ban` role to dispatcher pattern

**Files:**
- Create: `deploy/ansible/roles/fail2ban/tasks/install.yml`
- Create: `deploy/ansible/roles/fail2ban/tasks/install_debian.yml`
- Create: `deploy/ansible/roles/fail2ban/vars/Debian.yml`
- Create: `deploy/ansible/roles/fail2ban/vars/main.yml`
- Modify: `deploy/ansible/roles/fail2ban/tasks/main.yml`

- [ ] **Step 1: Read the current fail2ban role**

```bash
cat deploy/ansible/roles/fail2ban/tasks/main.yml
cat deploy/ansible/roles/fail2ban/handlers/main.yml
ls deploy/ansible/roles/fail2ban/templates/ 2>/dev/null
```

- [ ] **Step 2: Write `vars/main.yml`**

Create `deploy/ansible/roles/fail2ban/vars/main.yml`:

```yaml
---
fail2ban_jail_local_enabled: true
fail2ban_ssh_max_retry: 3
fail2ban_ssh_bantime: 3600
fail2ban_ssh_findtime: 600
```

- [ ] **Step 3: Write `vars/Debian.yml`**

Create `deploy/ansible/roles/fail2ban/vars/Debian.yml`:

```yaml
---
fail2ban_package: fail2ban
fail2ban_service: fail2ban
fail2ban_jail_local_path: /etc/fail2ban/jail.local
```

- [ ] **Step 4: Write `tasks/install.yml`**

Create `deploy/ansible/roles/fail2ban/tasks/install.yml`:

```yaml
---
- name: Include Debian-family install tasks
  ansible.builtin.include_tasks: install_debian.yml
  when: ansible_facts.os_family == 'Debian'
```

- [ ] **Step 5: Write `tasks/install_debian.yml`**

Create `deploy/ansible/roles/fail2ban/tasks/install_debian.yml`:

```yaml
---
- name: Install fail2ban
  ansible.builtin.apt:
    name: "{{ fail2ban_package }}"
    state: present
    update_cache: true
    cache_valid_time: 3600
```

- [ ] **Step 6: Refactor `tasks/main.yml`**

Replace `deploy/ansible/roles/fail2ban/tasks/main.yml` with:

```yaml
---
# Fail2ban role: SSH brute-force protection.

- name: Load OS-specific vars
  ansible.builtin.include_vars: "{{ lookup('ansible.builtin.first_found', params) }}"
  vars:
    params:
      files:
        - "{{ ansible_facts.distribution }}.yml"
        - "{{ ansible_facts.os_family }}.yml"
        - main.yml
      paths:
        - "{{ role_path }}/vars"

- name: Install fail2ban
  ansible.builtin.include_tasks: install.yml

- name: Configure jail.local
  ansible.builtin.template:
    src: jail.local.j2
    dest: "{{ fail2ban_jail_local_path }}"
    owner: root
    group: root
    mode: "0644"
  notify: Restart fail2ban

- name: Enable and start fail2ban
  ansible.builtin.systemd:
    name: "{{ fail2ban_service }}"
    enabled: true
    state: started
```

If the existing role has additional tasks (e.g., custom filter copies), preserve them — append after the systemd task. If there's no `jail.local.j2` template, copy the existing one verbatim from whatever path it currently lives at.

- [ ] **Step 7: Verify the existing template references the new var names**

```bash
grep -E 'maxretry|bantime|findtime' deploy/ansible/roles/fail2ban/templates/jail.local.j2 2>/dev/null
```

If the template uses hardcoded values, leave it as-is (the var refactor for jail config is out of scope for this PR — the goal is distro abstraction, not templating polish).

- [ ] **Step 8: Lint and commit**

```bash
cd deploy/ansible
ansible-lint roles/fail2ban/
git add deploy/ansible/roles/fail2ban/
git commit -m "ansible(fail2ban): refactor to dispatcher + per-family vars"
```

---

## Task 7: Refactor `ssh-hardening` role with vars file (no dispatcher needed)

**Files:**
- Create: `deploy/ansible/roles/ssh-hardening/vars/Debian.yml`
- Create: `deploy/ansible/roles/ssh-hardening/vars/main.yml`
- Modify: `deploy/ansible/roles/ssh-hardening/tasks/main.yml`

This role is pure config templating + service restart. No dispatcher needed — just pull package and service names into vars files so RHEL family can override them later.

- [ ] **Step 1: Read the current ssh-hardening role**

```bash
cat deploy/ansible/roles/ssh-hardening/tasks/main.yml
cat deploy/ansible/roles/ssh-hardening/handlers/main.yml
```

- [ ] **Step 2: Write `vars/main.yml`**

Create `deploy/ansible/roles/ssh-hardening/vars/main.yml`:

```yaml
---
# Cross-distro SSH defaults
sshd_permit_root_login: 'no'
sshd_password_authentication: 'no'
sshd_pubkey_authentication: 'yes'
sshd_kbd_interactive_authentication: 'no'
sshd_max_auth_tries: 3
sshd_client_alive_interval: 300
sshd_client_alive_count_max: 2
```

- [ ] **Step 3: Write `vars/Debian.yml`**

Create `deploy/ansible/roles/ssh-hardening/vars/Debian.yml`:

```yaml
---
sshd_package: openssh-server
sshd_service: ssh
sshd_config_path: /etc/ssh/sshd_config
sshd_config_d_path: /etc/ssh/sshd_config.d
```

- [ ] **Step 4: Refactor `tasks/main.yml`**

Read the current main.yml. Replace `apt:` install of `openssh-server` with `package:` and reference the var. Replace hardcoded paths with `{{ sshd_config_path }}` etc. Replace hardcoded service name with `{{ sshd_service }}` in the `systemd:` task.

Example structure (adapt to actual current contents — preserve any existing custom config):

```yaml
---
# SSH hardening role.

- name: Load OS-specific vars
  ansible.builtin.include_vars: "{{ lookup('ansible.builtin.first_found', params) }}"
  vars:
    params:
      files:
        - "{{ ansible_facts.distribution }}.yml"
        - "{{ ansible_facts.os_family }}.yml"
        - main.yml
      paths:
        - "{{ role_path }}/vars"

- name: Install SSH server
  ansible.builtin.package:
    name: "{{ sshd_package }}"
    state: present

- name: Drop hardened sshd config
  ansible.builtin.template:
    src: sshd_hardened.conf.j2
    dest: "{{ sshd_config_d_path }}/00-llamenos-hardened.conf"
    owner: root
    group: root
    mode: "0644"
    validate: "/usr/sbin/sshd -t -f %s"
  notify: Restart sshd

- name: Enable and start sshd
  ansible.builtin.systemd:
    name: "{{ sshd_service }}"
    enabled: true
    state: started
```

If the current role uses a different template path or sets values directly via `lineinfile`, preserve that approach — only swap the literal paths/names for variables.

- [ ] **Step 5: Update the handler to reference the var**

Read `deploy/ansible/roles/ssh-hardening/handlers/main.yml`. Replace any hardcoded `name: ssh` with `name: "{{ sshd_service }}"`.

- [ ] **Step 6: Lint and commit**

```bash
cd deploy/ansible
ansible-lint roles/ssh-hardening/
git add deploy/ansible/roles/ssh-hardening/
git commit -m "ansible(ssh-hardening): pull package/service names into vars files"
```

---

## Task 8: Refactor `kernel-hardening` role with vars file

**Files:**
- Create: `deploy/ansible/roles/kernel-hardening/vars/main.yml`
- Create: `deploy/ansible/roles/kernel-hardening/vars/Debian.yml`
- Modify: `deploy/ansible/roles/kernel-hardening/tasks/main.yml`

- [ ] **Step 1: Read the current kernel-hardening role**

```bash
cat deploy/ansible/roles/kernel-hardening/tasks/main.yml
```

Identify the sysctl drop-in path (almost certainly `/etc/sysctl.d/`).

- [ ] **Step 2: Write `vars/main.yml`**

Create `deploy/ansible/roles/kernel-hardening/vars/main.yml`:

```yaml
---
sysctl_drop_in_dir: /etc/sysctl.d
sysctl_drop_in_filename: 99-llamenos-hardened.conf
```

- [ ] **Step 3: Write `vars/Debian.yml`** (only if the path differs — usually identical, but explicit for documentation)

Create `deploy/ansible/roles/kernel-hardening/vars/Debian.yml`:

```yaml
---
# Inherits all defaults from main.yml. Present for symmetry with other roles
# and to make the per-family override pattern obvious to future readers.
```

- [ ] **Step 4: Refactor `tasks/main.yml` to reference the variable**

In `deploy/ansible/roles/kernel-hardening/tasks/main.yml`, add the vars-file lookup at the top:

```yaml
---
- name: Load OS-specific vars
  ansible.builtin.include_vars: "{{ lookup('ansible.builtin.first_found', params) }}"
  vars:
    params:
      files:
        - "{{ ansible_facts.distribution }}.yml"
        - "{{ ansible_facts.os_family }}.yml"
        - main.yml
      paths:
        - "{{ role_path }}/vars"
```

Then replace any hardcoded `/etc/sysctl.d/...` paths with `{{ sysctl_drop_in_dir }}/{{ sysctl_drop_in_filename }}`.

- [ ] **Step 5: Lint and commit**

```bash
cd deploy/ansible
ansible-lint roles/kernel-hardening/
git add deploy/ansible/roles/kernel-hardening/
git commit -m "ansible(kernel-hardening): pull sysctl path into vars files"
```

---

## Task 9: Refactor `geoip` role to dispatcher pattern

**Files:**
- Create: `deploy/ansible/roles/geoip/tasks/install.yml`
- Create: `deploy/ansible/roles/geoip/tasks/install_debian.yml`
- Create: `deploy/ansible/roles/geoip/vars/Debian.yml`
- Create: `deploy/ansible/roles/geoip/vars/main.yml`
- Modify: `deploy/ansible/roles/geoip/tasks/main.yml`

- [ ] **Step 1: Read the current geoip role**

```bash
cat deploy/ansible/roles/geoip/tasks/main.yml
```

- [ ] **Step 2: Write `vars/main.yml`**

Create `deploy/ansible/roles/geoip/vars/main.yml`:

```yaml
---
geoip_db_path: /var/lib/geoip/dbip-city.mmdb
geoip_db_dir: /var/lib/geoip
```

- [ ] **Step 3: Write `vars/Debian.yml`**

Create `deploy/ansible/roles/geoip/vars/Debian.yml`:

```yaml
---
geoip_install_packages:
  - wget
  - ca-certificates
```

- [ ] **Step 4: Write `tasks/install.yml` and `tasks/install_debian.yml`**

`deploy/ansible/roles/geoip/tasks/install.yml`:

```yaml
---
- name: Include Debian-family install tasks
  ansible.builtin.include_tasks: install_debian.yml
  when: ansible_facts.os_family == 'Debian'
```

`deploy/ansible/roles/geoip/tasks/install_debian.yml`:

```yaml
---
- name: Install geoip download dependencies
  ansible.builtin.apt:
    name: "{{ geoip_install_packages }}"
    state: present
    update_cache: true
    cache_valid_time: 3600
```

- [ ] **Step 5: Refactor `tasks/main.yml`**

Add the vars-file lookup and the install include at the top of the existing main.yml. Preserve everything else (the actual mmdb download and placement logic).

- [ ] **Step 6: Lint and commit**

```bash
cd deploy/ansible
ansible-lint roles/geoip/
git add deploy/ansible/roles/geoip/
git commit -m "ansible(geoip): refactor to dispatcher + per-family vars"
```

---

## Task 10: Refactor `backup` role with vars file

**Files:**
- Create: `deploy/ansible/roles/backup/vars/Debian.yml`
- Create: `deploy/ansible/roles/backup/vars/main.yml`
- Modify: `deploy/ansible/roles/backup/tasks/main.yml`

- [ ] **Step 1: Read the current backup role**

```bash
cat deploy/ansible/roles/backup/tasks/main.yml
```

Note: rclone is installed via the upstream installer script (`curl https://rclone.org/install.sh | sudo bash`), which works identically across distros. The only distro-specific bit is whatever `apt install` calls exist.

- [ ] **Step 2: Write `vars/main.yml`**

Create `deploy/ansible/roles/backup/vars/main.yml`:

```yaml
---
backup_install_packages_common:
  - rsync
  - cron
```

- [ ] **Step 3: Write `vars/Debian.yml`**

Create `deploy/ansible/roles/backup/vars/Debian.yml`:

```yaml
---
backup_install_packages: "{{ backup_install_packages_common }}"
```

- [ ] **Step 4: Refactor `tasks/main.yml`**

Add the vars-file lookup at the top and replace any `apt:` calls for these packages with `package:`:

```yaml
- name: Load OS-specific vars
  ansible.builtin.include_vars: "{{ lookup('ansible.builtin.first_found', params) }}"
  vars:
    params:
      files:
        - "{{ ansible_facts.distribution }}.yml"
        - "{{ ansible_facts.os_family }}.yml"
        - main.yml
      paths:
        - "{{ role_path }}/vars"

- name: Install backup dependencies
  ansible.builtin.package:
    name: "{{ backup_install_packages }}"
    state: present
```

Preserve all the existing rclone install + cron job + backup script tasks.

- [ ] **Step 5: Lint and commit**

```bash
cd deploy/ansible
ansible-lint roles/backup/
git add deploy/ansible/roles/backup/
git commit -m "ansible(backup): pull package list into vars files"
```

---

## Task 11: Refactor `llamenos` role to use `package:` module

**Files:**
- Create: `deploy/ansible/roles/llamenos/vars/Debian.yml`
- Create: `deploy/ansible/roles/llamenos/vars/main.yml`
- Modify: `deploy/ansible/roles/llamenos/tasks/main.yml`
- Modify: `deploy/ansible/roles/llamenos/tasks/luks.yml`

- [ ] **Step 1: Audit `apt:` calls in the llamenos role**

```bash
grep -rn "ansible.builtin.apt:" deploy/ansible/roles/llamenos/
```

The known one is `cryptsetup` in `luks.yml`. There may be others.

- [ ] **Step 2: Write `vars/main.yml`**

Create `deploy/ansible/roles/llamenos/vars/main.yml`:

```yaml
---
cryptsetup_package: cryptsetup
```

- [ ] **Step 3: Write `vars/Debian.yml`**

Create `deploy/ansible/roles/llamenos/vars/Debian.yml`:

```yaml
---
# Inherits cryptsetup_package from main.yml. Present for symmetry.
```

- [ ] **Step 4: Update `tasks/luks.yml` to use the var + package module**

Read the current `tasks/luks.yml`. Find the cryptsetup install task:

```yaml
- name: Install cryptsetup
  ansible.builtin.apt:
    name: cryptsetup
    state: present
    update_cache: true
    cache_valid_time: 3600
```

Replace with:

```yaml
- name: Install cryptsetup
  ansible.builtin.package:
    name: "{{ cryptsetup_package }}"
    state: present
```

The `update_cache` no longer applies — it's apt-specific. The cache update from the `common` role earlier in the playbook is sufficient.

- [ ] **Step 5: Add the vars lookup to `tasks/main.yml`**

At the top of `deploy/ansible/roles/llamenos/tasks/main.yml`, before any other tasks:

```yaml
- name: Load OS-specific vars
  ansible.builtin.include_vars: "{{ lookup('ansible.builtin.first_found', params) }}"
  vars:
    params:
      files:
        - "{{ ansible_facts.distribution }}.yml"
        - "{{ ansible_facts.os_family }}.yml"
        - main.yml
      paths:
        - "{{ role_path }}/vars"
```

- [ ] **Step 6: Audit any other `apt:` calls in the role and convert each**

For each remaining `apt:` install task in `roles/llamenos/`, replace with `package:` if it's a simple install. If the task uses `apt`-specific options (`force_apt_get`, `dpkg_options`, etc.), document why and leave it OR move it into a future `tasks/install_debian.yml` split.

- [ ] **Step 7: Lint and commit**

```bash
cd deploy/ansible
ansible-lint roles/llamenos/
git add deploy/ansible/roles/llamenos/
git commit -m "ansible(llamenos): use ansible.builtin.package for cryptsetup"
```

---

## Task 12: Add a Debian-only guard to the `kamailio` role

`kamailio` is deferred to a follow-up PR (see spec §10). Until then, the role must fail loudly on Debian rather than silently breaking.

**Files:**
- Modify: `deploy/ansible/roles/kamailio/tasks/main.yml`

- [ ] **Step 1: Read the current kamailio role**

```bash
cat deploy/ansible/roles/kamailio/tasks/main.yml | head -30
```

- [ ] **Step 2: Add the guard as the very first task**

Add this task at the top of `deploy/ansible/roles/kamailio/tasks/main.yml`:

```yaml
---
- name: Assert kamailio role is running on Ubuntu (Debian support pending)
  ansible.builtin.assert:
    that:
      - ansible_facts.distribution == 'Ubuntu'
    fail_msg: |
      The kamailio role currently only supports Ubuntu. Debian support is
      planned in a follow-up PR.

      Detected: {{ ansible_facts.distribution }} {{ ansible_facts.distribution_version }}

      To deploy Llamenos on Debian without Kamailio, omit the kamailio role
      from your playbook by tagging it out:

        ansible-playbook setup.yml --skip-tags kamailio

      Track follow-up status in deploy/ansible/README.md.
```

- [ ] **Step 3: Lint and commit**

```bash
cd deploy/ansible
ansible-lint roles/kamailio/
git add deploy/ansible/roles/kamailio/tasks/main.yml
git commit -m "ansible(kamailio): assert Ubuntu-only until Debian support lands"
```

---

## Task 13: Update Tart VM test matrix

**Files:**
- Modify: `deploy/ansible/justfile`

- [ ] **Step 1: Read the existing test recipe**

```bash
grep -n -A 20 'tart clone' deploy/ansible/justfile
```

- [ ] **Step 2: Verify cirruslabs image availability**

For each image we plan to use, verify it exists in the GHCR registry:

```bash
for img in ubuntu:24.04 ubuntu:22.04 debian:13 debian:12; do
  echo "=== $img ==="
  gh api "/orgs/cirruslabs/packages/container/${img%:*}/versions" --jq ".[] | select(.metadata.container.tags[] == \"${img#*:}\") | .name" 2>/dev/null | head -1 || echo "(not found via gh api — check https://github.com/orgs/cirruslabs/packages)"
done
```

Record the results. If `cirruslabs/debian:13` is missing, drop it from P0 and document the gap in the PR description (per spec §7).

- [ ] **Step 3: Add the matrix recipe**

Read the existing test recipe to understand the SSH commands and test flow. Then add a new `test-matrix` recipe that loops over the available images:

```just
# Test the Ansible playbook against multiple distros via Tart on a Mac runner.
# Requires `mac` SSH alias to a configured Tart host.
#
# P0 distros (must pass on every PR): Ubuntu 24.04, Debian 13
# P1 distros (nightly + tags): Ubuntu 22.04, Debian 12
test-matrix mode='p0':
    #!/usr/bin/env bash
    set -euo pipefail
    if [ "{{mode}}" = "p0" ]; then
        images=("ghcr.io/cirruslabs/ubuntu:24.04" "ghcr.io/cirruslabs/debian:13")
    elif [ "{{mode}}" = "p1" ]; then
        images=("ghcr.io/cirruslabs/ubuntu:22.04" "ghcr.io/cirruslabs/debian:12")
    elif [ "{{mode}}" = "all" ]; then
        images=(
            "ghcr.io/cirruslabs/ubuntu:24.04"
            "ghcr.io/cirruslabs/ubuntu:22.04"
            "ghcr.io/cirruslabs/debian:13"
            "ghcr.io/cirruslabs/debian:12"
        )
    else
        echo "usage: just test-matrix [p0|p1|all]" >&2
        exit 2
    fi

    for image in "${images[@]}"; do
        name="llamenos-test-$(basename "$image" | tr ':' '-')"
        echo "=== Testing against $image ==="

        ssh mac "source ~/.zprofile && tart delete $name 2>/dev/null || true"
        ssh mac "source ~/.zprofile && tart clone $image $name && tart set $name --cpu 4 --memory 8192 --disk-size 20"
        ssh mac "source ~/.zprofile && tart run --no-graphics $name &"
        sleep 30  # boot

        vm_ip=$(ssh mac "source ~/.zprofile && tart ip $name")

        # Run the playbook
        ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook setup.yml \
            -i "${vm_ip}," \
            -u admin \
            --private-key ~/.ssh/tart_test_ed25519 \
            -e @vars.example.yml

        # Smoke assertions
        ssh -o StrictHostKeyChecking=no -i ~/.ssh/tart_test_ed25519 admin@${vm_ip} 'sudo bash -s' <<'SMOKE'
        set -euo pipefail
        ufw status verbose | grep -q "Default: deny (incoming)"
        systemctl is-active fail2ban
        systemctl is-active docker
        docker info --format '{{.SecurityOptions}}' | grep -q userns
        sshd -T | grep -E '^(passwordauthentication|permitrootlogin) no$' | wc -l | grep -q 2
        sysctl -n net.ipv4.tcp_syncookies | grep -q 1
        dpkg -l unattended-upgrades | grep -q '^ii'
        echo "all smoke checks passed"
SMOKE

        ssh mac "source ~/.zprofile && tart stop $name && tart delete $name"
        echo "=== $image PASS ==="
    done
```

> Adapt the SSH user (`admin`), private key path, and `tart ip` invocation to match the existing test recipe's actual conventions. The above is a template — preserve whatever connection mechanism currently works.

- [ ] **Step 4: Update the existing single-image recipe to call `test-matrix p0` if it's a wrapper**

Or leave it as a separate recipe and document that `test-matrix` is the new canonical path.

- [ ] **Step 5: Commit**

```bash
git add deploy/ansible/justfile
git commit -m "ansible: extend Tart test recipe to multi-distro matrix"
```

---

## Task 14: Update README and CLAUDE.md

**Files:**
- Modify: `deploy/ansible/README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add "Supported targets" to the ansible README**

Read `deploy/ansible/README.md`. Insert the following section near the top, ideally right after the project description / overview:

```markdown
## Supported targets

This playbook is tested on:

- **Debian 12** (bookworm)
- **Debian 13** (trixie) — primary target for new deployments
- **Ubuntu 22.04** (jammy)
- **Ubuntu 24.04** (noble)

Other distributions, including the RHEL family, are not yet supported.
The preflight check (`playbooks/preflight.yml`) will fail with a clear
error if you try.

If you need to add a new distro, see the dispatcher pattern documented
in any of the refactored roles (e.g., `roles/common/tasks/install.yml`)
and add a `vars/{Family}.yml` plus a `tasks/install_{family}.yml`.

> The kamailio role is currently Ubuntu-only and will fail-fast on Debian.
> Track follow-up in `docs/NEXT_BACKLOG.md`.
```

- [ ] **Step 2: Add a `bootstrap` step to the README quickstart**

Find the existing quickstart section. Insert a `just bootstrap` step before the first `just deploy-*` command:

```markdown
## Quickstart

1. Install ansible: `pip install ansible ansible-lint`
2. **Bootstrap galaxy roles + collections** (run once after a fresh checkout, or when `requirements.yml` changes):
   ```bash
   cd deploy/ansible
   just bootstrap
   ```
3. Configure your inventory and vars: ...
4. Deploy: `just deploy-demo`
```

- [ ] **Step 3: Update CLAUDE.md deployment line**

Read `CLAUDE.md`. Find the line under "Tech Stack" that reads:

```
- **Deployment**: VPS (Ansible/Docker), EU/GDPR-compatible hosting
```

Replace with:

```
- **Deployment**: VPS (Ansible/Docker), Debian 12+/Ubuntu 22.04+, EU/GDPR-compatible hosting
```

- [ ] **Step 4: Add a one-line gotcha to the CLAUDE.md "Gotchas" section**

Find the "## Gotchas" section. Append a new bullet:

```markdown
- Ansible roles use the dispatcher pattern (`tasks/install.yml` → `install_{family}.yml`) plus per-family vars files. When adding distro-specific behavior, never put `when: ansible_distribution == ...` in role bodies — use the dispatcher and a vars file. See `roles/common/` for the canonical example.
```

- [ ] **Step 5: Commit**

```bash
git add deploy/ansible/README.md CLAUDE.md
git commit -m "docs: document supported distros and dispatcher pattern"
```

---

## Task 15: Manual verification against a real Debian 13 VPS

This is the merge gate. Do not skip.

- [ ] **Step 1: Provision a fresh Debian 13 VPS at any provider**

Hetzner Cloud, OVH, 1984 Hosting, or any provider with a standard Debian 13 image works. (We'll use this same provider for the FDE ISO PR's manual test, so consider standing up two test instances or a single Debian 13 instance you can re-use.)

- [ ] **Step 2: Bootstrap and run the playbook**

```bash
cd deploy/ansible
just bootstrap
ansible-playbook setup.yml \
  -i '<vps-ip>,' \
  -u root \
  --private-key ~/.ssh/your_key \
  -e @vars.example.yml \
  --diff
```

Expected: completes without errors, all roles run.

- [ ] **Step 3: Run the smoke assertions manually**

SSH to the VPS and run each of the 7 checks from spec §7:

```bash
ssh root@<vps-ip>
sudo bash <<'CHECKS'
set -e
ufw status verbose
systemctl is-active fail2ban
systemctl is-active docker
docker info --format '{{.SecurityOptions}}'
sshd -T | grep -E '^(passwordauthentication|permitrootlogin)'
sysctl net.ipv4.tcp_syncookies
dpkg -l unattended-upgrades | grep '^ii' || rpm -q unattended-upgrades
echo "OK"
CHECKS
```

- [ ] **Step 4: Capture the output for the PR description**

Save the entire run log + smoke check output to `pr-evidence.txt` (or paste into the PR description directly).

- [ ] **Step 5: Tear down the VPS**

Once you've captured evidence and confirmed the playbook succeeded, destroy the VPS to avoid charges.

---

## Task 16: Final acceptance check

- [ ] **Step 1: Walk the spec acceptance criteria**

Open `docs/superpowers/specs/2026-04-09-ansible-distro-abstraction-design.md`. Check each item in the "Acceptance Criteria" section against the current branch.

- [ ] **Step 2: Run the full lint pass**

```bash
cd deploy/ansible
ansible-lint .
```

Expected: no errors. If any role has warnings introduced by this PR, fix them now.

- [ ] **Step 3: Run the syntax check on every playbook**

```bash
for pb in playbooks/*.yml setup.yml; do
  echo "=== $pb ==="
  ansible-playbook "$pb" --syntax-check -i inventory.example.yml || echo "FAIL: $pb"
done
```

Expected: all PASS.

- [ ] **Step 4: Verify nothing in `roles/galaxy/` is committed**

```bash
git ls-files deploy/ansible/roles/galaxy/ | wc -l
```

Expected: `0`.

- [ ] **Step 5: Verify the deleted `roles/docker/` is gone from the working tree and from git**

```bash
ls deploy/ansible/roles/docker/ 2>/dev/null && echo "FAIL: directory still exists" || echo "OK: deleted"
git log --diff-filter=D --summary | grep 'roles/docker' | head -5
```

Expected: directory missing from working tree, and at least one `delete mode` line for `roles/docker` in git history.

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin feat/ansible-distro-abstraction
gh pr create --title "ansible: multi-distro abstraction (Debian 12/13 + Ubuntu 22/24)" \
  --body "$(cat <<'EOF'
## Summary

- Adds Debian 12/13 + Ubuntu 22.04/24.04 as first-class targets via the matrix-docker-ansible-deploy dispatcher pattern
- Replaces the hand-rolled `roles/docker/` with `geerlingguy.docker` pinned in `requirements.yml`
- Adds a fail-fast distro allowlist preflight assert
- Extends the Tart VM test matrix to cover Ubuntu 24.04 + Debian 13 as P0
- Defers `kamailio` to a follow-up PR (Ubuntu-only guard added)

## Spec
docs/superpowers/specs/2026-04-09-ansible-distro-abstraction-design.md

## Test plan
- [ ] CI: ansible-lint passes
- [ ] CI: every playbook passes --syntax-check
- [ ] Tart matrix: Ubuntu 24.04 + Debian 13 (P0) — both pass smoke assertions
- [ ] Manual: real Debian 13 VPS at <provider> — see evidence below
- [ ] Manual: existing Ubuntu 24.04 demo deploy still works (no regression)

## Evidence
<paste the run log + smoke checks from Task 15 here>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes for the implementer

- **Worktree hygiene:** keep the FDE ISO worktree (`feat/fde-iso-builder`) untouched while you do this work. The two PRs are independent branches.
- **No `apt` in role bodies:** after each refactor task, grep for `ansible.builtin.apt:` in the role you just touched. Anything still there should be in `install_debian.yml` or justified by a comment (apt-specific option that has no `package:` equivalent).
- **Vars file conflicts:** if you add a variable to `vars/main.yml` and a Debian-specific override to `vars/Debian.yml`, the Debian one wins. Verify with `ansible-playbook ... -vvv` against a Debian host.
- **`first_found` paths matter:** the lookup uses `paths: ["{{ role_path }}/vars"]`. If you typo a vars filename, the lookup falls through to the next file silently. Add a `debug:` task to verify variables are loaded if you suspect a path bug.
- **`ansible.builtin.package` requires the python interpreter:** Debian 12 minimal images may not have python3 installed before the playbook runs. The preseed in the FDE ISO PR explicitly installs `python3 + python3-apt` — if you're testing against a non-ISO Debian image, ensure python3 is present (most cloud images include it).
- **Don't refactor things that aren't broken:** the goal is multi-distro support, not stylistic improvements. Resist the urge to clean up unrelated patterns.
