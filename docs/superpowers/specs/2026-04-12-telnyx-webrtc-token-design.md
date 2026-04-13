# Telnyx WebRTC Token — Design

**Status:** approved (autonomous loop — no user review)
**Author:** Claude (autonomous overnight backlog)
**Date:** 2026-04-12
**Scope:** Fill the `generateWebRtcToken` stub for Telnyx at
`src/server/telephony/webrtc-tokens.ts:34` so that self-hosters who pick
Telnyx as their telephony provider can use browser calling via the
`@telnyx/webrtc` SDK.

## Context

Five of the seven telephony providers already generate WebRTC login
tokens (Twilio, SignalWire, Vonage, Plivo, Asterisk, FreeSWITCH). The
existing switch in `generateWebRtcToken` throws for Telnyx and Bandwidth.
This spec covers **Telnyx only**. Bandwidth is deferred — its Voice SDK
uses a different permissioning model (BXML-scoped) and warrants its own
brainstorm pass.

The Telnyx test fixture at `webrtc-tokens.test.ts:203-213` currently
asserts the stub throws `'Telnyx WebRTC not yet implemented'`. That
assertion will be replaced with positive tests for the new generator.

## Telnyx WebRTC authentication model

From the Telnyx v2 API and `@telnyx/webrtc` SDK docs (fetched via
context7 2026-04-12):

1. A **SIP Connection** (credential or FQDN) represents the trunk the
   caller authenticates against. Created once, kept in provider config
   as `sipConnectionId`.
2. A **Telephony Credential** (`POST /v2/telephony_credentials`) is an
   on-demand, short-lived credential bound to a SIP Connection via
   `connection_id`. Telnyx generates random `sip_username` /
   `sip_password` server-side; we never see them.
3. A **login_token** is a JWT minted from a specific telephony
   credential via `POST /v2/telephony_credentials/{id}/token`. The
   endpoint returns the JWT as a plain-text response body. This is what
   the browser SDK passes as `login_token` to `new TelnyxRTC({ ... })`.

Each `generateWebRtcToken` call creates a fresh credential + token pair.
Per-request cost is 2 API round trips; acceptable because token requests
happen at most once per user session per TTL. Credentials default to
expire 2 years out on Telnyx's side; they accumulate if never cleaned
up, but that's a pure accounting issue, not a security one — the SIP
credentials themselves never leave Telnyx.

## Schema changes

`src/shared/schemas/providers.ts`:

```ts
export const TelnyxConfigSchema = BaseProviderSchema.extend({
  type: z.literal('telnyx'),
  apiKey: z.string().min(1),
  texmlAppId: z.string().optional(),
  sipConnectionId: z.string().optional(), // required for WebRTC
  webrtcEnabled: z.boolean().optional(),
})
```

Both new fields are `optional()` to stay backward-compatible with
existing Telnyx configs that only use the REST/TeXML path. Runtime
checks inside `generateTelnyxToken` and `isWebRtcConfigured` enforce
that both are set when WebRTC is actually used.

## Token generator

`src/server/telephony/webrtc-tokens.ts`:

```ts
async function generateTelnyxToken(
  config: TelnyxConfig,
  identity: string
): Promise<{ token: string; provider: TelephonyProviderType; ttl: number }> {
  if (!config.apiKey || !config.sipConnectionId) {
    throw new Error(
      'Missing Telnyx WebRTC config: apiKey, sipConnectionId'
    )
  }

  const base =
    ((config as Record<string, unknown>)._testBaseUrl as string | undefined) ??
    'https://api.telnyx.com'
  const authHeaders = { Authorization: `Bearer ${config.apiKey}` }

  // 1. Create an on-demand telephony credential bound to the SIP connection.
  const createRes = await fetch(`${base}/v2/telephony_credentials`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      connection_id: config.sipConnectionId,
      name: `llamenos-${identity}-${Math.floor(Date.now() / 1000)}`,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!createRes.ok) {
    throw new Error(`Telnyx create telephony_credential failed: HTTP ${createRes.status}`)
  }
  const createData = (await createRes.json()) as { data?: { id?: string } }
  const credId = createData.data?.id
  if (!credId) throw new Error('Telnyx telephony_credential response missing id')

  // 2. Mint a login JWT for that credential.
  const tokenRes = await fetch(`${base}/v2/telephony_credentials/${credId}/token`, {
    method: 'POST',
    headers: { ...authHeaders, Accept: 'text/plain' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!tokenRes.ok) {
    throw new Error(`Telnyx telephony_credential/token failed: HTTP ${tokenRes.status}`)
  }
  const token = (await tokenRes.text()).trim()
  if (!token) throw new Error('Telnyx telephony_credential/token returned empty body')

  return { token, provider: 'telnyx', ttl: 3600 }
}
```

## isWebRtcConfigured

```ts
case 'telnyx':
  return !!(config.webrtcEnabled && config.apiKey && config.sipConnectionId)
```

## Tests

`webrtc-tokens.test.ts`:

- **Happy path** — mock `fetch` via `_testBaseUrl` + a scoped stub; assert
  - POST to `/v2/telephony_credentials` carries correct body + Bearer
  - POST to `/v2/telephony_credentials/<id>/token` carries Bearer
  - Returned `{ token: '<jwt>', provider: 'telnyx', ttl: 3600 }`
  - `identity` is embedded in the credential `name`
- **Missing apiKey** — throws `'Missing Telnyx WebRTC'`
- **Missing sipConnectionId** — throws `'Missing Telnyx WebRTC'`
- **Create credential HTTP 401** — throws `'Telnyx create telephony_credential'`
- **Token fetch HTTP 500** — throws `'Telnyx telephony_credential/token'`
- **Empty token body** — throws `'empty body'`
- `isWebRtcConfigured` — 4 cases: fully configured, missing webrtcEnabled, missing apiKey, missing sipConnectionId.
- Replace the existing "not yet implemented" assertion.

`fetch` mocking: use `globalThis.fetch` override inside a
`describe`/`beforeEach`/`afterEach` block so each test gets a fresh
stub without leaking into other provider tests.

## Out of scope

- Bandwidth WebRTC (separate backlog item, separate brainstorm).
- Credential cleanup / TTL enforcement on the Telnyx side (credentials
  expire naturally; accounting concern only).
- UI for configuring `sipConnectionId` in the provider settings form
  (the schema change makes the field available; the form components
  will surface it incrementally as part of provider-settings work).
- `telnyxCapabilities.ts` — not touched; capability flag
  `supportsWebRtc: true` already declared, no runtime change needed.
