# Release Flow Overhaul (Knope) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace auto-release-on-every-merge with a knope-maintained release PR that accumulates conventional-commit changes from `main`, then releases (tag, GH release, Docker images, demo deploy) only when a human merges the release PR.

**Architecture:** A new `knope-release-pr.yml` workflow runs on every push to `main` and re-runs `knope prepare-release` to open or force-update the release PR on branch `knope/release`. `release.yml` is rewritten to trigger on `pull_request: closed` and gated on `head_ref == 'knope/release' && merged == true`. `ci.yml` concurrency is fixed so successive main pushes cancel older runs. `git-cliff`, `cliff.toml`, the `install-git-cliff` composite action, and the `bump-version.ts` script are removed.

**Tech Stack:** GitHub Actions, [knope](https://knope.tech) v0.22.4 via `knope-dev/action@v2.1.2`, conventional commits, Bun, existing SBOM/cosign/GPG/SLSA infrastructure (unchanged).

**Spec:** `docs/superpowers/specs/2026-04-14-release-flow-knope-design.md`

---

## File structure

**Create:**
- `knope.toml` (repo root) — knope package + workflow definitions
- `.github/workflows/knope-release-pr.yml` — runs `knope prepare-release` on every main push

**Modify:**
- `.github/workflows/release.yml` — full rewrite: new trigger, drop bash version detection, use knope for tag + GH release creation, keep all SBOM/cosign/GPG/SLSA/docker logic
- `.github/workflows/ci.yml` — fix concurrency group + add release-commit skip gate
- `package.json` — drop `changelog`, `changelog:preview`, `version:bump` scripts
- `README.md` — update the one git-cliff reference (line ~304) to mention knope

**Delete:**
- `cliff.toml`
- `.github/actions/install-git-cliff/action.yml` (and the directory)
- `scripts/bump-version.ts`

**Unchanged:** `docker.yml`, `auto-deploy-demo.yml`, `deploy-site.yml`, `desktop-e2e.yml`, `iso-builder.yml`, `load-test.yml`, `secret-scan.yml`, `security-audit.yml`.

---

## Task 1: Pre-flight verification

**Files:** none modified — verification only.

- [ ] **Step 1: Verify the worktree is on the right branch and clean**

```bash
cd ~/projects/llamenos-hotline-release-flow-knope
git status --short
git rev-parse --abbrev-ref HEAD
```

Expected: empty working tree, branch `feat/release-flow-knope`.

- [ ] **Step 2: Verify no callers of soon-to-be-deleted files outside the files we're rewriting**

```bash
rg -l 'install-git-cliff' .github/
rg -l 'scripts/bump-version' .
rg -n '"git-cliff"' package.json
```

Expected:
- `.github/workflows/release.yml` is the ONLY caller of `install-git-cliff` (lines 199 and 371) — that's the file we're rewriting in Task 4, OK to delete the action afterwards.
- `scripts/bump-version` only referenced by `package.json` (`version:bump` script) — that's the script we're removing in Task 6, no other callers.
- `git-cliff` is NOT a `devDependencies` entry in `package.json` (it's installed via the composite action) — nothing to remove from `dependencies`/`devDependencies`.

- [ ] **Step 3: Install knope locally for dry-run validation**

```bash
# Use the GitHub releases binary directly; cargo is not required.
KNOPE_VERSION=0.22.4
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) KNOPE_TRIPLE="x86_64-unknown-linux-musl" ;;
  aarch64) KNOPE_TRIPLE="aarch64-unknown-linux-musl" ;;
esac
curl -fsSL "https://github.com/knope-dev/knope/releases/download/knope%2Fv${KNOPE_VERSION}/knope-${KNOPE_TRIPLE}.tgz" \
  | tar -xz -C /tmp
sudo install /tmp/knope /usr/local/bin/knope
knope --version
```

Expected: `knope 0.22.4`.

- [ ] **Step 4: Install actionlint for workflow validation**

```bash
ACTIONLINT_VERSION=1.7.4
curl -fsSL "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz" \
  | tar -xz -C /tmp actionlint
sudo install /tmp/actionlint /usr/local/bin/actionlint
actionlint --version
```

Expected: `1.7.4`.

- [ ] **Step 5: No commit (verification only)**

---

## Task 2: Add `knope.toml`

**Files:**
- Create: `knope.toml`

- [ ] **Step 1: Write `knope.toml`**

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

- [ ] **Step 2: Validate the config**

```bash
cd ~/projects/llamenos-hotline-release-flow-knope
knope --validate
```

Expected: exit 0, no errors. If knope reports unknown keys, the version pin is wrong — re-check Task 1 step 3.

- [ ] **Step 3: Dry-run prepare-release**

```bash
git stash --keep-index --include-untracked
knope prepare-release --dry-run 2>&1 | tee /tmp/knope-dry-run.log
git stash pop
```

Expected: knope prints the planned version bump (likely `0.50.0 → 0.50.1` or `0.51.0` depending on commits since v0.50.0) and the changelog entries it would insert. If knope errors with "no commits to release", that means there are no `feat:`/`fix:`/etc. commits since v0.50.0 — that's fine, the dry-run still validated the config.

- [ ] **Step 4: Commit**

```bash
git add knope.toml
git commit -m "chore(release): add knope.toml for release PR flow"
```

---

## Task 3: Add `knope-release-pr.yml` workflow

**Files:**
- Create: `.github/workflows/knope-release-pr.yml`

- [ ] **Step 1: Write the workflow**

```yaml
# Maintain the release PR by re-running `knope prepare-release` on every
# push to main. Knope opens or force-updates a PR on the `knope/release`
# branch with the next version bump and a CHANGELOG.md entry. Merging
# that PR triggers release.yml to cut the actual release.

name: Knope — Prepare Release PR

on:
  push:
    branches: [main]

# Rapid-fire main merges collapse into a single recomputation.
concurrency:
  group: knope-prepare
  cancel-in-progress: true

permissions:
  contents: write
  pull-requests: write

jobs:
  prepare-release:
    # Skip the merge commit produced by merging the release PR itself,
    # otherwise we'd recursively try to prepare a release of the release.
    if: "!startsWith(github.event.head_commit.message, 'chore: prepare release')"
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Configure git identity
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

      - name: Install knope
        uses: knope-dev/action@a8e74ad7f4c80fef60aa9bbcdc54bd9bd1bc4dee # v2.1.2
        with:
          version: 0.22.4
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Prepare release PR
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: knope prepare-release --verbose
```

> **Note on the `knope-dev/action` SHA pin:** the SHA above is illustrative. Resolve the real SHA for tag `v2.1.2` during implementation:
>
> ```bash
> gh api repos/knope-dev/action/git/refs/tags/v2.1.2 --jq '.object.sha'
> ```
>
> Replace the placeholder before committing.

- [ ] **Step 2: Resolve and pin the action SHA**

```bash
SHA=$(gh api repos/knope-dev/action/git/refs/tags/v2.1.2 --jq '.object.sha')
echo "$SHA"
sed -i "s|a8e74ad7f4c80fef60aa9bbcdc54bd9bd1bc4dee|$SHA|" .github/workflows/knope-release-pr.yml
grep "knope-dev/action@" .github/workflows/knope-release-pr.yml
```

Expected: line shows `knope-dev/action@<actual-sha> # v2.1.2`.

- [ ] **Step 3: Validate with actionlint**

```bash
actionlint .github/workflows/knope-release-pr.yml
```

Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/knope-release-pr.yml
git commit -m "ci(release): add knope-release-pr workflow"
```

---

## Task 4: Rewrite `release.yml`

**Files:**
- Modify: `.github/workflows/release.yml` (full rewrite)

- [ ] **Step 1: Write the new `release.yml`**

Replace the **entire** contents of `.github/workflows/release.yml` with:

```yaml
# Release workflow — runs when the bot-maintained release PR (branch
# `knope/release`) is merged to main. Knope creates the tag + GitHub
# Release; this workflow attaches signed artifacts and triggers the
# Docker build.
#
# Steps:
#   1. Gate on release-PR merge (head_ref == 'knope/release', merged == true)
#   2. Read the new version from package.json (knope already bumped it)
#   3. Build the app (needed for CHECKSUMS and attestation)
#   4. Generate SBOM, sign with cosign keyless, GPG sign checksums
#   5. Run `knope release` to create the git tag + GitHub Release
#   6. Upload signed artifacts to the GitHub Release via gh CLI
#   7. Call docker.yml to publish versioned Docker images
#
# auto-deploy-demo.yml fires on the resulting `release: published` event.

name: Release

on:
  pull_request:
    types: [closed]
    branches: [main]

# Never cancel a release in progress.
concurrency:
  group: release
  cancel-in-progress: false

env:
  BUN_VERSION: "1.3.11"

jobs:
  # ─── Gate + version read ───────────────────────────────────
  check:
    if: >-
      github.event.pull_request.merged == true &&
      github.head_ref == 'knope/release'
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.read.outputs.version }}
    steps:
      - name: Checkout merge commit
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          ref: ${{ github.event.pull_request.merge_commit_sha }}
          fetch-depth: 0

      - name: Read new version from package.json
        id: read
        run: |
          VERSION=$(node -p "require('./package.json').version")
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          echo "Releasing v$VERSION"

  # ─── Build (needed for CHECKSUMS and attestation) ─────────────
  build:
    needs: check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          ref: ${{ github.event.pull_request.merge_commit_sha }}
      - uses: ./.github/actions/setup-bun
        with:
          bun-version: ${{ env.BUN_VERSION }}

      - name: Set build-time constants (Epic 79)
        run: |
          echo "SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)" >> "$GITHUB_ENV"

      - name: Build frontend
        run: bun run build

      - name: Compute build checksums (Epic 79)
        run: |
          cd dist
          find client -type f -exec sha256sum {} \; | sort > ../CHECKSUMS.txt
          cd ..
          sha256sum bun.lockb >> CHECKSUMS.txt
          echo "$(wc -l < CHECKSUMS.txt) files checksummed"

      - name: Upload app build
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: app-build
          path: dist/
          retention-days: 1

      - name: Upload checksums
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: checksums
          path: CHECKSUMS.txt
          retention-days: 7

  # ─── Tag + GitHub Release via knope, then attach artifacts ─
  release:
    needs: [check, build]
    runs-on: ubuntu-latest

    permissions:
      contents: write
      id-token: write       # OIDC for cosign keyless + attestations
      attestations: write

    steps:
      - name: Checkout merge commit
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          ref: ${{ github.event.pull_request.merge_commit_sha }}
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Configure git identity
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

      - name: Download checksums
        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0
        with:
          name: checksums

      - name: Download app build (for attestation)
        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0
        with:
          name: app-build
          path: dist/

      - name: Generate SLSA build provenance attestation (Epic 79)
        uses: actions/attest-build-provenance@ef244123eb79f2f7a7e75d99086184180e6d0018 # v2.1.0
        with:
          subject-path: |
            CHECKSUMS.txt
            dist/client/**/*.js
            dist/client/**/*.css

      - name: Generate provenance metadata JSON (Epic 79)
        env:
          NEW_VERSION: ${{ needs.check.outputs.version }}
        run: |
          cat > provenance.json <<PROVEOF
          {
            "builder": { "id": "https://github.com/actions/runner" },
            "buildType": "https://github.com/slsa-framework/slsa/blob/main/docs/spec/v1.0/levels.md",
            "invocation": {
              "configSource": {
                "uri": "git+https://github.com/${{ github.repository }}@refs/tags/v${NEW_VERSION}",
                "digest": { "sha1": "${{ github.event.pull_request.merge_commit_sha }}" },
                "entryPoint": ".github/workflows/release.yml"
              },
              "parameters": {
                "SOURCE_DATE_EPOCH": "$(git log -1 --format=%ct)",
                "bunVersion": "${{ env.BUN_VERSION }}"
              }
            },
            "buildConfig": {
              "dockerfile": "Dockerfile.build",
              "steps": ["bun install --frozen-lockfile", "bun run build"]
            },
            "metadata": {
              "buildStartedOn": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
              "buildFinishedOn": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
              "completeness": { "parameters": true, "environment": false, "materials": false },
              "reproducible": true
            },
            "materials": [
              {
                "uri": "git+https://github.com/${{ github.repository }}@refs/tags/v${NEW_VERSION}",
                "digest": { "sha1": "${{ github.event.pull_request.merge_commit_sha }}" }
              }
            ]
          }
          PROVEOF
          python3 -c "
          import json
          with open('provenance.json') as f:
              data = json.load(f)
          with open('provenance.json', 'w') as f:
              json.dump(data, f, indent=2)
          "
          echo "--- provenance.json ---"
          cat provenance.json

      - name: Generate CycloneDX SBOM
        run: |
          npx --yes @cyclonedx/cdxgen -o sbom.cdx.json --spec-version 1.5
          echo "SBOM generated: $(jq '.components | length' sbom.cdx.json) components"

      - name: Install cosign
        uses: sigstore/cosign-installer@dc72c7d5c4d10cd6bcb8cf6e3fd625a9e5e537da # v3.7.0

      - name: Attest SBOM
        run: |
          cosign attest-blob --yes \
            --predicate sbom.cdx.json \
            --type cyclonedx \
            --output-file sbom.cdx.json.att \
            CHECKSUMS.txt
          echo "SBOM attestation attached to CHECKSUMS.txt"

      - name: Sign release artifacts (keyless)
        run: |
          for f in CHECKSUMS.txt provenance.json; do
            [ -f "$f" ] || continue
            cosign sign-blob --yes \
              --output-signature "${f}.cosign.sig" \
              --output-certificate "${f}.cosign.pem" \
              "$f"
            echo "Signed: $f"
          done

      - name: GPG sign CHECKSUMS.txt (Epic 79)
        env:
          GPG_PRIVATE_KEY: ${{ secrets.RELEASE_GPG_PRIVATE_KEY }}
          GPG_KEY_ID: ${{ secrets.RELEASE_GPG_KEY_ID }}
        run: |
          if [ -z "$GPG_PRIVATE_KEY" ] || [ -z "$GPG_KEY_ID" ]; then
            echo "GPG signing secrets not configured — skipping signature"
            exit 0
          fi
          echo "$GPG_PRIVATE_KEY" | gpg --batch --import
          gpg --batch --armor --local-user "$GPG_KEY_ID" --detach-sign CHECKSUMS.txt
          echo "GPG signature generated: CHECKSUMS.txt.asc"
          gpg --verify CHECKSUMS.txt.asc CHECKSUMS.txt
          echo "GPG signature verified successfully"

      - name: Install knope
        uses: knope-dev/action@a8e74ad7f4c80fef60aa9bbcdc54bd9bd1bc4dee # v2.1.2
        with:
          version: 0.22.4
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Create tag and GitHub Release via knope
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: knope release --verbose

      - name: Upload signed artifacts to GitHub Release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NEW_VERSION: ${{ needs.check.outputs.version }}
        run: |
          ARTIFACTS=()
          for f in \
            CHECKSUMS.txt \
            CHECKSUMS.txt.asc \
            CHECKSUMS.txt.cosign.sig \
            CHECKSUMS.txt.cosign.pem \
            provenance.json \
            provenance.json.cosign.sig \
            provenance.json.cosign.pem \
            sbom.cdx.json \
            sbom.cdx.json.att; do
            [ -f "$f" ] && ARTIFACTS+=("$f")
          done
          gh release upload "v${NEW_VERSION}" "${ARTIFACTS[@]}" --clobber

  # ─── Docker Image Publish ─────────────────────────────────
  docker:
    needs: [check, release]
    uses: ./.github/workflows/docker.yml
    with:
      version: ${{ needs.check.outputs.version }}
      ref: refs/tags/v${{ needs.check.outputs.version }}
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write
      security-events: write
    secrets: inherit
```

- [ ] **Step 2: Resolve the knope-dev/action SHA in this file too**

```bash
SHA=$(gh api repos/knope-dev/action/git/refs/tags/v2.1.2 --jq '.object.sha')
sed -i "s|a8e74ad7f4c80fef60aa9bbcdc54bd9bd1bc4dee|$SHA|g" .github/workflows/release.yml
grep "knope-dev/action@" .github/workflows/release.yml
```

Expected: line shows the real SHA.

- [ ] **Step 3: Validate with actionlint**

```bash
actionlint .github/workflows/release.yml
```

Expected: exit 0. If actionlint complains about `secrets.GITHUB_TOKEN` in a `pull_request` workflow, it's likely a false positive — the workflow only runs on `pull_request: closed` from the same repo (release PR is opened by knope on the same repo, not a fork). Add an inline `# actionlint:disable` comment only if the warning is actually wrong; otherwise fix the issue.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): rewrite release.yml to trigger on release PR merge"
```

---

## Task 5: Modify `ci.yml` concurrency + skip gate

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Fix concurrency group**

Replace lines 25-30 of `.github/workflows/ci.yml`:

```yaml
# Cancel in-progress PR runs when new commits are pushed.
# For push-to-main, include run_id so main runs never cancel each other and
# the notify-main-failure hook always gets a chance to fire.
concurrency:
  group: ci-${{ github.ref }}-${{ github.event_name == 'push' && github.run_id || 'pr' }}
  cancel-in-progress: true
```

with:

```yaml
# Cancel in-progress runs when new commits are pushed. Both PR and main
# runs collapse on the same ref so rapid merges don't burn CI minutes.
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

- [ ] **Step 2: Add release-commit skip gate to the `changes` job**

Find the `changes:` job (around line 51 of `ci.yml`) and add an `if:` immediately under `runs-on: ubuntu-latest`:

```yaml
  changes:
    runs-on: ubuntu-latest
    # Release-PR merge commits are handled by release.yml; skip CI for them.
    if: >-
      github.event_name != 'push' ||
      !startsWith(github.event.head_commit.message, 'chore: prepare release')

    outputs:
      app: ${{ steps.filter.outputs.app }}
      site: ${{ steps.filter.outputs.site }}
      docs_only: ${{ steps.filter.outputs.docs_only }}
      ansible: ${{ steps.filter.outputs.ansible }}
```

- [ ] **Step 3: Validate with actionlint**

```bash
actionlint .github/workflows/ci.yml
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: cancel in-progress main runs and skip release-PR merge commits"
```

---

## Task 6: Remove git-cliff and bump-version artifacts

**Files:**
- Delete: `cliff.toml`
- Delete: `.github/actions/install-git-cliff/action.yml` (and the directory)
- Delete: `scripts/bump-version.ts`
- Modify: `package.json` (remove three scripts)
- Modify: `README.md` (update the git-cliff reference)

- [ ] **Step 1: Delete `cliff.toml`**

```bash
git rm cliff.toml
```

- [ ] **Step 2: Delete the `install-git-cliff` composite action**

```bash
git rm -r .github/actions/install-git-cliff
```

- [ ] **Step 3: Delete `scripts/bump-version.ts`**

```bash
git rm scripts/bump-version.ts
```

- [ ] **Step 4: Remove the three scripts from `package.json`**

Edit `package.json`. Find lines (around 39-41):

```json
    "changelog": "git-cliff --output CHANGELOG.md",
    "changelog:preview": "git-cliff --unreleased",
    "version:bump": "bun run scripts/bump-version.ts",
```

Delete those three lines. The surrounding context (`prepare`, `test`, etc.) should remain. After the edit, run `node -e "JSON.parse(require('fs').readFileSync('package.json'))"` — expect no output (success).

- [ ] **Step 5: Update `README.md` line ~304**

Find the line:

```
3. **Changelog** — generates via [git-cliff](https://git-cliff.org) from commit history
```

Replace with:

```
3. **Changelog** — maintained by [knope](https://knope.tech) in a release PR; merging the PR cuts the release
```

- [ ] **Step 6: Verify no dangling references**

```bash
rg -n 'git-cliff|install-git-cliff|cliff\.toml' .github/ package.json README.md scripts/
rg -n 'bump-version' .github/ package.json scripts/
rg -n '"changelog"|"version:bump"' package.json
```

Expected: zero hits across `.github/`, `package.json`, `README.md`, and `scripts/`. Hits inside `docs/` (specs, audits) are historical records and stay.

- [ ] **Step 7: Validate package.json is still valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))" && echo OK
```

Expected: `OK`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(release): remove git-cliff and bump-version in favor of knope"
```

---

## Task 7: Final verification

**Files:** none modified — verification only.

- [ ] **Step 1: Lint all modified workflow files**

```bash
actionlint \
  .github/workflows/ci.yml \
  .github/workflows/release.yml \
  .github/workflows/knope-release-pr.yml
```

Expected: exit 0.

- [ ] **Step 2: Validate knope.toml again**

```bash
knope --validate
```

Expected: exit 0.

- [ ] **Step 3: Run typecheck and build (repo policy)**

```bash
bun run typecheck
bun run build
```

Expected: both exit 0. No app code changed, so this should be a no-op verification.

- [ ] **Step 4: Inspect the full set of changes**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Expected: 6 commits (one per Task 2-6, plus this verification produces no commit), modifying ~5 files and deleting ~3.

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feat/release-flow-knope
```

Expected: branch pushed, GitHub returns a "create PR" URL.

- [ ] **Step 6: Open the PR**

```bash
gh pr create --title "ci(release): knope release-PR flow" --body "$(cat <<'EOF'
## Summary
- Replace auto-release-on-every-merge with a knope-maintained release PR
- Add `knope-release-pr.yml` running `knope prepare-release` on every main push
- Rewrite `release.yml` to trigger on release-PR merge (`head_ref == 'knope/release'`)
- Fix `ci.yml` concurrency so successive main pushes cancel older in-progress runs
- Remove `git-cliff`, `cliff.toml`, `install-git-cliff` composite action, `scripts/bump-version.ts`

## Test plan
- [ ] CI passes on this PR
- [ ] After merge: `knope-release-pr.yml` opens a release PR on next main push
- [ ] After merge: pushing a trivial commit force-updates the existing release PR (accumulating behavior)
- [ ] Merging the release PR triggers `release.yml`, which tags, creates a GitHub Release with all signed artifacts (CHECKSUMS, .asc, .cosign.sig, .cosign.pem, provenance.json, sbom.cdx.json), and calls `docker.yml`
- [ ] `auto-deploy-demo.yml` fires on the resulting release event and deploys to the demo VPS
- [ ] A second main push after the release opens a fresh release PR (not a reopened merged one)
- [ ] Two main pushes in quick succession: only the second CI run finishes, the first is cancelled

## Spec
`docs/superpowers/specs/2026-04-14-release-flow-knope-design.md`
EOF
)"
```

Expected: PR URL returned. Capture it for the next step.

---

## Post-merge live verification (separate session, after the cutover PR merges)

These steps run **after** the cutover PR is merged to main. They are the real acceptance test for the new flow.

- [ ] **L1:** Watch GitHub Actions on the post-merge main push. Confirm `knope-release-pr.yml` runs and opens a PR titled `chore: prepare release vX.Y.Z` on branch `knope/release`.

- [ ] **L2:** Open the release PR. Confirm `package.json` version is bumped and `CHANGELOG.md` has a new section listing commits since `v0.50.0`.

- [ ] **L3:** Push a trivial conventional commit to main:

```bash
cd ~/projects/llamenos-hotline
git checkout main && git pull
echo "" >> docs/NEXT_BACKLOG.md
git commit -am "docs: smoke-test release flow accumulation"
git push
```

Confirm `knope-release-pr.yml` re-runs and force-updates the existing release PR (no new PR opened).

- [ ] **L4:** Merge the release PR via the GitHub UI.

- [ ] **L5:** Watch `release.yml` fire. Confirm: build → SBOM/cosign/GPG/SLSA → `knope release` creates the tag + GH Release → artifacts uploaded → `docker.yml` called → images pushed to GHCR with `vX.Y.Z` and `X.Y.Z` tags.

- [ ] **L6:** Watch `auto-deploy-demo.yml` fire on the `release: published` event. Confirm it waits for the Docker image and runs the Ansible playbook successfully.

- [ ] **L7:** SSH into the demo VPS (or hit its health endpoint) and confirm it's running the new version.

- [ ] **L8:** Push another trivial commit to main. Confirm a brand-new release PR opens (not the merged one re-appearing).

- [ ] **L9:** Verify CI cancellation: push two trivial commits to main back-to-back (within ~30 seconds). In the Actions tab, confirm the older `ci.yml` run is cancelled and only the newer one finishes.

If L1-L9 all pass, the migration is complete. If any step fails, revert the cutover PR (a single commit) and the old flow resumes immediately.
