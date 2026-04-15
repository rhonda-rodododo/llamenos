import { ConfirmDialog } from '@/components/confirm-dialog'
import { PhoneInput, isValidE164 } from '@/components/phone-input'
import { PinChallengeDialog } from '@/components/pin-challenge-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { type InviteDeliveryChannel, getUserUnmasked, type updateUser } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import {
  useCreateInvite,
  useInviteChannels,
  useInvites,
  useRevokeInvite,
  useSendInvite,
} from '@/lib/queries/invites'
import { useRoles } from '@/lib/queries/roles'
import { useCreateUser, useDeleteUser, useUpdateUser, useUsers } from '@/lib/queries/users'
import { useToast } from '@/lib/toast'
import { usePinChallenge } from '@/lib/use-pin-challenge'
import { generateKeyPair } from '@shared/crypto-primitives'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  Coffee,
  Copy,
  Eye,
  EyeOff,
  Key,
  Mail,
  MessageCircle,
  Send,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/users')({
  component: UsersPage,
})

function maskedPhone(phone: string) {
  if (!phone || phone.length < 6) return phone
  return phone.slice(0, 3) + '\u2022'.repeat(phone.length - 5) + phone.slice(-2)
}

function channelLabel(channel: string): string {
  switch (channel) {
    case 'signal':
      return 'Signal'
    case 'whatsapp':
      return 'WhatsApp'
    case 'sms':
      return 'SMS'
    default:
      return channel
  }
}

function UsersPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'
  const { toast } = useToast()

  // --- React Query: users ---
  const { data: users = [], isLoading: usersLoading } = useUsers()
  const createUserMutation = useCreateUser()
  const updateUserMutation = useUpdateUser()
  const deleteUserMutation = useDeleteUser()

  // --- React Query: invites, roles, channels ---
  const { data: invites = [], isLoading: invitesLoading } = useInvites()
  const { data: roles = [] } = useRoles(hubId)
  const { data: availableChannels } = useInviteChannels()
  const revokeInviteMutation = useRevokeInvite()

  // --- UI-only state ---
  const [showAddForm, setShowAddForm] = useState(false)
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [generatedNsec, setGeneratedNsec] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [sendInviteForCode, setSendInviteForCode] = useState<string | null>(null)

  const loading = usersLoading || invitesLoading

  // useInvites() already decrypts in the query fn
  const decryptedInvites = invites

  if (!isAdmin) {
    return <div className="text-muted-foreground">{t('common.accessDenied')}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <UserPlus className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold sm:text-2xl">{t('users.title')}</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setShowInviteForm(true)
              setInviteLink(null)
            }}
          >
            <Mail className="h-4 w-4" />
            {t('users.inviteUser')}
          </Button>
          <Button
            data-testid="user-add-btn"
            onClick={() => {
              setShowAddForm(true)
              setGeneratedNsec(null)
            }}
          >
            <UserPlus className="h-4 w-4" />
            {t('users.addUser')}
          </Button>
        </div>
      </div>

      {/* Generated key warning */}
      {generatedNsec && (
        <Card className="border-yellow-400/50 bg-yellow-50 dark:border-yellow-600/50 dark:bg-yellow-950/10">
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2">
              <Key className="mt-0.5 h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              <div>
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                  {t('users.inviteGenerated')}
                </p>
                <p className="mt-0.5 text-xs text-yellow-600 dark:text-yellow-400/80">
                  {t('users.secretKeyWarning')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code
                data-testid="user-nsec-code"
                className="flex-1 break-all rounded-md bg-background px-3 py-2 text-xs"
              >
                {generatedNsec}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(generatedNsec)
                  toast(t('common.success'), 'success')
                  setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000)
                }}
                aria-label={t('a11y.copyToClipboard')}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              data-testid="dismiss-nsec"
              onClick={() => setGeneratedNsec(null)}
            >
              {t('common.close')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Invite link display */}
      {inviteLink && (
        <Card className="border-green-400/50 bg-green-50 dark:border-green-600/50 dark:bg-green-950/10">
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2">
              <Mail className="mt-0.5 h-4 w-4 text-green-600 dark:text-green-400" />
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-300">
                  {t('users.inviteCreated')}
                </p>
                <p className="mt-0.5 text-xs text-green-600 dark:text-green-400/80">
                  {t('users.inviteLinkLabel')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code
                data-testid="invite-link-code"
                className="flex-1 break-all rounded-md bg-background px-3 py-2 text-xs"
              >
                {inviteLink}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(inviteLink)
                  toast(t('common.success'), 'success')
                  setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000)
                }}
                aria-label={t('a11y.copyToClipboard')}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              data-testid="dismiss-invite"
              onClick={() => setInviteLink(null)}
            >
              {t('common.close')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Invite form */}
      {showInviteForm && (
        <InviteForm
          roles={roles}
          onCreated={(invite) => {
            setInviteLink(`${window.location.origin}/onboarding?code=${invite.code}`)
            setSendInviteForCode(invite.code)
            setShowInviteForm(false)
          }}
          onCancel={() => setShowInviteForm(false)}
        />
      )}

      {/* Add user form */}
      {showAddForm && (
        <AddUserForm
          roles={roles}
          createMutation={createUserMutation}
          onCreated={(nsec) => {
            setGeneratedNsec(nsec)
            setShowAddForm(false)
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Pending invites */}
      {invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4 text-muted-foreground" />
              {t('users.pendingInvites')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {decryptedInvites.map((invite) => (
                <div
                  key={invite.code}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{invite.name}</p>
                    <p className="text-xs text-muted-foreground">{maskedPhone(invite.phone)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {invite.deliverySentAt
                        ? t('users.inviteSentVia', {
                            channel: channelLabel(invite.deliveryChannel ?? ''),
                            date: new Date(invite.deliverySentAt).toLocaleDateString(),
                          })
                        : t('users.inviteNotSent')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSendInviteForCode(invite.code)
                      }}
                      data-testid={`send-invite-btn-${invite.code}`}
                    >
                      <Send className="h-3 w-3" />
                      {t('users.sendInvite')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        revokeInviteMutation.mutate(invite.code, {
                          onSuccess: () => toast(t('users.inviteRevoked'), 'success'),
                          onError: () => toast(t('common.error'), 'error'),
                        })
                      }}
                      disabled={revokeInviteMutation.isPending}
                      className="text-destructive hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                      {t('users.revokeInvite')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Send invite dialog */}
      {sendInviteForCode && (
        <SendInviteDialog
          inviteCode={sendInviteForCode}
          availableChannels={availableChannels ?? { signal: false, whatsapp: false, sms: false }}
          onSent={(channel) => {
            setSendInviteForCode(null)
            toast(t('users.inviteSentSuccess', { channel: channelLabel(channel) }), 'success')
          }}
          onCopyLink={() => {
            const link = `${window.location.origin}/onboarding?code=${sendInviteForCode}`
            navigator.clipboard.writeText(link)
            toast(t('common.success'), 'success')
            setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000)
          }}
          onClose={() => setSendInviteForCode(null)}
        />
      )}

      {/* Users list */}
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
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">{t('common.noData')}</div>
          ) : (
            <div data-testid="user-list" className="divide-y divide-border">
              {users.map((u) => (
                <UserRow
                  key={u.pubkey}
                  user={u}
                  roles={roles}
                  onUpdate={(pubkey, data) => updateUserMutation.mutate({ pubkey, data })}
                  onDelete={(pubkey) => deleteUserMutation.mutate(pubkey)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function InviteForm({
  roles,
  onCreated,
  onCancel,
}: {
  roles: import('@/lib/api').RoleDefinition[]
  onCreated: (invite: import('@/lib/api').InviteCode) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [roleId, setRoleId] = useState('role-volunteer')
  const createInviteMutation = useCreateInvite()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidE164(phone)) {
      toast(t('users.invalidPhone'), 'error')
      return
    }
    createInviteMutation.mutate(
      { name, phone, roleIds: [roleId] },
      {
        onSuccess: (res) => {
          onCreated(res.invite)
          toast(t('users.inviteCreated'), 'success')
        },
        onError: () => {
          toast(t('common.error'), 'error')
        },
      }
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4 text-muted-foreground" />
          {t('users.inviteUser')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invite-name">{t('users.name')}</Label>
              <Input
                id="invite-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-phone">{t('users.phone')}</Label>
              <PhoneInput id="invite-phone" value={phone} onChange={setPhone} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">{t('users.role')}</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem
                    key={role.id}
                    value={role.id}
                    data-testid={`invite-role-option-${role.id}`}
                  >
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={createInviteMutation.isPending}>
              {createInviteMutation.isPending ? t('common.loading') : t('users.createInvite')}
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

function AddUserForm({
  roles,
  createMutation,
  onCreated,
  onCancel,
}: {
  roles: import('@/lib/api').RoleDefinition[]
  createMutation: ReturnType<typeof useCreateUser>
  onCreated: (nsec: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [roleId, setRoleId] = useState('role-volunteer')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidE164(phone)) {
      toast(t('users.invalidPhone'), 'error')
      return
    }
    const keyPair = generateKeyPair()
    createMutation.mutate(
      { name, phone, roleIds: [roleId], pubkey: keyPair.publicKey },
      {
        onSuccess: () => {
          onCreated(keyPair.nsec)
          toast(t('users.userAdded'), 'success')
        },
        onError: () => {
          toast(t('common.error'), 'error')
        },
      }
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="h-4 w-4 text-muted-foreground" />
          {t('users.addUser')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vol-name">{t('users.name')}</Label>
              <Input
                id="vol-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vol-phone">{t('users.phone')}</Label>
              <PhoneInput id="vol-phone" value={phone} onChange={setPhone} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vol-role">{t('users.role')}</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger id="vol-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button data-testid="form-save-btn" type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
            <Button
              data-testid="form-cancel-btn"
              type="button"
              variant="outline"
              onClick={onCancel}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function UserRow({
  user,
  roles,
  onUpdate,
  onDelete,
}: {
  user: import('@/lib/queries/users').User
  roles: import('@/lib/api').RoleDefinition[]
  onUpdate: (pubkey: string, data: Parameters<typeof updateUser>[1]) => void
  onDelete: (pubkey: string) => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [unmaskedPhone, setUnmaskedPhone] = useState<string | null>(null)
  const pinChallenge = usePinChallenge()

  // User data is already decrypted by useUsers() in the parent.
  const primaryRoleId = user.roles[0] || 'role-volunteer'
  const primaryRole = roles.find((r) => r.id === primaryRoleId)
  const isAdminRole = primaryRoleId === 'role-super-admin' || primaryRoleId === 'role-hub-admin'
  const displayName = user.name

  function changeRole(newRoleId: string) {
    if (newRoleId === primaryRoleId) return
    onUpdate(user.pubkey, { roles: [newRoleId] })
  }

  function toggleActive() {
    onUpdate(user.pubkey, { active: !user.active })
  }

  function handleDelete() {
    onDelete(user.pubkey)
  }

  return (
    <div
      data-testid={`user-row-${user.pubkey.slice(0, 8)}`}
      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
          {displayName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {displayName}{' '}
            <span className="font-mono text-xs text-muted-foreground">
              ({user.pubkey.slice(0, 8)})
            </span>
          </p>
          {user.phone && (
            <p className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
              {unmaskedPhone ?? user.phone}
              <button
                onClick={async () => {
                  if (unmaskedPhone) {
                    setUnmaskedPhone(null)
                  } else {
                    const ok = await pinChallenge.requirePin()
                    if (ok) {
                      const res = await getUserUnmasked(user.pubkey)
                      setUnmaskedPhone(res.user.phone)
                    }
                  }
                }}
                className="text-muted-foreground hover:text-foreground"
                data-testid="toggle-phone-visibility"
              >
                {unmaskedPhone ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <Badge variant={isAdminRole ? 'default' : 'secondary'}>
          {isAdminRole && <ShieldCheck className="h-3 w-3" />}
          {primaryRole?.name || primaryRoleId}
          {user.roles.length > 1 && (
            <span className="ml-1 text-xs opacity-70">+{user.roles.length - 1}</span>
          )}
        </Badge>
        <button onClick={toggleActive} aria-pressed={user.active}>
          <Badge
            variant="outline"
            className={
              user.active
                ? 'border-green-500/50 text-green-700 dark:text-green-400'
                : 'border-red-500/50 text-red-700 dark:text-red-400'
            }
          >
            {user.active ? t('users.active') : t('users.inactive')}
          </Badge>
        </button>
        {user.onBreak && (
          <Badge
            variant="outline"
            className="border-yellow-500/50 text-yellow-700 dark:text-yellow-400"
          >
            <Coffee className="h-3 w-3" />
            {t('dashboard.onBreak')}
          </Badge>
        )}
        <div className="flex items-center gap-1">
          <Select value={primaryRoleId} onValueChange={changeRole}>
            <SelectTrigger
              className="h-7 w-auto gap-1 border-none bg-transparent px-2 text-xs shadow-none"
              aria-label={t('users.changeRole')}
            >
              <Shield className="h-3 w-3" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            data-testid="user-delete-btn"
            variant="ghost"
            size="icon-xs"
            onClick={() => setShowDeleteConfirm(true)}
            className="text-destructive hover:text-destructive"
            aria-label={t('a11y.deleteItem')}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={t('users.removeUser')}
        description={`${displayName} (${user.phone})`}
        confirmLabel={t('common.delete')}
        onConfirm={handleDelete}
      />
      <PinChallengeDialog
        open={pinChallenge.isOpen}
        attempts={pinChallenge.attempts}
        error={pinChallenge.error}
        onComplete={pinChallenge.handleComplete}
        onCancel={pinChallenge.handleCancel}
      />
    </div>
  )
}

/**
 * SendInviteDialog — lets admin deliver an invite link via Signal, WhatsApp, or SMS.
 * Signal is the preferred channel. SMS requires insecure acknowledgment.
 * "Copy invite link" is always available as a manual fallback.
 */
function SendInviteDialog({
  inviteCode,
  availableChannels,
  onSent,
  onCopyLink,
  onClose,
}: {
  inviteCode: string
  availableChannels: { signal: boolean; whatsapp: boolean; sms: boolean }
  onSent: (channel: InviteDeliveryChannel) => void
  onCopyLink: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [phone, setPhone] = useState('')
  const [acknowledgedInsecure, setAcknowledgedInsecure] = useState(false)
  const sendInviteMutation = useSendInvite()

  const hasAnyChannel =
    availableChannels.signal || availableChannels.whatsapp || availableChannels.sms

  // Default to the best available channel
  const defaultChannel: InviteDeliveryChannel = availableChannels.signal
    ? 'signal'
    : availableChannels.whatsapp
      ? 'whatsapp'
      : 'sms'

  const [selectedChannel, setSelectedChannel] = useState<InviteDeliveryChannel>(defaultChannel)

  function handleSend() {
    if (!isValidE164(phone)) {
      toast(t('users.invalidPhone'), 'error')
      return
    }
    if (selectedChannel === 'sms' && !acknowledgedInsecure) {
      toast(t('users.smsAcknowledgeRequired'), 'error')
      return
    }
    sendInviteMutation.mutate(
      {
        code: inviteCode,
        data: {
          recipientPhone: phone,
          channel: selectedChannel,
          acknowledgedInsecure: selectedChannel === 'sms' ? acknowledgedInsecure : undefined,
        },
      },
      {
        onSuccess: () => onSent(selectedChannel),
        onError: (err) => {
          const message = err instanceof Error ? err.message : t('common.error')
          toast(message, 'error')
        },
      }
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-primary" />
            {t('users.sendInviteTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {hasAnyChannel ? (
            <>
              {/* Phone number */}
              <div className="space-y-2">
                <Label htmlFor="send-phone">{t('users.phone')}</Label>
                <PhoneInput
                  id="send-phone"
                  value={phone}
                  onChange={setPhone}
                  required
                  data-testid="send-invite-phone"
                />
              </div>

              {/* Channel selector */}
              <div className="space-y-2">
                <Label htmlFor="send-channel">{t('users.inviteChannel')}</Label>
                <Select
                  value={selectedChannel}
                  onValueChange={(v) => setSelectedChannel(v as InviteDeliveryChannel)}
                >
                  <SelectTrigger id="send-channel" data-testid="send-invite-channel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableChannels.signal && <SelectItem value="signal">Signal</SelectItem>}
                    {availableChannels.whatsapp && (
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    )}
                    {availableChannels.sms && <SelectItem value="sms">SMS</SelectItem>}
                  </SelectContent>
                </Select>
              </div>

              {/* SMS insecure warning */}
              {selectedChannel === 'sms' && (
                <div className="rounded-lg border border-amber-400/50 bg-amber-50 p-3 dark:border-amber-600/50 dark:bg-amber-950/10">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      {t('users.smsInsecureWarning')}
                    </p>
                  </div>
                  <label className="mt-2 flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={acknowledgedInsecure}
                      onChange={(e) => setAcknowledgedInsecure(e.target.checked)}
                      data-testid="sms-acknowledge-checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                    />
                    <span className="text-xs text-amber-800 dark:text-amber-300">
                      {t('users.smsAcknowledge')}
                    </span>
                  </label>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={handleSend}
                  disabled={
                    sendInviteMutation.isPending ||
                    (selectedChannel === 'sms' && !acknowledgedInsecure)
                  }
                  data-testid="send-invite-submit"
                  className="flex-1"
                >
                  <Send className="h-4 w-4" />
                  {sendInviteMutation.isPending ? t('common.loading') : t('users.sendInvite')}
                </Button>
                <Button variant="outline" onClick={onCopyLink} data-testid="copy-invite-link-btn">
                  <Copy className="h-4 w-4" />
                  {t('users.copyLink')}
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t('users.noChannelsConfigured')}</p>
              <Button
                variant="outline"
                onClick={onCopyLink}
                className="w-full"
                data-testid="copy-invite-link-btn"
              >
                <Copy className="h-4 w-4" />
                {t('users.copyLink')}
              </Button>
            </div>
          )}

          <Button variant="ghost" size="sm" onClick={onClose} className="w-full">
            {t('common.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
