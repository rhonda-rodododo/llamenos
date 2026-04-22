import type { RelationshipPayload } from '@shared/types'
import { AlertTriangle, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ContactRelationshipRecord } from '@/lib/api'

interface ContactRelationshipSectionProps {
  contactId: string
  relationships: ContactRelationshipRecord[]
  contactNames: Map<string, string>
  onNavigate: (contactId: string) => void
}

function parseRelationshipPayload(raw: string): RelationshipPayload | null {
  try {
    return JSON.parse(raw) as RelationshipPayload
  } catch {
    return null
  }
}

interface ResolvedRelationship {
  id: string
  payload: RelationshipPayload
  otherContactId: string
  direction: 'forward' | 'reverse'
}

export function ContactRelationshipSection({
  contactId,
  relationships,
  contactNames,
  onNavigate,
}: ContactRelationshipSectionProps) {
  const { t } = useTranslation()

  // Relationships are pre-decrypted by useContactRelationships() in the parent
  const resolved = useMemo<ResolvedRelationship[]>(() => {
    return relationships.flatMap((rel) => {
      // After decryption, the payload field contains the decrypted plaintext string
      const raw = (rel as ContactRelationshipRecord & { payload?: string }).payload
      if (!raw) return []
      const payload = parseRelationshipPayload(raw)
      if (!payload) return []

      const isFrom = payload.fromContactId === contactId
      const isTo = payload.toContactId === contactId
      if (!isFrom && !isTo) return []

      return [
        {
          id: rel.id,
          payload,
          otherContactId: isFrom ? payload.toContactId : payload.fromContactId,
          direction: isFrom ? 'forward' : 'reverse',
        } satisfies ResolvedRelationship,
      ]
    })
  }, [relationships, contactId])

  const forward = resolved.filter((r) => r.direction === 'forward')
  const reverse = resolved.filter((r) => r.direction === 'reverse')

  function getDisplayName(cid: string): string {
    return contactNames.get(cid) ?? `${cid.slice(0, 8)}…`
  }

  function renderList(items: ResolvedRelationship[], emptyKey: string) {
    if (items.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">{t(emptyKey, { defaultValue: 'None' })}</p>
      )
    }
    return (
      <div className="space-y-1.5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid="relationship-row"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50"
            onClick={() => onNavigate(item.otherContactId)}
          >
            <span className="min-w-0 flex-1 truncate font-medium">
              {getDisplayName(item.otherContactId)}
            </span>
            {item.payload.relationship && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {item.payload.relationship}
              </Badge>
            )}
            {item.payload.isEmergency && (
              <Badge
                variant="outline"
                className="shrink-0 border-red-500/30 bg-red-500/10 text-[10px] text-red-500"
              >
                <AlertTriangle className="mr-1 h-2.5 w-2.5" />
                {t('contacts.emergency')}
              </Badge>
            )}
          </button>
        ))}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-muted-foreground" />
          {t('contacts.supportContacts')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('contacts.supportContacts')}
          </p>
          {renderList(forward, 'contacts.noContacts')}
        </div>
        {reverse.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('contacts.supportContactFor')}
            </p>
            {renderList(reverse, 'contacts.noContacts')}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
