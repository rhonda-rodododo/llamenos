import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { type EncryptedNote, downloadFile, getFileEnvelopes, listNotes } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { decryptNote } from '@/lib/crypto-worker-helpers'
import { decryptFile } from '@/lib/file-crypto'
import * as keyManager from '@/lib/key-manager'
import type { FileKeyEnvelope } from '@shared/types'
import { AlertCircle, Loader2, Pause, Play, Voicemail } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface VoicemailPlayerProps {
  fileId?: string | null
  callId: string
  canListen: boolean // voicemail:listen permission
}

export function VoicemailPlayer({ fileId, callId, canListen }: VoicemailPlayerProps) {
  const { t } = useTranslation()
  const { hasNsec, publicKey, isAdmin } = useAuth()

  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioError, setAudioError] = useState(false)
  const [playing, setPlaying] = useState(false)

  const [transcript, setTranscript] = useState<string | null>(null)
  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const [transcriptError, setTranscriptError] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Revoke object URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  // Load voicemail transcript from system:voicemail note
  useEffect(() => {
    if (!callId) return
    setTranscriptLoading(true)
    setTranscriptError(false)

    listNotes({ callId, limit: 100 })
      .then(async ({ notes }) => {
        const vmNote = notes.find((n: EncryptedNote) => n.authorPubkey === 'system:voicemail')
        if (!vmNote) {
          setTranscript(null)
          return
        }

        const unlocked = await keyManager.isUnlocked()
        if (!hasNsec || !unlocked || !publicKey) {
          setTranscript(null)
          return
        }

        // Voicemail notes use per-note ECIES envelopes
        const envelope = isAdmin
          ? (vmNote.adminEnvelopes?.find((e) => e.pubkey === publicKey) ??
            vmNote.adminEnvelopes?.[0])
          : vmNote.authorEnvelope

        let text: string | null = null
        if (envelope && vmNote.encryptedContent) {
          const payload = await decryptNote(vmNote.encryptedContent, envelope)
          text = payload?.text ?? null
        }
        setTranscript(text)
      })
      .catch(() => setTranscriptError(true))
      .finally(() => setTranscriptLoading(false))
  }, [callId, hasNsec, publicKey, isAdmin])

  const fetchAudio = useCallback(async () => {
    if (!fileId || !canListen) return
    if (blobUrl) return // already loaded

    setAudioLoading(true)
    setAudioError(false)
    try {
      const unlocked = await keyManager.isUnlocked()
      if (!unlocked) throw new Error('Key not unlocked')

      const [content, { envelopes }] = await Promise.all([
        downloadFile(fileId),
        getFileEnvelopes(fileId),
      ])

      const myPubkey = publicKey ?? ''
      const envelope: FileKeyEnvelope | undefined = isAdmin
        ? (envelopes.find((e) => e.pubkey === myPubkey) ?? envelopes[0])
        : envelopes.find((e) => e.pubkey === myPubkey)

      if (!envelope) throw new Error('No key envelope found')

      // fileId is bound into the AAD — passing wrong fileId causes auth failure
      const { blob } = await decryptFile(content, envelope, fileId)
      const url = URL.createObjectURL(blob)
      setBlobUrl(url)
    } catch {
      setAudioError(true)
    } finally {
      setAudioLoading(false)
    }
  }, [fileId, canListen, blobUrl, publicKey, isAdmin])

  // Auto-play once blob URL is set after initial fetch
  // biome-ignore lint/correctness/useExhaustiveDependencies: only trigger on blobUrl change; playing/loading guard prevents double-play
  useEffect(() => {
    if (blobUrl && audioRef.current && !playing && !audioLoading) {
      audioRef.current
        .play()
        .then(() => setPlaying(true))
        .catch(() => {})
    }
  }, [blobUrl])

  const handlePlayPause = useCallback(async () => {
    if (!blobUrl) {
      await fetchAudio()
      return
    }
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      await audio.play()
      setPlaying(true)
    }
  }, [blobUrl, playing, fetchAudio])

  const handleEnded = useCallback(() => setPlaying(false), [])

  const showAudioPlayer = canListen && !!fileId

  return (
    <div data-testid="voicemail-player" className="space-y-2">
      {/* Always show a voicemail badge so the element is visible even without audio/transcript */}
      {!showAudioPlayer && !transcript && !transcriptLoading && (
        <Badge variant="secondary" className="gap-1" data-testid="voicemail-badge">
          <Voicemail className="h-3 w-3" />
          {t('voicemail.label', { defaultValue: 'Voicemail' })}
        </Badge>
      )}
      {showAudioPlayer && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePlayPause}
            disabled={audioLoading}
            data-testid="voicemail-play-btn"
          >
            {audioLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : playing ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {audioLoading
              ? t('recording.loading')
              : playing
                ? t('recording.pause')
                : t('recording.play')}
          </Button>

          {audioError && (
            <span className="flex items-center gap-1 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {t('recording.error')}
            </span>
          )}

          {blobUrl && (
            <audio
              ref={audioRef}
              src={blobUrl}
              onEnded={handleEnded}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              className="hidden"
            >
              <track kind="captions" />
            </audio>
          )}
        </div>
      )}

      {/* Transcript display */}
      {transcriptLoading && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('voicemail.loadingTranscript', { defaultValue: 'Loading transcript…' })}
        </div>
      )}

      {transcriptError && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {t('voicemail.transcriptError', { defaultValue: 'Could not load voicemail transcript' })}
        </div>
      )}

      {transcript && (
        <div
          className="flex items-start gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
          data-testid="voicemail-transcript"
        >
          <Voicemail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span>{transcript}</span>
        </div>
      )}
    </div>
  )
}
