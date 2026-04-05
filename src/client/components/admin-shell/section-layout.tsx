import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { Check, Loader2 } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Section layout primitives for admin-sections/*.
 *
 * All admin sections share the same visual rhythm: an intro description,
 * a stack of labelled fields (some with help text, some toggles), and a
 * footer action row with save button + success indicator. These primitives
 * enforce that rhythm and let frontend-design polish passes adjust it in
 * one place.
 *
 * Sections should render:
 *
 *   <SectionBody>
 *     <SectionDescription>{t('foo.description')}</SectionDescription>
 *     <SectionField label={t('foo.name')} htmlFor="foo-name" help={...}>
 *       <Input id="foo-name" ... />
 *     </SectionField>
 *     <SectionToggleField label={t('foo.enabled')} htmlFor="foo-enabled">
 *       <Switch id="foo-enabled" ... />
 *     </SectionToggleField>
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
  return <div className={cn('space-y-7 max-w-3xl', className)} {...rest} />
}

/** Muted intro paragraph that sets context for the section. */
export function SectionDescription({ className, ...rest }: ComponentProps<'p'>) {
  return <p className={cn('text-sm leading-relaxed text-muted-foreground', className)} {...rest} />
}

interface SectionFieldProps {
  /** Visible label text. */
  label: ReactNode
  /** Matches the `id` on the nested input/select/etc. */
  htmlFor?: string
  /** Optional secondary text beneath the control. */
  help?: ReactNode
  /** Optional validation error message beneath the control. */
  error?: ReactNode
  /** Whether this field must be filled. Shows a subtle indicator. */
  required?: boolean
  className?: string
  children: ReactNode
}

/**
 * Vertical field: label stacked on top of control with optional help/error.
 * Use this for text inputs, selects, textareas.
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

/**
 * Horizontal field for switches / checkboxes: label on the left,
 * control on the right.
 */
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
  /** Section slug — used for the save button + success testids. */
  slug: string
  onSave: () => void
  saving?: boolean
  disabled?: boolean
  /** Show the success indicator (controlled by parent, typically for 2s after save). */
  showSaved?: boolean
  /** Label for the primary save button. Defaults to t('common.save'). */
  saveLabel?: ReactNode
  /** Extra action buttons rendered before the Save button (e.g. "Test connection"). */
  extraActions?: ReactNode
  className?: string
}

/**
 * Action row at the bottom of a section: primary Save button, optional
 * extra actions (e.g., "Test connection"), and a stable success indicator
 * with `data-testid="admin-{slug}-save-success"`.
 */
export function SectionActions({
  slug,
  onSave,
  saving = false,
  disabled = false,
  showSaved = false,
  saveLabel,
  extraActions,
  className,
}: SectionActionsProps) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 border-t border-border/60 pt-5 mt-2',
        className
      )}
    >
      <Button
        data-testid={`admin-${slug}-save`}
        onClick={onSave}
        disabled={saving || disabled}
        className="min-w-[90px]"
      >
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {saveLabel ?? t('common.save')}
      </Button>
      {extraActions}
      {showSaved && (
        <span
          data-testid={`admin-${slug}-save-success`}
          className="ml-auto flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-500"
        >
          <Check className="h-3.5 w-3.5" />
          {t('common.saved')}
        </span>
      )}
    </div>
  )
}

/**
 * Small banner used at the top of a section to highlight an important
 * status (e.g., "Provider not configured", "Feature disabled").
 */
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
