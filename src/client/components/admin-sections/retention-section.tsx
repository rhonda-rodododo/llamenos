import { SectionBody, SectionDescription, SectionField } from '@/components/section-layout'
import { Input } from '@/components/ui/input'
import { useRetentionSettings, useUpdateRetentionSettings } from '@/lib/queries/settings'
import { useToast } from '@/lib/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function RetentionSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { data: settings, isLoading } = useRetentionSettings()
  const saveMutation = useUpdateRetentionSettings()
  const [showSaved, setShowSaved] = useState(false)

  function save(field: string, raw: string) {
    const val = Number.parseInt(raw)
    if (!Number.isFinite(val) || val < 1) return
    saveMutation.mutate(
      { [field]: val },
      {
        onSuccess: () => {
          setShowSaved(true)
          setTimeout(() => setShowSaved(false), 2000)
        },
        onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
      }
    )
  }

  if (isLoading || !settings) return null

  return (
    <SectionBody className="space-y-4">
      <SectionDescription>
        {t('retention.description', {
          defaultValue:
            'Configure how long different types of data are retained before automatic deletion.',
        })}
      </SectionDescription>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SectionField
          label={t('retention.callRecordsDays', { defaultValue: 'Call Records (days)' })}
          htmlFor="retention-call-records"
          help={t('retention.callRecordsDaysHelp', {
            defaultValue: 'Days to retain call history records (30–3650).',
          })}
        >
          <Input
            id="retention-call-records"
            data-testid="admin-retention-call-records-input"
            type="number"
            defaultValue={settings.callRecordsDays}
            min={30}
            max={3650}
            onBlur={(e) => save('callRecordsDays', e.target.value)}
          />
        </SectionField>

        <SectionField
          label={t('retention.notesDays', { defaultValue: 'Notes (days)' })}
          htmlFor="retention-notes"
          help={t('retention.notesDaysHelp', {
            defaultValue: 'Days to retain call notes (30–3650).',
          })}
        >
          <Input
            id="retention-notes"
            data-testid="admin-retention-notes-input"
            type="number"
            defaultValue={settings.notesDays}
            min={30}
            max={3650}
            onBlur={(e) => save('notesDays', e.target.value)}
          />
        </SectionField>

        <SectionField
          label={t('retention.messagesDays', { defaultValue: 'Messages (days)' })}
          htmlFor="retention-messages"
          help={t('retention.messagesDaysHelp', {
            defaultValue: 'Days to retain conversation messages (30–3650).',
          })}
        >
          <Input
            id="retention-messages"
            data-testid="admin-retention-messages-input"
            type="number"
            defaultValue={settings.messagesDays}
            min={30}
            max={3650}
            onBlur={(e) => save('messagesDays', e.target.value)}
          />
        </SectionField>

        <SectionField
          label={t('retention.auditLogDays', { defaultValue: 'Audit Log (days)' })}
          htmlFor="retention-audit-log"
          help={t('retention.auditLogDaysHelp', {
            defaultValue: 'Days to retain audit log entries (365–3650).',
          })}
        >
          <Input
            id="retention-audit-log"
            data-testid="admin-retention-audit-log-input"
            type="number"
            defaultValue={settings.auditLogDays}
            min={365}
            max={3650}
            onBlur={(e) => save('auditLogDays', e.target.value)}
          />
        </SectionField>
      </div>

      {showSaved && (
        <span data-testid="admin-retention-save-success" className="text-sm text-green-600">
          {t('common.saved', { defaultValue: 'Saved' })}
        </span>
      )}
    </SectionBody>
  )
}
