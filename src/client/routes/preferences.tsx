import { createFileRoute } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { usePreferences, useUpdatePreferences } from '@/lib/queries/preferences'

export const Route = createFileRoute('/preferences')({
  component: PreferencesPage,
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) || '',
  }),
})

function PreferencesPage() {
  const { t } = useTranslation()
  const search = Route.useSearch()

  const { data: subscriber, isLoading, isError } = usePreferences(search.token)
  const updateMutation = useUpdatePreferences(search.token)

  async function handleUpdate(updates: Record<string, unknown>) {
    try {
      await updateMutation.mutateAsync(updates)
    } catch {
      // silently fail — subscriber preferences are best-effort
    }
  }

  if (isLoading)
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        {t('common.loading')}
      </div>
    )
  if (isError || !search.token)
    return (
      <div className="flex h-screen items-center justify-center text-destructive">
        {t('preferences.invalidToken')}
      </div>
    )
  if (!subscriber) return null

  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            {t('preferences.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            {subscriber.channels.map((ch) => (
              <div
                key={ch.type}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <Label>{ch.type.toUpperCase()}</Label>
                <Switch
                  checked={ch.verified}
                  onCheckedChange={(checked) =>
                    handleUpdate({ channel: ch.type, enabled: checked })
                  }
                />
              </div>
            ))}
          </div>

          <div className="pt-4 border-t">
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => handleUpdate({ status: 'unsubscribed' })}
            >
              {t('preferences.unsubscribe')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
