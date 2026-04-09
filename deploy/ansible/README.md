# Llamenos Ansible Deployment

Ansible playbooks for deploying and hardening Llamenos on a fresh VPS.

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

## Quickstart

1. Install ansible: `pip install ansible ansible-lint`
2. **Bootstrap galaxy roles + collections** (run once after a fresh checkout, or when `requirements.yml` changes):
   ```bash
   cd deploy/ansible
   just bootstrap
   ```
3. Configure your inventory and vars:
   ```bash
   cp inventory.example.yml inventory.yml
   cp vars.example.yml vars.yml
   # Edit both files with your values
   ansible-vault encrypt vars.yml
   ```
4. Deploy: `just setup-all` (full setup) or `just deploy-demo` (demo instance)

## Common commands

| Command | Description |
|---|---|
| `just bootstrap` | Install galaxy roles + collections from `requirements.yml` |
| `just setup-all` | Full server setup: harden + deploy |
| `just harden` | Apply server hardening only |
| `just deploy` | Deploy or update the application |
| `just check` | Dry-run setup with `--check --diff` |
| `just validate` | Lint + check against example inventory (CI-safe) |
| `just test-matrix [p0\|p1\|all]` | Run multi-distro Tart VM matrix tests |

See `justfile` for the full list.
