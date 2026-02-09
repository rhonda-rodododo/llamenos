# Epic 30: Collapsible Settings Sections with Deep Links

## Problem
The settings page has 10+ Card sections stacked vertically. On mobile especially, users must scroll extensively to find the section they need. There's no way to link directly to a specific section (e.g., an admin sharing a link to the "Spam Mitigation" settings).

## Goals
1. Each settings section is collapsible (accordion-style) with a clickable header
2. Profile section is expanded by default; all others start collapsed
3. Sections can be deep-linked via URL search params (e.g., `/settings?section=spam`)
4. TanStack Router detects the `section` param and auto-expands + scrolls to the target section
5. A "copy link" button on each section header copies a shareable deep link

## Architecture

### Section IDs
Each Card section gets a stable string ID used for URL params and element IDs:

| Section | ID | Default | Visibility |
|---|---|---|---|
| Profile | `profile` | expanded | all |
| Key Backup | `key-backup` | collapsed | admin |
| Passkeys | `passkeys` | collapsed | all (if WebAuthn available) |
| Passkey Policy | `passkey-policy` | collapsed | admin |
| Transcription | `transcription` | collapsed | all |
| Notifications | `notifications` | collapsed | all |
| IVR Languages | `ivr-languages` | collapsed | admin |
| Call Settings | `call-settings` | collapsed | admin |
| Voice Prompts | `voice-prompts` | collapsed | admin |
| Spam Mitigation | `spam` | collapsed | admin |
| Custom Note Fields | `custom-fields` | collapsed | admin (Epic 31) |

### URL Integration (TanStack Router)
- Add `section` to `Route.validateSearch`:
  ```ts
  export const Route = createFileRoute('/settings')({
    component: SettingsPage,
    validateSearch: (search: Record<string, unknown>) => ({
      section: (search.section as string) || '',
    }),
  })
  ```
- On mount, if `section` is set, expand that section and scroll to it via `scrollIntoView()`
- When a section is toggled open, optionally update the URL (using `navigate({ search: { section } })`)

### Collapsible Component
Use shadcn/ui `Collapsible` (from Radix `@radix-ui/react-collapsible`). Install via:
```bash
bunx shadcn@latest add collapsible
```

Each settings Card wraps its content:
```tsx
<Collapsible open={expanded.has(id)} onOpenChange={(open) => toggleSection(id, open)}>
  <Card>
    <CollapsibleTrigger asChild>
      <CardHeader className="cursor-pointer select-none hover:bg-muted/50 transition-colors">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Icon /> {title}
          </CardTitle>
          <div className="flex items-center gap-1">
            <CopyLinkButton sectionId={id} />
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded.has(id) && "rotate-180")} />
          </div>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <CardContent>...</CardContent>
    </CollapsibleContent>
  </Card>
</Collapsible>
```

### State Management
- `expanded: Set<string>` — tracks which sections are open
- Initialize with `new Set(['profile'])` (profile always starts expanded)
- If URL has `?section=X`, also add X to the set on mount
- A helper `<SettingsSection>` component encapsulates the collapsible Card pattern to avoid repetition

### Copy Link Button
- Small icon button (Link icon) in each section header
- On click: copies `${window.location.origin}/settings?section={id}` to clipboard
- Shows a brief toast "Link copied"
- Auto-clears clipboard after 30s (matches existing security pattern)

### Scroll Behavior
- On mount, if `section` param is present:
  1. Expand the target section
  2. Use `requestAnimationFrame` + `document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })`
  3. Each section `<Card>` gets `id={sectionId}` for scroll targeting

### Animation
- Use Radix Collapsible's built-in open/close data attributes
- CSS transitions for height animation via `data-[state=open]` / `data-[state=closed]`

## Files to Create/Modify

### New Files
- `src/client/components/ui/collapsible.tsx` — shadcn Collapsible component (generated)
- `src/client/components/settings-section.tsx` — reusable collapsible Card wrapper

### Modified Files
- `src/client/routes/settings.tsx` — refactor all Card sections into `<SettingsSection>`, add validateSearch, scroll logic
- `src/client/locales/*.json` — `settings.copyLink`, `settings.linkCopied` keys (13 locales)

## Acceptance Criteria
- [ ] All settings sections are collapsible with smooth animation
- [ ] Profile section expanded by default, all others collapsed
- [ ] Navigating to `/settings?section=spam` auto-expands and scrolls to Spam Mitigation
- [ ] Copy link button on each section copies a shareable URL
- [ ] Clicking collapsed header expands it; clicking expanded header collapses it
- [ ] Multiple sections can be open simultaneously (not single-accordion)
- [ ] Admin-only sections still hidden for non-admins (collapsible doesn't affect visibility)
- [ ] Mobile responsive — headers remain tappable, content animates smoothly
- [ ] All new strings translated in 13 locales
- [ ] E2E test: navigate to `/settings?section=transcription`, verify section is visible
