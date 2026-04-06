import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { Check, Loader2 } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Section layout primitives for user-facing /security/* pages.
 *
 * Parallel to admin-shell/section-layout.tsx. Separate file keeps the
 * two surfaces independent until they are deduped into a shared module
 * (see NEXT_BACKLOG — "Dedupe user-shell + admin-shell section-layout").
 *
 * Sections should render:
 *
 *   <SectionBody data-testid="foo-page">
 *     <SectionDescription>{t('foo.description')}</SectionDescription>
 *     <SectionField label={t('foo.name')} htmlFor="foo-name" help={...}>
 *       <Input id="foo-name" ... />
 *     </SectionField>
 *     <SectionActions
 *       slug="foo"
 *       onSave={...}
 *       saving={mutation.isPending}
 *       showSaved={showSaved}
 *     />
 *   </SectionBody>
 */

/** Outer wrapper for a section's content. One per section. */
export function SectionBody({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={cn('space-y-6 max-w-3xl', className)} {...rest} />
}

/** Muted intro paragraph that sets context for the section. */
export function SectionDescription({ className, ...rest }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...rest} />
}

interface SectionFieldProps {
  label: ReactNode
  htmlFor?: string
  help?: ReactNode
  error?: ReactNode
  required?: boolean
  className?: string
  children: ReactNode
}

/**
 * Vertical field: label stacked on top of control with optional help/error.
 * Use for text inputs, selects, textareas.
 */
export function SectionField({
  label,
  htmlFor,
  help,
  error,
  required,
  className,
  children,
}: SectionFieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : help ? (
        <p className="text-xs text-muted-foreground">{help}</p>
      ) : null}
    </div>
  )
}

interface SectionToggleFieldProps {
  label: ReactNode
  htmlFor?: string
  help?: ReactNode
  className?: string
  children: ReactNode
}

/** Horizontal field for switches / checkboxes: label left, control right. */
export function SectionToggleField({
  label,
  htmlFor,
  help,
  className,
  children,
}: SectionToggleFieldProps) {
  return (
    <div className={cn('flex items-start justify-between gap-6', className)}>
      <div className="space-y-1">
        <Label htmlFor={htmlFor}>{label}</Label>
        {help && <p className="text-xs text-muted-foreground">{help}</p>}
      </div>
      {children}
    </div>
  )
}

interface SectionActionsProps {
  /** Section slug — used for the default save button + success testids. */
  slug: string
  onSave: () => void
  saving?: boolean
  disabled?: boolean
  /** Show the built-in success indicator (controlled by parent). */
  showSaved?: boolean
  /** Label for the primary save button. Defaults to t('common.save'). */
  saveLabel?: ReactNode
  /** Extra action buttons rendered before the Save button. */
  extraActions?: ReactNode
  /**
   * Legacy data-testid override for the save button. If omitted the button
   * gets `user-${slug}-save`. Existing E2E selectors (e.g. `submit-pin`)
   * can be preserved by passing them here.
   */
  saveButtonTestId?: string
  className?: string
}

/**
 * Action row at the bottom of a section: primary Save button, optional
 * extra actions, and a stable success indicator.
 */
export function SectionActions({
  slug,
  onSave,
  saving = false,
  disabled = false,
  showSaved = false,
  saveLabel,
  extraActions,
  saveButtonTestId,
  className,
}: SectionActionsProps) {
  const { t } = useTranslation()
  const saveTestId = saveButtonTestId ?? `user-${slug}-save`
  return (
    <div className={cn('flex items-center gap-3 pt-2 border-t mt-2', className)}>
      {extraActions}
      <Button data-testid={saveTestId} onClick={onSave} disabled={saving || disabled}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {saveLabel ?? t('common.save')}
      </Button>
      {showSaved && (
        <span
          data-testid={`user-${slug}-save-success`}
          className="flex items-center gap-1 text-sm text-green-600"
        >
          <Check className="h-4 w-4" />
          {t('common.saved')}
        </span>
      )}
    </div>
  )
}

/** Status banner at the top of a section. */
export function SectionBanner({
  tone = 'info',
  className,
  ...rest
}: ComponentProps<'div'> & { tone?: 'info' | 'warn' | 'danger' }) {
  const toneClass =
    tone === 'warn'
      ? 'border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-100'
      : tone === 'danger'
        ? 'border-destructive/30 bg-destructive/5 text-destructive'
        : 'border-border bg-muted/40 text-foreground'
  return (
    <div className={cn('rounded-md border px-3 py-2 text-sm', toneClass, className)} {...rest} />
  )
}
