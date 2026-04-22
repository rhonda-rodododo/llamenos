import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { createReport } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import { getMlsConversation } from '@/lib/mls/get-mls-conversation'
import * as mlsApi from '@/lib/mls/mls-api-client'
import { useReportCategories, useReportTypes } from '@/lib/queries/reports'
import { useToast } from '@/lib/toast'
import { Loader2, Lock, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ReportFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (reportId: string) => void
}

export function ReportForm({ open, onOpenChange, onCreated }: ReportFormProps) {
  const { t } = useTranslation()
  const { hasNsec, publicKey, adminDecryptionPubkey } = useAuth()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'
  const { toast } = useToast()

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [reportTypeId, setReportTypeId] = useState<string>('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Only fetch when open — enabled flag prevents unnecessary fetches
  const categoriesQuery = useReportCategories()
  const reportTypesQuery = useReportTypes(hubId)

  const categories = categoriesQuery.data ?? []
  const reportTypes = reportTypesQuery.data ?? []
  const activeReportTypes = reportTypes.filter((rt) => !rt.archivedAt)

  // Pre-select the default report type when types load and none is selected
  useEffect(() => {
    if (!open || reportTypeId) return
    const defaultType = activeReportTypes.find((rt) => rt.isDefault)
    if (defaultType) setReportTypeId(defaultType.id)
  }, [open, activeReportTypes, reportTypeId])

  const resetForm = useCallback(() => {
    setTitle('')
    setCategory('')
    setReportTypeId('')
    setBody('')
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || !body.trim()) {
      toast(
        t('reports.fillRequired', { defaultValue: 'Please fill in the required fields' }),
        'error'
      )
      return
    }

    if (!hasNsec || !publicKey) {
      toast(t('reports.noKeyPair', { defaultValue: 'Encryption key not available' }), 'error')
      return
    }

    setSubmitting(true)

    try {
      const mlsConv = await getMlsConversation(hubId)
      if (!mlsConv) {
        toast(t('reports.mlsNotAvailable', { defaultValue: 'MLS not available' }), 'error')
        setSubmitting(false)
        return
      }

      const mlsBytes = await mlsConv.encrypt(new TextEncoder().encode(body.trim()))
      const mlsCiphertext = mlsApi.toBase64(mlsBytes)
      const epoch = await mlsConv.currentEpoch()

      const report = await createReport({
        title: title.trim(),
        category: category || undefined,
        reportTypeId: reportTypeId || undefined,
        mlsCiphertext,
        mlsEpoch: epoch,
      })

      toast(t('reports.created', { defaultValue: 'Report submitted' }), 'success')
      resetForm()
      onOpenChange(false)
      onCreated(report.id)
    } catch {
      toast(t('reports.createError', { defaultValue: 'Failed to submit report' }), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [
    title,
    body,
    category,
    reportTypeId,
    hasNsec,
    publicKey,
    hubId,
    toast,
    t,
    resetForm,
    onOpenChange,
    onCreated,
  ])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('reports.newReport', { defaultValue: 'New Report' })}</SheetTitle>
          <SheetDescription>
            <span className="flex items-center gap-1.5">
              <Lock className="h-3 w-3" />
              {t('reports.encryptedNote', { defaultValue: 'Your report is encrypted end-to-end' })}
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4 px-4">
          <div className="space-y-2">
            <Label htmlFor="report-title">
              {t('reports.titleLabel', { defaultValue: 'Title' })} *
            </Label>
            <Input
              id="report-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('reports.titlePlaceholder', {
                defaultValue: 'Brief description of the report',
              })}
              disabled={submitting}
              maxLength={200}
            />
          </div>

          {activeReportTypes.length > 0 && (
            <div className="space-y-2">
              <Label data-testid="report-type-label">
                {t('reports.type.label', { defaultValue: 'Report Type' })}
              </Label>
              <Select value={reportTypeId} onValueChange={setReportTypeId} disabled={submitting}>
                <SelectTrigger className="w-full" data-testid="report-type-select">
                  <SelectValue
                    placeholder={t('reports.type.placeholder', {
                      defaultValue: 'Select a report type',
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  {activeReportTypes.map((rt) => (
                    <SelectItem
                      key={rt.id}
                      value={rt.id}
                      data-testid={`report-type-option-${rt.id}`}
                    >
                      {rt.name}
                      {rt.isDefault && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          ({t('settings.reportTypes.default', { defaultValue: 'Default' })})
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {categories.length > 0 && (
            <div className="space-y-2">
              <Label>{t('reports.categoryLabel', { defaultValue: 'Category' })}</Label>
              <Select value={category} onValueChange={setCategory} disabled={submitting}>
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={t('reports.selectCategory', { defaultValue: 'Select a category' })}
                  />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="report-body">
              {t('reports.bodyLabel', { defaultValue: 'Details' })} *
            </Label>
            <Textarea
              id="report-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('reports.bodyPlaceholder', {
                defaultValue: 'Describe the situation in detail...',
              })}
              disabled={submitting}
              rows={6}
              className="resize-y"
            />
          </div>

          <div className="flex justify-end pt-2">
            <Button
              onClick={() => void handleSubmit()}
              disabled={submitting || !title.trim() || !body.trim()}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {t('reports.submit', { defaultValue: 'Submit Report' })}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
