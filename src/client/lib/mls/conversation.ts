/**
 * Thin wrapper around @wireapp/core-crypto MLS conversation API.
 *
 * SKELETON — no methods are implemented yet. MLS group lifecycle methods
 * (createConversation, addMembers, encryptMessage, decryptMessage) will be
 * added when the MLS feature flag is enabled.
 */

import { isMlsEnabled } from './core-crypto-loader'

export class MlsConversation {
  private constructor() {
    if (!isMlsEnabled()) {
      throw new Error('MLS is not enabled — set VITE_LLAMENOS_MLS_ENABLED=true')
    }
  }
}
