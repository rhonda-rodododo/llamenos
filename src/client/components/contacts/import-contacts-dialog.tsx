import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { type CryptoLabel, LABEL_CONTACT_PII, LABEL_CONTACT_SUMMARY } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Upload, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getContactRecipients } from '@/lib/api'
import { cryptoWorker } from '@/lib/crypto-worker-client'
import * as keyManager from '@/lib/key-manager'
import { useImportContacts } from '@/lib/queries/contacts'

// ── Types ──────────────────────────────────────────────────────────────────

interface ParsedRow {
  displayName: string
  contactType: string
  riskLevel: string
  tags: string[]
  fullName?: string
  phone?: string
  notes?: string
}

type ParseResult =
  | { ok: true; rows: ParsedRow[]; warnings: string[] }
  | { ok: false; error: string }

// ── Helpers ────────────────────────────────────────────────────────────────

const VALID_TYPES = new Set([
  'caller',
  'organization',
  'volunteer',
  'partner-org',
  'referral-resource',
  'other',
])
const VALID_RISKS = new Set(['low', 'medium', 'high', 'critical'])

function normalizeType(raw: string): string {
  const v = raw.trim().toLowerCase()
  return VALID_TYPES.has(v) ? v : 'other'
}

function normalizeRisk(raw: string): string {
  const v = raw.trim().toLowerCase()
  return VALID_RISKS.has(v) ? v : 'low'
}

function parseTags(raw: string | string[] | undefined): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map((t) => t.trim()).filter(Boolean)
  return raw
    .split(/[;,|]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function parseCSV(text: string): ParseResult {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2)
    return { ok: false, error: 'CSV must have a header row and at least one data row' }

  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase())
  const requiredCols = ['displayname']
  const missing = requiredCols.filter((c) => !header.includes(c))
  if (missing.length > 0) {
    return { ok: false, error: `Missing required CSV columns: ${missing.join(', ')}` }
  }

  const idx = (name: string) => header.indexOf(name)
  const rows: ParsedRow[] = []
  const warnings: string[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // Simple CSV parse — handles quoted fields
    const cells: string[] = []
    let cell = ''
    let inQuote = false
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]
      if (ch === '"') {
        inQuote = !inQuote
      } else if (ch === ',' && !inQuote) {
        cells.push(cell)
        cell = ''
      } else {
        cell += ch
      }
    }
    cells.push(cell)

    const get = (name: string) => cells[idx(name)]?.trim() ?? ''

    const displayName = get('displayname')
    if (!displayName) {
      warnings.push(`Row ${i}: missing displayName — skipped`)
      continue
    }

    rows.push({
      displayName,
      contactType: normalizeType(get('contacttype') || get('type') || 'other'),
      riskLevel: normalizeRisk(get('risklevel') || get('risk') || 'low'),
      tags: parseTags(get('tags')),
      fullName: get('fullname') || undefined,
      phone: get('phone') || undefined,
      notes: get('notes') || undefined,
    })
  }

  if (rows.length === 0) return { ok: false, error: 'No valid rows found in CSV' }
  return { ok: true, rows, warnings }
}

function parseJSON(text: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Invalid JSON' }
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'JSON must be an array of contact objects' }
  }

  const rows: ParsedRow[] = []
  const warnings: string[] = []

  for (let i = 0; i < parsed.length; i++) {
    const obj = parsed[i] as Record<string, unknown>
    const displayName = String(obj.displayName ?? obj.display_name ?? '').trim()
    if (!displayName) {
      warnings.push(`Item ${i}: missing displayName — skipped`)
      continue
    }
    rows.push({
      displayName,
      contactType: normalizeType(String(obj.contactType ?? obj.type ?? 'other')),
      riskLevel: normalizeRisk(String(obj.riskLevel ?? obj.risk ?? 'low')),
      tags: parseTags(obj.tags as string | string[] | undefined),
      fullName: obj.fullName ? String(obj.fullName) : undefined,
      phone: obj.phone ? String(obj.phone) : undefined,
      notes: obj.notes ? String(obj.notes) : undefined,
    })
  }

  if (rows.length === 0) return { ok: false, error: 'No valid items found in JSON' }
  return { ok: true, rows, warnings }
}

async function envelopeEncrypt(
  plaintext: string,
  recipientPubkeys: string[],
  label: CryptoLabel
): Promise<{ encrypted: Ciphertext; envelopes: RecipientEnvelope[] }> {
  const { encryptedHex, envelopes } = await cryptoWorker.envelopeEncryptField(
    plaintext,
    recipientPubkeys,
    label,
    utf8ToBytes(label)
  )
  return {
    encrypted: encryptedHex as Ciphertext,
    // @ts-expect-error Slice 2: ECIES → HPKE migration
    envelopes: envelopes.map((e) => ({
      pubkey: e.recipientPubkey,
      wrappedKey: e.wrappedKeyHex as Ciphertext,
      ephemeralPubkey: e.ephemeralPubkeyHex,
    })),
  }
}

// ── Component ──────────────────────────────────────────────────────────────

interface ImportContactsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (count: number) => void
}

type Stage = 'pick' | 'preview' | 'importing' | 'done'

interface ImportResult {
  created: number
  errors: Array<{ index: number; error: string }>
}

export function ImportContactsDialog({
  open,
  onOpenChange,
  onImported,
}: ImportContactsDialogProps) {
  const { t } = useTranslation()
  const importMutation = useImportContacts()

  const [stage, setStage] = useState<Stage>('pick')
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() {
    setStage('pick')
    setParseResult(null)
    setParseError(null)
    setFileName('')
    setProgress(0)
    setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleClose() {
    if (stage === 'importing') return
    if (stage === 'done' && result && result.created > 0) {
      onImported(result.created)
    }
    onOpenChange(false)
    reset()
  }

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setParseError(null)
      setParseResult(null)
      setFileName(file.name)

      const reader = new FileReader()
      reader.onload = (ev) => {
        const text = ev.target?.result as string
        const ext = file.name.split('.').pop()?.toLowerCase()

        let result: ParseResult
        if (ext === 'json') {
          result = parseJSON(text)
        } else if (ext === 'csv') {
          result = parseCSV(text)
        } else {
          setParseError(
            t('contacts.importInvalidFormat', {
              defaultValue: 'Invalid file format. Expected .csv or .json',
            })
          )
          return
        }

        if (!result.ok) {
          setParseError(result.error)
          return
        }

        setParseResult(result)
        setStage('preview')
      }
      reader.readAsText(file)
    },
    [t]
  )

  async function handleImport() {
    if (!parseResult?.ok) return

    const unlocked = await keyManager.isUnlocked()
    if (!unlocked) {
      toast.error(
        t('contacts.errorKeyLocked', {
          defaultValue: 'Encryption key is locked. Please unlock first.',
        })
      )
      return
    }

    const pk = await keyManager.getPublicKeyHex()
    if (!pk) {
      toast.error(t('contacts.errorNoPubkey', { defaultValue: 'Could not retrieve public key' }))
      return
    }

    setStage('importing')
    setProgress(0)

    try {
      const { summaryPubkeys, piiPubkeys } = await getContactRecipients()
      if (!summaryPubkeys.includes(pk)) summaryPubkeys.push(pk)
      if (!piiPubkeys.includes(pk)) piiPubkeys.push(pk)

      const { rows } = parseResult
      const encryptedContacts: Parameters<typeof importMutation.mutateAsync>[0]['contacts'] = []

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]

        const { encrypted: encryptedDisplayName, envelopes: displayNameEnvelopes } =
          await envelopeEncrypt(row.displayName, summaryPubkeys, LABEL_CONTACT_SUMMARY)

        let encryptedFullName: string | undefined
        let fullNameEnvelopes: RecipientEnvelope[] | undefined
        if (row.fullName) {
          const r = await envelopeEncrypt(row.fullName, piiPubkeys, LABEL_CONTACT_PII)
          encryptedFullName = r.encrypted
          fullNameEnvelopes = r.envelopes
        }

        let encryptedPhone: string | undefined
        let phoneEnvelopes: RecipientEnvelope[] | undefined
        if (row.phone) {
          const r = await envelopeEncrypt(row.phone, piiPubkeys, LABEL_CONTACT_PII)
          encryptedPhone = r.encrypted
          phoneEnvelopes = r.envelopes
        }

        encryptedContacts.push({
          contactType: row.contactType,
          riskLevel: row.riskLevel,
          tags: row.tags,
          encryptedDisplayName,
          displayNameEnvelopes,
          encryptedFullName,
          fullNameEnvelopes,
          encryptedPhone,
          phoneEnvelopes,
        })

        setProgress(Math.round(((i + 1) / rows.length) * 90))
      }

      setProgress(95)
      const res = await importMutation.mutateAsync({ contacts: encryptedContacts })
      setProgress(100)
      setResult(res)
      setStage('done')
    } catch (_err) {
      toast.error(t('contacts.importFailed', { defaultValue: 'Import failed' }))
      setStage('preview')
    }
  }

  const rows = parseResult?.ok ? parseResult.rows : []
  const warnings = parseResult?.ok ? parseResult.warnings : []

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t('contacts.importContacts', { defaultValue: 'Import Contacts' })}
          </DialogTitle>
          <DialogDescription>
            {t('contacts.importDescription', {
              defaultValue:
                'Upload a CSV or JSON file to import contacts in bulk. Contacts are encrypted before sending.',
            })}
          </DialogDescription>
        </DialogHeader>

        {/* Pick file stage */}
        {stage === 'pick' && (
          <div className="space-y-4 py-2">
            <label
              data-testid="import-file-dropzone"
              className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/30 p-8 text-center hover:border-primary/50 transition-colors"
            >
              <FileUp className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">
                  {t('contacts.importFile', { defaultValue: 'Choose a CSV or JSON file' })}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('contacts.importFileHint', {
                    defaultValue:
                      'CSV columns: displayName, contactType, riskLevel, tags, fullName, phone, notes',
                  })}
                </p>
              </div>
              <input
                ref={fileRef}
                data-testid="import-file-input"
                type="file"
                accept=".csv,.json"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>

            {parseError && (
              <div
                data-testid="import-parse-error"
                className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {parseError}
              </div>
            )}
          </div>
        )}

        {/* Preview stage */}
        {stage === 'preview' && parseResult?.ok && (
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{fileName}</span>
                {' — '}
                {t('contacts.importPreviewCount', {
                  defaultValue: '{{count}} contacts ready to import',
                  count: rows.length,
                })}
              </p>
              <Button
                data-testid="import-change-file-btn"
                variant="ghost"
                size="sm"
                onClick={reset}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                {t('common.change', { defaultValue: 'Change' })}
              </Button>
            </div>

            {warnings.length > 0 && (
              <div
                data-testid="import-warnings"
                className="rounded-md bg-yellow-500/10 p-3 text-xs text-yellow-600 dark:text-yellow-400 space-y-1"
              >
                <p className="font-medium flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t('contacts.importWarnings', {
                    defaultValue: '{{count}} rows skipped',
                    count: warnings.length,
                  })}
                </p>
                {warnings.slice(0, 3).map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
                {warnings.length > 3 && <p>…and {warnings.length - 3} more</p>}
              </div>
            )}

            <ScrollArea className="h-60 rounded-md border">
              <div className="text-xs">
                <div className="grid grid-cols-4 gap-2 border-b bg-muted/50 px-3 py-2 font-medium text-muted-foreground">
                  <span>{t('contacts.displayName', { defaultValue: 'Display Name' })}</span>
                  <span>{t('contacts.type', { defaultValue: 'Type' })}</span>
                  <span>{t('contacts.riskLevel', { defaultValue: 'Risk Level' })}</span>
                  <span>{t('contacts.tags', { defaultValue: 'Tags' })}</span>
                </div>
                {rows.map((row, i) => (
                  <div
                    key={i}
                    data-testid="import-preview-row"
                    className="grid grid-cols-4 gap-2 border-b px-3 py-2 last:border-0"
                  >
                    <span className="truncate font-medium">{row.displayName}</span>
                    <span className="capitalize">{row.contactType}</span>
                    <span className="capitalize">{row.riskLevel}</span>
                    <span className="truncate text-muted-foreground">
                      {row.tags.join(', ') || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Importing stage */}
        {stage === 'importing' && (
          <div className="flex flex-col items-center gap-4 py-6" data-testid="import-progress">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {t('contacts.importingProgress', {
                defaultValue: 'Encrypting and importing contacts…',
              })}
            </p>
            <Progress data-testid="import-progress-bar" value={progress} className="w-full" />
            <p className="text-xs text-muted-foreground">{progress}%</p>
          </div>
        )}

        {/* Done stage */}
        {stage === 'done' && result && (
          <div className="space-y-3 py-2" data-testid="import-result">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              <p className="text-sm font-medium">
                {t('contacts.importSuccess', {
                  defaultValue: 'Imported {{created}} contacts',
                  created: result.created,
                })}
              </p>
            </div>

            {result.errors.length > 0 && (
              <div
                data-testid="import-errors"
                className="rounded-md bg-destructive/10 p-3 text-sm text-destructive space-y-1"
              >
                <p className="font-medium flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" />
                  {t('contacts.importErrors', {
                    defaultValue: '{{count}} rows failed',
                    count: result.errors.length,
                  })}
                </p>
                <ScrollArea className="max-h-32">
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs">
                      Row {e.index + 1}: {e.error}
                    </p>
                  ))}
                </ScrollArea>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {stage === 'pick' && (
            <Button data-testid="import-cancel-btn" variant="outline" onClick={handleClose}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          )}

          {stage === 'preview' && (
            <>
              <Button
                data-testid="import-cancel-preview-btn"
                variant="outline"
                onClick={handleClose}
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                data-testid="import-confirm-btn"
                onClick={handleImport}
                disabled={rows.length === 0}
              >
                <Upload className="mr-1.5 h-4 w-4" />
                {t('contacts.importConfirm', {
                  defaultValue: 'Import {{count}} contacts',
                  count: rows.length,
                })}
              </Button>
            </>
          )}

          {stage === 'done' && (
            <Button data-testid="import-done-btn" onClick={handleClose}>
              {t('common.done', { defaultValue: 'Done' })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
