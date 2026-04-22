import type { Blast } from '@shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Megaphone, Plus, Send, Settings2, Trash2, Users, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BlastComposer } from '@/components/BlastComposer'
import { BlastSettingsPanel } from '@/components/BlastSettingsPanel'
import { SubscriberManager } from '@/components/SubscriberManager'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import { useBlasts, useCancelBlast, useDeleteBlast, useSendBlast } from '@/lib/queries/blasts'
import { queryKeys } from '@/lib/queries/keys'
import { useToast } from '@/lib/toast'

export const Route = createFileRoute('/blasts')({
  component: BlastsPage,
})

function BlastsPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Access control — require blasts:read permission
  if (!hasPermission('blasts:read')) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-muted-foreground" data-testid="access-denied">
          {t('common.accessDenied', { defaultValue: 'Access denied' })}
        </p>
      </div>
    )
  }

  // React Query
  const { data, isLoading } = useBlasts(hubId)
  const blasts = data?.blasts ?? []
  const decryptedContent = data?.decryptedContent ?? {}

  // UI-only state
  const [selectedBlast, setSelectedBlast] = useState<Blast | null>(null)
  const [showComposer, setShowComposer] = useState(false)
  const [showSubscribers, setShowSubscribers] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const sendMutation = useSendBlast()
  const deleteMutation = useDeleteBlast()
  const cancelMutation = useCancelBlast()

  async function handleDelete(id: string) {
    try {
      await deleteMutation.mutateAsync(id)
      if (selectedBlast?.id === id) setSelectedBlast(null)
      toast(t('common.success'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  async function handleSend(id: string) {
    try {
      const res = await sendMutation.mutateAsync(id)
      setSelectedBlast(res.blast)
      toast(t('blasts.sent'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  async function handleCancel(id: string) {
    try {
      const res = await cancelMutation.mutateAsync(id)
      setSelectedBlast(res.blast)
      toast(t('common.success'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    sending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
    sent: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    cancelled: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  }

  if (showSubscribers) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowSubscribers(false)}>
            {t('common.back')}
          </Button>
          <h1 className="text-xl font-bold">{t('blasts.subscribers')}</h1>
        </div>
        <SubscriberManager />
      </div>
    )
  }

  if (showSettings) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowSettings(false)}>
            {t('common.back')}
          </Button>
          <h1 className="text-xl font-bold">{t('blasts.settings')}</h1>
        </div>
        <BlastSettingsPanel />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Megaphone className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold sm:text-2xl">{t('blasts.title')}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowSubscribers(true)}>
            <Users className="h-4 w-4" />
            {t('blasts.subscribers')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
            <Settings2 className="h-4 w-4" />
            {t('common.settings')}
          </Button>
          {hasPermission('blasts:send') && (
            <Button
              onClick={() => {
                setShowComposer(true)
                setSelectedBlast(null)
              }}
            >
              <Plus className="h-4 w-4" />
              {t('blasts.newBlast')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Blast list */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('blasts.allBlasts')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 text-center text-muted-foreground">{t('common.loading')}</div>
              ) : blasts.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground" data-testid="no-blasts">
                  {t('blasts.noBlasts')}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {blasts.map((blast) => (
                    <button
                      key={blast.id}
                      onClick={() => {
                        setSelectedBlast(blast)
                        setShowComposer(false)
                      }}
                      className={`w-full px-4 py-3 text-left transition-colors hover:bg-accent ${
                        selectedBlast?.id === blast.id ? 'bg-accent' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium truncate">{blast.name}</p>
                        <Badge className={statusColors[blast.status] || ''} variant="outline">
                          {t(`blasts.status.${blast.status}`)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground truncate">
                        {(decryptedContent[blast.id]?.text ?? t('blasts.encryptedContent')).slice(
                          0,
                          60
                        )}
                        {(decryptedContent[blast.id]?.text ?? '').length > 60 ? '...' : ''}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {blast.stats?.totalRecipients ?? 0} {t('blasts.recipients')}
                        </span>
                        {blast.stats.sent > 0 && (
                          <span>
                            {blast.stats.sent} {t('blasts.sentCount')}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Detail / Composer */}
        <div className="lg:col-span-2">
          {showComposer ? (
            <BlastComposer
              onCreated={(blast) => {
                setShowComposer(false)
                setSelectedBlast(blast)
                void queryClient.invalidateQueries({ queryKey: queryKeys.blasts.all })
              }}
              onCancel={() => setShowComposer(false)}
            />
          ) : selectedBlast ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{selectedBlast.name}</CardTitle>
                  <Badge className={statusColors[selectedBlast.status] || ''} variant="outline">
                    {t(`blasts.status.${selectedBlast.status}`)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm whitespace-pre-wrap">
                    {decryptedContent[selectedBlast.id]?.text ?? t('blasts.encryptedContent')}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">{t('blasts.recipients')}</p>
                    <p className="font-medium">{selectedBlast.stats.totalRecipients}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('blasts.sentCount')}</p>
                    <p className="font-medium">{selectedBlast.stats.sent}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('blasts.delivered')}</p>
                    <p className="font-medium">{selectedBlast.stats.delivered}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('blasts.failed')}</p>
                    <p className="font-medium text-destructive">{selectedBlast.stats.failed}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  {selectedBlast.status === 'draft' && (
                    <>
                      <Button onClick={() => handleSend(selectedBlast.id)}>
                        <Send className="h-4 w-4" />
                        {t('blasts.sendNow')}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(selectedBlast.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                        {t('common.delete')}
                      </Button>
                    </>
                  )}
                  {selectedBlast.status === 'scheduled' && (
                    <Button variant="outline" onClick={() => handleCancel(selectedBlast.id)}>
                      <XCircle className="h-4 w-4" />
                      {t('blasts.cancelScheduled')}
                    </Button>
                  )}
                  {selectedBlast.status === 'sending' && (
                    <Button variant="outline" onClick={() => handleCancel(selectedBlast.id)}>
                      <XCircle className="h-4 w-4" />
                      {t('blasts.cancelSending')}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex h-48 items-center justify-center text-muted-foreground">
                {t('blasts.selectOrCreate')}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
