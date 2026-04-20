import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useContacts } from '@/lib/queries/contacts'
import { cn } from '@/lib/utils'
import { CONTACT_TYPE_LABELS, type ContactType } from '@shared/types'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/** ContactRecord with decrypted displayName field populated by decrypt-on-fetch. */
type DecryptedContactRecord = {
  id: string
  contactType: string
  displayName?: string
  [key: string]: unknown
}

interface ContactSelectProps {
  value: string | string[] | undefined
  onChange: (value: string | string[]) => void
  multiple?: boolean
  disabled?: boolean
  'data-testid'?: string
}

export function ContactSelect({
  value,
  onChange,
  multiple,
  disabled,
  'data-testid': testId,
}: ContactSelectProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // useContacts returns already-decrypted contacts (displayName populated)
  const { data: rawContacts = [] } = useContacts()
  const contacts = rawContacts as unknown as DecryptedContactRecord[]

  function getDisplayName(contact: DecryptedContactRecord): string {
    return contact.displayName ?? contact.id.slice(0, 8)
  }

  const selectedIds: string[] = multiple
    ? Array.isArray(value)
      ? value
      : value
        ? [value]
        : []
    : typeof value === 'string' && value
      ? [value]
      : []

  const selectedContacts = contacts.filter((c) => selectedIds.includes(c.id))

  function toggle(id: string) {
    if (multiple) {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((s) => s !== id)
        : [...selectedIds, id]
      onChange(next)
    } else {
      onChange(id)
      setOpen(false)
    }
  }

  function remove(id: string, e: React.SyntheticEvent) {
    e.stopPropagation()
    if (multiple) {
      onChange(selectedIds.filter((s) => s !== id))
    } else {
      onChange('')
    }
  }

  const singleSelected = !multiple && selectedContacts[0]

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            data-testid={testId}
            className={cn(
              'w-full justify-between font-normal',
              !singleSelected && !multiple && 'text-muted-foreground'
            )}
          >
            <span className="truncate">
              {singleSelected
                ? getDisplayName(singleSelected)
                : t('contacts.selectContact', 'Select contact…')}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command
            filter={(id, search) => {
              const contact = contacts.find((c) => c.id === id)
              if (!contact) return 0
              const name = getDisplayName(contact)
              const typeLbl =
                CONTACT_TYPE_LABELS[contact.contactType as ContactType] ?? contact.contactType
              const haystack = `${name} ${typeLbl}`.toLowerCase()
              return haystack.includes(search.toLowerCase()) ? 1 : 0
            }}
          >
            <CommandInput placeholder={t('contacts.searchContacts', 'Search contacts…')} />
            <CommandList className="max-h-[200px]">
              <CommandEmpty>{t('contacts.noContactsFound', 'No contacts found.')}</CommandEmpty>
              <CommandGroup>
                {contacts.map((contact) => {
                  const name = getDisplayName(contact)
                  const typeLbl =
                    CONTACT_TYPE_LABELS[contact.contactType as ContactType] ?? contact.contactType
                  const isSelected = selectedIds.includes(contact.id)
                  return (
                    <CommandItem
                      key={contact.id}
                      value={contact.id}
                      onSelect={() => toggle(contact.id)}
                    >
                      <Check
                        className={cn('h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
                      />
                      <span className="truncate">{name}</span>
                      <Badge variant="outline" className="ml-auto text-xs shrink-0">
                        {typeLbl}
                      </Badge>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {multiple && selectedContacts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedContacts.map((contact) => {
            const name = getDisplayName(contact)
            const typeLbl =
              CONTACT_TYPE_LABELS[contact.contactType as ContactType] ?? contact.contactType
            return (
              <Badge key={contact.id} variant="secondary" className="gap-1 pr-0.5">
                <span className="truncate max-w-[140px]" title={name}>
                  {name}
                </span>
                <span className="text-muted-foreground text-xs">· {typeLbl}</span>
                {!disabled && (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={t('contacts.removeContact', { name })}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 cursor-pointer"
                    onClick={(e) => remove(contact.id, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        remove(contact.id, e)
                      }
                    }}
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </Badge>
            )
          })}
        </div>
      )}
    </div>
  )
}
