import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import { KIND_CALL_VOICEMAIL } from '@shared/nostr-events'
import { Hono } from 'hono'
import {
  DEFAULT_LANGUAGE,
  detectLanguageFromPhone,
  languageFromDigit,
} from '../../shared/languages'
import { permissionGranted, resolvePermissions } from '../../shared/permissions'
import { getTelephony } from '../lib/adapters'
import { telephonyResponse } from '../lib/helpers'
import { publishNostrEvent } from '../lib/nostr-events'
import { startParallelRinging } from '../lib/ringing'
import { maybeTranscribe, transcribeVoicemail } from '../lib/transcription-manager'
import { storeVoicemailAudio } from '../lib/voicemail-storage'
import type { Services } from '../services'
import type { AppEnv, CallSettings } from '../types'
import type { Env } from '../types'

/**
 * Determine whether the call should go to voicemail, ring users, or play unavailable.
 * Single source of truth for the voicemail mode decision across all call entry points.
 */
async function checkVoicemailMode(
  services: Services,
  hubId: string | undefined
): Promise<{
  mode: 'auto' | 'always' | 'never'
  hasAvailableUsers: boolean
  callSettings: CallSettings
}> {
  const callSettings = await services.settings.getCallSettings(hubId)
  const mode = callSettings.voicemailMode ?? 'auto'
  if (mode === 'always') {
    return { mode, hasAvailableUsers: false, callSettings }
  }
  let onShift = await services.shifts.getEffectiveUsers(hubId)
  if (onShift.length === 0) {
    onShift = await services.settings.getFallbackGroup(hubId)
  }
  return { mode, hasAvailableUsers: onShift.length > 0, callSettings }
}

const telephony = new Hono<AppEnv>()

/** Build audio URL map from settings service */
async function buildAudioUrlMap(
  settings: Services['settings'],
  origin: string,
  hubId?: string
): Promise<Record<string, string>> {
  const recordings = await settings.getIvrAudioList(hubId)
  const map: Record<string, string> = {}
  for (const rec of recordings) {
    map[`${rec.promptType}:${rec.language}`] =
      `${origin}/api/ivr-audio/${rec.promptType}/${rec.language}`
  }
  return map
}

/** Get hub ID from query param */
function getHubId(url: URL): string | undefined {
  return url.searchParams.get('hub') || undefined
}

// Validate telephony webhook signature on all routes
telephony.use('*', async (c, next) => {
  const url = new URL(c.req.url)
  console.log(`[telephony] ${c.req.method} ${url.pathname}${url.search}`)
  const services = c.get('services')
  const hubId = getHubId(url)
  const env = c.env

  const adapter = await getTelephony(services.settings, hubId, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })

  // If no telephony provider is configured, return a helpful error
  if (!adapter) {
    return c.json(
      {
        error:
          'Telephony is not configured. Set up a voice provider in Admin Settings or the Setup Wizard.',
      },
      404
    )
  }

  const isDev = env.ENVIRONMENT === 'development'
  const isLocal =
    isDev && (c.req.header('CF-Connecting-IP') === '127.0.0.1' || url.hostname === 'localhost')
  if (!isLocal) {
    const isValid = await adapter.validateWebhook(c.req.raw)
    if (!isValid) {
      console.error(`[telephony] Webhook signature FAILED for ${url.pathname}`)
      return new Response('Forbidden', { status: 403 })
    }
  }
  await next()
})

// --- Step 1: Incoming call -> hub lookup -> ban check -> language menu ---
telephony.post('/incoming', async (c) => {
  const services = c.get('services')
  const env = c.env

  // Use global adapter to parse the webhook
  const globalAdapter = await getTelephony(services.settings, undefined, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!globalAdapter) return c.json({ error: 'Telephony not configured' }, 503)

  const { callSid, callerNumber, calledNumber } = await globalAdapter.parseIncomingWebhook(
    c.req.raw
  )
  console.log(
    `[telephony] /incoming callSid=${callSid} caller=***${callerNumber.slice(-4)} called=${calledNumber || 'unknown'}`
  )

  // Look up which hub owns the called phone number
  let hubId: string | undefined
  if (calledNumber) {
    const hub = await services.settings.getHubByPhone(calledNumber)
    if (hub) {
      hubId = hub.id
      console.log(`[telephony] /incoming resolved hub=${hubId} for calledNumber=${calledNumber}`)
    }
  }

  // Fall back to the sole hub when no phone mapping exists (single-hub deployments).
  // Only count active hubs here — archived/suspended hubs shouldn't count toward
  // the "sole hub" check, otherwise an operator who archives an old hub breaks
  // call routing on the remaining active one.
  if (!hubId) {
    const allHubs = await services.settings.getHubs()
    const activeHubs = allHubs.filter((h) => h.status === 'active')
    if (activeHubs.length === 1) {
      hubId = activeHubs[0].id
      console.log(`[telephony] /incoming defaulted to sole active hub=${hubId}`)
    }
  }

  // Use hub-scoped adapter for subsequent operations
  const adapter =
    (await getTelephony(services.settings, hubId, {
      TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
      TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
    })) ?? globalAdapter

  const banned = await services.records.isBanned(callerNumber, hubId)
  if (banned) {
    return telephonyResponse(adapter.rejectCall())
  }

  const enabledLanguages = await services.settings.getIvrLanguages(hubId)

  const response = await adapter.handleLanguageMenu({
    callSid,
    callerNumber,
    hotlineName: env.HOTLINE_NAME || 'Llamenos',
    enabledLanguages,
    hubId,
  })
  return telephonyResponse(response)
})

// --- Step 2: Language selected -> spam check -> greeting + hold/captcha ---
telephony.post('/language-selected', async (c) => {
  const url = new URL(c.req.url)
  let hubId = getHubId(url)
  const services = c.get('services')

  // Fall back to the sole hub when no hub param is present (single-hub deployments)
  if (!hubId) {
    const allHubs = await services.settings.getHubs()
    if (allHubs.length === 1) hubId = allHubs[0].id
  }
  const env = c.env
  const adapter = await getTelephony(services.settings, hubId, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return c.json({ error: 'Telephony not configured' }, 503)
  const { callSid, callerNumber, digits } = await adapter.parseLanguageWebhook(c.req.raw)
  const isAuto = url.searchParams.get('auto') === '1'

  let callerLanguage: string
  const forceLang = url.searchParams.get('forceLang')
  if (forceLang) {
    callerLanguage = forceLang
  } else if (isAuto) {
    callerLanguage = detectLanguageFromPhone(callerNumber)
  } else {
    callerLanguage = languageFromDigit(digits) ?? detectLanguageFromPhone(callerNumber)
  }

  const spamSettings = await services.settings.getSpamSettings(hubId)

  let rateLimited = false
  if (spamSettings.rateLimitEnabled) {
    rateLimited = await services.settings.checkRateLimit(
      `phone:${services.crypto.hmac(callerNumber, HMAC_PHONE_PREFIX)}`,
      spamSettings.maxCallsPerMinute
    )
  }

  // Generate CAPTCHA digits server-side with CSPRNG and store them
  let captchaDigits: string | undefined
  if (spamSettings.voiceCaptchaEnabled && !rateLimited) {
    const buf = new Uint8Array(2)
    crypto.getRandomValues(buf)
    captchaDigits = String(1000 + (((buf[0] << 8) | buf[1]) % 9000))
    // Store expected digits server-side (not in callback URL)
    await services.settings.storeCaptcha(callSid, captchaDigits)
  }

  const audioUrls = await buildAudioUrlMap(services.settings, new URL(c.req.url).origin, hubId)
  const response = await adapter.handleIncomingCall({
    callSid,
    callerNumber,
    voiceCaptchaEnabled: spamSettings.voiceCaptchaEnabled,
    rateLimited,
    callerLanguage,
    hotlineName: env.HOTLINE_NAME || 'Llamenos',
    audioUrls,
    captchaDigits,
    hubId,
  })

  if (!rateLimited && !spamSettings.voiceCaptchaEnabled) {
    const { mode, hasAvailableUsers, callSettings } = await checkVoicemailMode(services, hubId)

    if (mode === 'always' || (mode === 'auto' && !hasAvailableUsers)) {
      // Create call record before voicemail so the recording callback can resolve the hub
      await services.records
        .upsertCallRecord(callSid, hubId ?? 'global', {
          status: 'voicemail',
          callerLast4: callerNumber.slice(-4),
        })
        .catch((err) => console.error('[telephony] failed to create voicemail call record:', err))

      const vmResponse = await adapter.handleVoicemail({
        callSid,
        callerLanguage,
        callbackUrl: new URL(c.req.url).origin,
        audioUrls,
        maxRecordingSeconds: callSettings.voicemailMaxSeconds,
        hubId,
      })
      return telephonyResponse(vmResponse)
    }

    if (mode === 'never' && !hasAvailableUsers) {
      return telephonyResponse(adapter.handleUnavailable(callerLanguage, audioUrls))
    }

    // Normal flow — ring users
    const origin = new URL(c.req.url).origin
    console.log(
      `[telephony] /language-selected starting parallel ringing callSid=${callSid} origin=${origin} hub=${hubId || 'global'}`
    )
    startParallelRinging(callSid, callerNumber, origin, env, services, hubId).catch((err) =>
      console.error('[background]', err)
    )
  }

  return telephonyResponse(response)
})

// --- Step 3: CAPTCHA response ---
telephony.post('/captcha', async (c) => {
  const url = new URL(c.req.url)
  const hubId = getHubId(url)
  const services = c.get('services')
  const env = c.env
  const adapter = await getTelephony(services.settings, hubId, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return c.json({ error: 'Telephony not configured' }, 503)
  const { digits, callerNumber } = await adapter.parseCaptchaWebhook(c.req.raw)
  const callSid = url.searchParams.get('callSid') || ''
  const callerLang = url.searchParams.get('lang') || DEFAULT_LANGUAGE

  // Look up expected digits from server-side storage (not URL params)
  const spamSettings = await services.settings.getSpamSettings(hubId)
  const { match, expected, shouldRetry, remainingAttempts } = await services.settings.verifyCaptcha(
    callSid,
    digits,
    spamSettings.captchaMaxAttempts
  )

  // On retry, generate new CAPTCHA digits and store them
  let newCaptchaDigits: string | undefined
  if (shouldRetry) {
    const buf = new Uint8Array(2)
    crypto.getRandomValues(buf)
    newCaptchaDigits = String(1000 + (((buf[0] << 8) | buf[1]) % 9000))
    await services.settings.storeCaptcha(callSid, newCaptchaDigits, true)
  }

  const response = await adapter.handleCaptchaResponse({
    callSid,
    digits,
    expectedDigits: expected,
    callerLanguage: callerLang,
    hubId,
    remainingAttempts,
    newCaptchaDigits,
  })

  if (match) {
    const { mode, hasAvailableUsers, callSettings } = await checkVoicemailMode(services, hubId)

    if (mode === 'always' || (mode === 'auto' && !hasAvailableUsers)) {
      const audioUrls = await buildAudioUrlMap(services.settings, new URL(c.req.url).origin, hubId)
      const vmResponse = await adapter.handleVoicemail({
        callSid,
        callerLanguage: callerLang,
        callbackUrl: new URL(c.req.url).origin,
        audioUrls,
        maxRecordingSeconds: callSettings.voicemailMaxSeconds,
        hubId,
      })
      return telephonyResponse(vmResponse)
    }

    if (mode === 'never' && !hasAvailableUsers) {
      const audioUrls = await buildAudioUrlMap(services.settings, new URL(c.req.url).origin, hubId)
      return telephonyResponse(adapter.handleUnavailable(callerLang, audioUrls))
    }

    const origin = new URL(c.req.url).origin
    startParallelRinging(callSid, callerNumber, origin, env, services, hubId).catch((err) =>
      console.error('[background]', err)
    )
  }

  return telephonyResponse(response)
})

// --- Step 4: User answered -> bridge via queue ---
telephony.post('/user-answer', async (c) => {
  const url = new URL(c.req.url)
  const hubId = getHubId(url)
  const services = c.get('services')
  const env = c.env
  const adapter = await getTelephony(services.settings, hubId, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return c.json({ error: 'Telephony not configured' }, 503)
  const parentCallSid = url.searchParams.get('parentCallSid') || ''
  const pubkey = url.searchParams.get('pubkey') || ''

  await services.calls.updateActiveCall(
    parentCallSid,
    { assignedPubkey: pubkey, status: 'in-progress' },
    hubId
  )

  const [userInfo, activeCalls] = await Promise.all([
    services.identity.getUser(pubkey),
    services.calls.getActiveCalls(hubId),
  ])
  const callRecord = activeCalls.find((call) => call.callSid === parentCallSid)
  const callerLast4 = callRecord?.callerNumber?.slice(-4) || ''
  await services.records.addAuditEntry(hubId ?? 'global', 'callAnswered', pubkey, {
    callerLast4,
    userName: userInfo?.name,
  })

  const origin = new URL(c.req.url).origin
  const response = await adapter.handleCallAnswered({
    parentCallSid,
    callbackUrl: origin,
    userPubkey: pubkey,
    hubId,
  })
  return telephonyResponse(response)
})

// --- Step 5: Call status callback ---
telephony.post('/call-status', async (c) => {
  const url = new URL(c.req.url)
  let hubId = getHubId(url)
  const services = c.get('services')

  // Fall back to the sole hub when no hub param is present (single-hub deployments)
  if (!hubId) {
    const allHubs = await services.settings.getHubs()
    if (allHubs.length === 1) hubId = allHubs[0].id
  }
  const env = c.env
  const adapter = await getTelephony(services.settings, hubId, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return c.json({ error: 'Telephony not configured' }, 503)
  const { status: callStatus } = await adapter.parseCallStatusWebhook(c.req.raw)
  const parentCallSid = url.searchParams.get('parentCallSid') || ''

  console.log(
    `[call-status] status=${callStatus} parentCallSid=${parentCallSid} hub=${hubId || 'global'}`
  )

  if (
    callStatus === 'completed' ||
    callStatus === 'busy' ||
    callStatus === 'no-answer' ||
    callStatus === 'failed'
  ) {
    const pubkey = url.searchParams.get('pubkey') || ''
    if (callStatus === 'completed') {
      const activeCalls = await services.calls.getActiveCalls(hubId)
      const preCall = activeCalls.find((call) => call.callSid === parentCallSid)
      console.log(`[call-status] ending call ${parentCallSid}, found in active: ${!!preCall}`)

      try {
        await services.calls.deleteActiveCall(parentCallSid, hubId)
        console.log(`[call-status] ended call ${parentCallSid}`)

        const duration = preCall
          ? Math.floor((Date.now() - new Date(preCall.startedAt).getTime()) / 1000)
          : undefined
        await services.records.addAuditEntry(hubId ?? 'global', 'callEnded', pubkey, {
          callerLast4: preCall?.callerNumber?.slice(-4) || '',
          duration,
        })
      } catch {
        // Call may have already been ended by /call-recording
        console.log(`[call-status] call ${parentCallSid} already ended`)
      }
    }
  }

  return telephonyResponse(adapter.emptyResponse())
})

// --- Step 6: Wait music for queued callers ---
telephony.all('/wait-music', async (c) => {
  const url = new URL(c.req.url)
  const hubId = getHubId(url)
  const services = c.get('services')
  const env = c.env
  const adapter = await getTelephony(services.settings, hubId, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return c.json({ error: 'Telephony not configured' }, 503)
  const lang = url.searchParams.get('lang') || DEFAULT_LANGUAGE
  const queueTime =
    c.req.method === 'POST' ? (await adapter.parseQueueWaitWebhook(c.req.raw)).queueTime : 0
  const audioUrls = await buildAudioUrlMap(services.settings, new URL(c.req.url).origin, hubId)
  const callSettings = await services.settings.getCallSettings(hubId)
  const response = await adapter.handleWaitMusic(
    lang,
    audioUrls,
    queueTime,
    callSettings.queueTimeoutSeconds
  )
  return telephonyResponse(response)
})

// --- Step 7: Queue exit -> voicemail if no one answered ---
telephony.post('/queue-exit', async (c) => {
  const url = new URL(c.req.url)
  const hubId = getHubId(url)
  const services = c.get('services')
  const env = c.env
  const adapter = await getTelephony(services.settings, hubId, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return c.json({ error: 'Telephony not configured' }, 503)
  const { result: queueResult } = await adapter.parseQueueExitWebhook(c.req.raw)
  const callSid = url.searchParams.get('callSid') || ''
  const lang = url.searchParams.get('lang') || DEFAULT_LANGUAGE

  if (queueResult === 'hangup') {
    // Caller hung up while in queue — end the call as unanswered
    await services.calls
      .deleteActiveCall(callSid, hubId)
      .catch((err) => console.error('[telephony] failed to delete active call:', callSid, err))
    await services.records.addAuditEntry(hubId ?? 'global', 'callMissed', 'system', { callSid })
    return telephonyResponse(adapter.emptyResponse())
  }

  if (queueResult === 'leave' || queueResult === 'queue-full' || queueResult === 'error') {
    const audioUrls = await buildAudioUrlMap(services.settings, new URL(c.req.url).origin, hubId)
    const origin = new URL(c.req.url).origin
    const callSettings = await services.settings.getCallSettings(hubId)
    const response = await adapter.handleVoicemail({
      callSid,
      callerLanguage: lang,
      callbackUrl: origin,
      audioUrls,
      maxRecordingSeconds: callSettings.voicemailMaxSeconds,
      hubId,
    })
    return telephonyResponse(response)
  }

  return telephonyResponse(adapter.emptyResponse())
})

// --- Step 8: Voicemail recording complete ---
telephony.post('/voicemail-complete', async (c) => {
  const url = new URL(c.req.url)
  const hubId = getHubId(url)
  const services = c.get('services')
  const env = c.env
  const adapter = await getTelephony(services.settings, hubId, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return c.json({ error: 'Telephony not configured' }, 503)
  const lang = url.searchParams.get('lang') || DEFAULT_LANGUAGE
  return telephonyResponse(adapter.handleVoicemailComplete(lang))
})

// --- Step 9: Call recording status callback (bridged call recording) ---
telephony.post('/call-recording', async (c) => {
  const url = new URL(c.req.url)
  const hubId = getHubId(url)
  const services = c.get('services')
  const env = c.env
  const adapter = await getTelephony(services.settings, hubId, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return c.json({ error: 'Telephony not configured' }, 503)
  const { status: recordingStatus, recordingSid } = await adapter.parseRecordingWebhook(c.req.raw)
  const parentCallSid = url.searchParams.get('parentCallSid') || ''
  const pubkey = url.searchParams.get('pubkey') || ''

  if (recordingStatus === 'completed' && parentCallSid) {
    // Get call info before ending (for audit)
    const activeCalls = await services.calls.getActiveCalls(hubId)
    const callRecord = activeCalls.find((call) => call.callSid === parentCallSid)

    // Recording completed means the bridge ended — end the call
    // (safety net in case /call-status doesn't fire)
    try {
      await services.calls.deleteActiveCall(parentCallSid, hubId)
      console.log(`[call-recording] ended call ${parentCallSid}`)

      if (pubkey) {
        await services.records.addAuditEntry(hubId ?? 'global', 'callEnded', pubkey, {
          callerLast4: callRecord?.callerNumber?.slice(-4) || '',
        })
      }
    } catch {
      console.log(`[call-recording] call ${parentCallSid} already ended`)
    }

    if (recordingSid) {
      // Persist recording SID on the call record
      const existingRecord = await services.records.getCallRecord(parentCallSid, hubId)
      if (existingRecord) {
        await services.records.updateCallRecord(parentCallSid, hubId ?? 'global', {
          recordingSid,
          hasRecording: true,
        })
      }

      maybeTranscribe(parentCallSid, recordingSid, pubkey, hubId ?? 'global', env, services).catch(
        (err) => console.error('[background]', err)
      )
    }
  }

  return telephonyResponse(adapter.emptyResponse())
})

// --- Step 10: Voicemail recording status callback ---
telephony.post('/voicemail-recording', async (c) => {
  const url = new URL(c.req.url)
  let hubId = getHubId(url)
  const services = c.get('services')

  // Resolve hub from active call or call record, then fall back to sole hub
  const callSidFromUrl = url.searchParams.get('callSid') || ''
  if (!hubId && callSidFromUrl) {
    // Check active calls first (normal ringing flow)
    const allActiveCalls = await services.calls.getActiveCalls()
    const matchedCall = allActiveCalls.find((ac) => ac.callSid === callSidFromUrl)
    if (matchedCall) {
      hubId = matchedCall.hubId
    } else {
      // Check call records (voicemail-only flow creates a record before active call)
      const recordHubId = await services.records.findCallRecordHubId(callSidFromUrl)
      if (recordHubId) hubId = recordHubId
    }
  }
  if (!hubId) {
    const allHubs = await services.settings.getHubs()
    if (allHubs.length === 1) hubId = allHubs[0].id
  }
  const env = c.env
  const adapter = await getTelephony(services.settings, hubId, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return c.json({ error: 'Telephony not configured' }, 503)
  const { status: recordingStatus, recordingSid } = await adapter.parseRecordingWebhook(c.req.raw)
  const callSid = url.searchParams.get('callSid') || ''

  if (recordingStatus === 'completed') {
    await services.calls
      .updateActiveCall(callSid, { status: 'voicemail' }, hubId)
      .catch((err) => console.error('[telephony] failed to update voicemail status:', callSid, err))

    // Persist voicemail flag and recording SID to call_records (upsert — record may not exist yet)
    if (recordingSid) {
      await services.records
        .upsertCallRecord(callSid, hubId ?? 'global', {
          hasVoicemail: true,
          hasRecording: true,
          recordingSid,
        })
        .catch((err) =>
          console.error('[telephony] failed to persist voicemail record:', callSid, err)
        )
    }

    await services.records.addAuditEntry(hubId ?? 'global', 'voicemailReceived', 'system', {
      callSid,
    })

    // Store encrypted audio in object storage and delete from provider (background)
    if (recordingSid) {
      void (async () => {
        try {
          const settings = await services.settings.getCallSettings(hubId)
          // Get pubkeys for encryption — filter by voicemail:listen permission
          const allUsers = await services.identity.getUsers()
          const roleDefs = await services.settings.listRoles(hubId)
          const adminPubkeys = allUsers
            .filter((v) => {
              const perms = resolvePermissions(v.roles, roleDefs)
              return permissionGranted(perms, 'voicemail:listen')
            })
            .map((v) => v.pubkey)
          // Also include env.ADMIN_PUBKEY as fallback
          if (env.ADMIN_PUBKEY && !adminPubkeys.includes(env.ADMIN_PUBKEY)) {
            adminPubkeys.push(env.ADMIN_PUBKEY)
          }

          await storeVoicemailAudio({
            callSid,
            recordingSid,
            hubId: hubId ?? 'global',
            adminPubkeys,
            adapter,
            files: services.files,
            records: services.records,
            maxBytes: settings.voicemailMaxBytes,
            crypto: services.crypto,
          })

          // Publish voicemail Nostr event (hub-key encrypted, fire-and-forget)
          publishNostrEvent(
            env,
            KIND_CALL_VOICEMAIL,
            {
              type: 'call:voicemail',
              callSid,
              hubId: hubId ?? 'global',
              timestamp: Date.now(),
            },
            hubId
          )

          // Send Web Push to users with voicemail:notify permission
          const notifyPubkeys = allUsers
            .filter((v) => {
              const perms = resolvePermissions(v.roles, roleDefs)
              return permissionGranted(perms, 'voicemail:notify')
            })
            .map((v) => v.pubkey)

          if (notifyPubkeys.length > 0) {
            services.push
              .sendPushToUsers(
                notifyPubkeys,
                { type: 'voicemail', callSid, hubId: hubId ?? 'global' },
                env
              )
              .catch((err: unknown) => console.error('[push] voicemail notification failed:', err))
          }
        } catch (err) {
          console.error('[background] voicemail storage failed:', callSid, err)
        }
      })()
    }

    transcribeVoicemail(callSid, hubId ?? 'global', env, services).catch((err) =>
      console.error('[background]', err)
    )
  }

  return telephonyResponse(adapter.emptyResponse())
})

export default telephony
