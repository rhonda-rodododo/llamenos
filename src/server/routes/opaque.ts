/**
 * Tier 2 PR-A OPAQUE routes.
 *
 * All four endpoints live under `/api/opaque` and are authenticated —
 * a user only registers or unlocks OPAQUE records that belong to their
 * own pubkey. The credential identifier is always bound server-side to
 * `{authenticatedPubkey}:{purpose}` so a malicious client cannot start
 * a handshake against somebody else's record.
 *
 * Flow summary (per purpose):
 *
 *   registration/start  → client sends OPAQUE registration request;
 *                         server creates a registration response against
 *                         the purpose's ServerSetup and pins the pending
 *                         handshake to (pubkey, purpose) in the login
 *                         state cache.
 *   registration/finish → client sends the registration upload; server
 *                         calls finishRegistration, upserts the password
 *                         file row, and consumes the cached state.
 *   login/start         → client sends a credential request; server
 *                         starts the login against the stored password
 *                         file, stashes the OPAQUE state in the cache,
 *                         and returns the credential response.
 *   login/finish        → client sends the credential finalization;
 *                         server consumes the cached state and runs
 *                         finishLogin. Success signals that the client's
 *                         OPAQUE handshake produced a valid session key
 *                         on both sides, but the actual root-KEK unwrap
 *                         happens entirely client-side. The server never
 *                         retains the session key beyond discarding it;
 *                         a 200 here is purely a "handshake valid"
 *                         acknowledgement for the client's own bookkeeping.
 *
 * The server cannot derive any key material from these flows. Its
 * role is limited to: holding the ServerSetup, storing the opaque
 * password file, and participating in the handshake protocol.
 */

import { createRoute, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'
import {
  OpaqueLoginFinishRequestSchema,
  OpaqueLoginFinishResponseSchema,
  OpaqueLoginStartRequestSchema,
  OpaqueLoginStartResponseSchema,
  OpaqueRegistrationFinishRequestSchema,
  OpaqueRegistrationFinishResponseSchema,
  OpaqueRegistrationStartRequestSchema,
  OpaqueRegistrationStartResponseSchema,
} from '../../shared/schemas/opaque'
import { getDb } from '../db'
import { userOpaqueRecords } from '../db/schema/opaque'
import { consumeLoginState, createLoginState } from '../lib/login-state-cache'
import { opaqueServer } from '../lib/opaque-server'
import { getOrCreateServerSetup } from '../lib/opaque-server-setup'
import { createRouter } from '../lib/openapi'

const ErrorSchema = z.object({ error: z.string() }).strict()

const opaque = createRouter()

/**
 * Enforce that the client-declared credential identifier is `{pubkey}:{purpose}`
 * for the authenticated user. This is the single point where we refuse to
 * participate in a handshake aimed at somebody else's record.
 */
function assertBoundCredential(
  credentialIdentifier: string,
  pubkey: string,
  purpose: string
): boolean {
  return credentialIdentifier === `${pubkey}:${purpose}`
}

// ── POST /registration/start ────────────────────────────────────────────

const registrationStartRoute = createRoute({
  method: 'post',
  path: '/registration/start',
  tags: ['OPAQUE'],
  summary: 'Begin an OPAQUE registration',
  request: {
    body: {
      content: {
        'application/json': { schema: OpaqueRegistrationStartRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: 'Registration response ready',
      content: {
        'application/json': { schema: OpaqueRegistrationStartResponseSchema },
      },
    },
    400: {
      description: 'Credential identifier does not match authenticated user',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

opaque.openapi(registrationStartRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')

  if (!assertBoundCredential(body.credentialIdentifier, pubkey, body.purpose)) {
    return c.json({ error: 'credential identifier mismatch' }, 400)
  }

  const setup = await getOrCreateServerSetup(getDb(), body.purpose)
  const registrationResponse = await opaqueServer.createRegistrationResponse({
    setupBase64: setup,
    registrationRequestBase64: body.registrationRequest,
    credentialIdentifier: body.credentialIdentifier,
  })

  const sessionId = createLoginState({
    flow: 'registration',
    purpose: body.purpose,
    userPubkey: pubkey,
    credentialIdentifier: body.credentialIdentifier,
    state: '',
  })

  return c.json({ sessionId, registrationResponse }, 200)
})

// ── POST /registration/finish ───────────────────────────────────────────

const registrationFinishRoute = createRoute({
  method: 'post',
  path: '/registration/finish',
  tags: ['OPAQUE'],
  summary: 'Complete an OPAQUE registration',
  request: {
    body: {
      content: {
        'application/json': { schema: OpaqueRegistrationFinishRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: 'Password file stored',
      content: {
        'application/json': { schema: OpaqueRegistrationFinishResponseSchema },
      },
    },
    400: {
      description: 'Session expired, stolen, or not a registration flow',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

opaque.openapi(registrationFinishRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')

  const pending = consumeLoginState(body.sessionId)
  if (
    !pending ||
    pending.flow !== 'registration' ||
    pending.userPubkey !== pubkey ||
    pending.credentialIdentifier !== body.credentialIdentifier
  ) {
    return c.json({ error: 'invalid or expired session' }, 400)
  }

  const passwordFile = await opaqueServer.finishRegistration({
    uploadBase64: body.registrationUpload,
  })

  const now = new Date()
  await getDb()
    .insert(userOpaqueRecords)
    .values({
      userPubkey: pubkey,
      purpose: pending.purpose,
      credentialIdentifier: body.credentialIdentifier,
      passwordFile,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userOpaqueRecords.userPubkey, userOpaqueRecords.purpose],
      set: {
        credentialIdentifier: body.credentialIdentifier,
        passwordFile,
        updatedAt: now,
      },
    })

  return c.json({ ok: true as const, credentialIdentifier: body.credentialIdentifier }, 200)
})

// ── POST /login/start ───────────────────────────────────────────────────

const loginStartRoute = createRoute({
  method: 'post',
  path: '/login/start',
  tags: ['OPAQUE'],
  summary: 'Begin an OPAQUE login',
  request: {
    body: {
      content: {
        'application/json': { schema: OpaqueLoginStartRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: 'Credential response ready',
      content: {
        'application/json': { schema: OpaqueLoginStartResponseSchema },
      },
    },
    400: {
      description: 'Credential identifier does not match authenticated user',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'No password file registered for this purpose',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

opaque.openapi(loginStartRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')

  if (!assertBoundCredential(body.credentialIdentifier, pubkey, body.purpose)) {
    return c.json({ error: 'credential identifier mismatch' }, 400)
  }

  const db = getDb()
  const record = await db
    .select({ passwordFile: userOpaqueRecords.passwordFile })
    .from(userOpaqueRecords)
    .where(
      and(eq(userOpaqueRecords.userPubkey, pubkey), eq(userOpaqueRecords.purpose, body.purpose))
    )
    .limit(1)

  const existing = record[0]
  if (!existing) {
    return c.json({ error: 'no password file for this purpose' }, 404)
  }

  const setup = await getOrCreateServerSetup(db, body.purpose)
  const started = await opaqueServer.startLogin({
    setupBase64: setup,
    passwordFileBase64: existing.passwordFile,
    credentialRequestBase64: body.credentialRequest,
    credentialIdentifier: body.credentialIdentifier,
  })

  const sessionId = createLoginState({
    flow: 'login',
    purpose: body.purpose,
    userPubkey: pubkey,
    credentialIdentifier: body.credentialIdentifier,
    state: started.state,
  })

  return c.json({ sessionId, credentialResponse: started.message }, 200)
})

// ── POST /login/finish ──────────────────────────────────────────────────

const loginFinishRoute = createRoute({
  method: 'post',
  path: '/login/finish',
  tags: ['OPAQUE'],
  summary: 'Complete an OPAQUE login',
  request: {
    body: {
      content: {
        'application/json': { schema: OpaqueLoginFinishRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: 'Handshake valid',
      content: {
        'application/json': { schema: OpaqueLoginFinishResponseSchema },
      },
    },
    400: {
      description: 'Session expired, stolen, or not a login flow',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

opaque.openapi(loginFinishRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')

  const pending = consumeLoginState(body.sessionId)
  if (!pending || pending.flow !== 'login' || pending.userPubkey !== pubkey) {
    return c.json({ error: 'invalid or expired session' }, 400)
  }

  // finishLogin returns a 64-byte session key that the server
  // immediately discards. The caller uses the *export key* produced
  // client-side to unwrap its root KEK; the session key is only
  // proof-of-possession of the password, which is enough for the
  // server to say "handshake valid" via the 200 response.
  await opaqueServer.finishLogin({
    stateBase64: pending.state,
    credentialFinalizationBase64: body.credentialFinalization,
  })

  return c.json({ ok: true as const }, 200)
})

export default opaque
