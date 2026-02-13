---
title: Telephony Providers
description: Compare supported telephony providers and choose the best fit for your hotline.
---

Llamenos supports multiple telephony providers through its **TelephonyAdapter** interface. You can switch providers at any time from the admin settings without changing any application code.

## Supported providers

| Provider | Type | Pricing Model | WebRTC Support | Setup Difficulty | Best For |
|---|---|---|---|---|---|
| **Twilio** | Cloud | Per-minute | Yes | Easy | Getting started quickly |
| **SignalWire** | Cloud | Per-minute (cheaper) | Yes | Easy | Cost-conscious organizations |
| **Vonage** | Cloud | Per-minute | Yes | Medium | International coverage |
| **Plivo** | Cloud | Per-minute | Yes | Medium | Budget cloud option |
| **Asterisk** | Self-hosted | SIP trunk cost only | Yes (SIP.js) | Hard | Maximum privacy, at-scale deployment |

## Pricing comparison

Approximate per-minute costs for US voice calls (prices vary by region and volume):

| Provider | Inbound | Outbound | Phone Number | Free Tier |
|---|---|---|---|---|
| Twilio | $0.0085 | $0.014 | $1.15/month | Trial credit |
| SignalWire | $0.005 | $0.009 | $1.00/month | Trial credit |
| Vonage | $0.0049 | $0.0139 | $1.00/month | Free credit |
| Plivo | $0.0055 | $0.010 | $0.80/month | Trial credit |
| Asterisk | SIP trunk rate | SIP trunk rate | From SIP provider | N/A |

All cloud providers bill per minute with per-second granularity. Asterisk costs depend on your SIP trunk provider and server hosting.

## Feature support matrix

| Feature | Twilio | SignalWire | Vonage | Plivo | Asterisk |
|---|---|---|---|---|---|
| Call recording | Yes | Yes | Yes | Yes | Yes |
| Live transcription | Yes | Yes | Yes | Yes | Yes (via bridge) |
| Voice CAPTCHA | Yes | Yes | Yes | Yes | Yes |
| Voicemail | Yes | Yes | Yes | Yes | Yes |
| WebRTC browser calling | Yes | Yes | Yes | Yes | Yes (SIP.js) |
| Webhook validation | Yes | Yes | Yes | Yes | Custom (HMAC) |
| Parallel ringing | Yes | Yes | Yes | Yes | Yes |
| Queue / hold music | Yes | Yes | Yes | Yes | Yes |

## How to configure

1. Navigate to **Settings** in the admin sidebar
2. Open the **Telephony Provider** section
3. Select your provider from the dropdown
4. Enter the required credentials (each provider has different fields)
5. Set your hotline phone number in E.164 format (e.g., `+15551234567`)
6. Click **Save**
7. Configure webhooks in your provider's console to point to your Llamenos instance

See the individual setup guides for step-by-step instructions:

- [Setup: Twilio](/docs/setup-twilio)
- [Setup: SignalWire](/docs/setup-signalwire)
- [Setup: Vonage](/docs/setup-vonage)
- [Setup: Plivo](/docs/setup-plivo)
- [Setup: Asterisk (Self-Hosted)](/docs/setup-asterisk)
- [WebRTC Browser Calling](/docs/webrtc-calling)
