---
title: "Setup: Asterisk (Self-Hosted)"
description: Step-by-step guide to deploy Asterisk with the ARI bridge for Llamenos.
---

Asterisk is an open-source telephony platform that you host on your own infrastructure. This gives you maximum control over your data and eliminates per-minute cloud fees. Llamenos connects to Asterisk via the Asterisk REST Interface (ARI).

This is the most complex setup option and is recommended for organizations with technical staff who can manage server infrastructure.

## Prerequisites

- A Linux server (Ubuntu 22.04+ or Debian 12+ recommended) with a public IP address
- A SIP trunk provider for PSTN connectivity (e.g., Telnyx, Flowroute, VoIP.ms)
- Your Llamenos instance deployed and accessible via a public URL
- Basic familiarity with Linux server administration

## 1. Install Asterisk

### Option A: Package manager (simpler)

```bash
sudo apt update
sudo apt install asterisk
```

### Option B: Docker (recommended for easier management)

```bash
docker pull asterisk/asterisk:20
docker run -d \
  --name asterisk \
  --network host \
  -v /etc/asterisk:/etc/asterisk \
  -v /var/lib/asterisk:/var/lib/asterisk \
  asterisk/asterisk:20
```

### Option C: Build from source (for custom modules)

```bash
wget https://downloads.asterisk.org/pub/telephony/asterisk/asterisk-20-current.tar.gz
tar xzf asterisk-20-current.tar.gz
cd asterisk-20.*/
./configure
make
sudo make install
sudo make samples
```

## 2. Configure the SIP trunk

Edit `/etc/asterisk/pjsip.conf` to add your SIP trunk provider. Here is an example configuration:

```ini
; SIP trunk to your PSTN provider
[trunk-provider]
type=registration
transport=transport-tls
outbound_auth=trunk-auth
server_uri=sip:sip.your-provider.com
client_uri=sip:your-account@sip.your-provider.com

[trunk-auth]
type=auth
auth_type=userpass
username=your-account
password=your-password

[trunk-endpoint]
type=endpoint
context=from-trunk
transport=transport-tls
disallow=all
allow=ulaw
allow=alaw
allow=opus
aors=trunk-aor
outbound_auth=trunk-auth

[trunk-aor]
type=aor
contact=sip:sip.your-provider.com
```

## 3. Enable ARI

ARI (Asterisk REST Interface) is how Llamenos controls calls on Asterisk.

Edit `/etc/asterisk/ari.conf`:

```ini
[general]
enabled=yes
pretty=yes

[llamenos]
type=user
read_only=no
password=your-strong-ari-password
```

Edit `/etc/asterisk/http.conf` to enable the HTTP server:

```ini
[general]
enabled=yes
bindaddr=0.0.0.0
bindport=8088
tlsenable=yes
tlsbindaddr=0.0.0.0:8089
tlscertfile=/etc/asterisk/keys/asterisk.pem
tlsprivatekey=/etc/asterisk/keys/asterisk.key
```

## 4. Configure the dialplan

Edit `/etc/asterisk/extensions.conf` to route incoming calls to the ARI application:

```ini
[from-trunk]
exten => _X.,1,NoOp(Incoming call from ${CALLERID(num)})
 same => n,Stasis(llamenos,incoming)
 same => n,Hangup()

[llamenos-outbound]
exten => _X.,1,NoOp(Outbound call to ${EXTEN})
 same => n,Stasis(llamenos,outbound)
 same => n,Hangup()
```

## 5. Deploy the ARI bridge service

The ARI bridge is a small service that translates between Llamenos webhooks and ARI events. It runs alongside Asterisk and connects to both the ARI WebSocket and your Llamenos Worker.

```bash
# The bridge service is included in the Llamenos repository
cd llamenos
bun run build:ari-bridge

# Run it
ASTERISK_ARI_URL=https://your-asterisk-server:8089/ari \
ASTERISK_ARI_USERNAME=llamenos \
ASTERISK_ARI_PASSWORD=your-strong-ari-password \
LLAMENOS_CALLBACK_URL=https://your-worker-url.com/telephony \
bun run ari-bridge
```

Or with Docker:

```bash
docker run -d \
  --name llamenos-ari-bridge \
  -e ASTERISK_ARI_URL=https://your-asterisk-server:8089/ari \
  -e ASTERISK_ARI_USERNAME=llamenos \
  -e ASTERISK_ARI_PASSWORD=your-strong-ari-password \
  -e LLAMENOS_CALLBACK_URL=https://your-worker-url.com/telephony \
  llamenos/ari-bridge
```

## 6. Configure in Llamenos

1. Log in as admin
2. Go to **Settings** > **Telephony Provider**
3. Select **Asterisk (Self-Hosted)** from the provider dropdown
4. Enter:
   - **ARI URL**: `https://your-asterisk-server:8089/ari`
   - **ARI Username**: `llamenos`
   - **ARI Password**: your ARI password
   - **Bridge Callback URL**: URL where the ARI bridge receives webhooks from Llamenos (e.g., `https://bridge.your-domain.com/webhook`)
   - **Phone Number**: your SIP trunk phone number (E.164 format)
5. Click **Save**

## 7. Test the setup

1. Restart Asterisk: `sudo systemctl restart asterisk`
2. Verify ARI is running: `curl -u llamenos:password https://your-server:8089/ari/asterisk/info`
3. Call your hotline number from a phone
4. Check the ARI bridge logs for connection and call events

## Security considerations

Running your own Asterisk server gives you full control, but also full responsibility for security:

### TLS and SRTP

Always enable TLS for SIP signaling and SRTP for media encryption:

```ini
; In pjsip.conf transport section
[transport-tls]
type=transport
protocol=tls
bind=0.0.0.0:5061
cert_file=/etc/asterisk/keys/asterisk.pem
priv_key_file=/etc/asterisk/keys/asterisk.key
method=tlsv1_2
```

Enable SRTP on endpoints:

```ini
[trunk-endpoint]
media_encryption=sdes
media_encryption_optimistic=yes
```

### Network isolation

- Place Asterisk in a DMZ or isolated network segment
- Use a firewall to restrict access:
  - SIP (5060-5061/tcp/udp): only from your SIP trunk provider
  - RTP (10000-20000/udp): only from your SIP trunk provider
  - ARI (8088-8089/tcp): only from the ARI bridge server
  - SSH (22/tcp): only from admin IPs
- Use fail2ban to protect against SIP scanning attacks

### Regular updates

Keep Asterisk updated to patch security vulnerabilities:

```bash
sudo apt update && sudo apt upgrade asterisk
```

## WebRTC with Asterisk

Asterisk supports WebRTC via its built-in WebSocket transport and SIP.js in the browser. This requires additional configuration:

1. Enable the WebSocket transport in `http.conf`
2. Create PJSIP endpoints for WebRTC clients
3. Configure DTLS-SRTP for media encryption
4. Use SIP.js on the client side (configured automatically by Llamenos when Asterisk is selected)

WebRTC setup with Asterisk is more involved than with cloud providers. See the [WebRTC Browser Calling](/docs/webrtc-calling) guide for details.

## Troubleshooting

- **ARI connection refused**: Verify that `http.conf` has `enabled=yes` and the bind address is correct.
- **No audio**: Check that RTP ports (10000-20000/udp) are open in your firewall and NAT is configured correctly.
- **SIP registration failures**: Verify your SIP trunk credentials and that DNS resolves your provider's SIP server.
- **Bridge not connecting**: Check that the ARI bridge can reach both the Asterisk ARI endpoint and your Llamenos Worker URL.
- **Call quality issues**: Ensure your server has sufficient bandwidth and low latency to the SIP trunk provider. Consider codecs (opus for WebRTC, ulaw/alaw for PSTN).
