import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

let openShortcutsDialog: (() => void) | null = null

export function triggerShortcutsDialog() {
  openShortcutsDialog?.()
}

export function KeyboardShortcutsDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const isMac = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac')
  const mod = isMac ? '⌘' : 'Ctrl'

  useEffect(() => {
    openShortcutsDialog = () => setOpen(true)
    return () => { openShortcutsDialog = null }
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Don't trigger when typing in inputs/textareas or when modifier keys are held
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === '?') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const shortcuts = [
    { keys: `${mod}+K`, description: t('shortcuts.commandPalette') },
    { keys: '?', description: t('shortcuts.showHelp') },
    { keys: `${mod}+Enter`, description: t('shortcuts.saveNote') },
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          {shortcuts.map(s => (
            <div key={s.keys} className="flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted/50">
              <span className="text-muted-foreground">{s.description}</span>
              <kbd className="inline-flex items-center gap-0.5 rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
