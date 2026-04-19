/**
 * MLS-specific TypeScript types for the client-side MLS integration.
 *
 * These types are used by MlsConversation, the crypto-worker RPC layer,
 * and the MLS API client. They represent the shapes that cross the
 * worker/main-thread boundary and the client/server boundary.
 */

/** Result of decrypting an MLS message via core-crypto. */
export interface MlsDecryptResult {
  /** Raw decrypted plaintext, or undefined for handshake messages (commits, proposals). */
  message: Uint8Array | undefined
  /** MLS client ID of the sender, or undefined for handshake messages. */
  senderClientId: string | undefined
  /** True when the message caused an epoch change (i.e. it was a commit). */
  hasEpochChanged: boolean
  /** False if processing this message removed us from the group. */
  isActive: boolean
}

/** Commit bundle captured from the MLS transport after add/remove/update operations. */
export interface MlsCommitBundle {
  /** TLS-serialized MLS Commit to fan out to existing members. */
  commit: Uint8Array
  /** TLS-serialized MLS Welcome for newly added members (undefined if no members added). */
  welcome: Uint8Array | undefined
  /** TLS-serialized GroupInfo for external joins. */
  groupInfo: Uint8Array | undefined
}
