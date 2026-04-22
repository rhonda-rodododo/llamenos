import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Progress } from '@/components/ui/progress'

interface UploadProgressProps {
  completedChunks: number
  totalChunks: number
  fileName: string
  status: 'uploading' | 'complete' | 'failed'
}

export function UploadProgress({
  completedChunks,
  totalChunks,
  fileName,
  status,
}: UploadProgressProps) {
  const { t } = useTranslation()
  const percentage = totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 0

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="shrink-0">
        {status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        {status === 'complete' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {status === 'failed' && <XCircle className="h-4 w-4 text-destructive" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="truncate text-xs font-medium text-foreground">{fileName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {status === 'complete'
              ? t('reports.uploadComplete', { defaultValue: 'Complete' })
              : status === 'failed'
                ? t('reports.uploadFailed', { defaultValue: 'Failed' })
                : `${percentage}%`}
          </span>
        </div>
        <Progress value={percentage} />
      </div>
    </div>
  )
}
