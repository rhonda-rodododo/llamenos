import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import type { Volunteer } from '@/lib/api'

interface VolunteerMultiSelectProps {
  volunteers: Volunteer[]
  selected: string[]
  onSelectionChange: (pubkeys: string[]) => void
  placeholder?: string
  className?: string
}

export function VolunteerMultiSelect({
  volunteers,
  selected,
  onSelectionChange,
  placeholder,
  className,
}: VolunteerMultiSelectProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const selectedVolunteers = volunteers.filter(v => selected.includes(v.pubkey))

  function toggle(pubkey: string) {
    onSelectionChange(
      selected.includes(pubkey)
        ? selected.filter(p => p !== pubkey)
        : [...selected, pubkey]
    )
  }

  function remove(pubkey: string, e: React.SyntheticEvent) {
    e.stopPropagation()
    onSelectionChange(selected.filter(p => p !== pubkey))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs transition-colors',
            'hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            className
          )}
        >
          {selectedVolunteers.length > 0 ? (
            selectedVolunteers.map(vol => (
              <Badge
                key={vol.pubkey}
                variant="secondary"
                className="max-w-[150px] gap-0.5 pr-0.5"
              >
                <span className="truncate" title={vol.name}>{vol.name}</span>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={t('shifts.removeVolunteer', { name: vol.name })}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                  onClick={(e) => remove(vol.pubkey, e)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      remove(vol.pubkey, e)
                    }
                  }}
                >
                  <X className="h-3 w-3" />
                </span>
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">
              {placeholder || t('shifts.searchVolunteers')}
            </span>
          )}
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command filter={(value, search) => {
          const vol = volunteers.find(v => v.pubkey === value)
          if (!vol) return 0
          const haystack = `${vol.name} ${vol.phone} ${vol.pubkey}`.toLowerCase()
          return haystack.includes(search.toLowerCase()) ? 1 : 0
        }}>
          <CommandInput placeholder={t('shifts.searchVolunteers')} />
          <CommandList className="max-h-[200px]">
            <CommandEmpty>{t('shifts.noVolunteersFound')}</CommandEmpty>
            <CommandGroup>
              {volunteers.map(vol => (
                <CommandItem
                  key={vol.pubkey}
                  value={vol.pubkey}
                  onSelect={() => toggle(vol.pubkey)}
                >
                  <Check
                    className={cn(
                      'h-4 w-4',
                      selected.includes(vol.pubkey) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="truncate">{vol.name}</span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {vol.pubkey.slice(0, 8)}…
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
