import { SectionBody, SectionDescription } from '@/components/admin-shell/section-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useConfig } from '@/lib/config'
import { encryptHubField } from '@/lib/hub-field-crypto'
import {
  useCreateFirehoseConnection,
  useDeleteFirehoseConnection,
  useFirehoseConnections,
  useFirehoseStatus,
  useUpdateFirehoseConnection,
} from '@/lib/queries/firehose'
import { useReportTypes } from '@/lib/queries/reports'
import { useToast } from '@/lib/toast'
import type {
  CreateFirehoseConnectionInput,
  FirehoseConnection,
  FirehoseConnectionStatus,
  UpdateFirehoseConnectionInput,
} from '@shared/schemas/firehose'
import { Loader2, Pause, Play, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CLASSES: Record<FirehoseConnectionStatus, string> = {
  pending: 'border-yellow-400 text-yellow-700 dark:text-yellow-400',
  active: 'border-green-500 text-green-700 dark:text-green-400',
  paused: 'border-orange-400 text-orange-700 dark:text-orange-400',
  disabled: 'border-border text-muted-foreground',
}

function StatusBadge({ status }: { status: FirehoseConnectionStatus }) {
  return (
    <Badge variant="outline" className={STATUS_CLASSES[status]}>
      {status}
    </Badge>
  )
}

// ── Create dialog state ───────────────────────────────────────────────────────

interface CreateForm {
  displayName: string
  reportTypeId: string
  geoContext: string
  geoContextCountryCodes: string
  extractionIntervalSec: number
}

const DEFAULT_CREATE: CreateForm = {
  displayName: '',
  reportTypeId: '',
  geoContext: '',
  geoContextCountryCodes: '',
  extractionIntervalSec: 60,
}

// ── Edit dialog state ─────────────────────────────────────────────────────────

interface EditForm {
  id: string
  geoContext: string
  geoContextCountryCodes: string
  extractionIntervalSec: number
  systemPromptSuffix: string
  bufferTtlDays: number
  inferenceEndpoint: string
  notifyViaSignal: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FirehoseSection() {
  const { toast } = useToast()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'

  const { data: connections = [], isLoading: connectionsLoading } = useFirehoseConnections(hubId)
  const { data: healthList = [] } = useFirehoseStatus()
  const { data: reportTypes = [] } = useReportTypes(hubId)

  const createMutation = useCreateFirehoseConnection()
  const updateMutation = useUpdateFirehoseConnection()
  const deleteMutation = useDeleteFirehoseConnection()

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>(DEFAULT_CREATE)
  const [editTarget, setEditTarget] = useState<EditForm | null>(null)
  const [showSaved, setShowSaved] = useState(false)

  function flashSaved() {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  function healthFor(id: string) {
    return healthList.find((h) => h.id === id)
  }

  function reportTypeName(id: string) {
    return reportTypes.find((rt) => rt.id === id)?.name ?? id
  }

  function parseCountryCodes(raw: string): string[] {
    return raw
      .split(/[\s,]+/)
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c.length === 2)
  }

  async function handleCreate() {
    if (!createForm.displayName.trim() || !createForm.reportTypeId) return

    // Pre-generate a client UUID for the new connection so the AAD can be bound to a stable ID.
    const newId = crypto.randomUUID()
    const encryptedDisplayName =
      (await encryptHubField(
        createForm.displayName.trim(),
        hubId,
        newId,
        'encrypted_display_name'
      )) ?? undefined
    const input: CreateFirehoseConnectionInput = {
      displayName: createForm.displayName.trim(),
      encryptedDisplayName,
      reportTypeId: createForm.reportTypeId,
      extractionIntervalSec: createForm.extractionIntervalSec,
    }
    if (createForm.geoContext.trim()) input.geoContext = createForm.geoContext.trim()
    const codes = parseCountryCodes(createForm.geoContextCountryCodes)
    if (codes.length > 0) input.geoContextCountryCodes = codes

    try {
      await createMutation.mutateAsync(input)
      toast('Firehose connection created', 'success')
      setShowCreate(false)
      setCreateForm(DEFAULT_CREATE)
      flashSaved()
    } catch {
      toast('Failed to create connection', 'error')
    }
  }

  function openEdit(conn: FirehoseConnection) {
    setEditTarget({
      id: conn.id,
      geoContext: conn.geoContext ?? '',
      geoContextCountryCodes: (conn.geoContextCountryCodes ?? []).join(', '),
      extractionIntervalSec: conn.extractionIntervalSec,
      systemPromptSuffix: conn.systemPromptSuffix ?? '',
      bufferTtlDays: conn.bufferTtlDays,
      inferenceEndpoint: conn.inferenceEndpoint ?? '',
      notifyViaSignal: conn.notifyViaSignal,
    })
  }

  async function handleEdit() {
    if (!editTarget) return

    const input: UpdateFirehoseConnectionInput = {
      extractionIntervalSec: editTarget.extractionIntervalSec,
      bufferTtlDays: editTarget.bufferTtlDays,
      notifyViaSignal: editTarget.notifyViaSignal,
      geoContext: editTarget.geoContext.trim() || null,
      systemPromptSuffix: editTarget.systemPromptSuffix.trim() || null,
      inferenceEndpoint: editTarget.inferenceEndpoint.trim() || null,
    }
    const codes = parseCountryCodes(editTarget.geoContextCountryCodes)
    input.geoContextCountryCodes = codes.length > 0 ? codes : null

    try {
      await updateMutation.mutateAsync({ id: editTarget.id, data: input })
      toast('Connection updated', 'success')
      setEditTarget(null)
      flashSaved()
    } catch {
      toast('Failed to update connection', 'error')
    }
  }

  async function handleTogglePause(conn: FirehoseConnection) {
    const newStatus = conn.status === 'paused' ? 'active' : 'paused'
    try {
      await updateMutation.mutateAsync({ id: conn.id, data: { status: newStatus } })
      toast(newStatus === 'paused' ? 'Connection paused' : 'Connection resumed', 'success')
      flashSaved()
    } catch {
      toast('Failed to update status', 'error')
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete firehose connection "${name}"? This cannot be undone.`)) return
    try {
      await deleteMutation.mutateAsync(id)
      toast('Connection deleted', 'success')
      flashSaved()
    } catch {
      toast('Failed to delete connection', 'error')
    }
  }

  const activeCount = connections.filter((c) => c.status === 'active').length

  return (
    <SectionBody className="space-y-4">
      <SectionDescription>
        Connect Signal group channels as live intake feeds. Incoming messages are extracted and
        routed as reports.
      </SectionDescription>

      {/* Connection list */}
      {connectionsLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading connections…
        </div>
      ) : connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No firehose connections configured.</p>
      ) : (
        <div className="space-y-2" data-testid="admin-firehose-list">
          {connections.map((conn) => {
            const health = healthFor(conn.id)
            const isPaused = conn.status === 'paused'
            const isUpdating =
              updateMutation.isPending &&
              (updateMutation.variables as { id: string } | undefined)?.id === conn.id
            const isDeleting =
              deleteMutation.isPending &&
              (deleteMutation.variables as string | undefined) === conn.id

            return (
              <div
                key={conn.id}
                data-testid={`admin-firehose-connection-${conn.id}`}
                className="flex flex-col gap-2 rounded-lg border border-border px-4 py-3 sm:flex-row sm:items-center"
              >
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{conn.displayName || '(unnamed)'}</p>
                    <StatusBadge status={conn.status} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>Type: {reportTypeName(conn.reportTypeId)}</span>
                    {conn.geoContext && <span>Geo: {conn.geoContext}</span>}
                    {conn.signalGroupId && <span>Signal group: {conn.signalGroupId}</span>}
                    {health && (
                      <>
                        <span>Buffer: {health.bufferSize} msgs</span>
                        <span>Extractions: {health.extractionCount}</span>
                      </>
                    )}
                    <span>Interval: {conn.extractionIntervalSec}s</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    data-testid={`admin-firehose-toggle-pause-${conn.id}`}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTogglePause(conn)}
                    disabled={conn.status === 'disabled' || isUpdating}
                    title={isPaused ? 'Resume' : 'Pause'}
                  >
                    {isUpdating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isPaused ? (
                      <Play className="h-3.5 w-3.5" />
                    ) : (
                      <Pause className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    data-testid={`admin-firehose-edit-${conn.id}`}
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(conn)}
                  >
                    Edit
                  </Button>
                  <Button
                    data-testid={`admin-firehose-delete-${conn.id}`}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(conn.id, conn.displayName)}
                    disabled={isDeleting}
                    title="Delete"
                  >
                    {isDeleting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    )}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Status summary line */}
      {!connectionsLoading && connections.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {activeCount} active of {connections.length} total
        </p>
      )}

      {/* Add new button */}
      <Button
        data-testid="admin-firehose-add"
        variant="outline"
        onClick={() => setShowCreate(true)}
      >
        <Plus className="h-4 w-4" />
        New connection
      </Button>

      {showSaved && (
        <span data-testid="admin-firehose-save-success" className="text-sm text-green-600">
          Saved
        </span>
      )}

      {/* ── Create dialog ── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Firehose Connection</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="fh-display-name">Display name</Label>
              <Input
                id="fh-display-name"
                data-testid="admin-firehose-display-name-input"
                value={createForm.displayName}
                onChange={(e) => setCreateForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder="e.g. Latin America Feed"
                maxLength={128}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="fh-report-type">Report type</Label>
              <Select
                value={createForm.reportTypeId}
                onValueChange={(v) => setCreateForm((f) => ({ ...f, reportTypeId: v }))}
              >
                <SelectTrigger id="fh-report-type" data-testid="admin-firehose-report-type-select">
                  <SelectValue placeholder="Select a report type" />
                </SelectTrigger>
                <SelectContent>
                  {reportTypes
                    .filter((rt) => !rt.archivedAt)
                    .map((rt) => (
                      <SelectItem key={rt.id} value={rt.id}>
                        {rt.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="fh-geo-context">Geographic context</Label>
              <Input
                id="fh-geo-context"
                data-testid="admin-firehose-geo-context-input"
                value={createForm.geoContext}
                onChange={(e) => setCreateForm((f) => ({ ...f, geoContext: e.target.value }))}
                placeholder="e.g. Colombia, Bogotá region"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="fh-country-codes">
                Country codes (comma-separated, ISO 3166-1 alpha-2)
              </Label>
              <Input
                id="fh-country-codes"
                data-testid="admin-firehose-country-codes-input"
                value={createForm.geoContextCountryCodes}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, geoContextCountryCodes: e.target.value }))
                }
                placeholder="CO, VE, EC"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="fh-interval">
                Extraction interval: {createForm.extractionIntervalSec}s
              </Label>
              <Input
                id="fh-interval"
                data-testid="admin-firehose-interval-input"
                type="number"
                min={30}
                max={300}
                step={10}
                value={createForm.extractionIntervalSec}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    extractionIntervalSec: Math.min(300, Math.max(30, Number(e.target.value))),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">30–300 seconds</p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowCreate(false)}
                data-testid="admin-firehose-create-cancel"
              >
                Cancel
              </Button>
              <Button
                data-testid="admin-firehose-create-submit"
                disabled={
                  !createForm.displayName.trim() ||
                  !createForm.reportTypeId ||
                  createMutation.isPending
                }
                onClick={handleCreate}
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  'Create connection'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Firehose Connection</DialogTitle>
          </DialogHeader>

          {editTarget && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="fh-edit-geo-context">Geographic context</Label>
                <Input
                  id="fh-edit-geo-context"
                  data-testid="admin-firehose-edit-geo-context-input"
                  value={editTarget.geoContext}
                  onChange={(e) => setEditTarget((f) => f && { ...f, geoContext: e.target.value })}
                  placeholder="e.g. Colombia, Bogotá region"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="fh-edit-country-codes">Country codes</Label>
                <Input
                  id="fh-edit-country-codes"
                  data-testid="admin-firehose-edit-country-codes-input"
                  value={editTarget.geoContextCountryCodes}
                  onChange={(e) =>
                    setEditTarget((f) => f && { ...f, geoContextCountryCodes: e.target.value })
                  }
                  placeholder="CO, VE"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="fh-edit-interval">
                  Extraction interval: {editTarget.extractionIntervalSec}s
                </Label>
                <Input
                  id="fh-edit-interval"
                  data-testid="admin-firehose-edit-interval-input"
                  type="number"
                  min={30}
                  max={300}
                  step={10}
                  value={editTarget.extractionIntervalSec}
                  onChange={(e) =>
                    setEditTarget(
                      (f) =>
                        f && {
                          ...f,
                          extractionIntervalSec: Math.min(
                            300,
                            Math.max(30, Number(e.target.value))
                          ),
                        }
                    )
                  }
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="fh-edit-system-prompt">System prompt suffix</Label>
                <Textarea
                  id="fh-edit-system-prompt"
                  data-testid="admin-firehose-edit-system-prompt-input"
                  rows={3}
                  className="resize-none"
                  value={editTarget.systemPromptSuffix}
                  onChange={(e) =>
                    setEditTarget((f) => f && { ...f, systemPromptSuffix: e.target.value })
                  }
                  placeholder="Additional instructions appended to the extraction prompt"
                  maxLength={2000}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="fh-edit-buffer-ttl">Buffer TTL (days)</Label>
                <Input
                  id="fh-edit-buffer-ttl"
                  data-testid="admin-firehose-edit-buffer-ttl-input"
                  type="number"
                  min={1}
                  max={30}
                  value={editTarget.bufferTtlDays}
                  onChange={(e) =>
                    setEditTarget(
                      (f) =>
                        f && {
                          ...f,
                          bufferTtlDays: Math.min(30, Math.max(1, Number(e.target.value))),
                        }
                    )
                  }
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="fh-edit-inference">Inference endpoint override</Label>
                <Input
                  id="fh-edit-inference"
                  data-testid="admin-firehose-edit-inference-input"
                  value={editTarget.inferenceEndpoint}
                  onChange={(e) =>
                    setEditTarget((f) => f && { ...f, inferenceEndpoint: e.target.value })
                  }
                  placeholder="https://vllm.internal/v1 (leave blank for default)"
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="fh-edit-signal"
                  data-testid="admin-firehose-edit-notify-signal-switch"
                  checked={editTarget.notifyViaSignal}
                  onCheckedChange={(checked) =>
                    setEditTarget((f) => f && { ...f, notifyViaSignal: checked })
                  }
                />
                <Label htmlFor="fh-edit-signal" className="text-sm">
                  Send Signal DM notifications on new extractions
                </Label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setEditTarget(null)}
                  data-testid="admin-firehose-edit-cancel"
                >
                  Cancel
                </Button>
                <Button
                  disabled={updateMutation.isPending}
                  onClick={handleEdit}
                  data-testid="admin-firehose-edit-save"
                >
                  {updateMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save changes'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </SectionBody>
  )
}
