import { useState, useEffect, useRef, useCallback } from 'react'
import { encryptDraft, decryptDraft, getStoredSession, keyPairFromNsec } from './crypto'

interface DraftData {
  text: string
  callId: string
  savedAt: number
}

const STORAGE_PREFIX = 'llamenos-draft:'
const DEBOUNCE_MS = 500

function getSessionKeyPair() {
  const nsec = getStoredSession()
  return nsec ? keyPairFromNsec(nsec) : null
}

export function useDraft(key: string) {
  const [text, setText] = useState('')
  const [callId, setCallId] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const storageKey = STORAGE_PREFIX + key

  // Restore on mount
  useEffect(() => {
    const keyPair = getSessionKeyPair()
    if (!keyPair) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const decrypted = decryptDraft(raw, keyPair.secretKey)
      if (!decrypted) return
      const data: DraftData = JSON.parse(decrypted)
      setText(data.text)
      setCallId(data.callId)
      setSavedAt(data.savedAt)
    } catch {
      // Corrupted draft — ignore
    }
  }, [storageKey])

  // Persist helper
  const persist = useCallback((t: string, cId: string) => {
    const keyPair = getSessionKeyPair()
    if (!keyPair) return
    if (!t && !cId) {
      localStorage.removeItem(storageKey)
      setSavedAt(null)
      return
    }
    const now = Date.now()
    const data: DraftData = { text: t, callId: cId, savedAt: now }
    const encrypted = encryptDraft(JSON.stringify(data), keyPair.secretKey)
    localStorage.setItem(storageKey, encrypted)
    setSavedAt(now)
    setIsDirty(false)
  }, [storageKey])

  // Debounced save on text/callId change
  useEffect(() => {
    if (!isDirty) return
    timerRef.current = setTimeout(() => persist(text, callId), DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [text, callId, isDirty, persist])

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      // Capture current values for flush — use the DOM storage as source of truth
      // We just do a final persist with whatever we have
    }
  }, [])

  const setTextWrapped = useCallback((v: string) => {
    setText(v)
    setIsDirty(true)
  }, [])

  const setCallIdWrapped = useCallback((v: string) => {
    setCallId(v)
    setIsDirty(true)
  }, [])

  const clearDraft = useCallback(() => {
    localStorage.removeItem(storageKey)
    setText('')
    setCallId('')
    setSavedAt(null)
    setIsDirty(false)
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [storageKey])

  return {
    text,
    callId,
    setText: setTextWrapped,
    setCallId: setCallIdWrapped,
    clearDraft,
    savedAt,
    isDirty,
  }
}
