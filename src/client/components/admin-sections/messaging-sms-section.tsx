import { SectionBanner, SectionBody, SectionDescription } from '@/components/section-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  type TelephonyProviderConfig,
  getSetupState,
  getTelephonyProvider,
  updateSetupState,
} from '@/lib/api'
import { queryKeys } from '@/lib/queries/keys'
import { useToast } from '@/lib/toast'
import {
  CHANNEL_LABELS,
  CHANNEL_SECURITY,
  type ChannelType,
  type TransportSecurity,
} from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FileText, Globe, MessageSquare, Phone, Shield } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SLUG = 'messaging-sms'

interface ChannelInfo {
  type: ChannelType
  icon: typeof Phone
  descriptionKey: string
}

const CHANNELS: ChannelInfo[] = [
  { type: 'voice', icon: Phone, descriptionKey: 'setup.channelVoiceDesc' },
  { type: 'sms', icon: MessageSquare, descriptionKey: 'setup.channelSmsDesc' },
  { type: 'whatsapp', icon: Globe, descriptionKey: 'setup.channelWhatsappDesc' },
  { type: 'signal', icon: Shield, descriptionKey: 'setup.channelSignalDesc' },
  { type: 'reports', icon: FileText, descriptionKey: 'setup.channelReportsDesc' },
]

const SECURITY_BADGE_STYLES: Record<TransportSecurity, string> = {
  e2ee: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  'e2ee-to-bridge': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  'provider-encrypted': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  none: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

const SECURITY_LABEL_KEYS: Record<TransportSecurity, string> = {
  e2ee: 'setup.securityE2ee',
  'e2ee-to-bridge': 'setup.securityE2eeBridge',
  'provider-encrypted': 'setup.securityProvider',
  none: 'setup.securityNone',
}

const SETUP_STATE_KEY = ['setup', 'state'] as const

export function MessagingSmsSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: setupState } = useQuery({
    queryKey: SETUP_STATE_KEY,
    queryFn: getSetupState,
  })
  const { data: providerConfig } = useQuery<TelephonyProviderConfig | null>({
    queryKey: queryKeys.settings.provider(),
    queryFn: () => getTelephonyProvider().catch(() => null),
  })

  const [selectedChannels, setSelectedChannels] = useState<ChannelType[]>([])
  const [showSaved, setShowSaved] = useState(false)

  useEffect(() => {
    if (setupState) setSelectedChannels(setupState.selectedChannels || [])
  }, [setupState])

  const saveMutation = useMutation({
    mutationFn: () => updateSetupState({ selectedChannels }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SETUP_STATE_KEY })
      toast(t('common.success'), 'success')
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    },
    onError: () => toast(t('common.error'), 'error'),
  })

  function toggleChannel(channel: ChannelType) {
    setSelectedChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
    )
  }

  function getChannelStatus(type: ChannelType): 'active' | 'configured' | 'not-configured' {
    if (!selectedChannels.includes(type)) return 'not-configured'
    switch (type) {
      case 'voice':
      case 'sms':
        return providerConfig?.phoneNumber ? 'active' : 'configured'
      case 'reports':
        return 'active'
      default:
        return 'configured'
    }
  }

  const hasChanges =
    setupState &&
    JSON.stringify(selectedChannels.slice().sort()) !==
      JSON.stringify([...(setupState.selectedChannels || [])].sort())

  return (
    <SectionBody>
      <SectionDescription>
        {t('channelSettings.description', {
          defaultValue: 'Manage which communication channels are enabled for your hotline.',
        })}
      </SectionDescription>

      <div className="grid gap-3 sm:grid-cols-2">
        {CHANNELS.map((channel) => {
          const selected = selectedChannels.includes(channel.type)
          const security = CHANNEL_SECURITY[channel.type]
          const status = getChannelStatus(channel.type)
          const Icon = channel.icon

          return (
            <Card
              key={channel.type}
              // biome-ignore lint/a11y/useSemanticElements: Card with interactive role is intentional
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              data-testid={`admin-${SLUG}-channel-${channel.type}`}
              onClick={() => toggleChannel(channel.type)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggleChannel(channel.type)
                }
              }}
              className={`cursor-pointer p-3 transition-all ${
                selected ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{CHANNEL_LABELS[channel.type]}</span>
                </div>
                <div className="flex items-center gap-1">
                  {selected && status === 'active' && (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-0 bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                    >
                      {t('channelSettings.active', { defaultValue: 'Active' })}
                    </Badge>
                  )}
                  {selected && (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                      <Check className="h-3 w-3 text-primary-foreground" />
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t(channel.descriptionKey)}</p>
              <Badge
                variant="outline"
                className={`mt-2 text-[10px] border-0 ${SECURITY_BADGE_STYLES[security]}`}
              >
                {t(SECURITY_LABEL_KEYS[security])}
              </Badge>
            </Card>
          )
        })}
      </div>

      {providerConfig && (
        <SectionBanner data-testid={`admin-${SLUG}-current-provider-banner`}>
          {t('channelSettings.currentProvider', { defaultValue: 'Current voice/SMS provider:' })}{' '}
          <span className="font-medium text-foreground">
            {providerConfig.type} ({providerConfig.phoneNumber})
          </span>
        </SectionBanner>
      )}

      {hasChanges && (
        <div className="flex items-center gap-3 pt-2 border-t mt-2">
          <Button
            data-testid={`admin-${SLUG}-save`}
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? t('common.loading') : t('common.save')}
          </Button>
          {showSaved && (
            <span data-testid={`admin-${SLUG}-save-success`} className="text-sm text-green-600">
              {t('common.success')}
            </span>
          )}
        </div>
      )}
    </SectionBody>
  )
}
