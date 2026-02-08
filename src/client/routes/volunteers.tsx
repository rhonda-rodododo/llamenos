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

export const Route = createFileRoute('/volunteers')({
  component: VolunteersPage,
})

function VolunteersPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
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
      // handle error
    } finally {
      setLoading(false)
    }
  }

  if (!isAdmin) {
    return <div className="text-muted-foreground">Access denied</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('volunteers.title')}</h2>
        <button
          onClick={() => { setShowAddForm(true); setGeneratedNsec(null) }}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('volunteers.addVolunteer')}
        </button>
      </div>

      {/* Generated key warning */}
      {generatedNsec && (
        <div className="rounded-lg border border-yellow-600/50 bg-yellow-900/20 p-4">
          <p className="mb-2 text-sm font-medium text-yellow-300">{t('volunteers.inviteGenerated')}</p>
          <p className="mb-2 text-xs text-yellow-400">{t('volunteers.secretKeyWarning')}</p>
          <code className="block break-all rounded bg-background p-2 text-xs">{generatedNsec}</code>
          <button
            onClick={() => setGeneratedNsec(null)}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground"
          >
            {t('common.close')}
          </button>
        </div>
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
      <div className="rounded-lg border border-border">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">{t('common.loading')}</div>
        ) : volunteers.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">{t('common.noData')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 font-medium">{t('volunteers.name')}</th>
                <th className="px-4 py-3 font-medium">{t('volunteers.phone')}</th>
                <th className="px-4 py-3 font-medium">{t('volunteers.role')}</th>
                <th className="px-4 py-3 font-medium">{t('common.status')}</th>
                <th className="px-4 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
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
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function AddVolunteerForm({ onCreated, onCancel }: {
  onCreated: (vol: Volunteer, nsec: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<'volunteer' | 'admin'>('volunteer')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      // Generate keypair client-side — server never sees the private key
      const keyPair = generateKeyPair()
      const res = await createVolunteer({ name, phone, role, pubkey: keyPair.publicKey })
      onCreated(res.volunteer, keyPair.nsec)
    } catch {
      // handle error
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border p-4 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium">{t('volunteers.name')}</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">{t('volunteers.phone')}</label>
          <input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            type="tel"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">{t('volunteers.role')}</label>
        <select
          value={role}
          onChange={e => setRole(e.target.value as 'volunteer' | 'admin')}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="volunteer">{t('volunteers.roleVolunteer')}</option>
          <option value="admin">{t('volunteers.roleAdmin')}</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? t('common.loading') : t('common.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

function VolunteerRow({ volunteer, onUpdate, onDelete }: {
  volunteer: Volunteer
  onUpdate: (vol: Volunteer) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()

  async function toggleRole() {
    const newRole = volunteer.role === 'admin' ? 'volunteer' : 'admin'
    try {
      const res = await updateVolunteer(volunteer.pubkey, { role: newRole })
      onUpdate(res.volunteer)
    } catch {
      // handle error
    }
  }

  async function toggleActive() {
    try {
      const res = await updateVolunteer(volunteer.pubkey, { active: !volunteer.active })
      onUpdate(res.volunteer)
    } catch {
      // handle error
    }
  }

  async function handleDelete() {
    if (!confirm(t('volunteers.removeVolunteer') + '?')) return
    try {
      await deleteVolunteer(volunteer.pubkey)
      onDelete()
    } catch {
      // handle error
    }
  }

  return (
    <tr>
      <td className="px-4 py-3">{volunteer.name}</td>
      <td className="px-4 py-3 font-mono text-xs">{volunteer.phone}</td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2 py-0.5 text-xs ${
          volunteer.role === 'admin'
            ? 'bg-purple-900/50 text-purple-300'
            : 'bg-blue-900/50 text-blue-300'
        }`}>
          {volunteer.role === 'admin' ? t('volunteers.roleAdmin') : t('volunteers.roleVolunteer')}
        </span>
      </td>
      <td className="px-4 py-3">
        <button onClick={toggleActive} className="text-xs">
          <span className={`rounded-full px-2 py-0.5 ${
            volunteer.active
              ? 'bg-green-900/50 text-green-300'
              : 'bg-red-900/50 text-red-300'
          }`}>
            {volunteer.active ? t('volunteers.active') : t('volunteers.inactive')}
          </span>
        </button>
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <button onClick={toggleRole} className="text-xs text-muted-foreground hover:text-foreground">
            {volunteer.role === 'admin' ? t('volunteers.removeAdmin') : t('volunteers.makeAdmin')}
          </button>
          <button onClick={handleDelete} className="text-xs text-destructive-foreground hover:text-red-400">
            {t('common.delete')}
          </button>
        </div>
      </td>
    </tr>
  )
}
