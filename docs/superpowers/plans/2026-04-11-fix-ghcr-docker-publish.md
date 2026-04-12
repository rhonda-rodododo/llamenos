# Fix GHCR Docker Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.github/workflows/docker.yml` actually publish hardened, signed, attested container images to GHCR on every release tag cut by `release.yml`.

**Architecture:** Turn `docker.yml` into a reusable workflow (`on: workflow_call`) and have `release.yml` invoke it as a downstream job after the tag is created. This bypasses the `GITHUB_TOKEN` downstream-trigger suppression rule that has prevented `docker.yml` from ever running. Layer supply-chain hardening on top: full SHA action pinning, StepSecurity harden-runner, SBOM + SLSA provenance, GitHub-native build-provenance attestation, cosign keyless OIDC signing, and a pre-push Trivy CRITICAL/HIGH gate.

**Tech Stack:** GitHub Actions, `docker/build-push-action@v7`, `sigstore/cosign@v4`, `step-security/harden-runner@v2`, `actions/attest-build-provenance@v4`, `aquasecurity/trivy-action`, `actionlint` (local validator).

**Reference spec:** `docs/superpowers/specs/2026-04-11-fix-ghcr-docker-publish-design.md`

---

## File Structure

Files touched in this plan:

| Path | Role | Action |
|------|------|--------|
| `.github/workflows/docker.yml` | The reusable Docker build workflow — both `app` and `bridge` jobs | Rewrite |
| `.github/workflows/release.yml` | Release workflow — adds a `docker` job that calls the reusable workflow | Modify (add job) |
| `docs/superpowers/specs/2026-04-11-fix-ghcr-docker-publish-design.md` | The spec (already written, to be included in the PR) | Cherry-pick |

No other files are modified. No new files besides the plan itself.

---

## Pinned Action SHAs (resolved 2026-04-11)

Copy these verbatim into `docker.yml`. If more than a week has passed since this plan was written, re-run the resolver in **Task 2** and update.

```
actions/checkout                    @de0fac2e4500dabe0009e67214ff5f5447ce83dd  # v6.0.2
docker/setup-buildx-action          @4d04d5d9486b7bd6fa91e7baf45bbb4f8b9deedd  # v4.0.0
docker/login-action                 @4907a6ddec9925e35a0a9e82d7399ccc52663121  # v4.1.0
docker/metadata-action              @030e881283bb7a6894de51c315a6bfe6a94e05cf  # v6.0.0
docker/build-push-action            @bcafcacb16a39f128d818304e6c9c0c18556b85f  # v7.1.0
aquasecurity/trivy-action           @57a97c7e7821a5776cebc9bb87c984fa69cba8f1  # v0.35.0
github/codeql-action/upload-sarif   @c10b8064de6f491fea524254123dbe5e09572f13  # v4.35.1
step-security/harden-runner         @f808768d1510423e83855289c910610ca9b43176  # v2.17.0
sigstore/cosign-installer           @cad07c2e89fa2edd6e2d7bab4c1aa38e53f76003  # v4.1.1
actions/attest-build-provenance     @a2bbfa25375fe432b6a289bc6b6cd05ecd0c4c32  # v4.1.0
```

Note: `release.yml` currently pins `actions/attest-build-provenance@ef244123eb79f2f7a7e75d99086184180e6d0018 # v2.1.0`. **Do not bump it in this PR** — that's out of scope. Use v4.1.0 only in `docker.yml`. A follow-up can unify them.

---

## Task 1: Set up the worktree and rebase the spec onto a feature branch

The spec lives in three commits on local `main` (`318ee588`, `6540edc1`, `c0db6f16`) that have not been pushed. We need them on a feature branch in a new worktree so the PR contains both the spec and the code changes together.

**Files:**
- Create: worktree at `~/projects/llamenos-hotline-fix-ghcr-publish`

- [ ] **Step 1: Create the worktree off current `main`**

Run from the main repo directory:

```bash
cd "$(git rev-parse --show-toplevel)"  # main repo worktree (not the feature worktree)
git worktree add ~/projects/llamenos-hotline-fix-ghcr-publish -b ci/fix-ghcr-publish
```

Expected: `Preparing worktree (new branch 'ci/fix-ghcr-publish')` and the worktree directory is created with the three local spec commits already on the branch tip.

- [ ] **Step 2: Reset local `main` to `origin/main` so the spec commits live only on the feature branch**

```bash
cd "$(git rev-parse --show-toplevel)"  # main repo worktree (not the feature worktree)
git fetch origin main
git reset --hard origin/main
```

Expected: `HEAD is now at 991074a8 docs(queue): all prep PRs merged; ...`. `git log --oneline -5` should NOT show the three spec commits.

- [ ] **Step 3: Verify the spec commits are still on the feature branch in the worktree**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
git log --oneline origin/main..HEAD
```

Expected output (3 lines, exact SHAs may differ if commits were amended):

```
c0db6f16 docs(specs): rewrite ghcr spec — option A + supply-chain hardening
6540edc1 docs(specs): self-review fixes to ghcr docker publish design
318ee588 docs(specs): fix ghcr docker publish design
```

- [ ] **Step 4: Install dependencies in the worktree so lefthook hooks work**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
bun install
```

Expected: install succeeds, `node_modules/@evilmartians/lefthook/` exists.

---

## Task 2: Install actionlint and baseline existing workflows

`actionlint` is our YAML-level validator. Every workflow edit in this plan is gated on it.

**Files:** none yet

- [ ] **Step 1: Install actionlint**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
# Use Go if available, otherwise download the prebuilt binary
if command -v go >/dev/null 2>&1; then
  go install github.com/rhysd/actionlint/cmd/actionlint@latest
else
  bash <(curl -sSL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash)
  # downloads to ./actionlint; move to ~/bin or use ./actionlint in subsequent steps
fi
actionlint -version
```

Expected: version string printed (e.g., `1.7.x`).

- [ ] **Step 2: Run actionlint against the two files we'll be editing to establish a green baseline**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
actionlint .github/workflows/docker.yml .github/workflows/release.yml
echo "exit=$?"
```

Expected: `exit=0` with no output. If there are pre-existing warnings unrelated to this plan, note them but don't fix them — out of scope.

- [ ] **Step 3: (Optional) Refresh the pinned SHAs if more than a week has passed since this plan was written**

Run the same resolver used when writing the plan:

```bash
for repo in "actions/checkout" "docker/setup-buildx-action" "docker/login-action" "docker/metadata-action" "docker/build-push-action" "aquasecurity/trivy-action" "github/codeql-action" "step-security/harden-runner" "sigstore/cosign-installer" "actions/attest-build-provenance"; do
  tag=$(gh api "/repos/${repo}/releases/latest" --jq '.tag_name' 2>/dev/null)
  [ -z "$tag" ] && { printf "%-40s NO_RELEASE\n" "$repo"; continue; }
  ref=$(gh api "/repos/${repo}/git/refs/tags/${tag}" --jq '{type: .object.type, sha: .object.sha}')
  sha=$(echo "$ref" | grep -o '"sha":"[^"]*"' | cut -d'"' -f4)
  obj_type=$(echo "$ref" | grep -o '"type":"[^"]*"' | cut -d'"' -f4)
  if [ "$obj_type" = "tag" ]; then
    sha=$(gh api "/repos/${repo}/git/tags/${sha}" --jq '.object.sha')
  fi
  printf "%-40s @%s  # %s\n" "$repo" "$sha" "$tag"
done
```

Expected: a table of `owner/name  @sha  # tag` lines. Compare to the "Pinned Action SHAs" table at the top of this plan and update any that have moved.

---

## Task 3: Rewrite `docker.yml` — top-level structure

Replace the existing `docker.yml` with the new shape. This task only writes the `on:`, `env:`, `permissions:`, `concurrency:`, and empty job skeletons. Task 4+ fill in the job bodies.

**Files:**
- Modify: `.github/workflows/docker.yml` (full rewrite)

- [ ] **Step 1: Write the new `docker.yml` top section**

Open `.github/workflows/docker.yml` and replace **the entire file** with the following (jobs will be added in subsequent tasks — keep the `app:` and `bridge:` keys as empty placeholders for now):

```yaml
# Reusable Docker build workflow.
# Invoked by release.yml after a new version tag is cut. Not directly triggered
# by tag pushes because release.yml uses GITHUB_TOKEN to push, and that token
# cannot trigger downstream workflows. workflow_call sidesteps that rule.
#
# Publishes the `llamenos-hotline` app image and the `llamenos-hotline-sip-bridge`
# image to GHCR with: full SHA-pinned actions, StepSecurity harden-runner,
# SBOM + SLSA build provenance, GitHub-native build-provenance attestation,
# cosign keyless OIDC signature, and a pre-push Trivy CRITICAL/HIGH gate.
name: Docker Build

on:
  workflow_call:
    inputs:
      version:
        description: 'Semver version being released, e.g. "1.2.3" (no leading v)'
        required: true
        type: string
      ref:
        description: 'Git ref to check out (typically refs/tags/vX.Y.Z)'
        required: true
        type: string
  workflow_dispatch:
    inputs:
      version:
        description: 'Semver override for manual runs; leave empty to publish only latest + sha'
        required: false
        type: string
        default: ''
      ref:
        description: 'Git ref to check out; defaults to the current default branch'
        required: false
        type: string
        default: ''
  push:
    tags: ['v*']  # dormant fallback — currently unreachable under GITHUB_TOKEN-authored tag pushes

# Deny everything at workflow level; each job opts into the minimum scopes it needs.
permissions: {}

# Tag-triggered runs should always complete; manual dispatches can be superseded safely.
concurrency:
  group: docker-${{ github.ref }}-${{ inputs.version || github.sha }}
  cancel-in-progress: false

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  app:
    # Filled in by Task 4-7
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      id-token: write         # OIDC for cosign keyless + attestations
      attestations: write     # GH attestation store
      security-events: write  # SARIF upload to code scanning
    steps: []

  bridge:
    # Filled in by Task 8
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write
      security-events: write
    steps: []
```

- [ ] **Step 2: Run actionlint — expect a job-without-steps error**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
actionlint .github/workflows/docker.yml
echo "exit=$?"
```

Expected: actionlint complains that `steps: []` is empty for both jobs. That's fine — we fill them in Tasks 4-8. Do NOT commit yet. If actionlint errors on anything ELSE (trigger syntax, permissions syntax, env), fix it before moving on.

**Note:** if actionlint cannot tolerate empty steps even temporarily, insert a single placeholder step in each job:

```yaml
    steps:
      - name: Placeholder
        run: 'true'
```

…and remove it when you add the real first step in Task 4.

---

## Task 4: `app` job — checkout, harden-runner, buildx, login, metadata

**Files:**
- Modify: `.github/workflows/docker.yml` (app job `steps:` section)

- [ ] **Step 1: Replace the `app` job's `steps: []` with the following**

```yaml
    steps:
      - name: Harden the runner (audit egress)
        uses: step-security/harden-runner@f808768d1510423e83855289c910610ca9b43176 # v2.17.0
        with:
          egress-policy: audit

      - name: Resolve ref to check out
        id: resolve_ref
        env:
          INPUT_REF: ${{ inputs.ref }}
        run: |
          if [ -n "$INPUT_REF" ]; then
            echo "ref=$INPUT_REF" >> "$GITHUB_OUTPUT"
          else
            echo "ref=${{ github.ref }}" >> "$GITHUB_OUTPUT"
          fi

      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{ steps.resolve_ref.outputs.ref }}
          persist-credentials: false

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@4d04d5d9486b7bd6fa91e7baf45bbb4f8b9deedd # v4.0.0

      - name: Log in to GHCR
        uses: docker/login-action@4907a6ddec9925e35a0a9e82d7399ccc52663121 # v4.1.0
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract image metadata
        id: meta
        uses: docker/metadata-action@030e881283bb7a6894de51c315a6bfe6a94e05cf # v6.0.0
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          # Tag rules:
          #   - semver rules are gated on a non-empty version input (workflow_call always
          #     has one; workflow_dispatch may not). Without the guard, value=v is passed
          #     to the semver parser and the step fails.
          #   - `latest` fires only when the checked-out ref is on the default branch.
          #     release.yml commits+tags on main, so the tag points at the main tip at
          #     publish time → is_default_branch is true → latest applies. Manual dispatches
          #     against other branches get only sha-.
          #   - sha- is always present for traceability.
          tags: |
            type=semver,pattern={{version}},value=v${{ inputs.version }},enable=${{ inputs.version != '' }}
            type=semver,pattern={{major}}.{{minor}},value=v${{ inputs.version }},enable=${{ inputs.version != '' }}
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,format=short,prefix=sha-
```

- [ ] **Step 2: Run actionlint**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
actionlint .github/workflows/docker.yml
echo "exit=$?"
```

Expected: errors only on the still-empty `bridge` job's `steps: []` (unchanged from Task 3). Every error should point at line numbers in the `bridge:` block. If any error points at the `app:` block, fix it before moving on.

---

## Task 5: `app` job — Phase 1 scan build + Trivy CRITICAL/HIGH gate

This is the "scan before push" gate. Phase 1 builds to the local Docker daemon via `load: true`; Trivy scans it; Phase 2 (Task 6) re-builds from cache and pushes. Buildx's `docker-container` driver supports `load: true` for single-platform builds — multi-arch migration will have to rework this (see spec follow-ups).

**Files:**
- Modify: `.github/workflows/docker.yml` (app job, append after `meta` step)

- [ ] **Step 1: Append the Phase 1 + Trivy steps after the `meta` step**

```yaml
      # Phase 1: build for local Trivy scan. load: true requires single-platform.
      # When multi-arch is introduced, this pattern must be reworked — see spec follow-ups.
      - name: Build (phase 1 — for scanning, not pushed)
        id: build_scan
        uses: docker/build-push-action@bcafcacb16a39f128d818304e6c9c0c18556b85f # v7.1.0
        with:
          context: .
          file: deploy/docker/Dockerfile
          load: true
          push: false
          tags: local-scan:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            BUILD_VERSION=${{ inputs.version }}
            BUILD_COMMIT=${{ github.sha }}
            BUILD_TIME=${{ github.event.repository.updated_at }}

      - name: Scan image for CRITICAL/HIGH CVEs (fail on hit)
        uses: aquasecurity/trivy-action@57a97c7e7821a5776cebc9bb87c984fa69cba8f1 # v0.35.0
        with:
          image-ref: local-scan:${{ github.sha }}
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
          ignore-unfixed: true
          exit-code: '1'

      - name: Upload Trivy SARIF to code scanning
        if: always()  # upload even when the scan step failed
        uses: github/codeql-action/upload-sarif@c10b8064de6f491fea524254123dbe5e09572f13 # v4.35.1
        with:
          sarif_file: 'trivy-results.sarif'
          category: trivy-app
```

- [ ] **Step 2: Run actionlint**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
actionlint .github/workflows/docker.yml
echo "exit=$?"
```

Expected: still only the `bridge` job empty-steps error. Fix any new `app`-block errors before moving on.

---

## Task 6: `app` job — Phase 2 push build with SBOM + provenance

**Files:**
- Modify: `.github/workflows/docker.yml` (app job, append after Trivy SARIF upload step)

- [ ] **Step 1: Append the Phase 2 push build step**

```yaml
      # Phase 2: re-build from cache and push. sbom + provenance attach SPDX SBOM
      # and SLSA build provenance to the image manifest as OCI referrers.
      - name: Build and push (phase 2)
        id: build_push
        uses: docker/build-push-action@bcafcacb16a39f128d818304e6c9c0c18556b85f # v7.1.0
        with:
          context: .
          file: deploy/docker/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          sbom: true
          provenance: mode=max
          build-args: |
            BUILD_VERSION=${{ inputs.version }}
            BUILD_COMMIT=${{ github.sha }}
            BUILD_TIME=${{ github.event.repository.updated_at }}
```

- [ ] **Step 2: Run actionlint**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
actionlint .github/workflows/docker.yml
echo "exit=$?"
```

Expected: same as before — only `bridge` empty-steps errors.

---

## Task 7: `app` job — GitHub attestation + cosign keyless signing

**Files:**
- Modify: `.github/workflows/docker.yml` (app job, append after Phase 2 build step)

- [ ] **Step 1: Append attestation and cosign signing steps**

```yaml
      - name: Attest image build provenance (GitHub)
        uses: actions/attest-build-provenance@a2bbfa25375fe432b6a289bc6b6cd05ecd0c4c32 # v4.1.0
        with:
          subject-name: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          subject-digest: ${{ steps.build_push.outputs.digest }}
          push-to-registry: true

      - name: Install cosign
        uses: sigstore/cosign-installer@cad07c2e89fa2edd6e2d7bab4c1aa38e53f76003 # v4.1.1

      - name: Sign image with cosign (keyless, OIDC)
        env:
          DIGEST: ${{ steps.build_push.outputs.digest }}
          IMAGE: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
        run: |
          cosign sign --yes "${IMAGE}@${DIGEST}"
```

- [ ] **Step 2: Run actionlint**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
actionlint .github/workflows/docker.yml
echo "exit=$?"
```

Expected: only the `bridge` empty-steps error remains.

- [ ] **Step 3: Commit progress — app job complete**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
git add .github/workflows/docker.yml
git commit -m "$(cat <<'EOF'
ci(docker): rewrite app job as reusable workflow with hardening

- workflow_call trigger so release.yml can invoke downstream
- full SHA pinning, harden-runner audit, scoped permissions
- scan-before-push Trivy gate (phase 1 load → scan → phase 2 push)
- SBOM + SLSA provenance attached to image manifest
- GitHub-native build-provenance attestation
- cosign keyless signing via OIDC

bridge job still empty — filled in next commit.
EOF
)"
```

---

## Task 8: `bridge` job — mirror the app job for `sip-bridge/Dockerfile`

The bridge job is identical to the app job in shape, differing only in the image name (`llamenos-hotline-sip-bridge`) and the Dockerfile path (`sip-bridge/Dockerfile`). DRY via a second job rather than a matrix because the per-image metadata and digest outputs are cleaner as separate jobs. If this plan grows a third image, revisit with a matrix strategy.

**Files:**
- Modify: `.github/workflows/docker.yml` (bridge job `steps:` section)

- [ ] **Step 1: Replace the `bridge` job's `steps: []` with the full step list**

```yaml
    steps:
      - name: Harden the runner (audit egress)
        uses: step-security/harden-runner@f808768d1510423e83855289c910610ca9b43176 # v2.17.0
        with:
          egress-policy: audit

      - name: Resolve ref to check out
        id: resolve_ref
        env:
          INPUT_REF: ${{ inputs.ref }}
        run: |
          if [ -n "$INPUT_REF" ]; then
            echo "ref=$INPUT_REF" >> "$GITHUB_OUTPUT"
          else
            echo "ref=${{ github.ref }}" >> "$GITHUB_OUTPUT"
          fi

      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{ steps.resolve_ref.outputs.ref }}
          persist-credentials: false

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@4d04d5d9486b7bd6fa91e7baf45bbb4f8b9deedd # v4.0.0

      - name: Log in to GHCR
        uses: docker/login-action@4907a6ddec9925e35a0a9e82d7399ccc52663121 # v4.1.0
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract image metadata
        id: meta
        uses: docker/metadata-action@030e881283bb7a6894de51c315a6bfe6a94e05cf # v6.0.0
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}-sip-bridge
          tags: |
            type=semver,pattern={{version}},value=v${{ inputs.version }},enable=${{ inputs.version != '' }}
            type=semver,pattern={{major}}.{{minor}},value=v${{ inputs.version }},enable=${{ inputs.version != '' }}
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,format=short,prefix=sha-

      - name: Build (phase 1 — for scanning, not pushed)
        id: build_scan
        uses: docker/build-push-action@bcafcacb16a39f128d818304e6c9c0c18556b85f # v7.1.0
        with:
          context: .
          file: sip-bridge/Dockerfile
          load: true
          push: false
          tags: local-scan-bridge:${{ github.sha }}
          cache-from: type=gha,scope=bridge
          cache-to: type=gha,mode=max,scope=bridge

      - name: Scan image for CRITICAL/HIGH CVEs (fail on hit)
        uses: aquasecurity/trivy-action@57a97c7e7821a5776cebc9bb87c984fa69cba8f1 # v0.35.0
        with:
          image-ref: local-scan-bridge:${{ github.sha }}
          format: 'sarif'
          output: 'trivy-results-bridge.sarif'
          severity: 'CRITICAL,HIGH'
          ignore-unfixed: true
          exit-code: '1'

      - name: Upload Trivy SARIF to code scanning
        if: always()
        uses: github/codeql-action/upload-sarif@c10b8064de6f491fea524254123dbe5e09572f13 # v4.35.1
        with:
          sarif_file: 'trivy-results-bridge.sarif'
          category: trivy-bridge

      - name: Build and push (phase 2)
        id: build_push
        uses: docker/build-push-action@bcafcacb16a39f128d818304e6c9c0c18556b85f # v7.1.0
        with:
          context: .
          file: sip-bridge/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha,scope=bridge
          cache-to: type=gha,mode=max,scope=bridge
          sbom: true
          provenance: mode=max

      - name: Attest image build provenance (GitHub)
        uses: actions/attest-build-provenance@a2bbfa25375fe432b6a289bc6b6cd05ecd0c4c32 # v4.1.0
        with:
          subject-name: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}-sip-bridge
          subject-digest: ${{ steps.build_push.outputs.digest }}
          push-to-registry: true

      - name: Install cosign
        uses: sigstore/cosign-installer@cad07c2e89fa2edd6e2d7bab4c1aa38e53f76003 # v4.1.1

      - name: Sign image with cosign (keyless, OIDC)
        env:
          DIGEST: ${{ steps.build_push.outputs.digest }}
          IMAGE: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}-sip-bridge
        run: |
          cosign sign --yes "${IMAGE}@${DIGEST}"
```

Note the `scope=bridge` on the bridge job's `cache-from`/`cache-to` — this isolates the buildx cache between the two jobs so unrelated layer cache doesn't collide.

- [ ] **Step 2: Run actionlint — should now be clean**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
actionlint .github/workflows/docker.yml
echo "exit=$?"
```

Expected: `exit=0`, no output. Fix any remaining errors before moving on.

- [ ] **Step 3: Commit**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
git add .github/workflows/docker.yml
git commit -m "$(cat <<'EOF'
ci(docker): add bridge job with same hardening as app job

Mirrors the app job for sip-bridge/Dockerfile. Separate buildx cache
scope so layer reuse stays within each image.
EOF
)"
```

---

## Task 9: Wire `release.yml` to call `docker.yml`

**Files:**
- Modify: `.github/workflows/release.yml` (append `docker` job to the `jobs:` block)

- [ ] **Step 1: Read the current end of `release.yml` to confirm the insertion point**

The existing `release` job ends at the `Create GitHub Release` step. The new `docker` job goes after the `release` job in the jobs map. Find the last line of `release.yml` — it should be the `files: |` block with `CHECKSUMS.txt`, `CHECKSUMS.txt.asc`, `provenance.json`.

- [ ] **Step 2: Append the `docker` job at the end of `release.yml`**

After the existing `release` job's final step, add:

```yaml

  # ─── Docker Image Publish ─────────────────────────────────
  # Calls the reusable docker.yml workflow. workflow_call runs in the same
  # logical chain as the caller, so it is NOT subject to the GITHUB_TOKEN
  # downstream-trigger suppression rule that blocks `on: push: tags`.
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
      id-token: write
      attestations: write
      security-events: write
    secrets: inherit
```

- [ ] **Step 3: Run actionlint on both files**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
actionlint .github/workflows/docker.yml .github/workflows/release.yml
echo "exit=$?"
```

Expected: `exit=0`, no output. If actionlint complains about the `uses: ./.github/...` reusable-workflow call, it's typically because the local workflow file's `on: workflow_call:` block is malformed — cross-check Task 3.

- [ ] **Step 4: Commit**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
git add .github/workflows/release.yml
git commit -m "$(cat <<'EOF'
ci(release): call docker.yml after release job succeeds

Adds a downstream docker job that invokes the reusable docker.yml via
workflow_call. This is what actually makes image publishing work — tag
pushes under GITHUB_TOKEN auth cannot trigger downstream workflows, so
docker.yml has never run on its own. workflow_call runs in the same
logical chain as the caller and is not subject to that rule.

Passes version and ref=refs/tags/vX.Y.Z so the build sees the bumped
package.json committed by the version job, not the pre-bump commit.
EOF
)"
```

---

## Task 10: Push branch and open the PR

**Files:** none modified

- [ ] **Step 1: Push the branch to origin**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
git push -u origin ci/fix-ghcr-publish
```

Expected: push succeeds, tracking set up.

- [ ] **Step 2: Open the PR with a body that calls out the one-time manual step**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
gh pr create --title "ci: fix GHCR docker publish (reusable workflow + supply-chain hardening)" --body "$(cat <<'EOF'
## Summary

- Turn \`docker.yml\` into a reusable workflow (\`on: workflow_call\`) invoked by \`release.yml\` after each release tag is cut.
- Root cause: \`release.yml\` pushes tags under \`GITHUB_TOKEN\`, and GitHub suppresses downstream workflow triggers for \`GITHUB_TOKEN\`-authored events. The previous \`on: push: tags: v*\` trigger has never fired in 40+ tags.
- Add supply-chain hardening: full SHA action pinning, StepSecurity \`harden-runner\` (audit), SBOM + SLSA provenance attached to image manifest, GitHub-native build-provenance attestation, cosign keyless OIDC signing, and a pre-push Trivy CRITICAL/HIGH gate.

See \`docs/superpowers/specs/2026-04-11-fix-ghcr-docker-publish-design.md\` for the full design.

## Required one-time manual step (after merge + first successful release)

GHCR packages default to private on first publish. After the first release fires the new \`docker\` job successfully, toggle both packages to public:

1. https://github.com/users/rhonda-rodododo/packages/container/llamenos-hotline/settings → Danger Zone → Change package visibility → Public.
2. Same for \`llamenos-hotline-sip-bridge\`.
3. Confirm "Manage Actions access" lists this repository.

## Test plan

- [ ] actionlint passes on both edited workflows
- [ ] \`workflow_dispatch\` preview run against this PR branch succeeds end-to-end (harden-runner → phase1 → Trivy gate → phase2 → attest → cosign sign)
- [ ] Clean up any preview tags from GHCR after verification
- [ ] After merge: next real release run shows the \`docker\` job in the graph and completes green
- [ ] Flip both packages to public
- [ ] \`docker pull ghcr.io/rhonda-rodododo/llamenos-hotline:<version>\` from a clean environment
- [ ] \`docker buildx imagetools inspect ghcr.io/rhonda-rodododo/llamenos-hotline:<version> --format '{{json .SBOM}}' | jq .\` shows SPDX SBOM
- [ ] \`gh attestation verify oci://ghcr.io/rhonda-rodododo/llamenos-hotline:<version> --owner rhonda-rodododo\` succeeds
- [ ] \`cosign verify ghcr.io/rhonda-rodododo/llamenos-hotline:<version> --certificate-identity-regexp "https://github.com/rhonda-rodododo/llamenos-hotline/\.github/workflows/docker\.yml@.*" --certificate-oidc-issuer https://token.actions.githubusercontent.com\` succeeds

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Note it for Task 11.

---

## Task 11: Preview `workflow_dispatch` run against the PR branch

Validate the pipeline without merging. Since `docker.yml` is a reusable workflow, `workflow_dispatch` on the file directly is the only pre-merge way to exercise the full build.

**Files:** none modified

- [ ] **Step 1: Trigger a manual run against the PR branch with a preview version**

```bash
cd ~/projects/llamenos-hotline-fix-ghcr-publish
gh workflow run docker.yml \
  --ref ci/fix-ghcr-publish \
  -f version=0.0.0-pr-preview \
  -f ref=refs/heads/ci/fix-ghcr-publish
```

Expected: `✓ Created workflow_dispatch event for docker.yml`.

- [ ] **Step 2: Watch the run**

```bash
sleep 5
gh run list --workflow docker.yml --limit 1
RUN_ID=$(gh run list --workflow docker.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID"
```

Expected: both `app` and `bridge` jobs succeed.

- [ ] **Step 3: If the run fails, read the failing step's log and fix**

```bash
gh run view "$RUN_ID" --log-failed | tail -200
```

Common first-run failures and fixes:

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `unknown flag: --yes` in cosign step | cosign v1 installed (old action version) | verify the `sigstore/cosign-installer` SHA matches v3+ |
| `load: true is only available on docker-container driver` (or similar) | buildx setup step missing or misconfigured | confirm `docker/setup-buildx-action` ran before build step |
| `invalid semver in metadata-action` | `enable=${{ inputs.version != '' }}` guard missing or typo | re-check Task 4 Step 1 |
| `denied: permission_denied: write_package` | per-job `packages: write` missing or workflow-level `permissions: {}` overriding caller | re-check Task 3 and Task 9 permission blocks |
| `attest-build-provenance: subject-digest is required` | `steps.build_push.outputs.digest` empty because Phase 2 step id mismatch | ensure Phase 2 step has `id: build_push` (Task 6) |

- [ ] **Step 4: Clean up the preview tags from GHCR after a green run**

The preview produces tags `0.0.0-pr-preview`, `0.0`, `latest`, and `sha-<short>` on BOTH images. Delete them so they don't sit forever as garbage on the eventual public package:

```bash
# List versions for each package to find the preview
gh api /users/rhonda-rodododo/packages/container/llamenos-hotline/versions --jq '.[] | select(.metadata.container.tags[]? == "0.0.0-pr-preview") | .id'
gh api /users/rhonda-rodododo/packages/container/llamenos-hotline-sip-bridge/versions --jq '.[] | select(.metadata.container.tags[]? == "0.0.0-pr-preview") | .id'

# Delete each version id returned above. Replace <id> with the real id(s):
# gh api -X DELETE /users/rhonda-rodododo/packages/container/llamenos-hotline/versions/<id>
# gh api -X DELETE /users/rhonda-rodododo/packages/container/llamenos-hotline-sip-bridge/versions/<id>
```

Note: you'll need a PAT with `delete:packages` to actually delete, OR do it from the package settings UI. If neither is available, leave a note on the PR that the preview tag needs post-merge cleanup by the repo owner.

**Also**: the preview run will have overwritten `latest` with the preview image. The first real release after merge will rewrite `latest` correctly, so no manual fix needed as long as the preview is followed by a real release before anyone pulls `:latest`.

- [ ] **Step 5: Comment the successful preview run URL on the PR**

```bash
gh pr comment --body "Preview workflow_dispatch run succeeded end-to-end: $(gh run view $RUN_ID --json url --jq .url)

Preview tags will be cleaned up after merge + first real release."
```

---

## Task 12: Post-merge verification (manual, not executed in this session)

Documented here so the reviewer and the post-merge executor know the checklist. This task is **not executed by an agent** — wait for the PR to be reviewed and merged, then a human runs the steps and ticks the boxes.

**Files:** none modified

- [ ] **Step 1: Wait for the next real release run**

After merge, any non-docs-only push to `main` triggers `release.yml`, which now ends in the `docker` job via `workflow_call`. Watch:

```bash
gh run list --workflow release.yml --limit 1 --json databaseId,status,conclusion,displayTitle
```

- [ ] **Step 2: Confirm `docker.yml` executed as a downstream of `release.yml`**

```bash
gh run list --workflow docker.yml --limit 1
```

Expected: one new run with `event=workflow_call` (or similar downstream indicator). This is the first non-dispatch run of `docker.yml` in the repo's history.

- [ ] **Step 3: Flip both packages to public**

1. https://github.com/users/rhonda-rodododo/packages/container/llamenos-hotline/settings → Change visibility → Public.
2. https://github.com/users/rhonda-rodododo/packages/container/llamenos-hotline-sip-bridge/settings → Change visibility → Public.
3. Under "Manage Actions access", confirm the `llamenos-hotline` repository is listed.

- [ ] **Step 4: Run the four verification commands from a clean environment**

```bash
# Resolve the just-released version
VERSION=$(gh api /users/rhonda-rodododo/packages/container/llamenos-hotline/versions --jq '.[0].metadata.container.tags[]' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
echo "Verifying version: $VERSION"

# 1. pull
docker pull "ghcr.io/rhonda-rodododo/llamenos-hotline:${VERSION}"

# 2. SBOM
docker buildx imagetools inspect "ghcr.io/rhonda-rodododo/llamenos-hotline:${VERSION}" --format '{{json .SBOM}}' | jq '.SPDX.name'

# 3. GH attestation
gh attestation verify "oci://ghcr.io/rhonda-rodododo/llamenos-hotline:${VERSION}" --owner rhonda-rodododo

# 4. cosign signature
cosign verify "ghcr.io/rhonda-rodododo/llamenos-hotline:${VERSION}" \
  --certificate-identity-regexp "https://github.com/rhonda-rodododo/llamenos-hotline/\.github/workflows/docker\.yml@.*" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

All four commands must exit 0 for the PR to be considered fully verified. Repeat for `llamenos-hotline-sip-bridge`.

- [ ] **Step 5: (Optional) Promote `harden-runner` from `audit` to `block`**

After 2–3 clean runs, the harden-runner insights page lists the exact egress endpoints each job touches. Translate that into an explicit `allowed-endpoints` list and switch `egress-policy: audit` → `egress-policy: block` in a follow-up PR. Out of scope for this PR.

---

## Plan Self-Review

Ran the checklist against the spec:

**Spec coverage:**
- Problem + root cause → documented in plan header + Task 9 commit message.
- §1 Trigger change (reusable workflow) → Task 3 (top section) + Task 9 (caller).
- §2 Metadata tags → Task 4 (app) + Task 8 (bridge), both with `enable=` guards.
- §3.1 SHA pinning → "Pinned Action SHAs" table + every `uses:` in Task 4–8.
- §3.2 harden-runner → first step of both jobs (Task 4, Task 8).
- §3.3 SBOM + provenance flags → Phase 2 step in Task 6 + Task 8.
- §3.4 GH attestation → Task 7 + Task 8.
- §3.5 cosign keyless → Task 7 + Task 8.
- §3.6 Pre-push Trivy gate → Task 5 (Phase 1) + Task 8 (bridge Phase 1).
- §3.7 Minimal permissions → Task 3 (workflow-level `{}`, per-job explicit) + Task 9 (caller permissions).
- §4 Parity for bridge → Task 8.
- §5 Manual package visibility → Task 10 PR body + Task 12.
- §6 Concurrency → Task 3.
- Testing plan (actionlint + dispatch dry-run + post-merge verify) → Task 2 + Task 11 + Task 12.
- Rollout → Tasks 1, 10, 11, 12.

**Placeholder scan:** No TBDs, no "similar to above," no "handle errors." Every code step has full code. Error-mode table in Task 11 lists concrete symptoms and fixes.

**Type consistency:**
- Step id `build_push` used in Task 6 and referenced in Task 7 — match.
- Step id `meta` used in Task 4 and referenced in Tasks 5–6 — match.
- `inputs.version` / `inputs.ref` names consistent across Tasks 3, 4, 5, 8, 9.
- `env.REGISTRY` / `env.IMAGE_NAME` consistent across all tasks.
- Caller permissions (Task 9) match callee permissions (Task 3) exactly.
- `refs/tags/v${{ needs.version.outputs.new_version }}` (Task 9) — `version` job output name matches what `release.yml` already exposes (verified in spec against `release.yml` line 136).

No issues found.
