/**
 * Stub for packages/crypto/dist/wasm/llamenos_core in PLAYWRIGHT_TEST builds.
 *
 * In test builds, platform.ts routes all crypto through the mocked invoke()
 * (useTauri === true because PLAYWRIGHT_TEST is set), so this module is never
 * actually called. It exists only to satisfy Rollup's module resolution.
 *
 * If somehow invoked at runtime, the functions throw clearly rather than
 * silently returning wrong results.
 */

const notAvailable = (name: string) => {
  throw new Error(`[test-stub] ${name} called outside WASM path — should not happen in test builds`)
}

export class WasmCryptoState {
  getPublicKey = () => notAvailable('getPublicKey') as never
  createAuthToken = () => notAvailable('createAuthToken') as never
  eciesUnwrapKey = () => notAvailable('eciesUnwrapKey') as never
  encryptNote = () => notAvailable('encryptNote') as never
  decryptNote = () => notAvailable('decryptNote') as never
  decryptLegacyNote = () => notAvailable('decryptLegacyNote') as never
  encryptMessage = () => notAvailable('encryptMessage') as never
  decryptMessage = () => notAvailable('decryptMessage') as never
  decryptCallRecord = () => notAvailable('decryptCallRecord') as never
  decryptTranscription = () => notAvailable('decryptTranscription') as never
  encryptDraft = () => notAvailable('encryptDraft') as never
  decryptDraft = () => notAvailable('decryptDraft') as never
  encryptExport = () => notAvailable('encryptExport') as never
  signNostrEvent = () => notAvailable('signNostrEvent') as never
  decryptFileMetadata = () => notAvailable('decryptFileMetadata') as never
  unwrapFileKey = () => notAvailable('unwrapFileKey') as never
  unwrapHubKey = () => notAvailable('unwrapHubKey') as never
  rewrapFileKey = () => notAvailable('rewrapFileKey') as never
  encryptNsecForProvisioning = () => notAvailable('encryptNsecForProvisioning') as never
  decryptProvisionedNsec = () => notAvailable('decryptProvisionedNsec') as never
  requestProvisioningToken = () => notAvailable('requestProvisioningToken') as never
  getNsec = () => notAvailable('getNsec') as never
  importKey = () => notAvailable('importKey') as never
  unlockWithPin = () => notAvailable('unlockWithPin') as never
  lock = () => notAvailable('lock')
  isUnlocked = () => notAvailable('isUnlocked') as never
}

export const generateKeypair = () => notAvailable('generateKeypair') as never
export const getPublicKeyFromSecret = () => notAvailable('getPublicKeyFromSecret') as never
export const createAuthTokenStateless = () => notAvailable('createAuthTokenStateless') as never
export const eciesWrapKey = () => notAvailable('eciesWrapKey') as never
export const isValidNsec = () => notAvailable('isValidNsec') as never
export const keyPairFromNsec = () => notAvailable('keyPairFromNsec') as never
export const verifySchnorr = () => notAvailable('verifySchnorr') as never
export default async function init(): Promise<void> { notAvailable('init') }
