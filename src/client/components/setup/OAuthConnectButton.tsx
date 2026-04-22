import { TELEPHONY_PROVIDER_LABELS } from '@shared/types'
import { CheckCircle2, ExternalLink, Loader2, XCircle } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  type OAuthStartResponse,
  startProviderOAuth,
  type TelephonyProviderType,
  validateProviderCredentials,
} from '@/lib/api'
import { useToast } from '@/lib/toast'

interface OAuthConnectButtonProps {
  provider: TelephonyProviderType
  credentials?: {
    accountSid?: string
    authToken?: string
    signalwireSpace?: string
    apiKey?: string
    apiSecret?: string
    applicationId?: string
    authId?: string
    ariUrl?: string
    ariUsername?: string
    ariPassword?: string
  }
  onConnected: (result: { accountName?: string }) => void
  onError: (error: string) => void
  validated: boolean
}

type ConnectionStatus = 'idle' | 'connecting' | 'validating' | 'connected' | 'error'

export function OAuthConnectButton({
  provider,
  credentials,
  onConnected,
  onError,
  validated,
}: OAuthConnectButtonProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [status, setStatus] = useState<ConnectionStatus>(validated ? 'connected' : 'idle')
  const [oauthInfo, setOauthInfo] = useState<OAuthStartResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleConnect = useCallback(async () => {
    setStatus('connecting')
    setError(null)

    try {
      // Try OAuth first
      const result = await startProviderOAuth(provider)
      setOauthInfo(result)

      if (result.mode === 'oauth' && result.redirectUrl) {
        // Redirect to OAuth consent page
        window.open(result.redirectUrl, '_blank', 'noopener,noreferrer')
        // Start polling for status
        setStatus('validating')
      } else {
        // Manual mode - validate credentials directly
        setStatus('validating')
        if (credentials) {
          const validationResult = await validateProviderCredentials({
            provider,
            ...credentials,
          })
          if (validationResult.ok) {
            setStatus('connected')
            onConnected({ accountName: validationResult.accountName })
          } else {
            setStatus('error')
            const errMsg = validationResult.error || t('setup.oauth.validationFailed')
            setError(errMsg)
            onError(errMsg)
          }
        } else {
          setStatus('idle')
          toast(t('setup.oauth.enterCredentials'), 'info')
        }
      }
    } catch (err) {
      setStatus('error')
      const errMsg = err instanceof Error ? err.message : t('setup.oauth.connectionFailed')
      setError(errMsg)
      onError(errMsg)
    }
  }, [provider, credentials, onConnected, onError, t, toast])

  const providerLabel = TELEPHONY_PROVIDER_LABELS[provider]

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button
          variant={status === 'connected' ? 'outline' : 'default'}
          size="sm"
          onClick={handleConnect}
          disabled={status === 'connecting' || status === 'validating'}
          data-testid="oauth-connect-button"
        >
          {status === 'connecting' || status === 'validating' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : status === 'connected' ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : status === 'error' ? (
            <XCircle className="h-4 w-4 text-destructive" />
          ) : null}
          {status === 'connecting'
            ? t('setup.oauth.connecting')
            : status === 'validating'
              ? t('setup.oauth.validating')
              : status === 'connected'
                ? t('setup.oauth.connected', { provider: providerLabel })
                : t('setup.oauth.validate', { provider: providerLabel })}
        </Button>

        {oauthInfo?.signupUrl && status !== 'connected' && (
          <a
            href={oauthInfo.signupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            {t('setup.oauth.signUp', { provider: providerLabel })}
          </a>
        )}
      </div>

      {/* Status message */}
      {status === 'connected' && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3">
          <p className="text-xs text-green-700 dark:text-green-400">
            {t('setup.oauth.credentialsValid', { provider: providerLabel })}
          </p>
        </div>
      )}

      {status === 'error' && error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
    </div>
  )
}
