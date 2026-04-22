import { useQueryClient } from '@tanstack/react-query'
import { Trash2, Upload, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Subscriber } from '@/lib/api'
import { importSubscribers, removeSubscriber } from '@/lib/api'
import { useSubscriberStats, useSubscribers } from '@/lib/queries/blasts'
import { queryKeys } from '@/lib/queries/keys'
import { useToast } from '@/lib/toast'

export function SubscriberManager() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: subscribers = [], isLoading } = useSubscribers()
  const { data: stats } = useSubscriberStats()

  const [csvData, setCsvData] = useState('')
  const [importing, setImporting] = useState(false)

  async function handleRemove(id: string) {
    try {
      await removeSubscriber(id)
      // Optimistically remove from cache
      queryClient.setQueryData<Subscriber[]>(
        queryKeys.blasts.subscribers(),
        (prev) => prev?.filter((s) => s.id !== id) ?? []
      )
      // Invalidate stats so they recompute
      void queryClient.invalidateQueries({ queryKey: queryKeys.blasts.subscriberStats() })
      toast(t('common.success'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  async function handleImport() {
    if (!csvData.trim()) return
    setImporting(true)
    try {
      const lines = csvData
        .trim()
        .split('\n')
        .filter((l) => l.trim())
      const subs = lines.map((line) => {
        const [identifier, channel = 'sms', ...tags] = line.split(',').map((s) => s.trim())
        return { identifier, channel, tags: tags.length > 0 ? tags : undefined }
      })
      const res = await importSubscribers({ subscribers: subs })
      toast(t('blasts.importResult', { imported: res.imported, skipped: res.skipped }), 'success')
      setCsvData('')
      // Refresh subscribers and stats
      void queryClient.invalidateQueries({ queryKey: queryKeys.blasts.subscribers() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.blasts.subscriberStats() })
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">{t('blasts.totalSubscribers')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{stats.active}</p>
              <p className="text-xs text-muted-foreground">{t('blasts.activeSubscribers')}</p>
            </CardContent>
          </Card>
          {Object.entries(stats.byChannel).map(([ch, count]) => (
            <Card key={ch}>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-xs text-muted-foreground">{ch.toUpperCase()}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Import */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" />
            {t('blasts.importSubscribers')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{t('blasts.importHelp')}</p>
          <textarea
            value={csvData}
            onChange={(e) => setCsvData(e.target.value)}
            placeholder={t('blasts.importPlaceholder')}
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="import-csv"
          />
          <Button size="sm" onClick={handleImport} disabled={importing || !csvData.trim()}>
            <Upload className="h-4 w-4" />
            {importing ? t('common.loading') : t('blasts.import')}
          </Button>
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            {t('blasts.subscriberList')}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground">{t('common.loading')}</div>
          ) : subscribers.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">{t('blasts.noSubscribers')}</div>
          ) : (
            <div className="divide-y divide-border">
              {subscribers.map((sub) => (
                <div key={sub.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-mono text-xs">{sub.identifierHash.slice(0, 16)}...</p>
                    <div className="flex items-center gap-1 mt-1">
                      {sub.channels.map((ch) => (
                        <Badge key={ch.type} variant="outline" className="text-[10px]">
                          {ch.type.toUpperCase()}
                        </Badge>
                      ))}
                      {sub.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[10px]">
                          {tag}
                        </Badge>
                      ))}
                      <Badge
                        variant={sub.status === 'active' ? 'default' : 'outline'}
                        className="text-[10px]"
                      >
                        {sub.status}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleRemove(sub.id)}
                    className="text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
