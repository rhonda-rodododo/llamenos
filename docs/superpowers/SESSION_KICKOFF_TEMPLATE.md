# Session Kickoff Template

Paste this into a fresh Claude Code session when starting work on a security-overhaul implementation PR. Replace every `{{PLACEHOLDER}}` before submitting.

---

I'm implementing **{{TIER_NAME}}** (spec+plan PR **#{{SPEC_PR_NUM}}**, implementation PR **{{IMPL_PR_SLUG}}**) from the Llámenos security overhaul. This session is one of several planned for the weekend of 2026-04-11 / 2026-04-12 per `docs/superpowers/plans/IMPLEMENTATION_QUEUE.md`.

## Session prep — do these in order before touching any code

1. **Read `docs/superpowers/plans/IMPLEMENTATION_QUEUE.md`** (on main). Confirm `{{TIER_NAME}}` is the next unblocked item for this implementation track and nothing has changed since the last session.
2. **Read the spec:** `docs/superpowers/specs/2026-04-10-security-tier-{{TIER_NUM}}-{{TIER_SLUG}}-design.md`. The spec is the contract — if the plan and spec disagree, the spec wins.
3. **Read the plan:** `docs/superpowers/plans/2026-04-10-security-tier-{{TIER_NUM}}-{{TIER_SLUG}}.md`. Check which tasks are already done with `grep -c '^- \[x\]' <plan>` and which are pending with `grep -c '^- \[ \]' <plan>`.
4. **Read the review:** `docs/security/TIER_{{TIER_NUM}}_REVIEW.md`. Look at the "Decisions received" section and any open `I-*` findings.
5. **Read `CLAUDE.md`** — repo conventions, tech stack, gotchas. Especially the "Claude Code Working Style" section.
6. **Read relevant memory files** via the auto-loaded MEMORY.md (always on at session start).

## Worktree setup

```bash
cd /media/rikki/recover2/projects/llamenos-hotline
git fetch origin main
git worktree add ../llamenos-hotline-impl-tier-{{TIER_NUM}}-{{IMPL_SLUG}} feat/sec-tier-{{TIER_NUM}}-impl-{{IMPL_SLUG}} origin/main
cd ../llamenos-hotline-impl-tier-{{TIER_NUM}}-{{IMPL_SLUG}}
bun install              # runs prepare → lefthook install, wires up the PII hook
echo "$PII_CHECK_PATTERNS" # verify the hook is configured in your shell
```

## Prerequisites check

Run these greps to confirm the tier's dependencies are present on main:

```bash
{{PREREQUISITE_GREPS}}
```

Expected output: {{PREREQUISITE_EXPECTATIONS}}.

If any prerequisite is missing, STOP and update `IMPLEMENTATION_QUEUE.md` with the blocker. Do not proceed without dependencies in place.

## Implementation protocol

Invoke the `superpowers:subagent-driven-development` skill. This is the mandatory harness for TDD plan execution. The skill dispatches a fresh subagent per plan task with:

- Clean context (protects the main session's window)
- A structured review step between tasks
- Automatic commit discipline (every task = at least one commit)

**For each task in the plan:**

1. Dispatch a subagent with: task number + title, spec section reference, the file list the task touches, the test command, the commit command.
2. Wait for the subagent to report success.
3. Review the subagent's diff via `git diff HEAD~1`. If unsatisfactory, reject and retry.
4. Mark the plan task's checkbox as `[x]` in the plan file.
5. Move to the next task.

**Parallelize non-dependent tasks within the PR.** For example, Tier 0 workstream 0.3's per-schema AEAD audits (Tasks 11–15 in the plan) touch different schema files — dispatch 5 parallel subagents, one per schema. Wait for all, review each, then move on.

**Serialize dependent tasks.** If Task N+1 needs Task N's new API, wait for Task N to land before dispatching Task N+1.

## Progress tracking

- **Close each task's checkbox** in the plan file as it lands. Edit directly or: `sed -i 's/^- \[ \] \*\*Step N: Commit\*\*/- [x] **Step N: Commit**/' <plan>`.
- **Commit the plan file update** alongside the task's implementation commit, or batch-commit the plan updates at session end.
- **The plan file IS the session handoff.** If this session is interrupted, the next session reads the plan and picks up from the first unchecked task.

## Verification gate

Before pushing the PR, run the plan's final "Verification gate" task. It's the last task in every plan. The gate usually includes:

```bash
bun run typecheck
bun run lint
bun run build
bun run test:unit
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api
bunx playwright test tests/ui
./scripts/verify-build.sh  # if the tier touches the build pipeline
```

**Skipping the verification gate is a session failure.** If any step fails, fix it before pushing.

## Session end

1. Run the verification gate. All checks must be green.
2. Commit the updated plan file (`.md`) with task checkboxes closed.
3. Push the branch: `git push -u origin feat/sec-tier-{{TIER_NUM}}-impl-{{IMPL_SLUG}}`.
4. Open the PR against main with:
   - Title: `feat(sec): tier {{TIER_NUM}} impl — {{PR_SUBJECT}}`
   - Body: the plan's completed task list + summary of changes + test plan checklist
   - Reference the spec+plan PR number in the body (e.g. "Implements the plan from #{{SPEC_PR_NUM}}")
5. **Update `docs/superpowers/plans/IMPLEMENTATION_QUEUE.md`:**
   - Move this PR to the "Implementation PR(s)" column of the appropriate tier row.
   - Recompute "Next unblocked" and "Current queue head".
   - Note any open questions or blockers for the next session.
6. Commit the `IMPLEMENTATION_QUEUE.md` update on the implementation PR (or a trivial doc PR if you prefer separate).
7. Post a brief session summary: "Tier {{TIER_NUM}} {{IMPL_SLUG}} landed in PR #XXX. Next: {{NEXT_ITEM}}."

## Guard rails (mandatory)

- **No backward compatibility shims.** Pre-production; clean cuts only.
- **Full measure, no shortcuts.** Robust implementation, strong tests + docs.
- **Every feature ships with tests.** Unit + API E2E + UI E2E + adversarial negative cases from the spec.
- **No silent failures.** No bare `catch {}` in crypto paths. Crypto errors propagate.
- **No PII in logs.** The PII hook enforces this via `PII_CHECK_PATTERNS`. Don't bypass with `--no-verify`.
- **testid-only selectors** in E2E tests. No `getByText` / `getByRole({ name })` for interactive elements.
- **React Query mutations** must use mutation hooks with `onSuccess` invalidation. Never call API functions directly from components.
- **Never edit a committed Drizzle migration** in-place. Write a new repair migration if you need to fix one.
- **Never use `--no-verify`** on commit. The pre-commit hook is load-bearing for this workstream.
- **Never use `git reset --hard`** without explicit user permission. Destructive operations need a human in the loop.

## Tier-specific context block

Replace this block with tier-specific context from the spec + review + plan before starting the session:

### Spec summary (2–3 sentences)

{{TIER_SUMMARY}}

### Open review findings

{{OPEN_REVIEW_FINDINGS}}

### First task to implement

{{FIRST_TASK_REFERENCE}}

### Notes for this implementation session

{{SESSION_NOTES}}

---

## Subagent dispatch template (per task)

Use this as the prompt body when dispatching a `superpowers:subagent-driven-development` subagent for a single plan task:

```
You are implementing **Task {{TASK_NUM}}** of the **{{TIER_NAME}}** implementation plan.

## Worktree

**Path:** /media/rikki/recover2/projects/llamenos-hotline-impl-tier-{{TIER_NUM}}-{{IMPL_SLUG}}
**Branch:** feat/sec-tier-{{TIER_NUM}}-impl-{{IMPL_SLUG}}

Work only inside this worktree. Never `cd` outside it. Use absolute paths. Git: `git -C /media/rikki/recover2/projects/llamenos-hotline-impl-tier-{{TIER_NUM}}-{{IMPL_SLUG}} ...`.

## Spec

Read the relevant section: `docs/superpowers/specs/2026-04-10-security-tier-{{TIER_NUM}}-{{TIER_SLUG}}-design.md` §{{SPEC_SECTION}}.

## Plan task

Task {{TASK_NUM}}: {{TASK_TITLE}}

Full task definition at `docs/superpowers/plans/2026-04-10-security-tier-{{TIER_NUM}}-{{TIER_SLUG}}.md` under `### Task {{TASK_NUM}}`.

## Files to touch

{{TASK_FILE_LIST}}

## TDD steps (mandatory)

Follow the plan's checkbox steps exactly:

1. Write the failing test (per the plan's Step 1 code block)
2. Run the test and verify it fails (per Step 2)
3. Implement the minimal code to pass (per Step 3)
4. Run the test and verify it passes (per Step 4)
5. Commit (per the plan's commit command)

## Guard rails

{{GUARD_RAILS_EXCERPT}}

## Success report

At the end of your work, report:

- The commit hash(es) you created
- The test results (pass/fail counts)
- Any deviations from the plan + reasoning
- Any blockers or concerns for the next task
```
