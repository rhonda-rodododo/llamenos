# Asterisk ARI Bridge for Llamenos

A standalone service that runs alongside Asterisk and translates ARI (Asterisk REST Interface) events into HTTP webhooks for the Llamenos Cloudflare Worker. This enables self-hosted telephony using Asterisk as an alternative to Twilio, SignalWire, Vonage, or Plivo.

## Architecture

```
                    ┌──────────────┐
  SIP Trunk ──────► │   Asterisk   │
  (Incoming calls)  │   Server     │
                    │              │
                    │  Stasis App  │
                    │  "llamenos"  │
                    └──────┬───────┘
                           │ ARI WebSocket (events)
                           │ ARI REST API (commands)
                           ▼
                    ┌──────────────┐
                    │  ARI Bridge  │  ◄── This service
                    │  (Bun/Node)  │
                    └──────┬───────┘
                           │ HMAC-signed HTTP webhooks
                           │ (form-urlencoded, Twilio-compatible format)
                           ▼
                    ┌──────────────┐
                    │  Cloudflare  │
                    │  Worker      │
                    │  (Llamenos)  │
                    └──────────────┘
```

### How it works

1. Incoming SIP calls hit Asterisk, which routes them to the `llamenos` Stasis application via the dialplan.
2. The bridge service receives `StasisStart` events via the ARI WebSocket.
3. The bridge sends an HTTP POST to the CF Worker's `/api/telephony/incoming` endpoint, formatted as form-urlencoded data matching Twilio's webhook format (`CallSid`, `From`, `To`).
4. The Worker responds with TwiML (its standard response format).
5. The bridge parses the TwiML and translates it into ARI REST API calls (play audio, gather DTMF, bridge channels, record, etc.).
6. Subsequent events (DTMF, hangup, recording complete) trigger more webhooks to the Worker, continuing the call flow.

## Setup

### Prerequisites

- **Asterisk 18+** with ARI enabled
- **Bun 1.0+** (or Node.js 20+ with minor adjustments)
- A SIP trunk from any provider (Telnyx, Flowroute, VoIP.ms, etc.)
- The Llamenos CF Worker deployed and accessible

### 1. Configure Asterisk

Copy the sample configs to your Asterisk server:

```bash
cp asterisk-config/ari.conf /etc/asterisk/ari.conf
cp asterisk-config/http.conf /etc/asterisk/http.conf
cp asterisk-config/extensions.conf /etc/asterisk/extensions.conf
cp asterisk-config/pjsip.conf /etc/asterisk/pjsip.conf
```

Edit each file:
- `ari.conf`: Change the `password` for the `llamenos` user
- `pjsip.conf`: Configure your SIP trunk credentials
- `http.conf`: Enable TLS in production

Restart Asterisk:
```bash
asterisk -rx "core restart now"
```

### 2. Configure the Bridge

Create a `.env` file:

```bash
ARI_URL=ws://localhost:8088/ari/events
ARI_REST_URL=http://localhost:8088/ari
ARI_USERNAME=llamenos
ARI_PASSWORD=changeme
WORKER_WEBHOOK_URL=https://your-worker.example.com
BRIDGE_SECRET=your-shared-secret-here
BRIDGE_PORT=3000
STASIS_APP=llamenos
HOTLINE_NUMBER=+15551234567
```

### 3. Run the Bridge

**Development:**
```bash
cd asterisk-bridge
bun install
bun run dev
```

**Production (Docker):**
```bash
docker build -t llamenos-bridge .
docker run -d \
  --name llamenos-bridge \
  --env-file .env \
  --network host \
  -p 3000:3000 \
  llamenos-bridge
```

### 4. Configure Worker

In the Llamenos admin panel, set the telephony provider to "Asterisk (Self-Hosted)" and enter:
- **ARI URL**: The bridge's public URL (e.g., `https://bridge.example.com`)
- **ARI Username**: `llamenos`
- **ARI Password**: Your ARI password
- **Phone Number**: Your SIP trunk DID number

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check with active call count |
| GET | `/status` | Detailed status including Asterisk info |
| POST | `/command` | Execute a bridge command (signed) |
| POST | `/ring` | Initiate parallel volunteer ringing (signed) |
| POST | `/cancel-ringing` | Cancel ringing channels (signed) |
| POST | `/hangup` | Hang up a channel (signed) |
| GET | `/recordings/:name` | Download a recording audio file |

All POST endpoints require HMAC-SHA256 signature in the `X-Bridge-Signature` header.

## Event-to-Webhook Mapping

| ARI Event | Worker Webhook | Purpose |
|-----------|---------------|---------|
| `StasisStart` | `/api/telephony/incoming` | New incoming call |
| `ChannelDtmfReceived` | `/api/telephony/language-selected` or `/api/telephony/captcha` | Digit input |
| `ChannelStateChange` | `/api/telephony/call-status` | Call status updates |
| `StasisEnd` | `/api/telephony/call-status` (completed) | Call ended |
| `RecordingFinished` | `/api/telephony/call-recording` or `/api/telephony/voicemail-recording` | Recording done |
| `ChannelHangupRequest` | `/api/telephony/queue-exit` (hangup) | Caller hung up in queue |

## TwiML Translation

The Worker responds with TwiML, which the bridge translates to ARI commands:

| TwiML | ARI Action |
|-------|-----------|
| `<Say>` | `POST /channels/{id}/play` (TTS or pre-rendered audio) |
| `<Play>` | `POST /channels/{id}/play` (media URI) |
| `<Gather>` | Play prompt + listen for DTMF events |
| `<Enqueue>` | Music on hold + periodic wait callbacks |
| `<Dial><Queue>` | Create bridge + add channels |
| `<Record>` | `POST /channels/{id}/record` |
| `<Hangup>` | `DELETE /channels/{id}` |
| `<Reject>` | `DELETE /channels/{id}` with busy cause |
| `<Redirect>` | Send new webhook to the specified path |
| `<Leave>` | Exit queue, trigger voicemail flow |

## Security

- All webhooks from bridge to Worker are signed with HMAC-SHA256
- All commands from Worker to bridge require HMAC-SHA256 signature
- The shared secret (`BRIDGE_SECRET`) must match on both sides
- ARI credentials should be strong and unique
- In production, use TLS for the ARI connection (`wss://`) and HTTP server
- The bridge should run on the same network as Asterisk (not exposed to the internet)
- Only the Worker webhook URL needs to be reachable from the bridge

## TTS Considerations

Asterisk does not have built-in high-quality TTS like Twilio. Options:

1. **Pre-render audio files**: Generate audio for all prompts in all languages offline and serve via HTTP. The bridge maps `<Say>` to pre-rendered files.
2. **Asterisk TTS module**: Install `app_festival`, `res_speech_google`, or `res_aeap` for live TTS.
3. **External TTS API**: The bridge could call Google Cloud TTS / AWS Polly / Azure TTS on the fly and cache results.

The current implementation logs TTS text and plays a placeholder beep. For production, implement one of the above strategies.
