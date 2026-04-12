/**
 * Thin wrapper around @wireapp/core-crypto MLS conversation API.
 *
 * This file is a SKELETON — no methods are implemented in PR #1.
 * PR #2 fills in the MLS group lifecycle: createConversation,
 * addMembers, encryptMessage, decryptMessage, etc.
 *
 * The wrapper exists so PR #2 has a clean place to land.
 */

import { isMlsEnabled } from './core-crypto-loader'

export class MlsConversation {
  private constructor() {
    if (!isMlsEnabled()) {
      throw new Error('MLS is not enabled — set VITE_LLAMENOS_MLS_ENABLED=true')
    }
  }
}
