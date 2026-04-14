import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { listShifts, listUsers } from '@/lib/api'
import { useConfig } from '@/lib/config'
import { useNavigate } from '@tanstack/react-router'
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  FileText,
  Phone,
  Rocket,
  Users,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ChecklistItem {
  id: string
  label: string
  description: string
  done: boolean
  href: string
}

export function GettingStartedChecklist() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setupCompleted, hotlineNumber, channels } = useConfig()
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('getting-started-dismissed') === 'true'
    } catch {
      return false
    }
  })
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    async function check() {
      let hasUsers = false
      let hasShifts = false

      try {
        const [usersRes, shiftRes] = await Promise.all([listUsers(), listShifts()])
        hasUsers = usersRes.users.length > 1 // > 1 because admin counts as a user
        hasShifts = shiftRes.shifts.length > 0
      } catch {
        // API might fail if not authed yet
      }

      const checklist: ChecklistItem[] = [
        {
          id: 'setup',
          label: t('gettingStarted.setupWizard', { defaultValue: 'Complete setup wizard' }),
          description: t('gettingStarted.setupWizardDesc', {
            defaultValue: 'Configure your hotline name, channels, and providers.',
          }),
          done: setupCompleted,
          href: '/setup',
        },
        {
          id: 'users',
          label: t('gettingStarted.inviteUsers', { defaultValue: 'Invite users' }),
          description: t('gettingStarted.inviteUsersDesc', {
            defaultValue: 'Add team members who will answer calls and respond to reports.',
          }),
          done: hasUsers,
          href: '/users',
        },
        {
          id: 'shifts',
          label: t('gettingStarted.createShifts', { defaultValue: 'Create shift schedule' }),
          description: t('gettingStarted.createShiftsDesc', {
            defaultValue: 'Set up recurring shifts so calls are routed to available users.',
          }),
          done: hasShifts,
          href: '/shifts',
        },
        {
          id: 'provider',
          label: t('gettingStarted.configureProvider', { defaultValue: 'Configure telephony' }),
          description: t('gettingStarted.configureProviderDesc', {
            defaultValue: 'Set up your telephony provider to enable voice calls and SMS.',
          }),
          done: !!hotlineNumber,
          href: '/admin/settings',
        },
      ]

      // Only show reports task if reports channel is enabled
      if (channels?.reports) {
        checklist.push({
          id: 'reports',
          label: t('gettingStarted.enableReports', { defaultValue: 'Reports channel ready' }),
          description: t('gettingStarted.enableReportsDesc', {
            defaultValue: 'The reports channel is enabled. Reporters can submit encrypted reports.',
          }),
          done: true,
          href: '/reports',
        })
      }

      setItems(checklist)
      setLoading(false)
    }

    check()
  }, [setupCompleted, hotlineNumber, channels, t])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    try {
      localStorage.setItem('getting-started-dismissed', 'true')
    } catch {
      /* ignore */
    }
  }, [])

  if (dismissed || loading) return null

  const completedCount = items.filter((i) => i.done).length
  const allDone = completedCount === items.length

  // Don't show if everything is done
  if (allDone) return null

  return (
    <Card data-testid="getting-started-checklist" className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="h-4 w-4 text-primary" />
            {t('gettingStarted.title', { defaultValue: 'Getting Started' })}
            <span className="text-xs font-normal text-muted-foreground">
              {completedCount}/{items.length}
            </span>
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-xs" onClick={() => setCollapsed((prev) => !prev)}>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`}
              />
            </Button>
            <Button
              data-testid="getting-started-dismiss"
              variant="ghost"
              size="icon-xs"
              onClick={handleDismiss}
              aria-label={t('common.close')}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-2 h-1.5 rounded-full bg-primary/10">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={
              {
                '--progress-width': `${(completedCount / items.length) * 100}%`,
                width: 'var(--progress-width)',
              } as React.CSSProperties
            }
          />
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent className="pt-0">
          <div className="space-y-2">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate({ to: item.href })}
                className={`flex w-full cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                  item.done ? 'opacity-60' : 'hover:bg-primary/10'
                }`}
              >
                {item.done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div>
                  <p className={`text-sm font-medium ${item.done ? 'line-through' : ''}`}>
                    {item.label}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
