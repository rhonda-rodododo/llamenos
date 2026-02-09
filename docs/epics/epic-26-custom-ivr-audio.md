# Epic 26: Custom IVR Audio Recording

## Problem
The IVR (Interactive Voice Response) system uses Twilio's text-to-speech (`<Say>`) for all caller-facing prompts. This sounds robotic and impersonal. Admins should be able to record custom audio greetings per language for a more professional, human touch.

## Goals
1. Admin can record audio prompts per language via the browser (MediaRecorder API)
2. Recorded audio is stored server-side and served to Twilio via `<Play>` instead of `<Say>`
3. Fallback to TTS when no custom audio exists for a prompt/language
4. Admin can preview, re-record, and delete custom audio

## Architecture

### Audio Storage
- Store audio files in the SessionManager DO's storage as binary blobs
- Key format: `ivr-audio:{promptType}:{languageCode}` (e.g., `ivr-audio:greeting:es`)
- Audio format: WAV or MP3 (Twilio supports both; WAV is simpler from MediaRecorder)
- Max file size: 1MB per prompt (plenty for a 30-second greeting)

### Prompt Types
The following prompts can have custom audio (from `VOICE_PROMPTS` in twilio.ts):
- `greeting` — "Welcome to [hotline name]..." (most important)
- `pleaseHold` — "Connecting you to a volunteer..."
- `waitMessage` — "Your call is important to us..."
- `rateLimited` — "We're experiencing high call volume..."
- `captchaPrompt` — "Please enter the following digits..."

### API Endpoints (Admin Only)

#### `GET /settings/ivr-audio`
Returns list of uploaded audio with metadata:
```json
{
  "recordings": [
    { "promptType": "greeting", "language": "es", "size": 45000, "uploadedAt": "..." },
    { "promptType": "greeting", "language": "en", "size": 52000, "uploadedAt": "..." }
  ]
}
```

#### `PUT /settings/ivr-audio/:promptType/:language`
Upload audio file (binary body, `Content-Type: audio/wav` or `audio/mpeg`).
Validates: file size < 1MB, valid promptType, valid language code.

#### `GET /settings/ivr-audio/:promptType/:language`
Serve the audio file (used by Twilio `<Play>` URL and admin preview).
**Important**: This endpoint must be publicly accessible (no auth) for Twilio to fetch it during calls. Use a signed URL or unguessable path.

#### `DELETE /settings/ivr-audio/:promptType/:language`
Delete a custom recording, reverting to TTS fallback.

### Twilio Integration (`src/worker/telephony/twilio.ts`)

Modify prompt rendering to check for custom audio:
- Current: `<Say voice="..." language="...">${text}</Say>`
- New: If custom audio exists → `<Play>${audioUrl}</Play>`, else → `<Say>` (fallback)
- The `handleLanguageMenu()`, `handleIncomingCall()`, `handleWaitMusic()` methods need audio URL support
- Pass available audio URLs from the worker to TwilioAdapter methods

### Frontend: Settings Page

New "Voice Prompts" card (admin only) in Settings:
- Grid of prompt types x enabled languages
- Each cell shows: recorded (green check) or missing (gray dash)
- Click a cell to open a recording dialog:
  - "Record" button → starts MediaRecorder → browser mic capture
  - Waveform visualization (optional, stretch goal)
  - "Stop" button → preview playback
  - "Save" button → uploads to API
  - "Delete" button → removes custom audio
- Preview playback for existing recordings (HTML5 `<audio>` element)

### Frontend: Recording Component
- New component: `src/client/components/audio-recorder.tsx`
- Uses `navigator.mediaDevices.getUserMedia({ audio: true })`
- Records to WAV/WebM (MediaRecorder default varies by browser)
- Convert to WAV if needed for Twilio compatibility
- Max duration: 60 seconds (auto-stop)
- Show recording timer

## Files to Create/Modify

### New Files
- `src/client/components/audio-recorder.tsx` — reusable recording component

### Modified Files
- `src/worker/index.ts` — new IVR audio CRUD endpoints
- `src/worker/durable-objects/session-manager.ts` — audio blob storage routes
- `src/worker/telephony/twilio.ts` — `<Play>` vs `<Say>` logic
- `src/client/routes/settings.tsx` — Voice Prompts admin card
- `src/client/lib/api.ts` — IVR audio API functions
- `src/client/locales/*.json` — i18n keys for voice prompt UI

### i18n Keys
- `ivrAudio.title`, `ivrAudio.description`
- `ivrAudio.record`, `ivrAudio.stop`, `ivrAudio.preview`, `ivrAudio.save`, `ivrAudio.delete`
- `ivrAudio.recording`, `ivrAudio.noRecording`, `ivrAudio.uploaded`
- `ivrAudio.promptGreeting`, `ivrAudio.promptHold`, etc.
- `ivrAudio.maxDuration`, `ivrAudio.tooLarge`

## Security Considerations
- Audio upload endpoint: admin-only, file size validation
- Audio serve endpoint: needs to be accessible by Twilio without auth
  - Option A: Serve from a public path with unguessable ID (e.g., `/api/telephony/audio/<uuid>`)
  - Option B: Use Twilio's built-in audio hosting (upload to Twilio Media)
  - **Recommended: Option A** — simpler, keeps data in our control
- Audio content validation: check MIME type matches extension

## Acceptance Criteria
- [ ] Admin can see Voice Prompts card in Settings
- [ ] Admin can record audio for any prompt type in any enabled language
- [ ] Admin can preview recorded audio
- [ ] Admin can delete recorded audio (reverts to TTS)
- [ ] Twilio uses `<Play>` for prompts with custom audio
- [ ] Twilio falls back to `<Say>` for prompts without custom audio
- [ ] Audio files are persisted across worker restarts (DO storage)
- [ ] Audio serve endpoint works for Twilio playback
- [ ] All UI strings translated in 13 locales
- [ ] E2E test: admin records and previews audio
