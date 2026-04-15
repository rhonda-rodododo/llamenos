import { z } from 'zod/v4'

/** POST /api/auth/webauthn/login-verify */
export const WebAuthnLoginVerifySchema = z.object({
  assertion: z.unknown(),
  challengeId: z.string(),
})
type WebAuthnLoginVerifyInput = z.infer<typeof WebAuthnLoginVerifySchema>

/** POST /api/auth/invite/accept */
export const InviteAcceptSchema = z.object({
  code: z.string().min(1),
})
type InviteAcceptInput = z.infer<typeof InviteAcceptSchema>

/** POST /api/auth/demo-login */
export const DemoLoginSchema = z.object({
  pubkey: z.string().length(64),
})
type DemoLoginInput = z.infer<typeof DemoLoginSchema>

/** POST /api/auth/webauthn/register-verify */
export const WebAuthnRegisterVerifySchema = z.object({
  attestation: z.unknown(),
  label: z.string().min(1).max(64),
  challengeId: z.string(),
})
type WebAuthnRegisterVerifyInput = z.infer<typeof WebAuthnRegisterVerifySchema>
