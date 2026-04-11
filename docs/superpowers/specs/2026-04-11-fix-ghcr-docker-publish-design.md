# Fix GHCR Docker Image Publish

**Date**: 2026-04-11
**Status**: Approved
**Scope**: CI/CD — `.github/workflows/docker.yml`

## Problem

`.github/workflows/docker.yml` has never successfully run a single build. `gh run list --workflow docker.yml` returns zero runs despite 40+ release tags (`v0.41.1` is current). The app and `sip-bridge` container images are therefore not available on GHCR even though the repository is public and the workflow has been present for months.

### Root cause

`docker.yml` triggers only on `push: tags: ['v*']`. Those tags are pushed by `release.yml` using `secrets.GITHUB_TOKEN`. GitHub has a documented, hard constraint:

> When you use the repository's GITHUB_TOKEN to perform tasks, events triggered by the GITHUB_TOKEN, with the exception of `workflow_dispatch` and `repository_dispatch`, will not create a new workflow run.

Every `git push origin main --follow-tags` from `release.yml` pushes both the commit and the tag under `GITHUB_TOKEN` auth, so neither the `push: branches: [main]` nor the `push: tags: ['v*']` trigger in a downstream workflow will fire. `docker.yml` sits idle by design of the current plumbing.

### Secondary issue

The Trivy scan step hardcodes `image-ref: ...:sha-${{ github.sha }}`. `docker/metadata-action` with `type=sha` (no `format` override) produces `sha-<7char>`, not `sha-<full40>`, so even if the build step had ever succeeded, the scan step would pull a non-existent tag and fail. The bridge job has no scan step at all.

## Goals

1. Every merge to `main` publishes fresh images to GHCR for both `llamenos-hotline` (the app) and `llamenos-hotline-sip-bridge` (the Asterisk bridge).
2. Image tags are meaningful: `latest`, `main`, `sha-<short>`, and semver (`X.Y.Z`, `X.Y`) when a release tag is present.
3. Trivy scans run against the correct image reference and upload SARIF.
4. No new secrets, no PAT rotation, no change to the `release.yml` auto-bump flow.

## Non-goals

- Switching release tooling to `@changesets/cli` or similar — tracked as a separate follow-up (see **Follow-ups** below). Every PR-touches-contributor-workflow change deserves its own brainstorm.
- Triggering `docker.yml` specifically on the GitHub `release: published` event. The `push: branches: [main]` trigger plus the `type=semver` metadata rule covers the "every release to main" ask without requiring cross-workflow coordination, and release events authored by `GITHUB_TOKEN` are subject to the same trigger suppression rule.
- Making GHCR packages public from CI. That requires a PAT with `write:packages` and is a one-time click in the repo package settings.
- Adding SBOM generation, cosign signing, or multi-arch (`linux/arm64`) builds. Out of scope for a trigger fix; can be layered on once images are flowing.

## Design

### 1. Trigger change

```yaml
on:
  push:
    branches: [main]
    tags: ['v*']
  workflow_dispatch:
```

- `branches: [main]` — fires on every merge to main (this is the primary fix).
- `tags: ['v*']` — kept for `workflow_dispatch` re-runs and any future path where tags are pushed under non-`GITHUB_TOKEN` credentials. Harmless no-op under the current `release.yml`.
- `workflow_dispatch` — manual re-runs.

### 2. Metadata tags

Both jobs use the same `docker/metadata-action@v5` config:

```yaml
tags: |
  type=raw,value=latest,enable={{is_default_branch}}
  type=ref,event=branch
  type=sha,format=short,prefix=sha-
  type=semver,pattern={{version}}
  type=semver,pattern={{major}}.{{minor}}
```

Resulting tags:

| Event                          | Tags produced                     |
|--------------------------------|-----------------------------------|
| `push` → main                  | `latest`, `main`, `sha-abc1234`   |
| `push` → `v1.2.3` tag          | `1.2.3`, `1.2`, `sha-abc1234`     |
| `workflow_dispatch` from main  | `latest`, `sha-abc1234`           |
| `workflow_dispatch` from other | `sha-abc1234`                     |

`latest` is gated on `{{is_default_branch}}`, which evaluates to true whenever the dispatched ref is the default branch regardless of `event_name`. `type=ref,event=branch` only fires on `push`, which is why `main` (the literal branch-name tag) doesn't appear on workflow_dispatch runs.

### 3. Trivy reference fix

```yaml
image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.build.outputs.digest }}
```

Using the build step's `digest` output is exact: it scans the precise manifest that was just pushed, independent of which tags point at it. Requires adding `id: build` to the existing `Build and push` step. This replaces the hardcoded `sha-${{ github.sha }}` reference.

### 4. Parity for the bridge job

- Add the same trigger, same metadata rules, same digest-based Trivy scan to the `bridge` job.
- Currently the bridge job has no Trivy scan at all; add one for symmetry.

### 5. One-time manual: public package visibility

GHCR packages default to private on first publish. The repo owner is `rhonda-rodododo` (user-owned, not org-owned), so the package settings path uses `/users/`. After the first successful run of the new workflow:

1. Go to https://github.com/users/rhonda-rodododo/packages/container/llamenos-hotline/settings
2. Scroll to "Danger Zone" → "Change package visibility" → set to Public.
3. Repeat for `llamenos-hotline-sip-bridge`.
4. (Optional but recommended) Under "Manage Actions access", confirm the repository is linked so future pushes from the same repo are allowed without per-run auth tweaks.

This is called out in the PR description so it isn't missed.

### 6. Concurrency

Add a concurrency group to avoid wasted builds when multiple merges land quickly:

```yaml
concurrency:
  group: docker-${{ github.ref }}
  cancel-in-progress: true
```

`cancel-in-progress: true` is appropriate here — a superseded main commit's image is not worth finishing. Release tag runs get their own group via `github.ref` and are not cancelled by subsequent main pushes.

## File changes

Only one file: `.github/workflows/docker.yml`. Full rewrite of the triggers, metadata block, and Trivy step for both jobs. No new files, no secrets, no `release.yml` changes.

## Testing plan

CI workflow changes cannot be unit tested. Verification path:

1. **Local YAML lint**: `actionlint .github/workflows/docker.yml` (if installed) or `gh workflow view docker.yml` post-merge.
2. **Pre-merge dry-run**: open the PR; the workflow runs on the PR branch via `workflow_dispatch` manual trigger from the Actions UI to confirm the build-push-scan pipeline works end-to-end against a throwaway tag before merging.
3. **Post-merge confirmation**: after merge, confirm `gh run list --workflow docker.yml` shows a new run, the run succeeds, and `gh api /users/rhonda-rodododo/packages/container/llamenos-hotline/versions` lists the new version.
4. **Pull test**: `docker pull ghcr.io/rhonda-rodododo/llamenos-hotline:latest` from a clean environment (after the package is flipped to public).

## Rollout

1. Create worktree `~/projects/llamenos-hotline-fix-ghcr-publish` off `main`.
2. Make the `docker.yml` edit.
3. Open PR. Include the "one-time manual: flip package visibility" note in the PR description.
4. Trigger a `workflow_dispatch` run from the PR branch to validate before merge.
5. Merge. Watch first post-merge run. Flip package visibility. Pull-test.

## Follow-ups (not in this PR)

- **Release tooling spec**: brainstorm `@changesets/cli` vs. current conventional-commits-+-git-cliff pipeline. Changesets gives per-PR author-written changelog entries but requires every contributor to drop a changeset file per PR. Needs its own design session because it changes contributor workflow, not just CI.
- **Multi-arch images** (`linux/amd64` + `linux/arm64`) via `docker/setup-qemu-action` — useful for self-hosters on ARM VPSes.
- **cosign keyless signing** via OIDC — natural next step once images are flowing; pairs well with the existing SLSA attestation in `release.yml`.
- **SBOM attachment** via `docker/build-push-action`'s built-in SBOM generation.
