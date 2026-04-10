#!/usr/bin/env bash
# Pre-commit PII check — blocks commits that add content matching any pattern
# in the PII_CHECK_PATTERNS environment variable.
#
# Design rationale:
#   - The patterns themselves are PII and must NOT be committed. Every
#     developer sets PII_CHECK_PATTERNS in their shell rc (e.g. ~/.zshrc) with
#     their own real-name / email / username / org regexes, pipe-separated
#     the way egrep / grep -E expects.
#   - This script itself is committed so every worktree + every contributor
#     runs the same check. It reads patterns at runtime from the env var.
#   - Unset PII_CHECK_PATTERNS: script prints a one-line warning and exits 0
#     (does NOT fail the commit). This keeps the hook non-blocking for
#     contributors who have not yet configured it, while still surfacing
#     "you should set this up" every commit.
#   - Set PII_CHECK_PATTERNS: script greps the staged diff and fails hard on
#     any match, printing line numbers and the matched content so the author
#     can fix the leak.
#   - Only added lines (lines starting with '+' in the diff) are checked.
#     Removed lines (starting with '-') are fine — removing leaked PII is
#     exactly what we want this hook to allow.
#
# Example PII_CHECK_PATTERNS for a developer:
#   export PII_CHECK_PATTERNS='jane\.doe|jane@(company|personal)\.example|/home/janed|github\.com/(janed|janedoe-personal)'
#
# Add it to ~/.zshrc or ~/.bashrc, source the file, and every subsequent
# `git commit` in any Llamenos worktree runs the check automatically via
# lefthook (see lefthook.yml `pii-check` job).
#
# Installation:
#   1. Install lefthook: `bun install` (it is a devDependency) or
#      `brew install lefthook` on macOS.
#   2. Run `bunx lefthook install` once in the repo root to install the
#      git hooks into .git/hooks/.
#   3. Add `export PII_CHECK_PATTERNS='...'` to your shell rc with your
#      own patterns.
#   4. Open a new shell or `source ~/.zshrc`.
#   5. Verify: `PII_CHECK_PATTERNS='foo' scripts/pii-check.sh </dev/null` with
#      a staged file containing 'foo' should fail; without it should pass.
#
# Exit codes:
#   0 — no PII detected (or PII_CHECK_PATTERNS unset)
#   1 — PII detected in staged diff; commit blocked
#   2 — configuration error (missing git, not in a repo, etc.)

set -euo pipefail

# Verify we are in a git repo. Lefthook guarantees this, but this script may
# be invoked directly for testing.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "pii-check: not in a git repository" >&2
  exit 2
fi

# If PII_CHECK_PATTERNS is unset or empty, warn and pass.
if [ -z "${PII_CHECK_PATTERNS:-}" ]; then
  cat >&2 <<'WARN'
pii-check: PII_CHECK_PATTERNS is not set — PII pre-commit check is a no-op.
          Add to ~/.zshrc (or ~/.bashrc):
            export PII_CHECK_PATTERNS='your\.name|your@email\.example|/home/yourusername|other\.regexes'
          Then `source` the file and commit again. See scripts/pii-check.sh
          for the full usage notes.
WARN
  exit 0
fi

# Extract only the added lines from the staged diff. Format:
#   filename
#   +added line content
#
# The `--no-color` flag prevents ANSI escape codes from polluting the grep.
# `--unified=0` keeps the diff minimal (no context lines) so we never match
# on context. The `^+` filter drops file headers (`+++`), diff markers, and
# removed lines.
STAGED_DIFF=$(git diff --cached --no-color --unified=0 2>/dev/null || true)

if [ -z "$STAGED_DIFF" ]; then
  # No staged changes (e.g. empty commit, commit --allow-empty). Nothing to
  # check; pass.
  exit 0
fi

# Scan added lines only. Collect matches with their file + diff line context.
# We iterate the diff by file to give a useful error message.
FOUND=0
CURRENT_FILE=""
while IFS= read -r line; do
  case "$line" in
    "diff --git a/"*" b/"*)
      CURRENT_FILE=$(printf '%s' "$line" | sed -E 's|^diff --git a/[^ ]+ b/(.+)$|\1|')
      ;;
    "+++"*|"---"*)
      # File header — not a content line
      ;;
    "+"*)
      # Added content line. Strip the leading '+' before matching so a '+' at
      # the start of the real content doesn't accidentally anchor the pattern.
      content="${line#+}"
      # Case-insensitive match: names and usernames appear in mixed case
      # ("Rikki", "rikki", "RIKKI", "Rikki.Schulte") and we want to catch
      # them all. Patterns in PII_CHECK_PATTERNS should be lowercase-only.
      if printf '%s' "$content" | grep -qiE "$PII_CHECK_PATTERNS"; then
        if [ "$FOUND" -eq 0 ]; then
          echo "pii-check: PII detected in staged changes" >&2
          echo "" >&2
        fi
        FOUND=1
        # Redact the actual match in the output so the hook failure itself
        # doesn't double-leak the PII into terminal logs / shell history.
        # We print only the file + a marker, not the matched line.
        echo "  ${CURRENT_FILE}: contains a PII-pattern match (content redacted)" >&2
      fi
      ;;
  esac
done <<< "$STAGED_DIFF"

if [ "$FOUND" -ne 0 ]; then
  echo "" >&2
  echo "Fix: edit the offending files to remove the PII, re-stage, and retry." >&2
  echo "     Use \`git diff --cached\` yourself to see the exact content." >&2
  echo "     Patterns are sourced from PII_CHECK_PATTERNS — inspect with:" >&2
  echo "       echo \"\$PII_CHECK_PATTERNS\"" >&2
  exit 1
fi

exit 0
