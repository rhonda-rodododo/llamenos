import { ContactSelect } from '@/components/contacts/contact-select'
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

interface MergeDialogProps {
  /** The contact to merge (secondary -- will be soft-deleted) */
  secondaryId: string
  secondaryName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onMerged: (primaryId: string) => void
}

export function MergeDialog({
  secondaryId,
  secondaryName,
  open,
  onOpenChange,
  onMerged,
}: MergeDialogProps) {
  const { t } = useTranslation()
  const [primaryId, setPrimaryId] = useState<string>('')
  const mergeMutation = useMergeContacts()

  async function handleMerge() {
    if (!primaryId) return
    try {
      await mergeMutation.mutateAsync({ primaryId, secondaryId })
      toast.success(t('contacts.mergeSuccess', { defaultValue: 'Contacts merged successfully' }))
      onOpenChange(false)
      onMerged(primaryId)
    } catch {
      toast.error(t('contacts.mergeFailed', { defaultValue: 'Failed to merge contacts' }))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('contacts.mergeContact', { defaultValue: 'Merge Contact' })}</DialogTitle>
          <DialogDescription>
            {t('contacts.mergeDescription', {
              defaultValue:
                'Merge "{{name}}" into another contact. All calls and conversations will be re-linked to the target contact, and "{{name}}" will be archived.',
              name: secondaryName,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <label className="text-sm font-medium">
            {t('contacts.mergeInto', { defaultValue: 'Merge into' })}
          </label>
          <ContactSelect
            value={primaryId}
            onChange={(val) => setPrimaryId(typeof val === 'string' ? val : (val[0] ?? ''))}
            data-testid="merge-contact-select"
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mergeMutation.isPending}
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            data-testid="merge-confirm-btn"
            onClick={handleMerge}
            disabled={!primaryId || primaryId === secondaryId || mergeMutation.isPending}
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
