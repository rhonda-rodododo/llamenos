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

export function BulkMergeDialog({ open, onOpenChange, contacts, onMerged }: BulkMergeDialogProps) {
  const { t } = useTranslation()
  const mergeMutation = useMergeContacts()
  const [primaryId, setPrimaryId] = useState<string>('')

  async function handleMerge() {
    if (!primaryId || contacts.length < 2) return
    const secondaries = contacts.filter((c) => c.id !== primaryId)
    try {
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
                  primaryId === contact.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
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
                  <p className="text-sm font-medium">{contact.displayName ?? '[encrypted]'}</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="capitalize">{contact.contactType}</span>
                    {contact.riskLevel && contact.riskLevel !== 'low' && (
                      <span className="capitalize">{contact.riskLevel}</span>
                    )}
                    {contact.tags.length > 0 && <span>{contact.tags.join(', ')}</span>}
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
