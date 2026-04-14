/**
 * React hooks for decrypt-on-fetch pattern.
 *
 * Takes API response data with encrypted envelope fields and returns
 * a decrypted copy. Shows server fallbacks immediately, triggers async
 * worker decryption, and re-renders with decrypted values.
 */

import { type CryptoLabel, LABEL_USER_PII } from '@shared/crypto-labels'
import { useEffect, useRef, useState } from 'react'
import { decryptArrayFields, decryptCache, decryptObjectFields } from './decrypt-fields'
import * as keyManager from './key-manager'

/**
 * Decrypt encrypted fields on a single object.
 * Returns the input immediately, then re-renders with decrypted values.
 */
export function useDecryptedObject<T extends object>(
  data: T | null,
  label: CryptoLabel = LABEL_USER_PII
): T | null {
  const [decrypted, setDecrypted] = useState<T | null>(data)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Decrypt when data changes
  useEffect(() => {
    if (!data) {
      setDecrypted(null)
      return
    }
    setDecrypted(data)

    void (async () => {
      const isUnlocked = await keyManager.isUnlocked()
      if (!isUnlocked || !mountedRef.current) return
      const pubkey = await keyManager.getPublicKeyHex()
      if (!pubkey || !mountedRef.current) return

      const copy = { ...data } as Record<string, unknown>
      await decryptObjectFields(copy, pubkey, label)
      if (mountedRef.current) setDecrypted(copy as T)
    })()
  }, [data, label])

  // Re-decrypt on key unlock
  useEffect(() => {
    const unsubscribe = keyManager.onUnlock(() => {
      if (!data) return
      void (async () => {
        const pubkey = await keyManager.getPublicKeyHex()
        if (!pubkey || !mountedRef.current) return
        const copy = { ...data } as Record<string, unknown>
        await decryptObjectFields(copy, pubkey, label)
        if (mountedRef.current) setDecrypted(copy as T)
      })()
    })
    return unsubscribe
  }, [data, label])

  // Clear cache + revert on lock
  useEffect(() => {
    return keyManager.onLock(() => {
      decryptCache.clear()
      if (data && mountedRef.current) setDecrypted(data)
    })
  }, [data])

  return decrypted
}

/**
 * Decrypt encrypted fields on an array of objects.
 * Same pattern: immediate render with raw data, re-render with decrypted.
 */
export function useDecryptedArray<T extends object>(
  data: T[],
  label: CryptoLabel = LABEL_USER_PII
): T[] {
  const [decrypted, setDecrypted] = useState<T[]>(data)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    setDecrypted(data)

    void (async () => {
      const isUnlocked = await keyManager.isUnlocked()
      if (!isUnlocked || !mountedRef.current) return
      const pubkey = await keyManager.getPublicKeyHex()
      if (!pubkey || !mountedRef.current) return

      const copy = data.map((item) => ({ ...item })) as Record<string, unknown>[]
      await decryptArrayFields(copy, pubkey, label)
      if (mountedRef.current) setDecrypted(copy as T[])
    })()
  }, [data, label])

  useEffect(() => {
    const unsubscribe = keyManager.onUnlock(() => {
      void (async () => {
        const pubkey = await keyManager.getPublicKeyHex()
        if (!pubkey || !mountedRef.current) return
        const copy = data.map((item) => ({ ...item })) as Record<string, unknown>[]
        await decryptArrayFields(copy, pubkey, label)
        if (mountedRef.current) setDecrypted(copy as T[])
      })()
    })
    return unsubscribe
  }, [data, label])

  useEffect(() => {
    return keyManager.onLock(() => {
      decryptCache.clear()
      if (mountedRef.current) setDecrypted(data)
    })
  }, [data])

  return decrypted
}
