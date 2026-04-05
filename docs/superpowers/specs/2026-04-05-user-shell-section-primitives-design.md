# User-Shell Section Primitives — Design Spec

**Date:** 2026-04-05
**Branch:** `feat/device-management` (PR #43)
**Status:** Draft — pending user review

## 1. Goal

Cut style drift in user-facing security/settings pages by extracting the same
layout primitives that PR #44 introduces for admin sections. Every simple form
row, intro description, and save-action row on `/security/*` pages should flow
through the same tiny set of components so a single visual pass updates them
all.

## 2. Context

PR #44 (draft) adds `src/client/components/admin-shell/section-layout.tsx`
with six primitives (`SectionBody`, `SectionDescription`, `SectionField`,
`SectionToggleField`, `SectionActions`, `SectionBanner`) and refactors ~14
admin sections onto them.

Our PR #43 added four user-security pages (`/security/{sessions,passkeys,
history,factors}`) plus three factor form components
(`PinChangeForm`, `RecoveryRotateForm`, `IdleLockSlider`) with entirely
ad-hoc markup — raw `<div className="space-y-2"><Label>...</div>` field
rows, manual Button + success-span action rows, etc.

Without extraction, user settings and admin settings will drift apart over
future polish passes.

## 3. Non-Goals

- Dedupe with admin-shell in this PR (follow-up item — see §9).
- Refactor `LockdownModal.tsx` or `SignalContactPrompt.tsx` (both have their
  own dialog/wizard rhythm and would lose clarity under the generic primitives).
- Add new translations or user-facing copy beyond what already exists.
- Break any current `data-testid` selectors used in E2E tests.

## 4. Primitives file — `src/client/components/user-shell/section-layout.tsx`

Direct port of `admin-shell/section-layout.tsx`'s API with one change: testid
prefix switches from `admin-{slug}-...` to `user-{slug}-...`. Separate file
keeps the two surfaces independent until someone promotes both to a shared
`components/section-layout/` module.

**Exported components (identical API to admin-shell):**

| Primitive | Purpose |
|---|---|
| `SectionBody` | Outer `space-y-6 max-w-3xl` wrapper (one per section) |
| `SectionDescription` | Muted intro paragraph — replaces raw `<p className="text-sm text-muted-foreground">` |
| `SectionField` | Vertical label + input/select/textarea with optional `help` / `error` / `required` — replaces raw `<div className="space-y-2"><Label>...</div>` |
| `SectionToggleField` | Horizontal label + switch/checkbox row |
| `SectionActions` | Save button + success indicator with `user-{slug}-save` + `user-{slug}-save-success` testids |
| `SectionBanner` | Status banner with `info` / `warn` / `danger` tone |

Section components should render in this rhythm:

```tsx
<SectionBody>
  <SectionDescription>...</SectionDescription>
  <SectionField label={t(...)} htmlFor="foo-name" help={...}>
    <Input id="foo-name" ... />
  </SectionField>
  <SectionActions slug="foo" onSave={...} saving={...} showSaved={...} />
</SectionBody>
```

## 5. Component Reorg

Move the three factor forms into a `user-sections/` grouping, mirroring PR
#44's `admin-sections/` convention and renaming `-Form.tsx` → `-section.tsx`:

| Old path | New path |
|---|---|
| `src/client/components/PinChangeForm.tsx` | `src/client/components/user-sections/pin-change-section.tsx` |
| `src/client/components/RecoveryRotateForm.tsx` | `src/client/components/user-sections/recovery-rotate-section.tsx` |
| `src/client/components/IdleLockSlider.tsx` | `src/client/components/user-sections/idle-lock-section.tsx` |

The exported component names change accordingly (`PinChangeForm` →
`PinChangeSection`, etc.). `security.factors.tsx` is the only consumer and is
updated in the same commit.

## 6. Refactor Targets — Per File

### 6.1 `pin-change-section.tsx` (was PinChangeForm.tsx)

- Outer: `<SectionBody>`
- Heading: keep `<h3 className="text-lg font-semibold">` ABOVE the SectionBody (the primitives don't own headings; sections are headed by their containing route)
- Three `<SectionField>` rows for current PIN, new PIN, confirm PIN — pass `help` for the mismatch/length hints when appropriate
- Error message: pass into the third field's `error` prop (replaces the standalone `pin-error` div)
- Save row: `<SectionActions slug="pin" saveButtonTestId="submit-pin" onSave={submit} saving={change.isPending} showSaved={false} />`
- Success message: keep the legacy standalone `<p data-testid="pin-success">` after the actions row (SectionActions' built-in success is disabled via `showSaved={false}`, per §7 item 5). Follow-up refactor can merge these later.
- **Preserve testids:** `pin-change-form` (via `data-testid` passthrough on SectionBody's root div), `current-pin`, `new-pin`, `confirm-pin` (on Inputs), `pin-error`, `pin-success`, `submit-pin` (via `saveButtonTestId` on SectionActions — see §8).

### 6.2 `recovery-rotate-section.tsx` (was RecoveryRotateForm.tsx)

- Outer: `<SectionBody>`
- Pre-rotation state: one `<SectionField>` for current PIN + `<SectionActions slug="recovery" onSave={submit} ...>` for the rotate button
- Post-rotation state: `<SectionBanner tone="warn">` with the "Save this key now" message, displayed key in `<code>` block, download button as standalone (not in SectionActions since it's not a save)
- Error message: passed to field's `error` prop
- **Preserve testids:** `recovery-rotate-form`, `recovery-pin`, `submit-rotate`, `recovery-error`, `new-recovery-key`, `download-recovery-key`.

### 6.3 `idle-lock-section.tsx` (was IdleLockSlider.tsx)

- Outer: `<SectionBody>`
- Description: `<SectionDescription>` replaces raw `<p>`
- Slider row: native `<input type="range">` markup stays as-is (not a standard form field)
- Save behavior unchanged: auto-saves on slider commit. **No SectionActions** — the slider commit triggers the mutation directly, no explicit save button.
- **Preserve testids:** `idle-lock-slider`, `lock-slider`, `lock-value`.

### 6.4 `security.sessions.tsx`

- Wrap inner content in `<SectionBody>` (replaces the bare `<div data-testid="sessions-page">`)
- Add `<SectionDescription>` above the list explaining what "sessions" means
- Keep: the existing list (`<ul className="space-y-2">`), current-session badge, revoke buttons, sign-out-everywhere button, lockdown button, empty state
- **Preserve testids:** `sessions-page`, `revoke-all-others`, `open-lockdown`, `session-row-*`, `revoke-*`.

### 6.5 `security.passkeys.tsx`

- Wrap inner content in `<SectionBody>`
- Add `<SectionDescription>` at top
- Convert the warning div (`bg-yellow-50 border border-yellow-300 ...`) into `<SectionBanner tone="warn">`
- Keep: the list, row component (`PasskeyRow`), inline rename editing
- **Preserve testids:** `passkeys-page`, `passkey-warning`, `passkey-row-*`, `rename-*`, `delete-*`, `passkey-label-input`, `save-rename`, `transport-*`, `backup-indicator`.

### 6.6 `security.history.tsx`

- Wrap inner content in `<SectionBody>`
- Add `<SectionDescription>` at top
- Keep: export button, event list, report-suspicious buttons, flagged badges
- **Preserve testids:** `history-page`, `export-history`, `event-row-*`, `report-*`, `suspicious-flag`.

### 6.7 `security.factors.tsx`

- Already minimal — just mounts 3 section components
- Keep wrapping `<div className="space-y-8" data-testid="factors-page">`
- No direct primitive usage (sections own their rhythm)

## 7. Test Selector Preservation Strategy

**Rule:** Every existing `data-testid` used in E2E tests MUST still resolve to
the same DOM element after refactor. Strategy:

1. **Element-level testids stay on the actual element.** Input components
   keep `data-testid="current-pin"`, buttons keep `data-testid="submit-pin"`,
   etc. The primitives pass these through via children, not by owning them.
2. **Page-wrapper testids move to SectionBody via a `data-testid` passthrough.**
   `<SectionBody data-testid="sessions-page">` — SectionBody already accepts
   `...rest` props that include `data-testid`.
3. **Form-wrapper testids stay on the outermost element.** `pin-change-form`
   becomes a wrapper testid on the section component's outer element (either
   SectionBody's wrapper or a parent div the section component itself adds).
4. **SectionActions' save button** gets BOTH the new `user-{slug}-save` testid
   (from the primitive) AND the legacy testid (`submit-pin`, `submit-rotate`)
   via `data-testid` on the Button or a `slug` override.

   Simplest approach: the primitive already stamps `user-{slug}-save`. The
   legacy testid (`submit-pin`) is added by wrapping the primitive with a
   `<div data-testid="submit-pin">...</div>`, OR we extend `SectionActions`
   to accept a `saveButtonTestId` prop for the legacy selector. The spec
   prefers the second (extend `SectionActions`).

5. **Success indicator**: legacy testids like `pin-success` and
   `recovery-success` are text containers, not on the SectionActions' built-in
   indicator. Those remain as their own `<p>` elements OR get merged into the
   primitive's success indicator via an override prop.

   Simplest: keep the legacy success indicator as a separate element and
   pass `showSaved={false}` to SectionActions. The form owns the success
   message until the next refactor pass.

**Outcome:** No changes required to any `tests/ui/*.spec.ts` file.

## 8. `SectionActions` API extension

Add one optional prop to the copied primitive:

```ts
interface SectionActionsProps {
  // ... existing props ...
  /** Optional override for the save button's legacy data-testid. */
  saveButtonTestId?: string
}
```

The save button receives `data-testid={saveButtonTestId ?? \`user-${slug}-save\`}`.
This keeps `submit-pin`, `submit-rotate`, etc. working. Admin-shell's copy
doesn't need this prop (PR #44's sections are greenfield with fresh testids);
the user-shell copy is the one that needs legacy compatibility.

## 9. Follow-up (out of this PR)

- Once both PR #43 and PR #44 merge, dedupe `user-shell/section-layout.tsx`
  and `admin-shell/section-layout.tsx` into one `section-layout/` module
  re-exported from both paths. File a `NEXT_BACKLOG.md` entry for this
  cleanup.

## 10. Verification

- `bun run typecheck` — clean
- `bun run build` — clean
- `bun run test:unit` — 1275/1275 pass (no unit tests touch these files)
- `bun run test:e2e` for `tests/ui/security-*.spec.ts` — all existing tests
  pass without modification

## 11. Rollout

Single PR commit stack (on top of existing PR #43 work):

1. Add `components/user-shell/section-layout.tsx` with `saveButtonTestId` extension.
2. Move + refactor `PinChangeForm` → `pin-change-section`.
3. Move + refactor `RecoveryRotateForm` → `recovery-rotate-section`.
4. Move + refactor `IdleLockSlider` → `idle-lock-section`.
5. Refactor `security.{sessions,passkeys,history}.tsx` page wrappers.
6. Update `security.factors.tsx` + imports.
7. Append dedup follow-up to `docs/NEXT_BACKLOG.md`.
