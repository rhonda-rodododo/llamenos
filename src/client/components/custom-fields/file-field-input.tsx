import type { CustomFieldDefinition, FileFieldValue } from '@shared/types'
import { File as FileIcon, Upload, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useAuth } from '@/lib/auth'
import { uploadEncryptedFile } from '@/lib/file-upload'

interface Props {
  definition: CustomFieldDefinition
  value: FileFieldValue | undefined
  onChange: (value: FileFieldValue | undefined) => void
  disabled?: boolean
}

interface UploadState {
  file: File
  status: 'encrypting' | 'uploading' | 'complete' | 'error'
  progress: number
  error?: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function mimeTypeMatches(mimeType: string, pattern: string): boolean {
  if (pattern === '*/*') return true
  if (pattern.endsWith('/*')) {
    return mimeType.startsWith(pattern.slice(0, -1))
  }
  return mimeType === pattern
}

/**
 * File field input for custom fields — handles encrypt-then-upload flow,
 * MIME type and size validation, and progress display.
 * Single-file per field instance.
 */
export function FileFieldInput({ definition, value, onChange, disabled }: Props) {
  const { t } = useTranslation()
  const { publicKey, adminDecryptionPubkey } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploadState, setUploadState] = useState<UploadState | null>(null)

  const validateFile = useCallback(
    (file: File): string | null => {
      // Size validation
      if (definition.maxFileSize && file.size > definition.maxFileSize) {
        const maxMB = (definition.maxFileSize / (1024 * 1024)).toFixed(1)
        return t('customFields.file.tooLarge', { max: maxMB })
      }
      // MIME type validation
      if (definition.allowedMimeTypes && definition.allowedMimeTypes.length > 0) {
        const mimeType = file.type || 'application/octet-stream'
        const allowed = definition.allowedMimeTypes.some((pattern) =>
          mimeTypeMatches(mimeType, pattern)
        )
        if (!allowed) {
          return t('customFields.file.invalidType')
        }
      }
      return null
    },
    [definition.maxFileSize, definition.allowedMimeTypes, t]
  )

  const handleFileSelect = useCallback(
    async (file: File) => {
      if (!publicKey) return

      const validationError = validateFile(file)
      if (validationError) {
        setUploadState({ file, status: 'error', progress: 0, error: validationError })
        return
      }

      setUploadState({ file, status: 'encrypting', progress: 0 })

      try {
        const adminPubkeys = adminDecryptionPubkey ? [adminDecryptionPubkey] : []
        const fileFieldValue = await uploadEncryptedFile({
          file,
          uploaderPubkey: publicKey,
          adminPubkeys,
          contextType: 'custom_field',
          onProgress: (completed, total) => {
            setUploadState((prev) =>
              prev ? { ...prev, status: 'uploading', progress: (completed / total) * 100 } : prev
            )
          },
        })

        setUploadState((prev) => (prev ? { ...prev, status: 'complete', progress: 100 } : prev))
        onChange(fileFieldValue)
      } catch {
        setUploadState((prev) =>
          prev ? { ...prev, status: 'error', progress: 0, error: t('common.error') } : prev
        )
      }
    },
    [publicKey, adminDecryptionPubkey, validateFile, onChange, t]
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFileSelect(file)
      if (inputRef.current) inputRef.current.value = ''
    },
    [handleFileSelect]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file) handleFileSelect(file)
    },
    [handleFileSelect]
  )

  const handleRemove = useCallback(() => {
    setUploadState(null)
    onChange(undefined)
  }, [onChange])

  // If already has a value (edit mode), show as uploaded
  if (value?.fileId && !uploadState) {
    return (
      <div
        data-testid="file-field-uploaded"
        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
      >
        <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-muted-foreground">
          {t('customFields.file.upload')}
        </span>
        {!disabled && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleRemove}
            aria-label={t('customFields.file.remove')}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    )
  }

  // Uploading / error state
  if (uploadState) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm">{uploadState.file.name}</p>
            <p className="text-xs text-muted-foreground">{formatFileSize(uploadState.file.size)}</p>
          </div>
          {(uploadState.status === 'complete' || uploadState.status === 'error') && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleRemove}
              aria-label={t('customFields.file.remove')}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        {(uploadState.status === 'encrypting' || uploadState.status === 'uploading') && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t('customFields.file.uploading')}</p>
            <Progress value={uploadState.progress} className="h-1.5" />
          </div>
        )}
        {uploadState.status === 'error' && uploadState.error && (
          <p className="text-xs text-destructive">{uploadState.error}</p>
        )}
      </div>
    )
  }

  // Empty state — dropzone
  return (
    <div>
      <button
        type="button"
        data-testid="file-field-dropzone"
        disabled={disabled}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-4 text-sm transition-colors ${
          disabled
            ? 'cursor-not-allowed border-border bg-muted/30 opacity-50'
            : 'cursor-pointer border-border bg-muted/10 hover:border-primary/50 hover:bg-muted/20'
        }`}
        aria-label={t('customFields.file.upload')}
      >
        <Upload className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground">{t('customFields.file.upload')}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={definition.allowedMimeTypes?.join(',') ?? undefined}
        onChange={handleInputChange}
        disabled={disabled}
      />
    </div>
  )
}
