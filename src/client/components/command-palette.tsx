import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'
import { useCalls } from '@/lib/hooks'
import { createNote } from '@/lib/api'
import { encryptNote } from '@/lib/crypto'
import { useToast } from '@/lib/toast'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { triggerShortcutsDialog } from '@/components/keyboard-shortcuts-dialog'
import {
  LayoutDashboard,
  StickyNote,
  Clock,
  Users,
  ShieldBan,
  PhoneIncoming,
  ScrollText,
  Settings,
  LogOut,
  Coffee,
  Sun,
  Moon,
  Monitor,
  Plus,
  Search,
  Lock,
  Save,
  Keyboard,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

let openCommandPalette: (() => void) | null = null

export function triggerCommandPalette() {
  openCommandPalette?.()
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [quickNoteOpen, setQuickNoteOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const { t } = useTranslation()
  const { isAdmin, signOut, onBreak, toggleBreak, keyPair } = useAuth()
  const { setTheme } = useTheme()
  const { currentCall } = useCalls()
  const { toast } = useToast()
  const navigate = useNavigate()

  // Quick note state
  const [noteCallId, setNoteCallId] = useState('')
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)

  useEffect(() => {
    openCommandPalette = () => setOpen(true)
    return () => { openCommandPalette = null }
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function runCommand(fn: () => void) {
    setOpen(false)
    fn()
  }

  function openQuickNote() {
    setOpen(false)
    setNoteCallId(currentCall?.id || '')
    setNoteText('')
    setQuickNoteOpen(true)
  }

  async function handleSaveQuickNote() {
    if (!keyPair || !noteText.trim() || !noteCallId.trim()) return
    setNoteSaving(true)
    try {
      const encrypted = encryptNote(noteText, keyPair.secretKey)
      await createNote({ callId: noteCallId, encryptedContent: encrypted })
      toast(t('common.success'), 'success')
      setQuickNoteOpen(false)
      setNoteText('')
      setNoteCallId('')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setNoteSaving(false)
    }
  }

  return (
    <>
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
              <CommandItem onSelect={() => runCommand(() => navigate({ to: '/notes', search: { page: 1, callId: '', search: searchQuery.trim() } }))}>
                <Search className="h-4 w-4" />
                {t('commandPalette.searchNotes', { query: searchQuery.trim() })}
              </CommandItem>
              {isAdmin && (
                <CommandItem onSelect={() => runCommand(() => navigate({ to: '/calls', search: { page: 1, q: searchQuery.trim(), dateFrom: '', dateTo: '' } }))}>
                  <Search className="h-4 w-4" />
                  {t('commandPalette.searchCalls', { query: searchQuery.trim() })}
                </CommandItem>
              )}
            </CommandGroup>
          )}

          {/* Navigation */}
          <CommandGroup heading={t('commandPalette.navigation')}>
            <CommandItem onSelect={() => runCommand(() => navigate({ to: '/' }))}>
              <LayoutDashboard className="h-4 w-4" />
              {t('nav.dashboard')}
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => navigate({ to: '/notes', search: { page: 1, callId: '', search: '' } }))}>
              <StickyNote className="h-4 w-4" />
              {t('nav.notes')}
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => navigate({ to: '/settings', search: { section: '' } }))}>
              <Settings className="h-4 w-4" />
              {t('nav.settings')}
            </CommandItem>
            {isAdmin && (
              <>
                <CommandItem onSelect={() => runCommand(() => navigate({ to: '/shifts' }))}>
                  <Clock className="h-4 w-4" />
                  {t('nav.shifts')}
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => navigate({ to: '/volunteers' }))}>
                  <Users className="h-4 w-4" />
                  {t('nav.volunteers')}
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => navigate({ to: '/bans' }))}>
                  <ShieldBan className="h-4 w-4" />
                  {t('nav.banList')}
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => navigate({ to: '/calls', search: { page: 1, q: '', dateFrom: '', dateTo: '' } }))}>
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
            <CommandItem onSelect={openQuickNote}>
              <Plus className="h-4 w-4" />
              {t('notes.newNote')}
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => toggleBreak())}>
              <Coffee className="h-4 w-4" />
              {onBreak ? t('dashboard.endBreak') : t('dashboard.goOnBreak')}
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => triggerShortcutsDialog())}>
              <Keyboard className="h-4 w-4" />
              {t('shortcuts.title')}
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => { signOut(); navigate({ to: '/login' }) })}>
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

      {/* Quick Note Dialog */}
      {quickNoteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setQuickNoteOpen(false)} />
          <div className="relative z-50 w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <StickyNote className="h-5 w-5 text-muted-foreground" />
              {t('notes.newNote')}
            </h3>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('notes.callId')}</label>
                <Input
                  value={noteCallId}
                  onChange={e => setNoteCallId(e.target.value)}
                  placeholder={t('notes.callIdPlaceholder')}
                />
                {currentCall && noteCallId === currentCall.id && (
                  <p className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                    <PhoneIncoming className="h-3 w-3" />
                    {t('notes.activeCallNote')}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-sm font-medium">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  {t('notes.newNote')}
                </label>
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder={t('notes.notePlaceholder')}
                  rows={4}
                  autoFocus
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setQuickNoteOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={handleSaveQuickNote}
                  disabled={noteSaving || !noteText.trim() || !noteCallId.trim()}
                >
                  <Save className="h-4 w-4" />
                  {noteSaving ? t('common.loading') : t('common.save')}
                </Button>
              </div>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                {t('notes.encryptionNote')}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
