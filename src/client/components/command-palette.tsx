import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'
import { setLanguage } from '@/lib/i18n'
import { LANGUAGES } from '@shared/languages'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
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
  Globe,
} from 'lucide-react'

let openCommandPalette: (() => void) | null = null

export function triggerCommandPalette() {
  openCommandPalette?.()
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  const { isAdmin, signOut, onBreak, toggleBreak } = useAuth()
  const { setTheme } = useTheme()
  const navigate = useNavigate()

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

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t('commandPalette.label')}
      description={t('commandPalette.placeholder')}
    >
      <CommandInput placeholder={t('commandPalette.placeholder')} />
      <CommandList>
        <CommandEmpty>{t('commandPalette.noResults')}</CommandEmpty>

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
          <CommandItem onSelect={() => runCommand(() => navigate({ to: '/settings' }))}>
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
          <CommandItem onSelect={() => runCommand(() => toggleBreak())}>
            <Coffee className="h-4 w-4" />
            {onBreak ? t('dashboard.endBreak') : t('dashboard.goOnBreak')}
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

        {/* Language */}
        <CommandGroup heading={t('commandPalette.language')}>
          {LANGUAGES.map(lang => (
            <CommandItem key={lang.code} onSelect={() => runCommand(() => setLanguage(lang.code))}>
              <Globe className="h-4 w-4" />
              {lang.flag} {lang.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
