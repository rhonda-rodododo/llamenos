import { useState, useEffect, useRef, useCallback } from 'react'
import { encryptDraft, decryptDraft, getStoredSession, keyPairFromNsec } from './crypto'

type FieldValues = Record<string, string | number | boolean>

interface DraftData {
  text: string
  callId: string
  fields: FieldValues
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
  const [fields, setFields] = useState<FieldValues>({})
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
      setFields(data.fields || {})
      setSavedAt(data.savedAt)
    } catch {
      // Corrupted draft — ignore
    }
  }, [storageKey])

  // Persist helper
  const persist = useCallback((t: string, cId: string, f: FieldValues) => {
    const keyPair = getSessionKeyPair()
    if (!keyPair) return
    const hasFields = Object.keys(f).length > 0
    if (!t && !cId && !hasFields) {
      localStorage.removeItem(storageKey)
      setSavedAt(null)
      return
    }
    const now = Date.now()
    const data: DraftData = { text: t, callId: cId, fields: f, savedAt: now }
    const encrypted = encryptDraft(JSON.stringify(data), keyPair.secretKey)
    localStorage.setItem(storageKey, encrypted)
    setSavedAt(now)
    setIsDirty(false)
  }, [storageKey])

  // Debounced save on text/callId/fields change
  useEffect(() => {
    if (!isDirty) return
    timerRef.current = setTimeout(() => persist(text, callId, fields), DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [text, callId, fields, isDirty, persist])

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
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

  const setFieldValue = useCallback((fieldId: string, value: string | number | boolean) => {
    setFields(prev => ({ ...prev, [fieldId]: value }))
    setIsDirty(true)
  }, [])

  const clearDraft = useCallback(() => {
    localStorage.removeItem(storageKey)
    setText('')
    setCallId('')
    setFields({})
    setSavedAt(null)
    setIsDirty(false)
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [storageKey])

  return {
    text,
    callId,
    fields,
    setText: setTextWrapped,
    setCallId: setCallIdWrapped,
    setFieldValue,
    clearDraft,
    savedAt,
    isDirty,
  }
}
