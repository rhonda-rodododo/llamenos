declare const __CiphertextBytesBrand: unique symbol
declare const __PlaintextBytesBrand: unique symbol
declare const __SealedFrameBrand: unique symbol

/** Raw RTP payload bytes that have been sealed via SFrame / AES-GCM. */
export type CiphertextBytes = Uint8Array & { readonly [__CiphertextBytesBrand]: never }

/** Raw RTP payload bytes that have NOT been sealed — plaintext audio. */
export type PlaintextBytes = Uint8Array & { readonly [__PlaintextBytesBrand]: never }

/**
 * Complete sealed SFrame wire buffer: `[ codec header ][ ciphertext+tag ][ trailer ]`.
 *
 * This is the output of `sealFrame()` and the required input of `openFrame()`.
 * Passing a raw RTP payload (unprocessed frame bytes) to `openFrame()` is a
 * compile-time error — the caller must either produce this via `sealFrame()` or
 * brand incoming network bytes with `asSealedFrame()`.
 */
export type SealedFrame = Uint8Array & { readonly [__SealedFrameBrand]: never }

/** Runtime identity; the brand exists only at compile time. */
export const asCiphertextBytes = (bytes: Uint8Array): CiphertextBytes => bytes as CiphertextBytes

export const asPlaintextBytes = (bytes: Uint8Array): PlaintextBytes => bytes as PlaintextBytes

/**
 * Brand incoming network bytes as a `SealedFrame`.
 *
 * Use this only at trust boundaries where bytes arrive from the network
 * (i.e. they were produced by a remote `sealFrame()` call). Never use this
 * to paper over a raw RTP payload that hasn't been sealed.
 */
export const asSealedFrame = (bytes: Uint8Array): SealedFrame => bytes as SealedFrame
