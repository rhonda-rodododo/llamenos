import {
  SectionActions,
  SectionBody,
  SectionDescription,
  SectionField,
} from '@/components/section-layout'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { type WebAuthnSettings, getWebAuthnSettings, updateWebAuthnSettings } from '@/lib/api'
import { queryKeys } from '@/lib/queries/keys'
import { useToast } from '@/lib/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Enforcement = 'none' | 'admins' | 'everyone'

function settingsToEnforcement(s: WebAuthnSettings): Enforcement {
  if (s.requireForUsers) return 'everyone'
  if (s.requireForAdmins) return 'admins'
  return 'none'
}

function enforcementToSettings(e: Enforcement): WebAuthnSettings {
  switch (e) {
    case 'everyone':
      return { requireForAdmins: true, requireForUsers: true }
    case 'admins':
      return { requireForAdmins: true, requireForUsers: false }
    case 'none':
      return { requireForAdmins: false, requireForUsers: false }
  }
}

export function PasskeyPolicySection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: queryKeys.settings.webauthn(),
    queryFn: getWebAuthnSettings,
  })
  const [draft, setDraft] = useState<Enforcement | null>(null)
  const [showSaved, setShowSaved] = useState(false)

  useEffect(() => {
    if (settings && draft === null) setDraft(settingsToEnforcement(settings))
  }, [settings, draft])

  const saveMutation = useMutation({
    mutationFn: (next: Enforcement) => updateWebAuthnSettings(enforcementToSettings(next)),
    onSuccess: (updated) => {
      setDraft(settingsToEnforcement(updated))
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.webauthn() })
      toast(t('common.success'), 'success')
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    },
    onError: () => toast(t('common.error'), 'error'),
  })

  if (isLoading || draft === null) return null

  return (
    <SectionBody>
      <SectionDescription>{t('passkeyPolicy.description')}</SectionDescription>

      <SectionField
        label={t('passkeyPolicy.enforcement')}
        htmlFor="passkey-policy-enforcement"
        help={t('passkeyPolicy.enforcementHelp')}
      >
        <Select value={draft} onValueChange={(v) => setDraft(v as Enforcement)}>
          <SelectTrigger
            id="passkey-policy-enforcement"
            data-testid="admin-passkey-policy-enforcement-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('passkeyPolicy.enforcementNone')}</SelectItem>
            <SelectItem value="admins">{t('passkeyPolicy.enforcementAdmins')}</SelectItem>
            <SelectItem value="everyone">{t('passkeyPolicy.enforcementEveryone')}</SelectItem>
          </SelectContent>
        </Select>
      </SectionField>

      <SectionActions
        slug="passkey-policy"
        onSave={() => saveMutation.mutate(draft)}
        saving={saveMutation.isPending}
        showSaved={showSaved}
      />
    </SectionBody>
  )
}
