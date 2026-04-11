import { PhoneInput } from '@/components/phone-input'
import { TagInput } from '@/components/tag-input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  type ContactRecord,
  checkContactDuplicate,
  getContactRecipients,
  hashContactPhone,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cryptoWorker } from '@/lib/crypto-worker-client'
import * as keyManager from '@/lib/key-manager'
import { useCreateContact } from '@/lib/queries/contacts'
import { useToast } from '@/lib/toast'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { type CryptoLabel, LABEL_CONTACT_PII, LABEL_CONTACT_SUMMARY } from '@shared/crypto-labels'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { AlertTriangle, Loader2, Lock } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Envelope-encrypt plaintext for multiple recipients via the crypto worker.
 * Keeps the random message key material inside the worker rather than the
 * main thread, and reuses the canonical ECIES/XChaCha primitive stack.
 */
async function envelopeEncryptViaWorker(
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
    envelopes: envelopes.map((e) => ({
      pubkey: e.recipientPubkey,
      wrappedKey: e.wrappedKeyHex as Ciphertext,
      ephemeralPubkey: e.ephemeralPubkeyHex,
    })),
  }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (contact: ContactRecord) => void
}

const CONTACT_TYPES = ['caller', 'organization', 'volunteer', 'other'] as const
const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const

interface FormState {
  displayName: string
  contactType: string
  riskLevel: string
  tags: string[]
  notes: string
  // PII fields
  fullName: string
  phone: string
}

const INITIAL_FORM: FormState = {
  displayName: '',
  contactType: 'caller',
  riskLevel: 'low',
  tags: [],
  notes: '',
  fullName: '',
  phone: '',
}

export function CreateContactDialog({ open, onOpenChange, onCreated }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { hasPermission } = useAuth()
  const createContactMutation = useCreateContact()

  const canViewPii = hasPermission('contacts:envelope-full')

  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [dupWarning, setDupWarning] = useState<{ exists: boolean; contactId?: string } | null>(null)
  const [checkingDup, setCheckingDup] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function resetForm() {
    setForm(INITIAL_FORM)
    setDupWarning(null)
    setError(null)
  }

  const handlePhoneBlur = useCallback(async () => {
    if (!form.phone) return
    setCheckingDup(true)
    setDupWarning(null)
    try {
      const result = await checkContactDuplicate(form.phone)
      if (result.exists) {
        setDupWarning({ exists: true, contactId: result.contactId })
      }
    } catch {
      // Non-fatal — dedup check failure should not block creation
    } finally {
      setCheckingDup(false)
    }
  }, [form.phone])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.displayName.trim()) {
      setError(t('contacts.errorDisplayNameRequired', 'Display name is required'))
      return
    }

    const unlocked = await keyManager.isUnlocked()
    if (!unlocked) {
      setError(
        t('contacts.errorKeyLocked', 'Encryption key is locked. Please unlock your key first.')
      )
      return
    }

    setSubmitting(true)
    try {
      const pk = await keyManager.getPublicKeyHex()
      if (!pk) {
        setError(t('contacts.errorNoPubkey', 'Could not retrieve public key'))
        return
      }

      // Fetch authorized recipients from server — ensure current user is always included
      const { summaryPubkeys, piiPubkeys } = await getContactRecipients()
      if (!summaryPubkeys.includes(pk)) summaryPubkeys.push(pk)
      if (!piiPubkeys.includes(pk)) piiPubkeys.push(pk)

      const tags = form.tags

      // Encrypt Tier 1: display name (required)
      const { encrypted: encryptedDisplayName, envelopes: displayNameEnvelopes } =
        await envelopeEncryptViaWorker(
          form.displayName.trim(),
          summaryPubkeys,
          LABEL_CONTACT_SUMMARY
        )

      // Encrypt notes if present
      let encryptedNotes: string | undefined
      let notesEnvelopes: RecipientEnvelope[] | undefined
      if (form.notes.trim()) {
        const result = await envelopeEncryptViaWorker(
          form.notes.trim(),
          summaryPubkeys,
          LABEL_CONTACT_SUMMARY
        )
        encryptedNotes = result.encrypted
        notesEnvelopes = result.envelopes
      }

      // Encrypt Tier 2 fields if present
      let encryptedFullName: string | undefined
      let fullNameEnvelopes: RecipientEnvelope[] | undefined
      let encryptedPhone: string | undefined
      let phoneEnvelopes: RecipientEnvelope[] | undefined
      let identifierHash: HmacHash | undefined

      if (canViewPii) {
        if (form.fullName.trim()) {
          const result = await envelopeEncryptViaWorker(
            form.fullName.trim(),
            piiPubkeys,
            LABEL_CONTACT_PII
          )
          encryptedFullName = result.encrypted
          fullNameEnvelopes = result.envelopes
        }

        if (form.phone.trim()) {
          // Get HMAC from server (client doesn't have the HMAC secret)
          const { identifierHash: hash } = await hashContactPhone(form.phone.trim())
          identifierHash = hash as HmacHash
          const result = await envelopeEncryptViaWorker(
            form.phone.trim(),
            piiPubkeys,
            LABEL_CONTACT_PII
          )
          encryptedPhone = result.encrypted
          phoneEnvelopes = result.envelopes
        }
      }

      const contact = await createContactMutation.mutateAsync({
        contactType: form.contactType,
        riskLevel: form.riskLevel,
        tags,
        identifierHash,
        encryptedDisplayName,
        displayNameEnvelopes,
        encryptedNotes,
        notesEnvelopes,
        encryptedFullName,
        fullNameEnvelopes,
        encryptedPhone,
        phoneEnvelopes,
      })

      toast(t('contacts.created', 'Contact created'), 'success')
      resetForm()
      onCreated(contact)
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!submitting) {
      if (!nextOpen) resetForm()
      onOpenChange(nextOpen)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg" data-testid="create-contact-dialog">
        <DialogHeader>
          <DialogTitle data-testid="create-contact-title">
            {t('contacts.createTitle', 'New Contact')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tier 1 fields */}
          <div className="space-y-2">
            <Label htmlFor="displayName">
              {t('contacts.fields.displayName', 'Display Name')}{' '}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="displayName"
              value={form.displayName}
              onChange={(e) => setField('displayName', e.target.value)}
              placeholder={t('contacts.placeholders.displayName', 'e.g. Caller from 3/28')}
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contactType">
                {t('contacts.fields.contactType', 'Contact Type')}
              </Label>
              <Select value={form.contactType} onValueChange={(v) => setField('contactType', v)}>
                <SelectTrigger id="contactType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map((ct) => (
                    <SelectItem key={ct} value={ct}>
                      {t(`contacts.types.${ct}`, ct)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="riskLevel">{t('contacts.fields.riskLevel', 'Risk Level')}</Label>
              <Select value={form.riskLevel} onValueChange={(v) => setField('riskLevel', v)}>
                <SelectTrigger id="riskLevel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_LEVELS.map((rl) => (
                    <SelectItem key={rl} value={rl}>
                      {t(`contacts.riskLevels.${rl}`, rl)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('contacts.fields.tags', 'Tags')}</Label>
            <TagInput
              value={form.tags}
              onChange={(tags) => setField('tags', tags)}
              allowCreate
              placeholder={t('contacts.placeholders.tags', 'Select or create tags...')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">{t('contacts.fields.notes', 'Notes')}</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder={t('contacts.placeholders.notes', 'Optional notes about this contact')}
              rows={3}
            />
          </div>

          {/* Tier 2 PII fields — only visible with permission */}
          {canViewPii && (
            <div className="space-y-4 rounded-md border border-dashed p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="size-3" />
                <span>{t('contacts.piiSection', 'PII — encrypted, access-controlled')}</span>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fullName">{t('contacts.fields.fullName', 'Full Name')}</Label>
                <Input
                  id="fullName"
                  value={form.fullName}
                  onChange={(e) => setField('fullName', e.target.value)}
                  placeholder={t('contacts.placeholders.fullName', 'Legal name')}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">{t('contacts.fields.phone', 'Phone Number')}</Label>
                <PhoneInput
                  id="phone"
                  value={form.phone}
                  onChange={(v) => {
                    setField('phone', v)
                    // Reset dup warning when phone changes
                    if (dupWarning) setDupWarning(null)
                  }}
                  placeholder={t('contacts.placeholders.phone', '+1 555 000 0000')}
                />
                {/* Dedup check happens on blur via the wrapper div */}
                <div onBlur={handlePhoneBlur}>
                  {checkingDup && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      {t('contacts.checkingDup', 'Checking for duplicates...')}
                    </p>
                  )}
                  {dupWarning?.exists && (
                    <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="size-3" />
                      {t('contacts.dupWarning', 'A contact with this phone number already exists.')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="flex items-center gap-1 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={submitting || !form.displayName.trim()}>
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {t('contacts.createButton', 'Create Contact')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
