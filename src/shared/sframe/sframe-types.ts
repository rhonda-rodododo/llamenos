declare const __CiphertextBytesBrand: unique symbol
declare const __PlaintextBytesBrand: unique symbol

/** Raw RTP payload bytes that have been sealed via SFrame / AES-GCM. */
export type CiphertextBytes = Uint8Array & { readonly [__CiphertextBytesBrand]: never }

/** Raw RTP payload bytes that have NOT been sealed — plaintext audio. */
export type PlaintextBytes = Uint8Array & { readonly [__PlaintextBytesBrand]: never }

/** Runtime identity; the brand exists only at compile time. */
export const asCiphertextBytes = (bytes: Uint8Array): CiphertextBytes => bytes as CiphertextBytes

export const asPlaintextBytes = (bytes: Uint8Array): PlaintextBytes => bytes as PlaintextBytes
