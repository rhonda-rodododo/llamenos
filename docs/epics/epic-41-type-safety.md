# Epic 41: Type Safety Improvements

## Problem
Several files use `as any` or `as unknown` casts that could be properly typed.

## Fixes

### `src/worker/routes/volunteers.ts:25`
`(body as any).pubkey` — Add proper type for the request body.

### `src/client/components/volunteer-multi-select.tsx:80`
`e as unknown as React.MouseEvent` — Fix event handler typing.

### `src/client/routes/volunteers_.$pubkey.tsx:248`
`as any` on i18n key — Use template literal type or type assertion helper.

### `src/client/routes/audit.tsx:83`
Same i18n `as any` pattern.

### `src/client/lib/webauthn.ts:53,80`
`as unknown as PublicKeyCredentialCreationOptionsJSON` — Version mismatch between server response and @simplewebauthn types. Fix with proper type mapping.

### `src/client/lib/webrtc.ts:110,149`
`as unknown as TwilioDevice` — SDK type mismatch. Define proper interface or use generic.

### Skip
- `src/client/routeTree.gen.ts` — auto-generated, don't touch

## Files
- Modify: 6 files (see list above)
