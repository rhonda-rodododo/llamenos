import { Check, Loader2, Phone, Plus, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  type AvailablePhoneNumber,
  listProviderPhoneNumbers,
  type ProviderCredentials,
  type ProviderPhoneNumber,
  provisionPhoneNumber,
  searchAvailablePhoneNumbers,
} from '@/lib/api'
import { useToast } from '@/lib/toast'

interface PhoneNumberSelectorProps {
  credentials: ProviderCredentials
  selectedNumber: string
  onSelect: (phoneNumber: string) => void
  credentialsValid: boolean
}

type TabType = 'existing' | 'search'

export function PhoneNumberSelector({
  credentials,
  selectedNumber,
  onSelect,
  credentialsValid,
}: PhoneNumberSelectorProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [tab, setTab] = useState<TabType>('existing')
  const [existingNumbers, setExistingNumbers] = useState<ProviderPhoneNumber[]>([])
  const [searchResults, setSearchResults] = useState<AvailablePhoneNumber[]>([])
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [provisioning, setProvisioning] = useState<string | null>(null)
  const [searchCountry, setSearchCountry] = useState('US')
  const [searchAreaCode, setSearchAreaCode] = useState('')
  const [manualNumber, setManualNumber] = useState(selectedNumber)
  const [hasLoaded, setHasLoaded] = useState(false)

  const fetchExistingNumbers = useCallback(async () => {
    if (!credentialsValid) return
    setLoading(true)
    try {
      const result = await listProviderPhoneNumbers(credentials)
      setExistingNumbers(result.numbers)
      setHasLoaded(true)
    } catch {
      // Silently fail — user can enter number manually
      setHasLoaded(true)
    } finally {
      setLoading(false)
    }
  }, [credentials, credentialsValid])

  useEffect(() => {
    if (credentialsValid && !hasLoaded) {
      fetchExistingNumbers()
    }
  }, [credentialsValid, hasLoaded, fetchExistingNumbers])

  async function handleSearch() {
    setSearching(true)
    try {
      const result = await searchAvailablePhoneNumbers({
        ...credentials,
        country: searchCountry,
        areaCode: searchAreaCode || undefined,
      })
      setSearchResults(result.numbers)
    } catch {
      toast(t('setup.phoneNumbers.searchFailed'), 'error')
    } finally {
      setSearching(false)
    }
  }

  async function handleProvision(phoneNumber: string) {
    setProvisioning(phoneNumber)
    try {
      const result = await provisionPhoneNumber({
        ...credentials,
        phoneNumber,
      })
      if (result.ok) {
        toast(t('setup.phoneNumbers.provisioned'), 'success')
        onSelect(phoneNumber)
        // Refresh the existing numbers list
        await fetchExistingNumbers()
        setTab('existing')
      } else {
        toast(result.error || t('setup.phoneNumbers.provisionFailed'), 'error')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : t('setup.phoneNumbers.provisionFailed'), 'error')
    } finally {
      setProvisioning(null)
    }
  }

  if (!credentialsValid) {
    return (
      <div className="space-y-3">
        <Label>{t('telephonyProvider.phoneNumber')}</Label>
        <Input
          value={manualNumber}
          onChange={(e) => {
            setManualNumber(e.target.value)
            onSelect(e.target.value)
          }}
          placeholder="+12125551234"
          data-testid="phone-number-input"
        />
        <p className="text-xs text-muted-foreground">{t('setup.phoneNumbers.validateFirst')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>{t('telephonyProvider.phoneNumber')}</Label>
        {/* Tab switcher */}
        <div className="flex gap-1">
          <Button
            variant={tab === 'existing' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTab('existing')}
            className="text-xs h-7 px-2"
          >
            <Phone className="h-3 w-3" />
            {t('setup.phoneNumbers.existing')}
          </Button>
          <Button
            variant={tab === 'search' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTab('search')}
            className="text-xs h-7 px-2"
          >
            <Search className="h-3 w-3" />
            {t('setup.phoneNumbers.buyNew')}
          </Button>
        </div>
      </div>

      {tab === 'existing' && (
        <div className="space-y-3">
          {/* Manual entry fallback */}
          <div className="flex gap-2">
            <Input
              value={manualNumber}
              onChange={(e) => {
                setManualNumber(e.target.value)
                onSelect(e.target.value)
              }}
              placeholder="+12125551234"
              className="flex-1"
              data-testid="phone-number-input"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={fetchExistingNumbers}
              disabled={loading}
              aria-label={t('setup.phoneNumbers.refresh')}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Existing numbers list */}
          {existingNumbers.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-lg border divide-y">
              {existingNumbers.map((num) => (
                <button
                  key={num.phoneNumber}
                  type="button"
                  onClick={() => {
                    onSelect(num.phoneNumber)
                    setManualNumber(num.phoneNumber)
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50 transition-colors ${
                    selectedNumber === num.phoneNumber ? 'bg-primary/5' : ''
                  }`}
                  data-testid={`phone-number-option-${num.phoneNumber}`}
                >
                  <div>
                    <p className="text-sm font-medium">{num.phoneNumber}</p>
                    <p className="text-xs text-muted-foreground">{num.friendlyName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {num.capabilities.voice && (
                      <Badge variant="outline" className="text-[10px]">
                        {t('setup.phoneNumbers.voice')}
                      </Badge>
                    )}
                    {num.capabilities.sms && (
                      <Badge variant="outline" className="text-[10px]">
                        {t('setup.phoneNumbers.sms')}
                      </Badge>
                    )}
                    {selectedNumber === num.phoneNumber && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {hasLoaded && existingNumbers.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground">{t('setup.phoneNumbers.noExisting')}</p>
          )}
        </div>
      )}

      {tab === 'search' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="space-y-1 flex-1">
              <Input
                value={searchCountry}
                onChange={(e) => setSearchCountry(e.target.value.toUpperCase())}
                placeholder="US"
                maxLength={2}
                data-testid="search-country"
              />
              <p className="text-[10px] text-muted-foreground">
                {t('setup.phoneNumbers.countryCode')}
              </p>
            </div>
            <div className="space-y-1 flex-1">
              <Input
                value={searchAreaCode}
                onChange={(e) => setSearchAreaCode(e.target.value)}
                placeholder="212"
                maxLength={5}
                data-testid="search-area-code"
              />
              <p className="text-[10px] text-muted-foreground">
                {t('setup.phoneNumbers.areaCode')}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleSearch}
              disabled={searching || !searchCountry}
              className="self-start"
            >
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {t('setup.phoneNumbers.search')}
            </Button>
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-lg border divide-y">
              {searchResults.map((num) => (
                <div key={num.phoneNumber} className="flex items-center justify-between px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{num.phoneNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {[num.locality, num.region, num.country].filter(Boolean).join(', ')}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleProvision(num.phoneNumber)}
                    disabled={provisioning === num.phoneNumber}
                    data-testid={`provision-${num.phoneNumber}`}
                  >
                    {provisioning === num.phoneNumber ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                    {t('setup.phoneNumbers.provision')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
