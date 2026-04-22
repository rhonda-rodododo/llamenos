import { useNavigate } from '@tanstack/react-router'
import {
  Clock,
  Coffee,
  Contact,
  HelpCircle,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  PhoneIncoming,
  Plus,
  ScrollText,
  Search,
  Settings,
  ShieldBan,
  StickyNote,
  Sun,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { triggerShortcutsDialog } from '@/components/keyboard-shortcuts-dialog'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { useAuth } from '@/lib/auth'
import { useNoteSheet } from '@/lib/note-sheet-context'
import { useContacts } from '@/lib/queries/contacts'
import { useTheme } from '@/lib/theme'

let openCommandPalette: (() => void) | null = null

export function triggerCommandPalette() {
  openCommandPalette?.()
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const { t } = useTranslation()
  const { isAdmin, signOut, onBreak, toggleBreak } = useAuth()
  const { setTheme } = useTheme()
  const noteSheet = useNoteSheet()
  const navigate = useNavigate()
  const { data: contacts } = useContacts()

  const isMac = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac')
  const mod = isMac ? '⌘' : 'Ctrl'

  // Filter contacts by search query (uses cached decrypted data)
  const matchedContacts = useMemo(() => {
    if (!contacts || searchQuery.trim().length < 2) return []
    const lower = searchQuery.toLowerCase()
    return contacts
      .filter((c) => {
        const name = (c as unknown as { displayName?: string }).displayName
        return name?.toLowerCase().includes(lower)
      })
      .slice(0, 5)
  }, [contacts, searchQuery])

  useEffect(() => {
    openCommandPalette = () => setOpen(true)
    return () => {
      openCommandPalette = null
    }
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function runCommand(fn: () => void) {
    setOpen(false)
    fn()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t('commandPalette.label')}
      description={t('commandPalette.placeholder')}
    >
      <CommandInput
        placeholder={t('commandPalette.placeholder')}
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList>
        <CommandEmpty>{t('commandPalette.noResults')}</CommandEmpty>

        {/* Search shortcuts — shown when user types a query */}
        {searchQuery.trim().length > 1 && (
          <CommandGroup heading={t('common.search')}>
            <CommandItem
              onSelect={() =>
                runCommand(() =>
                  navigate({
                    to: '/notes',
                    search: { page: 1, callId: '', search: searchQuery.trim() },
                  })
                )
              }
            >
              <Search className="h-4 w-4" />
              {t('commandPalette.searchNotes', { query: searchQuery.trim() })}
            </CommandItem>
            {isAdmin && (
              <CommandItem
                onSelect={() =>
                  runCommand(() =>
                    navigate({
                      to: '/calls',
                      search: {
                        page: 1,
                        q: searchQuery.trim(),
                        dateFrom: '',
                        dateTo: '',
                        voicemailOnly: false,
                      },
                    })
                  )
                }
              >
                <Search className="h-4 w-4" />
                {t('commandPalette.searchCalls', { query: searchQuery.trim() })}
              </CommandItem>
            )}
          </CommandGroup>
        )}

        {/* Contacts — shown when search matches cached contacts */}
        {matchedContacts.length > 0 && (
          <CommandGroup heading={t('nav.contacts', { defaultValue: 'Contacts' })}>
            {matchedContacts.map((contact) => {
              const name = (contact as unknown as { displayName?: string }).displayName
              return (
                <CommandItem
                  key={contact.id}
                  onSelect={() =>
                    runCommand(() =>
                      navigate({ to: '/contacts/$contactId', params: { contactId: contact.id } })
                    )
                  }
                >
                  <Contact className="h-4 w-4" />
                  <span className="flex-1 truncate">{name ?? contact.id}</span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {contact.contactType}
                  </span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}

        {/* Navigation */}
        <CommandGroup heading={t('commandPalette.navigation')}>
          <CommandItem onSelect={() => runCommand(() => navigate({ to: '/' }))}>
            <LayoutDashboard className="h-4 w-4" />
            {t('nav.dashboard')}
          </CommandItem>
          <CommandItem
            onSelect={() =>
              runCommand(() =>
                navigate({ to: '/notes', search: { page: 1, callId: '', search: '' } })
              )
            }
          >
            <StickyNote className="h-4 w-4" />
            {t('nav.notes')}
            <CommandShortcut>{mod}+Shift+F</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              runCommand(() => navigate({ to: '/settings', search: { section: '' } }))
            }
          >
            <Settings className="h-4 w-4" />
            {t('nav.settings')}
          </CommandItem>
          {isAdmin && (
            <>
              <CommandItem onSelect={() => runCommand(() => navigate({ to: '/admin' }))}>
                <Settings className="h-4 w-4" />
                {t('nav.hubSettings', { defaultValue: 'Hub Settings' })}
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => navigate({ to: '/shifts' }))}>
                <Clock className="h-4 w-4" />
                {t('nav.shifts')}
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => navigate({ to: '/users' }))}>
                <Users className="h-4 w-4" />
                {t('nav.users')}
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => navigate({ to: '/bans' }))}>
                <ShieldBan className="h-4 w-4" />
                {t('nav.banList')}
              </CommandItem>
              <CommandItem
                onSelect={() =>
                  runCommand(() =>
                    navigate({
                      to: '/calls',
                      search: { page: 1, q: '', dateFrom: '', dateTo: '', voicemailOnly: false },
                    })
                  )
                }
              >
                <PhoneIncoming className="h-4 w-4" />
                {t('nav.callHistory')}
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => navigate({ to: '/audit' }))}>
                <ScrollText className="h-4 w-4" />
                {t('nav.auditLog')}
              </CommandItem>
            </>
          )}
        </CommandGroup>

        {/* Actions */}
        <CommandGroup heading={t('commandPalette.actions')}>
          <CommandItem onSelect={() => runCommand(() => noteSheet.openNewNote())}>
            <Plus className="h-4 w-4" />
            {t('notes.newNote')}
            <CommandShortcut>Alt+N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => toggleBreak())}>
            <Coffee className="h-4 w-4" />
            {onBreak ? t('dashboard.endBreak') : t('dashboard.goOnBreak')}
            <CommandShortcut>{mod}+Shift+B</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate({ to: '/help' }))}>
            <HelpCircle className="h-4 w-4" />
            {t('nav.help', { defaultValue: 'Help' })}
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => triggerShortcutsDialog())}>
            <Keyboard className="h-4 w-4" />
            {t('shortcuts.title')}
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              runCommand(() => {
                signOut()
                navigate({ to: '/login' })
              })
            }
          >
            <LogOut className="h-4 w-4" />
            {t('common.logout')}
          </CommandItem>
        </CommandGroup>

        {/* Theme */}
        <CommandGroup heading={t('commandPalette.theme')}>
          <CommandItem onSelect={() => runCommand(() => setTheme('system'))}>
            <Monitor className="h-4 w-4" />
            {t('a11y.themeSystem')}
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => setTheme('light'))}>
            <Sun className="h-4 w-4" />
            {t('a11y.themeLight')}
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => setTheme('dark'))}>
            <Moon className="h-4 w-4" />
            {t('a11y.themeDark')}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
