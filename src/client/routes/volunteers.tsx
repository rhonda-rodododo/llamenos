import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState } from 'react'
import {
  listVolunteers,
  createVolunteer,
  updateVolunteer,
  deleteVolunteer,
  type Volunteer,
} from '@/lib/api'
import { generateKeyPair } from '@/lib/crypto'
import { useToast } from '@/lib/toast'
import { UserPlus, Shield, ShieldCheck, Trash2, Key, AlertTriangle, Copy, Coffee, Eye, EyeOff } from 'lucide-react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/volunteers')({
  component: VolunteersPage,
})

function VolunteersPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const { toast } = useToast()
  const [volunteers, setVolunteers] = useState<Volunteer[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [generatedNsec, setGeneratedNsec] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadVolunteers()
  }, [])

  async function loadVolunteers() {
    try {
      const res = await listVolunteers()
      setVolunteers(res.volunteers)
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setLoading(false)
    }
  }

  if (!isAdmin) {
    return <div className="text-muted-foreground">Access denied</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold sm:text-2xl">{t('volunteers.title')}</h1>
        <Button onClick={() => { setShowAddForm(true); setGeneratedNsec(null) }}>
          <UserPlus className="h-4 w-4" />
          {t('volunteers.addVolunteer')}
        </Button>
      </div>

      {/* Generated key warning */}
      {generatedNsec && (
        <Card className="border-yellow-400/50 bg-yellow-50 dark:border-yellow-600/50 dark:bg-yellow-950/10">
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2">
              <Key className="mt-0.5 h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              <div>
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">{t('volunteers.inviteGenerated')}</p>
                <p className="mt-0.5 text-xs text-yellow-600 dark:text-yellow-400/80">{t('volunteers.secretKeyWarning')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-md bg-background px-3 py-2 text-xs">{generatedNsec}</code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => { navigator.clipboard.writeText(generatedNsec); toast(t('common.success'), 'success') }}
                aria-label={t('a11y.copyToClipboard')}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setGeneratedNsec(null)}>
              {t('common.close')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Add volunteer form */}
      {showAddForm && (
        <AddVolunteerForm
          onCreated={(vol, nsec) => {
            setVolunteers(prev => [...prev, vol])
            setGeneratedNsec(nsec)
            setShowAddForm(false)
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Volunteers list */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-4">
                  <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                  <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
                  <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
                  <div className="ml-auto h-4 w-24 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : volunteers.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">{t('common.noData')}</div>
          ) : (
            <div className="divide-y divide-border">
              {volunteers.map(vol => (
                <VolunteerRow
                  key={vol.pubkey}
                  volunteer={vol}
                  onUpdate={(updated) => {
                    setVolunteers(prev => prev.map(v => v.pubkey === updated.pubkey ? updated : v))
                  }}
                  onDelete={() => {
                    setVolunteers(prev => prev.filter(v => v.pubkey !== vol.pubkey))
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AddVolunteerForm({ onCreated, onCancel }: {
  onCreated: (vol: Volunteer, nsec: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<'volunteer' | 'admin'>('volunteer')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\+\d{7,15}$/.test(phone)) {
      toast(t('volunteers.invalidPhone'), 'error')
      return
    }
    setSaving(true)
    try {
      const keyPair = generateKeyPair()
      const res = await createVolunteer({ name, phone, role, pubkey: keyPair.publicKey })
      onCreated(res.volunteer, keyPair.nsec)
      toast(t('volunteers.volunteerAdded'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="h-4 w-4 text-muted-foreground" />
          {t('volunteers.addVolunteer')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vol-name">{t('volunteers.name')}</Label>
              <Input
                id="vol-name"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vol-phone">{t('volunteers.phone')}</Label>
              <Input
                id="vol-phone"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                type="tel"
                placeholder="+12125551234"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vol-role">{t('volunteers.role')}</Label>
            <select
              id="vol-role"
              value={role}
              onChange={e => setRole(e.target.value as 'volunteer' | 'admin')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <option value="volunteer">{t('volunteers.roleVolunteer')}</option>
              <option value="admin">{t('volunteers.roleAdmin')}</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? t('common.loading') : t('common.save')}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function VolunteerRow({ volunteer, onUpdate, onDelete }: {
  volunteer: Volunteer
  onUpdate: (vol: Volunteer) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showPhone, setShowPhone] = useState(false)

  function maskedPhone(phone: string) {
    if (!phone || phone.length < 6) return phone
    return phone.slice(0, 3) + '•'.repeat(phone.length - 5) + phone.slice(-2)
  }

  async function toggleRole() {
    const newRole = volunteer.role === 'admin' ? 'volunteer' : 'admin'
    try {
      const res = await updateVolunteer(volunteer.pubkey, { role: newRole })
      onUpdate(res.volunteer)
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  async function toggleActive() {
    try {
      const res = await updateVolunteer(volunteer.pubkey, { active: !volunteer.active })
      onUpdate(res.volunteer)
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  async function handleDelete() {
    try {
      await deleteVolunteer(volunteer.pubkey)
      onDelete()
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
          {volunteer.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{volunteer.name} <span className="font-mono text-xs text-muted-foreground">({volunteer.pubkey.slice(0, 8)})</span></p>
          <p className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
            {showPhone ? volunteer.phone : maskedPhone(volunteer.phone)}
            <button onClick={() => setShowPhone(!showPhone)} className="text-muted-foreground hover:text-foreground">
              {showPhone ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <Badge variant={volunteer.role === 'admin' ? 'default' : 'secondary'}>
          {volunteer.role === 'admin' ? (
            <><ShieldCheck className="h-3 w-3" /> {t('volunteers.roleAdmin')}</>
          ) : (
            t('volunteers.roleVolunteer')
          )}
        </Badge>
        <button onClick={toggleActive} aria-pressed={volunteer.active}>
          <Badge variant="outline" className={
            volunteer.active
              ? 'border-green-500/50 text-green-700 dark:text-green-400'
              : 'border-red-500/50 text-red-700 dark:text-red-400'
          }>
            {volunteer.active ? t('volunteers.active') : t('volunteers.inactive')}
          </Badge>
        </button>
        {volunteer.onBreak && (
          <Badge variant="outline" className="border-yellow-500/50 text-yellow-700 dark:text-yellow-400">
            <Coffee className="h-3 w-3" />
            {t('dashboard.onBreak')}
          </Badge>
        )}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={toggleRole}>
            {volunteer.role === 'admin' ? (
              <><Shield className="h-3 w-3" /> {t('volunteers.removeAdmin')}</>
            ) : (
              <><ShieldCheck className="h-3 w-3" /> {t('volunteers.makeAdmin')}</>
            )}
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={() => setShowDeleteConfirm(true)} className="text-destructive hover:text-destructive" aria-label={t('a11y.deleteItem')}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={t('volunteers.removeVolunteer')}
        description={`${volunteer.name} (${volunteer.phone})`}
        confirmLabel={t('common.delete')}
        onConfirm={handleDelete}
      />
    </div>
  )
}
