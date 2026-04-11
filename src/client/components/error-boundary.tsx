import { Button } from '@/components/ui/button'
import { createDebugLog } from '@/lib/debug-log'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

const log = createDebugLog('llamenos:error-boundary')

interface ErrorBoundaryProps {
  children: ReactNode
  /** Optional fallback UI. If not provided, uses default error card. */
  fallback?: ReactNode
  /** Scope label for logging (e.g. "notes", "calls") */
  scope?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * React error boundary that catches render errors and displays a recovery UI.
 * Without this, any component crash takes down the entire app with a blank screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    const scope = this.props.scope || 'unknown'
    log('error boundary caught', { scope, errName: error.name, errMsg: error.message })
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return <ErrorFallback error={this.state.error} onReset={this.handleReset} />
    }
    return this.props.children
  }
}

function ErrorFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 p-8">
      <AlertTriangle className="h-10 w-10 text-destructive" />
      <div className="text-center">
        <h3 className="text-lg font-semibold">
          {t('error.boundary.title', { defaultValue: 'Something went wrong' })}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('error.boundary.description', {
            defaultValue:
              'An unexpected error occurred. You can try again or navigate to another page.',
          })}
        </p>
        <pre className="mt-3 max-w-md overflow-auto rounded bg-muted p-2 text-left text-xs">
          {error.message}
        </pre>
      </div>
      <Button variant="outline" onClick={onReset}>
        <RotateCcw className="mr-2 h-4 w-4" />
        {t('error.boundary.retry', { defaultValue: 'Try again' })}
      </Button>
    </div>
  )
}
