/**
 * Server-side re-export of the OPAQUE server API.
 *
 * The OPAQUE WASM wrapper (`@serenity-kit/opaque`) is isomorphic —
 * it works in both browser and server environments. However, the
 * canonical typed wrapper lives at `src/client/lib/opaque-client.ts`
 * and server code must not import from `src/client/`. This module
 * re-exports only the server-side API.
 */

export { opaqueServer } from '../../client/lib/opaque-client'
