import { describe, expect, test } from 'bun:test'
import { escapeXml, FreeSwitchAdapter, getFliteVoice } from './freeswitch'

// Helper to create adapter instance for testing
function createAdapter(callbackBaseUrl = 'https://app.example.com'): FreeSwitchAdapter {
  return new FreeSwitchAdapter(
    '+15551234567',
    'https://bridge.example.com',
    'test-secret',
    callbackBaseUrl
  )
}

function _parseXml(body: string): string {
  return body
}

describe('FreeSwitchAdapter', () => {
  // --- XML document structure ---

  describe('emptyResponse', () => {
    test('returns valid mod_httapi document with empty work', () => {
      const adapter = createAdapter()
      const res = adapter.emptyResponse()
      expect(res.contentType).toBe('text/xml')
      expect(res.body).toContain('<document type="xml/freeswitch-httapi">')
      expect(res.body).toContain('<work>')
      expect(res.body).toContain('</work>')
      expect(res.body).toContain('</document>')
    })
  })

  describe('rejectCall', () => {
    test('returns hangup with CALL_REJECTED cause', () => {
      const adapter = createAdapter()
      const res = adapter.rejectCall()
      expect(res.contentType).toBe('text/xml')
      expect(res.body).toContain('<hangup cause="CALL_REJECTED"/>')
      expect(res.body).toContain('<document type="xml/freeswitch-httapi">')
    })
  })

  // --- Language menu ---

  describe('handleLanguageMenu', () => {
    test('single language auto-selects without digit capture', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleLanguageMenu({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        hotlineName: 'Test Hotline',
        enabledLanguages: ['es'],
      })
      expect(res.contentType).toBe('text/xml')
      expect(res.body).toContain('caller_lang=es')
      expect(res.body).toContain('call_phase=language_selected')
      // Should NOT contain bind (no digit capture needed)
      expect(res.body).not.toContain('<bind')
    })

    test('multiple languages generate speak prompts and digit capture', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleLanguageMenu({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        hotlineName: 'Test Hotline',
        enabledLanguages: ['en', 'es', 'fr'],
      })
      expect(res.contentType).toBe('text/xml')
      expect(res.body).toContain('<speak')
      expect(res.body).toContain('<bind')
      expect(res.body).toContain('/telephony/language-selected')
      expect(res.body).toContain('<pause')
    })

    test('hub ID is included in callback URL', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleLanguageMenu({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        hotlineName: 'Test Hotline',
        enabledLanguages: ['en', 'es'],
        hubId: 'hub-123',
      })
      expect(res.body).toContain('hub=hub-123')
    })
  })

  // --- Incoming call ---

  describe('handleIncomingCall', () => {
    test('rate limited caller gets speak + hangup', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleIncomingCall({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        voiceCaptchaEnabled: false,
        rateLimited: true,
        callerLanguage: 'en',
        hotlineName: 'Test Hotline',
      })
      expect(res.body).toContain('<speak')
      expect(res.body).toContain('<hangup/>')
      expect(res.body).not.toContain('<bind')
      expect(res.body).not.toContain('park')
    })

    test('CAPTCHA enabled generates bind for 4 digits', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleIncomingCall({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        voiceCaptchaEnabled: true,
        rateLimited: false,
        callerLanguage: 'en',
        hotlineName: 'Test Hotline',
        captchaDigits: '1234',
      })
      expect(res.body).toContain('1 2 3 4') // digits spoken individually
      expect(res.body).toContain('Please enter') // captchaPrompt text
      expect(res.body).toContain('<bind')
      expect(res.body).toContain('\\d{4}')
      expect(res.body).toContain('/telephony/captcha-response')
    })

    test('normal queue parks the caller', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleIncomingCall({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        voiceCaptchaEnabled: false,
        rateLimited: false,
        callerLanguage: 'en',
        hotlineName: 'Test Hotline',
      })
      expect(res.body).toContain('<speak')
      expect(res.body).toContain('park')
      expect(res.body).not.toContain('<hangup')
    })

    test('custom audio URLs use playback instead of speak', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleIncomingCall({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        voiceCaptchaEnabled: false,
        rateLimited: false,
        callerLanguage: 'en',
        hotlineName: 'Test Hotline',
        audioUrls: { 'connecting:en': 'https://cdn.example.com/connecting-en.mp3' },
      })
      expect(res.body).toContain('<playback')
      expect(res.body).toContain('https://cdn.example.com/connecting-en.mp3')
    })
  })

  // --- CAPTCHA response ---

  describe('handleCaptchaResponse', () => {
    test('correct digits parks the caller', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleCaptchaResponse({
        callSid: 'test-uuid',
        digits: '1234',
        expectedDigits: '1234',
        callerLanguage: 'en',
      })
      expect(res.body).toContain('park')
      expect(res.body).not.toContain('<hangup')
    })

    test('retry with remaining attempts generates new bind', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleCaptchaResponse({
        callSid: 'test-uuid',
        digits: '9999',
        expectedDigits: '1234',
        callerLanguage: 'en',
        remainingAttempts: 2,
        newCaptchaDigits: '5678',
      })
      expect(res.body).toContain('5 6 7 8')
      expect(res.body).toContain('<bind')
      expect(res.body).toContain('\\d{4}')
      expect(res.body).not.toContain('<hangup')
    })

    test('failed captcha hangs up', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleCaptchaResponse({
        callSid: 'test-uuid',
        digits: '9999',
        expectedDigits: '1234',
        callerLanguage: 'en',
      })
      expect(res.body).toContain('<hangup/>')
    })
  })

  // --- Call answered ---

  describe('handleCallAnswered', () => {
    test('bridges to parked caller via intercept', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleCallAnswered({
        parentCallSid: 'caller-uuid-123',
        callbackUrl: 'https://app.example.com/telephony/call-status',
        userPubkey: 'pub123',
      })
      expect(res.body).toContain('intercept')
      expect(res.body).toContain('caller-uuid-123')
    })
  })

  // --- Voicemail ---

  describe('handleVoicemail', () => {
    test('generates record element with default limit', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleVoicemail({
        callSid: 'test-uuid',
        callerLanguage: 'en',
        callbackUrl: 'https://app.example.com/telephony/voicemail-recording',
      })
      expect(res.body).toContain('<record')
      expect(res.body).toContain('limit="120"')
      expect(res.body).toContain('<speak')
    })

    test('custom max recording seconds', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleVoicemail({
        callSid: 'test-uuid',
        callerLanguage: 'en',
        callbackUrl: 'https://app.example.com/telephony/voicemail-recording',
        maxRecordingSeconds: 60,
      })
      expect(res.body).toContain('limit="60"')
    })
  })

  // --- Wait music ---

  describe('handleWaitMusic', () => {
    test('within timeout plays hold music', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleWaitMusic('en', undefined, 30, 90)
      expect(res.body).toContain('<speak')
      expect(res.body).not.toContain('transfer')
    })

    test('exceeded timeout triggers transfer to voicemail', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleWaitMusic('en', undefined, 95, 90)
      expect(res.body).toContain('transfer')
      expect(res.body).toContain('voicemail')
    })
  })

  // --- Voicemail complete + unavailable ---

  describe('handleVoicemailComplete', () => {
    test('speaks thank you and hangs up', () => {
      const adapter = createAdapter()
      const res = adapter.handleVoicemailComplete('en')
      expect(res.body).toContain('<speak')
      expect(res.body).toContain('<hangup/>')
    })
  })

  describe('handleUnavailable', () => {
    test('speaks unavailable message and hangs up', () => {
      const adapter = createAdapter()
      const res = adapter.handleUnavailable('es')
      expect(res.body).toContain('<speak')
      expect(res.body).toContain('<hangup/>')
    })
  })

  // --- XML escaping ---

  describe('escapeXml', () => {
    test('escapes all special XML characters', () => {
      expect(escapeXml('a & b < c > d " e \' f')).toBe('a &amp; b &lt; c &gt; d &quot; e &apos; f')
    })

    test('leaves normal text unchanged', () => {
      expect(escapeXml('Hello World 123')).toBe('Hello World 123')
    })
  })

  // --- getFliteVoice ---

  describe('getFliteVoice', () => {
    test('always returns slt (mod_flite limitation)', () => {
      expect(getFliteVoice('en')).toBe('slt')
      expect(getFliteVoice('es')).toBe('slt')
      expect(getFliteVoice('zh')).toBe('slt')
    })
  })
})
