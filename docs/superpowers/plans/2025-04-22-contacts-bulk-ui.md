# Contacts Bulk Import + Merge UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add JSON-only bulk import/export, bulk merge from contacts list, and E2E tests for the Llámenos contacts directory.

**Architecture:** Extend existing contacts page (`src/client/routes/contacts.tsx`) with a new `BulkMergeDialog` component, modify `ImportContactsDialog` to reject CSV, add an export helper that serializes selected contacts as encrypted JSON, and write Playwright E2E tests using testid selectors.

**Tech Stack:** React + TanStack Router + shadcn/ui, React Query, Playwright E2E, i18next (22 locales).

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/client/components/contacts/import-contacts-dialog.tsx` | Modify | Remove CSV parser, accept JSON only, update UI copy |
| `src/client/components/contacts/bulk-merge-dialog.tsx` | Create | Modal for merging 2+ selected contacts with side-by-side comparison |
| `src/client/routes/contacts.tsx` | Modify | Add "Merge" and "Export" buttons to `BulkActionToolbar`, wire new dialogs |
| `src/client/lib/api/contacts.ts` | Modify | Add `exportContacts` helper (client-side JSON serialization) |
| `public/locales/en.json` | Modify | Add new i18n keys under `contacts.*` |
| `public/locales/{am,ar,de,es,fa,fr,hi,ht,ko,ku,mix,my,pt,quc,ru,so,tl,tr,uk,vi,zh}.json` | Modify | Copy English keys as placeholders for all other locales |
| `tests/ui/contacts-bulk.spec.ts` | Create | E2E tests for batch select, bulk tag, bulk delete, bulk merge, JSON import, JSON export |

---

## Task 1: Remove CSV support from ImportContactsDialog

**Files:**
- Modify: `src/client/components/contacts/import-contacts-dialog.tsx`

- [ ] **Step 1: Remove CSV parser and references**

  Delete `parseCSV` function (lines 72-130). Keep `parseJSON`.

  In `handleFileChange`, remove the `ext === 'csv'` branch. Only accept `.json`:

  ```tsx
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext !== 'json') {
    setParseError(
      t('contacts.importInvalidFormat', {
        defaultValue: 'Invalid file format. Expected .json',
      })
    )
    return
  }
  result = parseJSON(text)
  ```

  Update `accept` on the file input:
  ```tsx
  accept=".json,application/json"
  ```

  Update the dropzone label and hint:
  ```tsx
  <p className="text-sm font-medium">
    {t('contacts.importFile', { defaultValue: 'Choose a JSON file' })}
  </p>
  <p className="text-xs text-muted-foreground mt-1">
    {t('contacts.importFileHint', {
      defaultValue:
        'JSON array of contact objects: displayName, contactType, riskLevel, tags, fullName, phone, notes',
    })}
  </p>
  ```

  Update the description in `DialogDescription`:
  ```tsx
  {t('contacts.importDescription', {
    defaultValue:
      'Upload a JSON file to import contacts in bulk. Contacts are encrypted before sending.',
  })}
  ```

- [ ] **Step 2: Verify no CSV references remain**

  Run: `grep -n "csv\|CSV" src/client/components/contacts/import-contacts-dialog.tsx`
  Expected: No matches (except possibly in comments — remove those too).

- [ ] **Step 3: Commit**

  ```bash
  git add src/client/components/contacts/import-contacts-dialog.tsx
  git commit -m "feat(contacts): restrict import dialog to JSON only"
  ```

---

## Task 2: Create BulkMergeDialog component

**Files:**
- Create: `src/client/components/contacts/bulk-merge-dialog.tsx`

- [ ] **Step 1: Scaffold the component**

  ```tsx
  import { Button } from '@/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '@/components/ui/dialog'
  import { useMergeContacts } from '@/lib/queries/contacts'
  import { useState } from 'react'
  import { useTranslation } from 'react-i18next'
  import { toast } from 'sonner'

  interface BulkMergeDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    contacts: Array<{
      id: string
      displayName?: string
      contactType: string
      riskLevel?: string
      tags: string[]
      notes?: string
      fullName?: string
      phone?: string
    }>
    onMerged: () => void
  }

  export function BulkMergeDialog({
    open,
    onOpenChange,
    contacts,
    onMerged,
  }: BulkMergeDialogProps) {
    const { t } = useTranslation()
    const mergeMutation = useMergeContacts()
    const [primaryId, setPrimaryId] = useState<string>('')

    // Reset primary when dialog opens
    // (handled via key or useEffect if needed)

    async function handleMerge() {
      if (!primaryId || contacts.length < 2) return
      const secondaries = contacts.filter((c) => c.id !== primaryId)
      try {
        // Merge sequentially: primary + each secondary
        for (const sec of secondaries) {
          await mergeMutation.mutateAsync({ primaryId, secondaryId: sec.id })
        }
        toast.success(t('contacts.mergeSuccess', { defaultValue: 'Contacts merged successfully' }))
        onOpenChange(false)
        onMerged()
      } catch {
        toast.error(t('contacts.mergeFailed', { defaultValue: 'Failed to merge contacts' }))
      }
    }

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {t('contacts.mergeContacts', { defaultValue: 'Merge Contacts' })}
            </DialogTitle>
            <DialogDescription>
              {t('contacts.mergeBulkDescription', {
                defaultValue:
                  'Select the primary contact to keep. All other selected contacts will be merged into it and archived.',
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {t('contacts.mergeSelectPrimary', {
                defaultValue: 'Select primary contact:',
              })}
            </p>
            <div className="grid gap-3">
              {contacts.map((contact) => (
                <label
                  key={contact.id}
                  data-testid={`merge-option-${contact.id}`}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    primaryId === contact.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="primary-contact"
                    value={contact.id}
                    checked={primaryId === contact.id}
                    onChange={() => setPrimaryId(contact.id)}
                    className="h-4 w-4"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {contact.displayName ?? '[encrypted]'}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="capitalize">{contact.contactType}</span>
                      {contact.riskLevel && contact.riskLevel !== 'low' && (
                        <span className="capitalize">{contact.riskLevel}</span>
                      )}
                      {contact.tags.length > 0 && (
                        <span>{contact.tags.join(', ')}</span>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              data-testid="merge-cancel-btn"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mergeMutation.isPending}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              data-testid="merge-confirm-btn"
              onClick={handleMerge}
              disabled={!primaryId || mergeMutation.isPending}
            >
              {mergeMutation.isPending
                ? t('common.merging', { defaultValue: 'Merging...' })
                : t('contacts.merge', { defaultValue: 'Merge' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/client/components/contacts/bulk-merge-dialog.tsx
  git commit -m "feat(contacts): add BulkMergeDialog component"
  ```

---

## Task 3: Add export helper and wire bulk actions in contacts page

**Files:**
- Modify: `src/client/routes/contacts.tsx`
- Modify: `src/client/lib/api/contacts.ts`

- [ ] **Step 1: Add export helper to API client**

  In `src/client/lib/api/contacts.ts`, add:

  ```ts
  export async function exportContacts(contactIds: string[]): Promise<{
    contacts: Array<{
      id: string
      contactType: string
      riskLevel: string
      tags: string[]
      encryptedDisplayName: string
      displayNameEnvelopes: RecipientEnvelope[]
      encryptedNotes?: string
      notesEnvelopes?: RecipientEnvelope[]
      encryptedFullName?: string
      fullNameEnvelopes?: RecipientEnvelope[]
      encryptedPhone?: string
      phoneEnvelopes?: RecipientEnvelope[]
      encryptedPII?: string
      piiEnvelopes?: RecipientEnvelope[]
      identifierHash?: string
    }>
  }> {
    return request(hp('/contacts/export'), {
      method: 'POST',
      body: JSON.stringify({ contactIds }),
    })
  }
  ```

- [ ] **Step 2: Add server endpoint for export**

  In `src/server/routes/contacts/core.ts`, add a POST `/export` route (or add to `bulk.ts` if preferred). For simplicity, add to `core.ts` before the export:

  ```ts
  // ── POST /export ──

  const exportContactsRoute = createRoute({
    method: 'post',
    path: '/export',
    tags: ['Contacts'],
    summary: 'Export contacts as encrypted JSON',
    middleware: [...baseMiddleware, requirePermission('contacts:read-own')],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({ contactIds: z.array(z.string()).min(1) }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Exported contacts',
        content: {
          'application/json': {
            schema: z.object({ contacts: z.array(PassthroughSchema) }),
          },
        },
      },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
    },
  })

  core.openapi(exportContactsRoute, async (c) => {
    const services = c.get('services')
    const hubId = c.get('hubId') ?? 'global'
    const permissions = c.get('permissions')
    const pubkey = c.get('pubkey')

    const readScope = getContactReadScope(permissions)
    if (!readScope) {
      return c.json({ error: 'Forbidden', required: 'contacts:read-own' }, 403)
    }

    const body = c.req.valid('json')
    const exported: unknown[] = []

    for (const id of body.contactIds) {
      const accessible = await services.contacts.isContactAccessible(id, hubId, readScope, pubkey)
      if (!accessible) continue
      const contact = await services.contacts.getContact(id, hubId)
      if (contact) exported.push(contact)
    }

    return c.json({ contacts: exported }, 200)
  })
  ```

- [ ] **Step 3: Wire merge and export into contacts page**

  In `src/client/routes/contacts.tsx`:

  1. Import `BulkMergeDialog`:
     ```tsx
     import { BulkMergeDialog } from '@/components/contacts/bulk-merge-dialog'
     ```

  2. Add state:
     ```tsx
     const [mergeOpen, setMergeOpen] = useState(false)
     const [exportPending, setExportPending] = useState(false)
     ```

  3. Add `handleBulkMerge` and `handleBulkExport`:
     ```tsx
     async function handleBulkMerge() {
       if (selectedIds.size < 2) return
       setMergeOpen(true)
     }

     async function handleBulkExport() {
       const ids = [...selectedIds]
       if (ids.length === 0) return
       setExportPending(true)
       try {
         const { contacts: exported } = await exportContacts(ids)
         const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' })
         const url = URL.createObjectURL(blob)
         const a = document.createElement('a')
         a.href = url
         a.download = `contacts-export-${new Date().toISOString().slice(0, 10)}.json`
         a.click()
         URL.revokeObjectURL(url)
         toast.success(t('contacts.exportSuccess', { defaultValue: 'Contacts exported' }))
         clearSelection()
       } catch {
         toast.error(t('contacts.exportFailed', { defaultValue: 'Export failed' }))
       } finally {
         setExportPending(false)
       }
     }
     ```

  4. Add merge and export buttons to `BulkActionToolbar` props and JSX:

     Extend props:
     ```tsx
     onMerge: () => void
     onExport: () => void
     exportPending: boolean
     ```

     Add buttons after the Tag button (inside the toolbar):
     ```tsx
     {/* Merge */}
     <Button
       data-testid="bulk-merge-btn"
       variant="outline"
       size="sm"
       disabled={isPending || selectedCount < 2}
       onClick={onMerge}
     >
       <GitMerge className="mr-1.5 h-3.5 w-3.5" />
       {t('contacts.merge', { defaultValue: 'Merge' })}
     </Button>

     {/* Export */}
     <Button
       data-testid="bulk-export-btn"
       variant="outline"
       size="sm"
       disabled={isPending || exportPending}
       onClick={onExport}
     >
       <Download className="mr-1.5 h-3.5 w-3.5" />
       {t('contacts.export', { defaultValue: 'Export' })}
     </Button>
     ```

     Don't forget to import `GitMerge` and `Download` from `lucide-react`.

  5. Render `BulkMergeDialog` at the bottom of the page (near `CreateContactDialog`):
     ```tsx
     <BulkMergeDialog
       open={mergeOpen}
       onOpenChange={setMergeOpen}
       contacts={filtered.filter((c) => selectedIds.has(c.id))}
       onMerged={() => {
         setMergeOpen(false)
         clearSelection()
       }}
     />
     ```

- [ ] **Step 4: Commit**

  ```bash
  git add src/client/lib/api/contacts.ts src/server/routes/contacts/core.ts src/client/routes/contacts.tsx
  git commit -m "feat(contacts): add bulk merge and JSON export to contacts page"
  ```

---

## Task 4: Add i18n keys to all 22 locales

**Files:**
- Modify: `public/locales/en.json`
- Modify: `public/locales/*.json` (21 others)

- [ ] **Step 1: Add keys to English locale**

  Under the existing `"contacts"` object in `public/locales/en.json`, add these keys (merge with existing):

  ```json
  {
    "contacts": {
      "mergeContacts": "Merge Contacts",
      "mergeBulkDescription": "Select the primary contact to keep. All other selected contacts will be merged into it and archived.",
      "mergeSelectPrimary": "Select primary contact:",
      "export": "Export",
      "exportSuccess": "Contacts exported",
      "exportFailed": "Export failed",
      "importFile": "Choose a JSON file",
      "importFileHint": "JSON array of contact objects: displayName, contactType, riskLevel, tags, fullName, phone, notes",
      "importDescription": "Upload a JSON file to import contacts in bulk. Contacts are encrypted before sending.",
      "importInvalidFormat": "Invalid file format. Expected .json"
    }
  }
  ```

  Make sure not to duplicate existing keys — update `importFile`, `importFileHint`, `importDescription`, `importInvalidFormat` in place.

- [ ] **Step 2: Propagate to all other locales**

  For each of the 21 other locale files, add the same keys with English placeholder values. A scriptable approach:

  ```bash
  for f in public/locales/{am,ar,de,es,fa,fr,hi,ht,ko,ku,mix,my,pt,quc,ru,so,tl,tr,uk,vi,zh}.json; do
    # Use jq to merge new keys into contacts object
    jq '.contacts.mergeContacts = "Merge Contacts" |
        .contacts.mergeBulkDescription = "Select the primary contact to keep. All other selected contacts will be merged into it and archived." |
        .contacts.mergeSelectPrimary = "Select primary contact:" |
        .contacts.export = "Export" |
        .contacts.exportSuccess = "Contacts exported" |
        .contacts.exportFailed = "Export failed" |
        .contacts.importFile = "Choose a JSON file" |
        .contacts.importFileHint = "JSON array of contact objects: displayName, contactType, riskLevel, tags, fullName, phone, notes" |
        .contacts.importDescription = "Upload a JSON file to import contacts in bulk. Contacts are encrypted before sending." |
        .contacts.importInvalidFormat = "Invalid file format. Expected .json"' "$f" > tmp.json && mv tmp.json "$f"
  done
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add public/locales/
  git commit -m "i18n(contacts): add bulk merge and export keys to all 22 locales"
  ```

---

## Task 5: Write E2E tests

**Files:**
- Create: `tests/ui/contacts-bulk.spec.ts`

- [ ] **Step 1: Create test file with fixtures and helpers**

  ```ts
  import { expect, test } from '@playwright/test'
  import { loginAsAdmin } from '../fixtures/auth'

  test.describe('Contacts bulk operations', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsAdmin(page)
      await page.goto('/contacts')
      await page.waitForSelector('[data-testid="contact-row"]')
    })

    test('batch select and bulk tag', async ({ page }) => {
      const rows = page.locator('[data-testid="contact-row"]')
      await expect(rows.first()).toBeVisible()

      // Select first two contacts
      const checkboxes = page.locator('[data-testid="contact-row-checkbox"]')
      await checkboxes.nth(0).click()
      await checkboxes.nth(1).click()

      // Bulk toolbar appears
      await expect(page.locator('[data-testid="bulk-toolbar"]')).toBeVisible()
      await expect(page.locator('[data-testid="bulk-selected-count"]')).toContainText('2 selected')

      // Apply tag
      await page.locator('[data-testid="bulk-tag-btn"]').click()
      await page.locator('[data-testid="tag-input"]').fill('urgent')
      await page.keyboard.press('Enter')
      await page.locator('[data-testid="bulk-tag-apply"]').click()

      // Toolbar should clear after action
      await expect(page.locator('[data-testid="bulk-toolbar"]')).toBeHidden()
    })

    test('batch select and bulk delete', async ({ page }) => {
      const checkboxes = page.locator('[data-testid="contact-row-checkbox"]')
      const countBefore = await checkboxes.count()
      if (countBefore < 2) {
        test.skip('Need at least 2 contacts for bulk delete test')
      }

      await checkboxes.nth(0).click()
      await checkboxes.nth(1).click()

      await page.locator('[data-testid="bulk-delete-btn"]').click()
      await page.locator('[data-testid="bulk-delete-confirm"]').click()

      await expect(page.locator('[data-testid="bulk-toolbar"]')).toBeHidden()
    })

    test('bulk merge from list', async ({ page }) => {
      const checkboxes = page.locator('[data-testid="contact-row-checkbox"]')
      const count = await checkboxes.count()
      if (count < 2) {
        test.skip('Need at least 2 contacts for merge test')
      }

      await checkboxes.nth(0).click()
      await checkboxes.nth(1).click()

      await page.locator('[data-testid="bulk-merge-btn"]').click()

      // Merge dialog opens
      await expect(page.locator('[data-testid="merge-confirm-btn"]')).toBeVisible()

      // Select primary
      const firstId = await page.locator('[data-testid^="merge-option-"]').first().getAttribute('data-testid')
      await page.locator(`[data-testid="${firstId}"]`).click()

      await page.locator('[data-testid="merge-confirm-btn"]').click()

      // Should return to list
      await expect(page.locator('[data-testid="bulk-toolbar"]')).toBeHidden()
    })

    test('JSON import', async ({ page }) => {
      await page.locator('[data-testid="import-contacts-btn"]').click()

      // Dialog opens
      await expect(page.locator('[data-testid="import-file-input"]')).toBeVisible()

      // Create a JSON file with one contact
      const json = JSON.stringify([
        {
          displayName: 'Imported Test',
          contactType: 'caller',
          riskLevel: 'medium',
          tags: ['test'],
          fullName: 'Test User',
          phone: '+15551234567',
          notes: 'Imported via E2E test',
        },
      ])

      await page.locator('[data-testid="import-file-input"]').setInputFiles({
        name: 'contacts.json',
        mimeType: 'application/json',
        buffer: Buffer.from(json),
      })

      // Preview stage
      await expect(page.locator('[data-testid="import-preview-row"]')).toBeVisible()
      await page.locator('[data-testid="import-confirm-btn"]').click()

      // Done stage
      await expect(page.locator('[data-testid="import-result"]')).toBeVisible()
      await page.locator('[data-testid="import-done-btn"]').click()

      // Verify contact appears in list
      await expect(page.locator('text=Imported Test')).toBeVisible()
    })

    test('JSON export', async ({ page }) => {
      const checkboxes = page.locator('[data-testid="contact-row-checkbox"]')
      await checkboxes.nth(0).click()

      await page.locator('[data-testid="bulk-export-btn"]').click()

      // Wait for download to start (Playwright can intercept if needed)
      // For now, just verify toolbar clears
      await expect(page.locator('[data-testid="bulk-toolbar"]')).toBeHidden()
    })
  })
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add tests/ui/contacts-bulk.spec.ts
  git commit -m "test(contacts): add E2E tests for bulk operations"
  ```

---

## Task 6: Verification

- [ ] **Step 1: Type check**

  Run: `bun run typecheck`
  Expected: No errors.

- [ ] **Step 2: Build**

  Run: `bun run build`
  Expected: No errors.

- [ ] **Step 3: Run E2E tests**

  Run: `bun run test:e2e tests/ui/contacts-bulk.spec.ts`
  Expected: All tests pass (or skip gracefully if insufficient seed data).

- [ ] **Step 4: Lint**

  Run: `bun run lint`
  Expected: No errors.

- [ ] **Step 5: Final commit**

  ```bash
  git add -A
  git commit -m "feat(contacts): bulk merge, JSON export, JSON-only import, i18n, E2E tests"
  ```

---

## Spec Coverage Checklist

| Requirement | Task |
|-------------|------|
| JSON-only import (no CSV) | Task 1 |
| Bulk merge from contacts list | Task 2 + Task 3 |
| JSON export of selected contacts | Task 3 |
| i18n keys in all 22 locales | Task 4 |
| E2E tests for bulk ops | Task 5 |
| Type safety / build pass | Task 6 |
