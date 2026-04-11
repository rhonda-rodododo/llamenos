# Fix GHCR Docker Image Publish (with Supply-Chain Hardening)

**Date**: 2026-04-11
**Status**: Approved
**Scope**: CI/CD — `.github/workflows/docker.yml`, `.github/workflows/release.yml`

## Problem

`.github/workflows/docker.yml` has never successfully run a single build. `gh run list --workflow docker.yml` returns zero runs despite 40+ release tags (`v0.41.1` is current). The app and `sip-bridge` container images are therefore not available on GHCR even though the repository is public and the workflow has been present for months.

### Root cause

`docker.yml` triggers only on `push: tags: ['v*']`. Those tags are pushed by `release.yml` using `secrets.GITHUB_TOKEN`. GitHub has a documented, hard constraint:

> When you use the repository's GITHUB_TOKEN to perform tasks, events triggered by the GITHUB_TOKEN, with the exception of `workflow_dispatch` and `repository_dispatch`, will not create a new workflow run.

Every `git push origin main --follow-tags` from `release.yml` pushes both the commit and the tag under `GITHUB_TOKEN` auth, so neither `push: branches: [main]` nor `push: tags: ['v*']` triggers in a downstream workflow will fire. `docker.yml` sits idle by design of the current plumbing.

### Why a tag-based publish is still the right shape

Publishing on every merge to `main` would "fix" the gap today but is the wrong long-term model. The roadmap direction is toward an aggregated release-PR flow (e.g. `@changesets/cli` or similar) where multiple main merges batch into a single "Version Packages" PR whose merge cuts the release. In that world, a per-main-merge Docker publish would produce a flood of disposable images and decouple "release exists" from "image exists." The spec keeps the trigger aligned with real releases.

### Secondary issue

The existing Trivy step hardcodes `image-ref: ...:sha-${{ github.sha }}`. `docker/metadata-action` with `type=sha` (no `format=long` override) produces `sha-<7char>`, not `sha-<full40>`, so even if the build step had ever succeeded, the scan step would pull a non-existent tag and fail. The bridge job has no scan step at all.

## Goals

1. Every release tag produced by `release.yml` publishes images to GHCR for both `llamenos-hotline` (app) and `llamenos-hotline-sip-bridge` (Asterisk bridge).
2. Publish is **coupled** to the release chain — if the Docker build or scan fails, the release job fails loudly. No silent gap between "release exists" and "image exists."
3. Images are signed, attested, and SBOM-bearing. An outside auditor can prove an image came from a specific workflow run in this repo.
4. Every third-party action is pinned to a full commit SHA and monitored by Dependabot.
5. Runner egress is instrumented.
6. No new secrets, no PAT rotation.
7. The solution survives a future migration to changesets-style release PRs unchanged — the reusable workflow is called from whatever runs next, including a changesets release action.

## Non-goals

- Switching release tooling to `@changesets/cli` or similar — separate follow-up brainstorm; changes contributor workflow, not just CI.
- Publishing on every main merge.
- Making GHCR packages public from CI (requires a PAT; one-time manual click).
- Multi-arch (`linux/arm64`) builds — additive, layer on once the base pipeline is green.

## Design

### 1. Trigger model — reusable workflow (`workflow_call`)

`docker.yml` becomes a reusable workflow. `release.yml` calls it as a downstream job in the same logical chain, so the `GITHUB_TOKEN` downstream-trigger suppression rule never applies.

`docker.yml` triggers:

```yaml
on:
  workflow_call:
    inputs:
      version:
        description: 'Semver version being released, e.g. "1.2.3" (omit leading v)'
        required: true
        type: string
      ref:
        description: 'Git ref to check out and build from (typically the tag commit SHA)'
        required: true
        type: string
  workflow_dispatch:
    inputs:
      version:
        description: 'Semver version override for manual runs'
        required: false
        type: string
        default: ''
  push:
    tags: ['v*']  # dormant fallback for future non-GITHUB_TOKEN tag pushes
```

`release.yml` adds a `docker` job that runs after the `release` job completes:

```yaml
docker:
  needs: [version, release]
  if: needs.version.outputs.should_release == 'true'
  uses: ./.github/workflows/docker.yml
  with:
    version: ${{ needs.version.outputs.new_version }}
    ref: refs/tags/v${{ needs.version.outputs.new_version }}
  permissions:
    contents: read
    packages: write
    id-token: write         # OIDC for cosign keyless + attestations
    attestations: write     # GH attestation store
    security-events: write  # SARIF upload
  secrets: inherit
```

The `ref` passed to the reusable workflow is the release tag, not `github.sha`. The caller's `github.sha` is the commit that triggered `release.yml` (the original PR merge into main), but `release.yml`'s `version` job creates a NEW commit (the `chore(release): v${NEW_VERSION}` bump) that the tag actually points at. Checking out the tag guarantees the Docker build sees the bumped `package.json` and the generated `CHANGELOG.md`.

### 2. Metadata tags

```yaml
tags: |
  type=semver,pattern={{version}},value=v${{ inputs.version }},enable=${{ inputs.version != '' }}
  type=semver,pattern={{major}}.{{minor}},value=v${{ inputs.version }},enable=${{ inputs.version != '' }}
  type=raw,value=latest,enable={{is_default_branch}}
  type=sha,format=short,prefix=sha-
```

The `enable=${{ inputs.version != '' }}` guards matter for `workflow_dispatch` runs where the user omits the version input — without the guard, `value=v` would be passed to the semver parser and fail the step.

| Event                                          | Tags produced                              |
|-------------------------------------------------|--------------------------------------------|
| `workflow_call` from `release.yml` for v1.2.3  | `1.2.3`, `1.2`, `latest`, `sha-abc1234`    |
| `workflow_dispatch` from main with `version=1.2.3` | `1.2.3`, `1.2`, `latest`, `sha-abc1234`  |
| `workflow_dispatch` from main, no version      | `latest`, `sha-abc1234`                    |
| `push` → `v1.2.3` tag (fallback, currently unreachable) | `1.2.3`, `1.2`, `latest`, `sha-abc1234`  |

**Why `latest` is safe on tag-triggered runs**: `{{is_default_branch}}` in `docker/metadata-action` evaluates to true when the checked-out commit is currently on the default branch. `release.yml` commits the release, tags it, and pushes both to `main` — the tagged commit IS the tip of `main` at publish time, so `latest` applies correctly. Document this inline in the workflow with a comment so the invariant is visible.

Values are sourced from `inputs.version` for `workflow_call` / `workflow_dispatch`, and from the pushed ref for the `push: tags` fallback. The `value=` override on `type=semver` lets us feed the version in from the caller instead of requiring a real tag push to exist.

### 3. Supply-chain hardening layer

#### 3.1 Pin every action to a full commit SHA

Match `release.yml`'s convention: `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2`. Applies to every `uses:` in `docker.yml`. Dependabot's existing `github-actions` ecosystem config already updates these weekly. No runtime cost.

Actions to pin (current → target):

| Action                             | Current | Resolve to latest SHA at edit time |
|------------------------------------|---------|------------------------------------|
| `actions/checkout`                 | `@v6`   | match release.yml where possible  |
| `docker/setup-buildx-action`       | `@v3`   | full SHA                          |
| `docker/login-action`              | `@v3`   | full SHA                          |
| `docker/metadata-action`           | `@v5`   | full SHA                          |
| `docker/build-push-action`         | `@v6`   | full SHA                          |
| `aquasecurity/trivy-action`        | `@v0.35.0` | full SHA                       |
| `github/codeql-action/upload-sarif`| `@v3`   | full SHA                          |
| `step-security/harden-runner`      | (new)   | full SHA                          |
| `sigstore/cosign-installer`        | (new)   | full SHA                          |
| `actions/attest-build-provenance`  | (new)   | match release.yml SHA              |

Resolve SHAs via `gh api /repos/<owner>/<repo>/releases/tags/<tag>` during implementation and commit them verbatim.

#### 3.2 StepSecurity `harden-runner`

First step of every job:

```yaml
- uses: step-security/harden-runner@<sha>  # v2.x.x
  with:
    egress-policy: audit
```

`audit` mode logs all outbound traffic without blocking. Produces a per-run insights page. After two or three clean runs we promote to `egress-policy: block` with an explicit `allowed-endpoints:` list. Starting in `audit` means this change cannot fail any build.

#### 3.3 SBOM + build-time SLSA provenance attached to the image

`docker/build-push-action` native flags:

```yaml
sbom: true
provenance: mode=max
```

Attaches an SPDX SBOM and a SLSA Build L3 provenance statement to the image manifest as OCI referrers. Inspect with `docker buildx imagetools inspect ghcr.io/rhonda-rodododo/llamenos-hotline:1.2.3 --format '{{json .Provenance}}'`. Zero extra workflow steps.

#### 3.4 GitHub-native build-provenance attestation

After push, extend the existing `actions/attest-build-provenance` pattern from `release.yml` to the container:

```yaml
- name: Attest image build provenance
  uses: actions/attest-build-provenance@ef244123eb79f2f7a7e75d99086184180e6d0018 # v2.1.0
  with:
    subject-name: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
    subject-digest: ${{ steps.build.outputs.digest }}
    push-to-registry: true
```

Stored in the GH attestation store AND pushed to the registry as an OCI referrer alongside the SBOM. Verifiable downstream with:

```bash
gh attestation verify oci://ghcr.io/rhonda-rodododo/llamenos-hotline:1.2.3 \
  --owner rhonda-rodododo
```

This complements #3.3 — #3.3 is discoverable via docker tooling, #3.4 is discoverable via `gh` and reuses the same keyless OIDC identity as #3.5.

#### 3.5 Cosign keyless signing via OIDC

```yaml
- uses: sigstore/cosign-installer@<sha>  # v3.x.x
- name: Sign image
  env:
    DIGEST: ${{ steps.build.outputs.digest }}
    IMAGE: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
  run: cosign sign --yes "${IMAGE}@${DIGEST}"
```

Uses the workflow's OIDC identity (`https://token.actions.githubusercontent.com`), no long-lived keys, Rekor transparency log entry. This is the verification that an external auditor cares about:

```bash
cosign verify ghcr.io/rhonda-rodododo/llamenos-hotline:1.2.3 \
  --certificate-identity-regexp "https://github.com/rhonda-rodododo/llamenos-hotline/\.github/workflows/docker\.yml@.*" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The identity-regexp locks the signature to our reusable workflow path — an image signed by any other workflow in any other repo fails verification. This is what makes Option A's coupling to `release.yml` a security feature, not just an ergonomic one.

#### 3.6 Pre-push Trivy gate

Replace the current "push then scan" pattern with "scan then push." Use a two-phase build-push-action invocation so the buildx cache is reused between phases (near-zero extra wall time on the second build):

1. **Phase 1** — `docker/build-push-action` with `load: true, push: false`. Image lands in the runner's local daemon, tagged with `${{ env.IMAGE_NAME }}:scan`.
2. **Trivy** — `aquasecurity/trivy-action` with `image-ref: ${{ env.IMAGE_NAME }}:scan`, `severity: 'CRITICAL,HIGH'`, `exit-code: '1'`, `ignore-unfixed: true`. Fails the job if any CRITICAL/HIGH unfixed CVE is present. SARIF output uploaded to code scanning regardless.
3. **Phase 2** — `docker/build-push-action` with `push: true` and the metadata-action tags. Re-uses the layer cache from phase 1, so the only extra work is the manifest push.

Image never reaches GHCR if it fails the gate. No post-hoc deletion needed.

**Driver caveat**: `load: true` in Phase 1 requires a buildx driver that can export to the local Docker daemon. `docker/setup-buildx-action` uses the `docker-container` driver by default, which supports `load: true` only for **single-platform** builds. Today's workflow is single-platform (`linux/amd64`), so this is fine. The follow-up multi-arch migration (`linux/amd64` + `linux/arm64`) will have to rework Phase 1 — either scan each platform image separately or switch to `outputs: type=oci,dest=...` + Trivy filesystem mode. Flag this inline in the workflow with a comment so the future maintainer doesn't have to re-derive it.

#### 3.7 Minimal per-job permissions

Workflow-level:

```yaml
permissions: {}  # deny all by default
```

Per-job for the main build job:

```yaml
permissions:
  contents: read
  packages: write
  id-token: write
  attestations: write
  security-events: write
```

The caller (`release.yml` `docker` job) declares the same permissions in its `uses:` block so the reusable workflow inherits explicit scopes and nothing more.

### 4. Parity for the bridge job

- Same `workflow_call` shape (or a second job in the same file — decision in the plan, not spec).
- Same metadata rules.
- Same Phase1→Trivy→Phase2 gate.
- Same attestation + cosign signing on the separate image name.
- Same harden-runner + SHA pinning.
- Tentatively one reusable workflow with two jobs (`app`, `bridge`) over two separate reusable workflows — fewer files, shared setup, shared env. Plan will confirm.

### 5. One-time manual: public package visibility

GHCR packages default to private on first publish. The repo owner is `rhonda-rodododo` (user-owned, so the settings URL uses `/users/`). After the first successful run:

1. Go to https://github.com/users/rhonda-rodododo/packages/container/llamenos-hotline/settings
2. Scroll to "Danger Zone" → "Change package visibility" → Public.
3. Repeat for `llamenos-hotline-sip-bridge`.
4. Under "Manage Actions access," confirm the repository is linked for future pushes.

Called out in the PR description so it isn't missed.

### 6. Concurrency

```yaml
concurrency:
  group: docker-${{ github.ref }}
  cancel-in-progress: false
```

`cancel-in-progress: false` (vs the main-branch fix's `true`) because tag-triggered runs are rare and every release should complete — cancelling a release-chain docker build would leave a release without an image.

## File changes

- `.github/workflows/docker.yml` — full rewrite: triggers, SHA pins, harden-runner, two-phase build, cosign, attestation, SBOM flags, minimal permissions, concurrency. Same shape for `bridge` job.
- `.github/workflows/release.yml` — add `docker` job with `uses: ./.github/workflows/docker.yml`, explicit permissions, secrets inheritance, conditional on `should_release == 'true'`.

No new files. No new secrets.

## Testing plan

1. **Local YAML lint**: run `actionlint` against the edited files (install ad-hoc if not present).
2. **Pre-merge dry-run**: open the PR, trigger `workflow_dispatch` on `docker.yml` against the PR branch with a throwaway version input (e.g. `0.0.0-pr-preview`). Confirm the full pipeline runs end-to-end: harden-runner → phase1 build → trivy gate → phase2 push → cosign sign → attest → SARIF upload. Delete the resulting preview tag from GHCR manually after verification.
3. **Caller dry-run**: in the same PR, verify `release.yml` parses correctly via `gh workflow view release.yml --yaml` after merge, and that the `docker` job appears in the next release run's job graph.
4. **First real release**: let a normal `release.yml` run fire after merge. Confirm `gh run list --workflow docker.yml` shows the `workflow_call` invocation, the job succeeds, and `gh api /users/rhonda-rodododo/packages/container/llamenos-hotline/versions` lists the new version.
5. **Flip package visibility** (manual, documented in PR description).
6. **Verification checks** from a clean environment:
   - `docker pull ghcr.io/rhonda-rodododo/llamenos-hotline:<version>`
   - `docker buildx imagetools inspect ghcr.io/rhonda-rodododo/llamenos-hotline:<version> --format '{{json .SBOM}}' | jq .`
   - `gh attestation verify oci://ghcr.io/rhonda-rodododo/llamenos-hotline:<version> --owner rhonda-rodododo`
   - `cosign verify ghcr.io/rhonda-rodododo/llamenos-hotline:<version> --certificate-identity-regexp "https://github.com/rhonda-rodododo/llamenos-hotline/\.github/workflows/docker\.yml@.*" --certificate-oidc-issuer https://token.actions.githubusercontent.com`

All four of the last bullet must succeed for the PR to be considered complete.

## Rollout

1. Create worktree `~/projects/llamenos-hotline-fix-ghcr-publish` off `main`.
2. Resolve full SHAs for every action added or updated.
3. Rewrite `docker.yml` and add the `docker` caller job to `release.yml`.
4. Run `actionlint` locally.
5. Open PR with an explicit "one-time manual flip to public after first release" section in the description.
6. Trigger `workflow_dispatch` preview run from the PR branch; verify the pipeline.
7. Merge. Watch the next real release. Flip package visibility. Run the four verification commands.

## Follow-ups (not in this PR)

- **Release tooling spec**: brainstorm `@changesets/cli` vs. the current conventional-commits-+-git-cliff pipeline. Changesets gives per-PR author-written changelog entries but requires every contributor to drop a changeset file per PR.
- **Multi-arch images** (`linux/amd64` + `linux/arm64`) via `docker/setup-qemu-action`.
- **Promote `harden-runner` from `audit` to `block`** after two or three clean runs reveal the real egress allowlist.
- **SBOM attestation for JS artifacts** in `release.yml` (the container side will already have it; matching on the JS side closes the gap).
- **Rekor transparency log monitoring** via an OSS rekor-monitor deployment — operational, not a repo change.
