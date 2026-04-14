# Release Flow Overhaul — Knope Release PR Model

**Status:** Draft
**Date:** 2026-04-14
**Branch:** `feat/release-flow-knope`

## Problem

Today, every merge to `main` auto-cuts a release: `release.yml` bumps `package.json`, regenerates `CHANGELOG.md` with git-cliff, tags, creates a GitHub Release, builds + pushes Docker images, and deploys to the demo VPS. That's fine when commits are infrequent, but it has three sharp edges:

1. **No human gate on release timing.** Every `feat:` or `fix:` that lands becomes a release, whether or not it's a good moment to ship. There is no way to batch several PRs into one coherent release.
2. **Main-branch CI never cancels.** `ci.yml`'s concurrency key includes `github.run_id` for push events, so five PRs merged in rapid succession run five full CI + E2E suites in parallel with no cancellation. That burns GitHub Actions minutes and throttles the queue.
3. **Version bump logic lives in bash.** `release.yml` has a hand-rolled conventional-commit parser in shell. It works but it's opaque, hard to extend, and duplicates what mature tools already do.

## Goal

Replace the auto-release-on-every-merge flow with a **release PR** model powered by [knope](https://github.com/knope-dev/knope):

- A bot-maintained PR titled `chore: prepare release vX.Y.Z` on branch `knope/release` accumulates changes from `main`.
- Each push to `main` re-runs `knope prepare-release`, which recomputes the version bump and regenerates `CHANGELOG.md` into the bot PR.
- A human merges the release PR when they're ready to cut a release. That merge triggers the tag, GitHub Release, Docker image publish, and demo VPS deploy — exactly the artifacts the current flow produces, just gated on human intent.
- Successive main-branch CI runs cancel in-progress older runs, including E2E.
- `git-cliff`, `cliff.toml`, and the bash version-bump shim are removed. Knope is the one tool.

## Non-goals

- **No production VPS deploy.** That's a separate workstream. The deploy target stays the demo VPS (`auto-deploy-demo.yml`, unchanged).
- **No Docker image preview builds on main pushes.** Images are only built when a release is cut.
- **No changeset files.** Knope reads conventional commits directly — contributors keep writing `feat:` / `fix:` / etc., no per-PR changeset YAML.
- **No changes to the existing security scaffolding** (SBOM, cosign, GPG, SLSA attestation). These run inside `release.yml` exactly as they do today.

## Architecture overview

### Change lifecycle under the new flow

1. **Contributor opens PR.** `ci.yml` runs on the PR (unit, API integration, UI E2E). Cancel-in-progress on new pushes, unchanged from today.
2. **PR merged to main.** Two workflows fire on the resulting push:
   - `ci.yml` runs against `main`, concurrency key `ci-${{ github.workflow }}-${{ github.ref }}`. A newer main push **cancels** the older in-progress run.
   - `knope-release-pr.yml` runs `knope prepare-release` and opens (or force-updates) the bot PR on `knope/release`. Concurrency key `knope-prepare` with `cancel-in-progress: true` collapses rapid-fire merges into a single recomputation.
3. **Release PR accumulates.** CI runs on the release PR like any PR. The release PR's commits are: the knope-authored `package.json` bump + `CHANGELOG.md` insertion.
4. **Human merges release PR.** The merge commit's `head_ref` is `knope/release` and `pull_request.merged == true`. `release.yml` triggers on `pull_request: closed` and gates on that condition. Everything below runs in `release.yml`:
   - `knope release` creates the git tag + GitHub Release
   - Build job produces `CHECKSUMS.txt`, uploads artifacts
   - Release job attaches SBOM (CycloneDX), cosign keyless signatures, GPG signature, SLSA build provenance
   - `docker.yml` is called via `workflow_call` and publishes versioned Docker images
5. **Auto-deploy fires.** `auto-deploy-demo.yml` triggers on `release: published` (unchanged). Waits for the Docker image manifest, then runs the Ansible deploy playbook against the demo VPS.

### Workflow responsibility matrix

| Event | ci.yml | knope-release-pr.yml | release.yml | docker.yml | auto-deploy-demo.yml |
|---|---|---|---|---|---|
| PR opened / updated | runs, cancels older | skip (not main push) | skip | skip | skip |
| Main push (normal) | runs, cancels older main runs | runs, cancels older | skip (gate fails) | skip | skip |
| Main push (release-PR merge) | skip (commit-msg gate) | skip (commit-msg gate) | **runs** | called via workflow_call | fires on release event |

### Commit / branch conventions

- Bot PR branch: `knope/release` (knope default, not configurable without custom steps).
- Bot PR title: `chore: prepare release v<X.Y.Z>` (set via `knope.toml` `[[workflows.steps]]` `Command` step).
- Bot commit message: identical to PR title.
- Release-commit detection uses **head_ref == 'knope/release' && pull_request.merged == true** on `release.yml`. The commit-message prefix check on `ci.yml` uses `startsWith(github.event.head_commit.message, 'chore: prepare release')`.

## Detailed design

### 1. `knope.toml` (new, repo root)

```toml
[package]
versioned_files = ["package.json"]
changelog = "CHANGELOG.md"

[package.extra_changelog_sections]
Security = ["security"]
Performance = ["perf"]

[[workflows]]
name = "prepare-release"

[[workflows.steps]]
type = "PrepareRelease"

[[workflows.steps]]
type = "Command"
command = "git commit -am \"chore: prepare release $version\""

[[workflows]]
name = "release"

[[workflows.steps]]
type = "Release"
```

**Notes:**
- `versioned_files` only lists `package.json`. `bun.lockb` does not embed the package version; a version-only bump leaves the lockfile untouched.
- `extra_changelog_sections` preserves the `security` and `perf` groupings the repo has used (visible in `cliff.toml` and recent commits). Defaults cover `feat`, `fix`, breaking changes.
- No `[github]` section: knope auto-detects owner/repo from `git remote get-url origin`. Keeps the config free of hardcoded org names.

### 2. `.github/workflows/knope-release-pr.yml` (new)

```yaml
name: Knope — Prepare Release PR

on:
  push:
    branches: [main]

concurrency:
  group: knope-prepare
  cancel-in-progress: true

permissions:
  contents: write
  pull-requests: write

jobs:
  prepare-release:
    if: "!startsWith(github.event.head_commit.message, 'chore: prepare release')"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}
      - uses: knope-dev/action@v2.1.2
        with:
          version: 0.22.4
      - run: knope prepare-release --verbose
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The inner commit-message gate prevents recursion: when the release PR is merged, its merge commit subject still starts with `chore: prepare release` and `knope-release-pr.yml` short-circuits.

### 3. `.github/workflows/release.yml` (rewritten)

**Trigger change:**

```yaml
on:
  pull_request:
    types: [closed]
    branches: [main]
```

**Gating job (new, replaces the old `changes` + `version` bash jobs):**

```yaml
jobs:
  check:
    if: >-
      github.event.pull_request.merged == true &&
      github.head_ref == 'knope/release'
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.read.outputs.version }}
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          ref: ${{ github.event.pull_request.merge_commit_sha }}
          fetch-depth: 0
      - id: read
        run: |
          VERSION=$(node -p "require('./package.json').version")
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
```

All downstream jobs (`build`, `release`, `docker`) gain `needs: check` and read the version from `needs.check.outputs.version`.

**Release job changes:**

- Drop the bash `knope prepare-release` equivalent (it already ran in the release PR).
- Add `knope-dev/action` + `knope release` step that creates the git tag and GitHub Release in one go.
- Keep all existing steps for SBOM (`@cyclonedx/cdxgen`), cosign keyless signing, GPG signing of `CHECKSUMS.txt`, SLSA build provenance attestation.
- Remove the `softprops/action-gh-release` step — knope's `Release` step replaces it, and file uploads happen via a separate follow-up step that uploads the signed artifacts to the knope-created release.
- Remove `git-cliff --latest --strip header > RELEASE_NOTES.md` — knope's `Release` step uses the `CHANGELOG.md` section for release notes automatically.

**Docker job:**

Unchanged mechanism (`workflow_call` → `docker.yml`), fed from `needs.check.outputs.version`.

### 4. `.github/workflows/ci.yml` (modified)

**Concurrency change:**

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

This gives:
- PR runs: cancel-in-progress per PR branch (unchanged from today).
- Main runs: cancel-in-progress on `refs/heads/main` → newer main push kills the older run.

**Release-commit skip gate:**

```yaml
jobs:
  changes:
    if: >-
      github.event_name != 'push' ||
      !startsWith(github.event.head_commit.message, 'chore: prepare release')
```

The release-PR merge commit message starts with `chore: prepare release` (set by `knope.toml`'s Command step). `ci.yml` skips on that commit because `release.yml` handles it.

### 5. Files removed

- `cliff.toml`
- `.github/actions/install-git-cliff/` (composite action, verify no other callers via `rg install-git-cliff`)
- `scripts/bump-version.ts` (verify no callers via `rg bump-version`)
- `package.json` scripts: `changelog`, `changelog:preview`, `version:bump`
- `git-cliff` from `devDependencies` if present

### 6. Files unchanged

- `.github/workflows/docker.yml` — still invoked via `workflow_call` from `release.yml`
- `.github/workflows/auto-deploy-demo.yml` — still triggered by `release: published`
- `.github/workflows/deploy-site.yml`
- `.github/workflows/desktop-e2e.yml`
- `.github/workflows/iso-builder.yml`
- `.github/workflows/load-test.yml`
- `.github/workflows/secret-scan.yml`
- `.github/workflows/security-audit.yml`

## Migration / cutover

### Pre-cutover local verification

1. `knope --validate` against the new `knope.toml` — catches TOML schema errors.
2. `knope prepare-release --dry-run` against the current repo state — inspect the diff to confirm version bump and changelog insertion match expectations for commits since `v0.50.0`.
3. `actionlint` on every modified/new workflow file.
4. `yamllint` on new/modified YAML for house-style consistency.
5. Grep sweeps to catch dangling references:
   - `rg 'cliff\.toml|git-cliff|install-git-cliff'` → no hits outside historical docs
   - `rg 'scripts/bump-version'` → no hits
   - `rg '"changelog"|"version:bump"' package.json` → no hits
6. `bun run typecheck && bun run build` — repo policy, no app changes expected.

### Cutover PR contents

A single atomic PR containing all the changes above. Leaving the repo in an in-between state would either double-release or fail to release.

### First release after cutover (live verification)

1. Merge cutover PR → main.
2. Observe `knope-release-pr.yml` firing → knope creates branch `knope/release` and opens a PR.
3. Inspect the auto-opened release PR: `package.json` bump correct, `CHANGELOG.md` has a new section with commits since `v0.50.0`, PR title matches `chore: prepare release vX.Y.Z`.
4. Push a trivial conventional commit to main (e.g. `docs: test release flow`). Observe knope-release-pr.yml re-runs and force-updates the existing PR. Confirms the "accumulating" behavior.
5. Merge the release PR.
6. Observe `release.yml` firing. Expected chain: knope tags → build produces checksums → release job attaches SBOM/cosign/GPG artifacts → `docker.yml` publishes images → `auto-deploy-demo.yml` fires on `release: published` → demo VPS receives deploy.
7. Verify demo VPS is running the new version within 10 minutes of release PR merge.
8. Regression check: push a second normal commit. Observe a new release PR opens (the old one was merged and deleted).

### Rollback plan

- Cutover PR is a single commit. Revert it; old workflows come back.
- Release PRs and tags are additive. A botched release PR can simply be closed with no side effects.
- If a bad release is cut, `scripts/verify-build.sh` + GH Release artifact deletion handle cleanup.

### Known non-issue

`auto-deploy-demo.yml` waits up to 10 minutes for Docker images to appear after a release event fires. The ordering `release → docker → deploy` remains safe.

## Testing approach

CI/CD workflow changes are hard to unit-test. The strategy is local dry-runs, actionlint static analysis, and a deliberate first live release as the acceptance test.

### Acceptance criteria

1. All local verification steps (knope validate, dry-run, actionlint, yamllint, grep sweeps) pass.
2. First real release after cutover:
   - Release PR opens automatically on next main push.
   - Release PR re-opens and force-updates on subsequent main pushes.
   - Merging the release PR produces a tagged GitHub Release with all expected artifacts (CHECKSUMS.txt, .asc, .cosign.sig, .cosign.pem, provenance.json, sbom.cdx.json).
   - Docker images are published to GHCR with the correct version tag.
   - Demo VPS is running the new version within 10 minutes.
3. Regression: a second main push after the release opens a fresh release PR (not a reopened merged one).
4. CI cancellation: two main pushes in quick succession result in the first run being cancelled and only the second finishing.

## Open questions

None blocking.

## References

- knope docs: https://knope.tech
- knope bot-workflow tutorial: https://knope.tech/tutorials/bot-workflow
- knope-dev/action: https://github.com/knope-dev/action (current: v2.1.2, knope: 0.22.4)
- Existing `release.yml`, `ci.yml`, `docker.yml`, `auto-deploy-demo.yml` in `.github/workflows/`
- Existing `cliff.toml` (to be removed)
