import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState } from 'react'
import { listBans, addBan, removeBan, bulkAddBans, type BanEntry } from '@/lib/api'

export const Route = createFileRoute('/bans')({
  component: BansPage,
})

function BansPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const [bans, setBans] = useState<BanEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showBulk, setShowBulk] = useState(false)

  useEffect(() => {
    listBans()
      .then(r => setBans(r.bans))
      .finally(() => setLoading(false))
  }, [])

  if (!isAdmin) {
    return <div className="text-muted-foreground">Access denied</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('banList.title')}</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowBulk(!showBulk)}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
          >
            {t('banList.bulkImport')}
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('banList.addNumber')}
          </button>
        </div>
      </div>

      {showAdd && (
        <AddBanForm
          onAdded={(ban) => {
            setBans(prev => [ban, ...prev])
            setShowAdd(false)
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {showBulk && (
        <BulkImportForm
          onImported={(count) => {
            listBans().then(r => setBans(r.bans))
            setShowBulk(false)
          }}
          onCancel={() => setShowBulk(false)}
        />
      )}

      <div className="rounded-lg border border-border">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">{t('common.loading')}</div>
        ) : bans.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">{t('banList.noEntries')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 font-medium">{t('banList.phoneNumber')}</th>
                <th className="px-4 py-3 font-medium">{t('banList.reason')}</th>
                <th className="px-4 py-3 font-medium">{t('banList.bannedAt')}</th>
                <th className="px-4 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bans.map(ban => (
                <tr key={ban.phone}>
                  <td className="px-4 py-3 font-mono text-xs">{ban.phone}</td>
                  <td className="px-4 py-3">{ban.reason}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(ban.bannedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={async () => {
                        if (!confirm(t('banList.confirmUnban'))) return
                        await removeBan(ban.phone)
                        setBans(prev => prev.filter(b => b.phone !== ban.phone))
                      }}
                      className="text-xs text-destructive-foreground hover:text-red-400"
                    >
                      {t('banList.removeNumber')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function AddBanForm({ onAdded, onCancel }: {
  onAdded: (ban: BanEntry) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await addBan({ phone, reason })
      onAdded(res.ban)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border p-4 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium">{t('banList.phoneNumber')}</label>
          <input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            type="tel"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">{t('banList.reason')}</label>
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving ? t('common.loading') : t('common.save')}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

function BulkImportForm({ onImported, onCancel }: {
  onImported: (count: number) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const phones = text.split('\n').map(l => l.trim()).filter(Boolean)
      const res = await bulkAddBans({ phones, reason })
      onImported(res.count)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border p-4 space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium">{t('banList.bulkImportDescription')}</label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={6}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
          required
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">{t('banList.reason')}</label>
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          required
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving ? t('common.loading') : t('common.submit')}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
