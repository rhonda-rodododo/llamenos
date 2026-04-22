/**
 * TagInput — multi-select tag picker using Command + Popover (shadcn pattern).
 *
 * Shows selected tags as colored chip badges (removable). Opens a searchable
 * dropdown of available tags with color dots. Optionally allows inline tag
 * creation when the user types a name that doesn't exist yet.
 */

import { Check, ChevronsUpDown, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useConfig } from '@/lib/config'
import { useTags } from '@/lib/queries/tags'
import { cn } from '@/lib/utils'

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  allowCreate?: boolean
  placeholder?: string
}

/** Resolve a tag definition from the tags list by its slug name. */
function useDecryptedTags() {
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'
  // Tags queryFn already decrypts label/category via decryptHubField
  const { data: tags = [] } = useTags(hubId)
  return tags
}

export function TagInput({ value, onChange, allowCreate = false, placeholder }: TagInputProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const decryptedTags = useDecryptedTags()

  const selectedSet = useMemo(() => new Set(value), [value])

  const availableTags = useMemo(
    () => decryptedTags.filter((tag) => !selectedSet.has(tag.name)),
    [decryptedTags, selectedSet]
  )

  const filteredTags = useMemo(() => {
    if (!search) return availableTags
    const lower = search.toLowerCase()
    return availableTags.filter(
      (tag) =>
        tag.label.toLowerCase().includes(lower) ||
        tag.name.toLowerCase().includes(lower) ||
        tag.category.toLowerCase().includes(lower)
    )
  }, [availableTags, search])

  // Check if search text matches an existing tag exactly
  const searchMatchesExisting = useMemo(
    () =>
      decryptedTags.some(
        (tag) =>
          tag.name.toLowerCase() === search.toLowerCase() ||
          tag.label.toLowerCase() === search.toLowerCase()
      ),
    [decryptedTags, search]
  )

  const showCreateOption = allowCreate && search.trim().length > 0 && !searchMatchesExisting

  function selectTag(name: string) {
    if (!selectedSet.has(name)) {
      onChange([...value, name])
    }
    setSearch('')
  }

  function removeTag(name: string) {
    onChange(value.filter((v) => v !== name))
  }

  function handleCreateNew() {
    const slug = search
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    if (slug && !selectedSet.has(slug)) {
      onChange([...value, slug])
    }
    setSearch('')
  }

  // Look up tag definition for selected slugs
  function getTagDef(slug: string) {
    return decryptedTags.find((t) => t.name === slug)
  }

  return (
    <div className="space-y-2" data-testid="tag-input">
      {/* Selected tags as badges */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid="tag-input-selected">
          {value.map((slug) => {
            const def = getTagDef(slug)
            const label = def?.label ?? slug
            const color = def?.color ?? ''

            return (
              <TagBadge key={slug} label={label} color={color}>
                <button
                  type="button"
                  className="ml-1 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  onClick={() => removeTag(slug)}
                  data-testid={`tag-remove-${slug}`}
                >
                  <X className="h-3 w-3" />
                  <span className="sr-only">{t('common.remove', { defaultValue: 'Remove' })}</span>
                </button>
              </TagBadge>
            )
          })}
        </div>
      )}

      {/* Popover trigger + Command list */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
              !value.length && 'text-muted-foreground'
            )}
            data-testid="tag-input-trigger"
          >
            {placeholder || t('tags.selectTags', { defaultValue: 'Select tags...' })}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={t('tags.searchTags', { defaultValue: 'Search tags...' })}
              value={search}
              onValueChange={setSearch}
              data-testid="tag-input-search"
            />
            <CommandList>
              <CommandEmpty>
                {t('tags.noTagsFound', { defaultValue: 'No tags found.' })}
              </CommandEmpty>
              <CommandGroup>
                {filteredTags.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    onSelect={() => selectTag(tag.name)}
                    data-testid={`tag-option-${tag.name}`}
                  >
                    <span
                      className="mr-2 h-3 w-3 rounded-full shrink-0"
                      style={
                        {
                          '--tag-color': tag.color || '#888',
                          backgroundColor: 'var(--tag-color)',
                        } as React.CSSProperties
                      }
                    />
                    <span className="flex-1 truncate">{tag.label}</span>
                    {tag.category && (
                      <span className="ml-2 text-xs text-muted-foreground">{tag.category}</span>
                    )}
                    {selectedSet.has(tag.name) && <Check className="ml-2 h-4 w-4 shrink-0" />}
                  </CommandItem>
                ))}
              </CommandGroup>

              {showCreateOption && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem onSelect={handleCreateNew} data-testid="tag-create-option">
                      <Plus className="mr-2 h-4 w-4" />
                      {t('tags.createTag', { defaultValue: 'Create' })}{' '}
                      <span className="ml-1 font-medium">"{search.trim()}"</span>
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TagBadge — reusable colored tag badge
// ---------------------------------------------------------------------------

interface TagBadgeProps {
  label: string
  color: string
  children?: React.ReactNode
  className?: string
}

export function TagBadge({ label, color, children, className }: TagBadgeProps) {
  if (color) {
    return (
      <Badge
        variant="outline"
        className={cn('text-xs', className)}
        style={
          {
            '--tag-bg': `${color}20`,
            '--tag-fg': color,
            '--tag-border': `${color}40`,
            backgroundColor: 'var(--tag-bg)',
            color: 'var(--tag-fg)',
            borderColor: 'var(--tag-border)',
          } as React.CSSProperties
        }
      >
        {label}
        {children}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className={cn('text-xs', className)}>
      {label}
      {children}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// useTagLookup — hook for looking up tag definitions (for external use)
// ---------------------------------------------------------------------------

export function useTagLookup() {
  return useDecryptedTags()
}
