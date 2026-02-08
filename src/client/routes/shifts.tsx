import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState } from 'react'
import {
  listShifts,
  createShift,
  updateShift,
  deleteShift,
  listVolunteers,
  getFallbackGroup,
  setFallbackGroup,
  type Shift,
  type Volunteer,
} from '@/lib/api'

export const Route = createFileRoute('/shifts')({
  component: ShiftsPage,
})

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

function ShiftsPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const [shifts, setShifts] = useState<Shift[]>([])
  const [volunteers, setVolunteers] = useState<Volunteer[]>([])
  const [fallback, setFallback] = useState<string[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingShift, setEditingShift] = useState<Shift | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      listShifts().then(r => setShifts(r.shifts)),
      listVolunteers().then(r => setVolunteers(r.volunteers)),
      getFallbackGroup().then(r => setFallback(r.volunteers)),
    ]).finally(() => setLoading(false))
  }, [])

  if (!isAdmin) {
    return <div className="text-muted-foreground">Access denied</div>
  }

  async function handleSaveFallback(selected: string[]) {
    await setFallbackGroup(selected)
    setFallback(selected)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('shifts.title')}</h2>
        <button
          onClick={() => { setShowForm(true); setEditingShift(null) }}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('shifts.createShift')}
        </button>
      </div>

      {(showForm || editingShift) && (
        <ShiftForm
          shift={editingShift}
          volunteers={volunteers}
          onSave={async (data) => {
            if (editingShift) {
              const res = await updateShift(editingShift.id, data)
              setShifts(prev => prev.map(s => s.id === editingShift.id ? res.shift : s))
            } else {
              const res = await createShift(data as Omit<Shift, 'id'>)
              setShifts(prev => [...prev, res.shift])
            }
            setShowForm(false)
            setEditingShift(null)
          }}
          onCancel={() => { setShowForm(false); setEditingShift(null) }}
        />
      )}

      {/* Shifts list */}
      <div className="space-y-3">
        {loading ? (
          <div className="rounded-lg border border-border p-8 text-center text-muted-foreground">{t('common.loading')}</div>
        ) : shifts.length === 0 ? (
          <div className="rounded-lg border border-border p-8 text-center text-muted-foreground">{t('shifts.noShifts')}</div>
        ) : (
          shifts.map(shift => (
            <div key={shift.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium">{shift.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {shift.startTime} - {shift.endTime}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {shift.days.map(d => (
                      <span key={d} className="rounded bg-accent px-1.5 py-0.5 text-xs">
                        {t(`shifts.days.${DAY_KEYS[d]}`)}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {shift.volunteerPubkeys.length} {t('shifts.volunteers').toLowerCase()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingShift(shift)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    onClick={async () => {
                      await deleteShift(shift.id)
                      setShifts(prev => prev.filter(s => s.id !== shift.id))
                    }}
                    className="text-xs text-destructive-foreground hover:text-red-400"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Fallback group */}
      <div className="rounded-lg border border-border p-4">
        <h3 className="font-medium">{t('shifts.fallbackGroup')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('shifts.fallbackDescription')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {volunteers.filter(v => v.active).map(vol => (
            <label key={vol.pubkey} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={fallback.includes(vol.pubkey)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...fallback, vol.pubkey]
                    : fallback.filter(p => p !== vol.pubkey)
                  handleSaveFallback(next)
                }}
                className="rounded border-input"
              />
              {vol.name}
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

function ShiftForm({ shift, volunteers, onSave, onCancel }: {
  shift: Shift | null
  volunteers: Volunteer[]
  onSave: (data: Partial<Shift>) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(shift?.name || '')
  const [startTime, setStartTime] = useState(shift?.startTime || '09:00')
  const [endTime, setEndTime] = useState(shift?.endTime || '17:00')
  const [days, setDays] = useState<number[]>(shift?.days || [1, 2, 3, 4, 5])
  const [selectedVolunteers, setSelectedVolunteers] = useState<string[]>(shift?.volunteerPubkeys || [])
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave({ name, startTime, endTime, days, volunteerPubkeys: selectedVolunteers })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border p-4 space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium">{t('shifts.shiftName')}</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium">{t('shifts.startTime')}</label>
          <input
            type="time"
            value={startTime}
            onChange={e => setStartTime(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">{t('shifts.endTime')}</label>
          <input
            type="time"
            value={endTime}
            onChange={e => setEndTime(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">{t('shifts.recurring')}</label>
        <div className="flex flex-wrap gap-2">
          {DAY_KEYS.map((day, i) => (
            <label key={i} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={days.includes(i)}
                onChange={(e) => {
                  setDays(e.target.checked ? [...days, i] : days.filter(d => d !== i))
                }}
                className="rounded border-input"
              />
              {t(`shifts.days.${day}`)}
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">{t('shifts.assignVolunteers')}</label>
        <div className="flex flex-wrap gap-2">
          {volunteers.filter(v => v.active).map(vol => (
            <label key={vol.pubkey} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={selectedVolunteers.includes(vol.pubkey)}
                onChange={(e) => {
                  setSelectedVolunteers(
                    e.target.checked
                      ? [...selectedVolunteers, vol.pubkey]
                      : selectedVolunteers.filter(p => p !== vol.pubkey)
                  )
                }}
                className="rounded border-input"
              />
              {vol.name}
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? t('common.loading') : t('common.save')}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
