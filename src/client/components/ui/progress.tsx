import type * as React from 'react'

import { cn } from '@/lib/utils'

function Progress({
  className,
  value = 0,
  max = 100,
  ...props
}: React.ComponentProps<'div'> & { value?: number; max?: number }) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100))

  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn('bg-primary/20 relative h-2 w-full overflow-hidden rounded-full', className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="bg-primary h-full transition-all duration-300 ease-in-out"
        style={
          {
            '--progress-width': `${percentage}%`,
            width: 'var(--progress-width)',
          } as React.CSSProperties
        }
      />
    </div>
  )
}

export { Progress }
