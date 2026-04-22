import { AlertCircle, FileText, Loader2, Pause, Play, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { getCallRecording } from '@/lib/api'
import { getClientTranscriptionSettings, TranscriptionManager } from '@/lib/transcription'

interface RecordingPlayerProps {
  callId: string
  onTranscriptReady?: (transcript: string) => void
}

export function RecordingPlayer({ callId, onTranscriptReady }: RecordingPlayerProps) {
  const { t } = useTranslation()
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [audioData, setAudioData] = useState<ArrayBuffer | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const managerRef = useRef<TranscriptionManager | null>(null)

  const isSupported = TranscriptionManager.isSupported()

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      managerRef.current?.dispose()
    }
  }, [blobUrl])

  const fetchRecording = useCallback(async () => {
    if (blobUrl) return // Already fetched
    setLoading(true)
    setError(false)
    try {
      const data = await getCallRecording(callId)
      setAudioData(data)
      const blob = new Blob([data], { type: 'audio/wav' })
      const url = URL.createObjectURL(blob)
      setBlobUrl(url)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [callId, blobUrl])

  const handlePlayPause = useCallback(async () => {
    if (!blobUrl) {
      await fetchRecording()
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
  }, [blobUrl, playing, fetchRecording])

  const handleEnded = useCallback(() => {
    setPlaying(false)
  }, [])

  const handleTranscribe = useCallback(async () => {
    if (!isSupported) return

    setTranscribing(true)
    setTranscriptionError(null)

    try {
      // Fetch audio if not already loaded
      let buffer = audioData
      if (!buffer) {
        buffer = await getCallRecording(callId)
        setAudioData(buffer)
        const blob = new Blob([buffer], { type: 'audio/wav' })
        setBlobUrl(URL.createObjectURL(blob))
      }

      // Get or create transcription manager
      if (!managerRef.current) {
        const settings = getClientTranscriptionSettings()
        managerRef.current = new TranscriptionManager({
          model: settings.model,
          language: settings.language,
        })
      }

      const text = await managerRef.current.transcribeAudioBuffer(buffer, 'audio/wav')
      setTranscript(text)
      onTranscriptReady?.(text)
    } catch (err) {
      setTranscriptionError(err instanceof Error ? err.message : t('recording.transcriptionFailed'))
    } finally {
      setTranscribing(false)
    }
  }, [audioData, callId, isSupported, onTranscriptReady, t])

  // Auto-play once blob URL is set after initial fetch
  // biome-ignore lint/correctness/useExhaustiveDependencies: only trigger on blobUrl change; playing/loading guard prevents double-play
  useEffect(() => {
    if (blobUrl && audioRef.current && !playing && loading === false) {
      audioRef.current
        .play()
        .then(() => setPlaying(true))
        .catch(() => {})
    }
  }, [blobUrl])

  if (error) {
    return (
      <div
        data-testid="recording-player"
        className="flex items-center gap-2 text-sm text-destructive"
      >
        <AlertCircle className="h-4 w-4" />
        {t('recording.error')}
      </div>
    )
  }

  return (
    <div data-testid="recording-player" className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handlePlayPause}
          disabled={loading}
          data-testid="recording-play-btn"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {loading ? t('recording.loading') : playing ? t('recording.pause') : t('recording.play')}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleTranscribe}
          disabled={transcribing || !isSupported || !!transcript}
          title={!isSupported ? t('recording.transcriptionNotSupported') : undefined}
          data-testid="transcribe-recording-btn"
        >
          {transcribing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
          {transcribing
            ? t('recording.transcribing')
            : transcript
              ? t('recording.transcribed')
              : t('recording.transcribe')}
        </Button>
      </div>

      {transcribing && (
        <div
          className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
          data-testid="transcription-local-indicator"
        >
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          {t('recording.transcribingLocally')}
        </div>
      )}

      {transcriptionError && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {transcriptionError}
        </div>
      )}

      {transcript && (
        <div
          className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
          data-testid="recording-transcript"
        >
          {transcript}
        </div>
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
  )
}
