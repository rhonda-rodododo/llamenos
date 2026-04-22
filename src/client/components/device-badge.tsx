import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'

interface DeviceBadgeProps {
  verified: boolean
}

export function DeviceBadge({ verified }: DeviceBadgeProps) {
  const { t } = useTranslation()
  return (
    <Badge
      data-testid="device-badge"
      data-verified={verified}
      variant={verified ? 'default' : 'destructive'}
    >
      {verified ? t('device.verified') : t('device.unverified')}
    </Badge>
  )
}
