---
title: Admin Guide
description: Manage everything — volunteers, shifts, call settings, ban lists, and custom fields.
---

As an admin, you manage everything: volunteers, shifts, call settings, ban lists, and custom fields. This guide covers the key admin workflows.

## Logging in

Log in with the `nsec` (Nostr secret key) generated during [setup](/docs/getting-started). The login page accepts the nsec format (`nsec1...`). Your browser signs a challenge with the key — the secret never leaves the device.

Optionally, register a WebAuthn passkey in Settings for passwordless login on additional devices.

## Managing volunteers

Navigate to **Volunteers** in the sidebar to:

- **Add a volunteer** — generates a new Nostr keypair. Share the nsec securely with the volunteer (it's shown once).
- **Create an invite link** — generates a one-time link that a volunteer can use to self-register.
- **Edit** — update name, phone number, and role.
- **Remove** — deactivate a volunteer's access.

Volunteer phone numbers are only visible to admins. They're used for parallel ringing when the volunteer is on shift.

## Configuring shifts

Navigate to **Shifts** to create recurring schedules:

1. Click **Add Shift**
2. Set a name, select days of the week, and set start/end times
3. Assign volunteers using the searchable multi-select
4. Save — the system will automatically route calls to volunteers on the active shift

Configure a **Fallback Group** at the bottom of the shifts page. These volunteers will ring when no scheduled shift is active.

## Ban lists

Navigate to **Bans** to manage blocked phone numbers:

- **Single entry** — type a phone number in E.164 format (e.g., +15551234567)
- **Bulk import** — paste multiple numbers, one per line
- **Remove** — unban a number instantly

Bans take effect immediately. Banned callers hear a rejection message and are disconnected.

## Call settings

In **Settings**, you'll find several sections:

### Spam mitigation

- **Voice CAPTCHA** — toggle on/off. When enabled, callers must enter a random 4-digit code.
- **Rate limiting** — toggle on/off. Limits calls per phone number within a sliding time window.

### Transcription

- **Global toggle** — enable/disable Whisper transcription for all calls.
- Individual volunteers can also opt out via their own settings.

### Call settings

- **Queue timeout** — how long callers wait before going to voicemail (30-300 seconds).
- **Voicemail max duration** — maximum recording length (30-300 seconds).

### Custom note fields

Define structured fields that appear in the note-taking form:

- Supported types: text, number, select (dropdown), checkbox, textarea
- Configure validation: required, min/max length, min/max value
- Control visibility: choose which fields volunteers can see and edit
- Reorder fields using up/down arrows
- Maximum 20 fields, maximum 50 options per select field

Custom field values are encrypted alongside note content. The server never sees them.

### Voice prompts

Record custom IVR audio prompts for each supported language. The system uses your recordings for greeting, CAPTCHA, queue, and voicemail flows. Where no recording exists, it falls back to text-to-speech.

### WebAuthn policy

Optionally require passkeys for admins, volunteers, or both. When required, users must register a passkey before they can use the app.

## Audit log

The **Audit Log** page shows a chronological list of system events: logins, call answers, note creation, setting changes, and admin actions. Entries include hashed IP addresses and country metadata. Use pagination to browse history.

## Call history

The **Calls** page shows all calls with status, duration, and volunteer assignment. Filter by date range or search by phone number. Export data in GDPR-compliant JSON format.
