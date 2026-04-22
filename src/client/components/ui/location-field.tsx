import type { LocationFieldValue, LocationPrecision, LocationResult } from '@shared/types'
import { ExternalLink, Loader2, MapPin, Navigation, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { geocodingAutocomplete, geocodingReverse } from '@/lib/api'

interface LocationFieldProps {
  value: LocationFieldValue | null
  onChange: (value: LocationFieldValue | null) => void
  maxPrecision?: LocationPrecision
  allowGps?: boolean
  allowAutocomplete?: boolean
  disabled?: boolean
  id?: string
}

/**
 * Cap coordinate precision based on maxPrecision setting.
 * Only include lat/lon if the precision allows it.
 */
function capToPrecision(
  result: LocationResult,
  maxPrecision: LocationPrecision
): LocationFieldValue {
  const value: LocationFieldValue = {
    address: result.address,
    displayName: result.displayName,
    source: 'geocoded',
  }
  if (maxPrecision === 'exact' || maxPrecision === 'block') {
    value.lat = result.lat
    value.lon = result.lon
  }
  return value
}

export function LocationField({
  value,
  onChange,
  maxPrecision = 'exact',
  allowGps = false,
  allowAutocomplete = true,
  disabled = false,
  id,
}: LocationFieldProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState(value?.address ?? '')
  const [suggestions, setSuggestions] = useState<LocationResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Debounced autocomplete
  const doAutocomplete = useCallback(
    (q: string) => {
      if (!allowAutocomplete || q.trim().length < 2) {
        setSuggestions([])
        setShowDropdown(false)
        return
      }
      setSearching(true)
      geocodingAutocomplete(q.trim(), 5)
        .then((results) => {
          setSuggestions(results)
          setShowDropdown(results.length > 0)
        })
        .catch(() => {
          setSuggestions([])
          setShowDropdown(false)
        })
        .finally(() => setSearching(false))
    },
    [allowAutocomplete]
  )

  function handleInputChange(text: string) {
    setQuery(text)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doAutocomplete(text), 300)

    // If user manually types (not selecting), update as manual value
    if (value) {
      onChange({ ...value, address: text, source: 'manual' })
    }
  }

  function handleSelect(result: LocationResult) {
    const capped = capToPrecision(result, maxPrecision)
    setQuery(result.address)
    setSuggestions([])
    setShowDropdown(false)
    onChange(capped)
  }

  function handleClear() {
    setQuery('')
    setSuggestions([])
    setShowDropdown(false)
    onChange(null)
  }

  async function handleGps() {
    if (!navigator.geolocation) return
    setGpsLoading(true)
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 10000,
          enableHighAccuracy: true,
        })
      })
      const result = await geocodingReverse(pos.coords.latitude, pos.coords.longitude)
      if (result) {
        const val: LocationFieldValue = {
          address: result.address,
          displayName: result.displayName,
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          source: 'gps',
        }
        setQuery(result.address)
        onChange(val)
      }
    } catch {
      // Silently fail — browser denied or reverse failed
    } finally {
      setGpsLoading(false)
    }
  }

  function getOpenMapsUrl(): string | null {
    if (value?.lat != null && value?.lon != null) {
      return `https://www.openstreetmap.org/?mlat=${value.lat}&mlon=${value.lon}#map=16/${value.lat}/${value.lon}`
    }
    if (value?.address) {
      return `https://www.openstreetmap.org/search?query=${encodeURIComponent(value.address)}`
    }
    return null
  }

  const mapsUrl = getOpenMapsUrl()

  return (
    <div ref={containerRef} className="relative space-y-1.5">
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <MapPin className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            id={id}
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => {
              if (suggestions.length > 0) setShowDropdown(true)
            }}
            disabled={disabled}
            placeholder={t('locationField.placeholder')}
            className="pl-9 pr-8"
          />
          {searching && (
            <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {!searching && value && (
            <button
              type="button"
              onClick={handleClear}
              disabled={disabled}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              aria-label={t('locationField.clearLocation')}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {allowGps && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled || gpsLoading}
            onClick={handleGps}
            title={t('locationField.useCurrentLocation')}
          >
            {gpsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Navigation className="h-4 w-4" />
            )}
          </Button>
        )}
        {mapsUrl && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            asChild
            title={t('locationField.openInMaps')}
          >
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        )}
      </div>

      {/* Autocomplete dropdown */}
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 w-full rounded-md border border-border bg-popover shadow-md">
          {suggestions.map((s, i) => (
            <button
              key={`${s.lat}-${s.lon}-${i}`}
              type="button"
              className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground first:rounded-t-md last:rounded-b-md"
              onClick={() => handleSelect(s)}
            >
              <span className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{s.address}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Coordinates display */}
      {value?.lat != null && value?.lon != null && (
        <p className="text-xs text-muted-foreground">
          {value.lat.toFixed(5)}, {value.lon.toFixed(5)}
        </p>
      )}
    </div>
  )
}
