import type { GeocodingProvider } from '@shared/types'
import { GEOCODING_PROVIDER_LABELS } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, TestTube2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SectionActions,
  SectionBody,
  SectionDescription,
  SectionField,
  SectionToggleField,
} from '@/components/section-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  type GeocodingConfigAdmin,
  getGeocodingSettings,
  testGeocodingProvider,
  updateGeocodingSettings,
} from '@/lib/api'
import { queryKeys } from '@/lib/queries/keys'
import { useToast } from '@/lib/toast'

const DISABLED_VALUE = '__disabled__'

export function LocationLookupSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: config, isLoading } = useQuery({
    queryKey: queryKeys.settings.geocoding(),
    queryFn: getGeocodingSettings,
  })
  const [draft, setDraft] = useState<GeocodingConfigAdmin | null>(null)
  const [showSaved, setShowSaved] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    latency?: number
    error?: string
  } | null>(null)

  useEffect(() => {
    if (config && !draft) setDraft(config)
  }, [config, draft])

  const saveMutation = useMutation({
    mutationFn: (next: GeocodingConfigAdmin) => updateGeocodingSettings(next),
    onSuccess: (updated) => {
      setDraft(updated)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.geocoding() })
      toast(t('common.success'), 'success')
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    },
    onError: () => toast(t('common.error'), 'error'),
  })

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('no draft')
      await updateGeocodingSettings(draft)
      return testGeocodingProvider()
    },
    onSuccess: (result) => {
      setTestResult(result)
      if (result.ok) {
        toast(t('locationLookup.testOk', { latency: result.latency }), 'success')
      } else {
        toast(result.error || t('locationLookup.testFailed'), 'error')
      }
    },
    onError: () => {
      setTestResult({ ok: false, error: 'Connection failed' })
      toast(t('locationLookup.testFailed'), 'error')
    },
  })

  if (isLoading || !draft) return null

  const selectValue = draft.provider ?? DISABLED_VALUE

  function handleProviderChange(val: string) {
    if (!draft) return
    if (val === DISABLED_VALUE) {
      setDraft({ ...draft, provider: null, enabled: false })
    } else {
      setDraft({ ...draft, provider: val as GeocodingProvider, enabled: true })
    }
  }

  return (
    <SectionBody>
      <SectionDescription>{t('locationLookup.description')}</SectionDescription>

      <SectionField label={t('locationLookup.provider')} htmlFor="location-lookup-provider">
        <Select value={selectValue} onValueChange={handleProviderChange}>
          <SelectTrigger
            id="location-lookup-provider"
            data-testid="admin-location-lookup-provider-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DISABLED_VALUE}>{t('common.disabled')}</SelectItem>
            {Object.entries(GEOCODING_PROVIDER_LABELS).map(([val, label]) => (
              <SelectItem key={val} value={val}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SectionField>

      {draft.provider && (
        <>
          <SectionField label={t('locationLookup.apiKey')} htmlFor="location-lookup-api-key">
            <Input
              id="location-lookup-api-key"
              data-testid="admin-location-lookup-api-key-input"
              type="password"
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder={t('locationLookup.apiKeyPlaceholder')}
            />
          </SectionField>

          <SectionField
            label={t('locationLookup.countries')}
            htmlFor="location-lookup-countries"
            help={t('locationLookup.countriesHelp')}
          >
            <Input
              id="location-lookup-countries"
              data-testid="admin-location-lookup-countries-input"
              value={draft.countries.join(', ')}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  countries: e.target.value
                    .split(',')
                    .map((c) => c.trim().toLowerCase())
                    .filter((c) => c.length === 2),
                })
              }
              placeholder={t('locationLookup.countriesPlaceholder')}
            />
          </SectionField>

          <SectionToggleField label={t('locationLookup.enable')} htmlFor="location-lookup-enabled">
            <Switch
              id="location-lookup-enabled"
              data-testid="admin-location-lookup-enabled-switch"
              checked={draft.enabled}
              onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
            />
          </SectionToggleField>
        </>
      )}

      <SectionActions
        slug="location-lookup"
        onSave={() => saveMutation.mutate(draft)}
        saving={saveMutation.isPending}
        showSaved={showSaved}
        extraActions={
          draft.provider && draft.apiKey ? (
            <Button
              variant="outline"
              data-testid="admin-location-lookup-test-button"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
            >
              {testMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <TestTube2 className="mr-2 h-4 w-4" />
              )}
              {t('locationLookup.testConnection')}
            </Button>
          ) : null
        }
      />

      {testResult && (
        <p
          data-testid="admin-location-lookup-test-result"
          className={`text-sm ${testResult.ok ? 'text-green-600' : 'text-destructive'}`}
        >
          {testResult.ok
            ? t('locationLookup.testOk', { latency: testResult.latency })
            : testResult.error || t('locationLookup.testFailed')}
        </p>
      )}
    </SectionBody>
  )
}
