import { SectionBanner, SectionBody, SectionDescription } from '@/components/section-layout'
import { useTranslation } from 'react-i18next'

/**
 * Super-admin-only placeholder section for future platform-wide settings.
 * No endpoints or state yet — just a scaffold that reserves the nav slot.
 */
export function PlatformSection() {
  const { t } = useTranslation()
  return (
    <SectionBody>
      <SectionDescription>
        {t('platform.description', {
          defaultValue: 'Platform-wide settings and configuration.',
        })}
      </SectionDescription>
      <SectionBanner tone="info" data-testid="admin-platform-empty-state">
        {t('platform.emptyState', { defaultValue: 'No platform-level settings yet.' })}
      </SectionBanner>
    </SectionBody>
  )
}
