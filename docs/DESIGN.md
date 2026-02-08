# Design Notes

Original project design notes and threat model. These informed the architecture and feature set of Llámenos.

## Hotline Personas

- **Callers** — someone dialing into the hotline using a regular GSM phone line.
- **Volunteers** — the person on the receiving end of calls during their shift. They receive calls on their phone and use the webapp to log notes about each call. They can only see notes they wrote themselves.
- **Admins** — manage volunteers, shifts, contact info, ban lists, and all notes. Any volunteer can be promoted to admin. This is the most sensitive role.

## Threat Model

- **Potential adversaries**: nation states, right-wing groups, private hacking firms, other malicious actors. Most digital platforms are compelled to cooperate with these adversaries, so E2EE and zero-knowledge architecture is ideal.
- **What they're willing to spend**: a lot.
- **What they want access to**: personally identifying information of volunteers, activists calling in, and lead information on what they've witnessed — for strategic legal or operational advantage.

## Requirements That Shaped the Architecture

- **Low cost** — Twilio for telephony, Cloudflare free/paid tiers for hosting.
- **Automated shift routing** — recurring schedules with ring groups and fallback groups.
- **Volunteer identity protection** — personal info (name, phone) visible only to admins.
- **Call spam mitigation** — real-time ban lists, voice CAPTCHA, rate limiting.
- **Parallel ringing** — all on-shift volunteers ring simultaneously; first pickup wins.
- **E2EE transcription** — Whisper transcription encrypted so the server can never read it.
- **Audit logging** — every call answered, every note created, visible to admins only.
- **GDPR compliance** — EU parent org, data handling must comply.
