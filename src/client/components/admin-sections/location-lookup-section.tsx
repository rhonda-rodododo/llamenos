import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { GEOCODING_PROVIDER_LABELS } from '@shared/types'
import type { GeocodingProvider } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save, TestTube2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
    <section className="space-y-6">
      <p className="text-sm text-muted-foreground">{t('locationLookup.description')}</p>

      <div className="space-y-2">
        <Label htmlFor="location-lookup-provider">{t('locationLookup.provider')}</Label>
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
      </div>

      {draft.provider && (
        <>
          <div className="space-y-2">
            <Label htmlFor="location-lookup-api-key">{t('locationLookup.apiKey')}</Label>
            <Input
              id="location-lookup-api-key"
              data-testid="admin-location-lookup-api-key-input"
              type="password"
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder={t('locationLookup.apiKeyPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="location-lookup-countries">{t('locationLookup.countries')}</Label>
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
            <p className="text-xs text-muted-foreground">{t('locationLookup.countriesHelp')}</p>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="location-lookup-enabled">{t('locationLookup.enable')}</Label>
            <Switch
              id="location-lookup-enabled"
              data-testid="admin-location-lookup-enabled-switch"
              checked={draft.enabled}
              onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
            />
          </div>
        </>
      )}

      <div className="flex gap-2">
        <Button
          data-testid="admin-location-lookup-save"
          onClick={() => saveMutation.mutate(draft)}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {t('common.save')}
        </Button>
        {draft.provider && draft.apiKey && (
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
        )}
      </div>

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

      {showSaved && (
        <span data-testid="admin-location-lookup-save-success" className="text-sm text-green-600">
          {t('locationLookup.saved')}
        </span>
      )}
    </section>
  )
}
