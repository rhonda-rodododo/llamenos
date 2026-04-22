import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MessageDeliveryStatus } from '@/lib/api'

interface MessageStatusIconProps {
  status?: MessageDeliveryStatus
  error?: string | null
  className?: string
}

/**
 * Renders a small icon representing outbound message delivery status.
 *
 * pending  → Clock (gray)
 * sent     → Check (gray)
 * delivered → CheckCheck (gray)
 * read     → CheckCheck (blue)
 * failed   → AlertCircle (red) with error tooltip
 */
export function MessageStatusIcon({
  status,
  error,
  className = 'h-3 w-3',
}: MessageStatusIconProps) {
  const { t } = useTranslation()

  switch (status) {
    case 'pending':
      return (
        <Clock
          className={className}
          aria-label={t('conversations.status.pending', { defaultValue: 'Pending' })}
        />
      )
    case 'sent':
      return (
        <Check
          className={className}
          aria-label={t('conversations.status.sent', { defaultValue: 'Sent' })}
        />
      )
    case 'delivered':
      return (
        <CheckCheck
          className={className}
          aria-label={t('conversations.status.delivered', { defaultValue: 'Delivered' })}
        />
      )
    case 'read':
      return (
        <CheckCheck
          className={`${className} text-blue-400`}
          aria-label={t('conversations.status.read', { defaultValue: 'Read' })}
        />
      )
    case 'failed':
      return (
        <span
          title={
            error
              ? t('conversations.status.failedTooltip', {
                  defaultValue: 'Failed: {{error}}',
                  error,
                })
              : t('conversations.status.failed', { defaultValue: 'Failed' })
          }
        >
          <AlertCircle
            className={`${className} text-red-400`}
            aria-label={t('conversations.status.failed', { defaultValue: 'Failed' })}
          />
        </span>
      )
    default:
      return (
        <Check
          className={className}
          aria-label={t('conversations.status.sent', { defaultValue: 'Sent' })}
        />
      )
  }
}
