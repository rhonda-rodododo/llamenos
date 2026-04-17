---
title: Mga Tampok
subtitle: Lahat ng kailangan ng isang platform para sa pagtugon sa krisis, sa isang open-source package. Boses, SMS, WhatsApp, Signal, at mga naka-encrypt na ulat — self-hosted para sa maximum na kontrol.
---

## Multi-Provider na Telepono

**5 voice provider** — Pumili mula sa Twilio, SignalWire, Vonage, Plivo, o self-hosted na Asterisk. I-configure ang iyong provider sa admin settings UI o sa panahon ng setup wizard. Maaaring magpalit ng provider anumang oras nang walang pagbabago sa code.

**WebRTC browser calling** — Maaaring sagutin ng mga volunteer ang mga tawag nang diretso sa browser nang walang telepono. Provider-specific na WebRTC token generation para sa Twilio, SignalWire, Vonage, at Plivo. Configurable na call preference bawat volunteer (telepono, browser, o pareho).

## Call Routing

**Sabay-sabay na pag-ring** — Kapag may tumatawag, sabay-sabay na nagi-ring ang lahat ng on-shift at hindi busy na volunteer. Ang unang sumagot ay makukuha ang tawag; ang iba ay titigil agad sa pag-ring.

**Shift-based scheduling** — Lumikha ng mga umuulit na shift na may tiyak na araw at oras. Magtalaga ng mga volunteer sa shift. Awtomatiko nang ireroute ng sistema ang mga tawag sa sinumang naka-duty.

**Queue na may hold music** — Kung lahat ng volunteer ay busy, pumapasok ang mga tumatawag sa queue na may configurable na hold music. Ang queue timeout ay maaaring i-adjust (30-300 segundo). Kapag walang sumagot, ang mga tawag ay mapupunta sa voicemail.

**Voicemail fallback** — Maaaring mag-iwan ng voicemail (hanggang 5 minuto) ang mga tumatawag kung walang sumagot na volunteer. Ang mga voicemail ay titranscribe sa pamamagitan ng Whisper AI at iencrypt para sa review ng admin.

## Encrypted na mga Tala

**End-to-end encrypted note-taking** — Nagsusulat ang mga volunteer ng mga tala habang at pagkatapos ng tawag. Ang mga tala ay iniencrypt sa client-side gamit ang ECIES (secp256k1 + XChaCha20-Poly1305) bago umalis sa browser. Ang server ay nag-iimbak lamang ng ciphertext.

**Dual encryption** — Bawat tala ay iniencrypt nang dalawang beses: minsan para sa volunteer na sumulat nito, at minsan para sa admin. Pareho silang maaaring mag-decrypt nang independyente. Walang iba pang maaaring basahin ang nilalaman.

**Custom fields** — Tinutukoy ng mga admin ang mga custom field para sa mga tala: text, number, select, checkbox, textarea. Ang mga field ay iniencrypt kasabay ng nilalaman ng tala.

**Draft auto-save** — Awtomatikong nai-save ang mga tala bilang naka-encrypt na draft sa browser. Kung mag-reload ang pahina o umalis ang volunteer, ang kanyang trabaho ay mapapanatili. Ang mga draft ay nililinis sa logout.

## AI Transcription

**On-device transcription** — Ang mga tawag ay titranscribe gamit ang AI na tumatakbo nang buo sa browser ng volunteer. Ang audio ay hindi kailanman umaalis sa device. Ang naka-encrypt na transcript lamang ang naiimbak.

**Admin at volunteer controls** — Maaaring i-enable o i-disable ng mga admin ang transcription nang pandaigdigan. Maaaring mag-opt out nang independyente ang mga volunteer. Parehong independyente ang mga toggle.

**Encrypted transcripts** — Ang mga transcript ay gumagamit ng parehong ECIES encryption tulad ng mga tala. Ang naiimbak na transcript ay ciphertext lamang.

## Spam Mitigation

**Voice CAPTCHA** — Opsyonal na voice bot detection: naririnig ng mga tumatawag ang isang randomized na 4-digit number at dapat itong ilagay sa keypad. Humaharang sa automated dialing habang nananatiling accessible sa mga tunay na tumatawag.

**Rate limiting** — Sliding-window rate limiting bawat numero ng telepono, nai-persist sa database. Ang mga configurable threshold ay nakaligtas sa mga restart.

**Real-time ban lists** — Namamahala ang mga admin sa mga ban list ng numero ng telepono na may single-entry o bulk import. Ang mga ban ay agad na nagkakaroon ng bisa. Ang mga banned na tumatawag ay naririnig ang isang rejection message.

**Custom IVR prompts** — Mag-record ng mga custom na voice prompt para sa bawat suportadong wika. Gumagamit ang sistema ng iyong mga recording para sa mga IVR flow, at bumabalik sa text-to-speech kapag walang recording.

## Multi-Channel Messaging

**SMS** — Inbound at outbound SMS messaging sa pamamagitan ng Twilio, SignalWire, Vonage, o Plivo. Auto-response na may configurable na welcome messages. Ang mga mensahe ay dumadaloy sa threaded na conversation view.

**WhatsApp Business** — Kumonekta sa pamamagitan ng Meta Cloud API (Graph API v21.0). Suporta sa template message para sa pagsisimula ng mga pakikipag-usap sa loob ng 24-oras na messaging window. Suporta sa media message para sa mga larawan, dokumento, at audio.

**Signal** — Privacy-focused messaging sa pamamagitan ng isang self-hosted na signal-cli-rest-api bridge. Health monitoring na may graceful degradation. Voice message transcription sa pamamagitan ng on-device na Whisper AI.

**Threaded conversations** — Lahat ng messaging channel ay dumadaloy sa isang unified na conversation view. Mga message bubble na may timestamp at direction indicator. Real-time updates. Lahat ng mensahe ay iniencrypt sa iyong server sa sandaling dumating. Ang server ay nag-iimbak lamang ng ciphertext.

## Encrypted na mga Ulat

**Reporter role** — Isang dedikadong role para sa mga taong nagpapasa ng mga tip o ulat. Ang mga reporter ay nakakakita ng isang simplified na interface na may mga ulat at tulong lamang. Inimbitahan sa pamamagitan ng parehong flow tulad ng mga volunteer, na may role selector.

**Encrypted submissions** — Ang nilalaman ng ulat ay iniencrypt gamit ang ECIES bago umalis sa browser. Ang mga plain text na pamagat ay para sa triage, ang naka-encrypt na nilalaman ay para sa privacy. Ang mga file attachment ay hiwalay na iniencrypt.

**Report workflow** — Mga kategorya para sa pag-oorganisa ng mga ulat. Status tracking (open, claimed, resolved). Maaaring i-claim ng mga admin ang mga ulat at tumugon na may threaded, naka-encrypt na mga reply.

## Contact Directory

**Encrypted contact records** — Iimbak ang impormasyon ng contact na may end-to-end encryption. Ang mga pangalan, numero ng telepono, email, at mga tala ay iniencrypt bago umalis sa browser.

**Relationship tracking** — I-link ang mga contact sa bawat isa at sa mga tawag, pakikipag-usap, at ulat. Bumuo ng isang larawan ng kung sino ang iyong tinutulungan.

**Auto-linking** — Awtomatikong iniuugnay ang mga papasok na tawag at mensahe sa mga kilalang contact sa pamamagitan ng pagtutugma ng mga numero ng telepono.

**Team-based access** — Kontrolin kung aling mga miyembro ng team ang makakakita ng aling contact. Ang mga pahintulot ay granular at configurable.

**Tags at intake** — I-organisa ang mga contact gamit ang mga tag. Ang mga intake workflow ay nagru-route ng mga bagong contact para sa review.

**Bulk import/export** — Mag-import ng mga contact mula sa CSV o JSON. Mag-export ng naka-encrypt na backup. Lahat ng processing ay nangyayari sa iyong browser.

## Configurable na mga Pahintulot

**Custom roles** — Tukuyin ang iyong sariling mga role na may eksaktong mga pahintulot na kailangan mo. Magsimula mula sa built-in templates (Admin, Volunteer, Reporter) o bumuo mula sa simula.

**Granular permissions** — Mahigit 90 na indibidwal na pahintulot sa 17 na feature area. Kontrolin kung sino ang maaaring tumingin, lumikha, mag-edit, at mag-delete sa isang pinong antas.

**Team scoping** — Italaga ang mga miyembro ng team sa mga team. Ang mga pahintulot ay maaaring i-scope sa mga tiyak na team, kaya ang iba't ibang grupo ay nakakakita ng iba't ibang data.

## Admin Dashboard

**Setup wizard** — Guided na multi-step setup sa unang admin login. Piliin kung aling mga channel ang ie-enable (Voice, SMS, WhatsApp, Signal, Reports), i-configure ang mga provider, at itakda ang pangalan ng iyong hotline.

**Getting Started checklist** — Dashboard widget na nagtutrack ng setup progress: channel configuration, volunteer onboarding, shift creation.

**Real-time monitoring** — Tingnan ang mga aktibong tawag, queued na tumatawag, mga pakikipag-usap, at status ng volunteer sa real time. Ang mga metric ay agad na nag-a-update.

**User management** — Mag-imbita ng mga bagong miyembro ng team sa pamamagitan ng mga secure link. Sila ang lumilikha ng kanilang sariling mga account at encryption keys. Pamahalaan ang mga role, pahintulot, at team assignment.

**Audit logging** — Bawat sagot sa tawag, nilikhang tala, naipadalang mensahe, naisumiteng ulat, binagong setting, at admin action ay nai-log. Paginated viewer para sa mga admin.

**Call history** — Searchable, filterable na call history na may date ranges, phone number search, at volunteer assignment. GDPR-compliant na data export.

**In-app help** — Mga seksyon ng FAQ, role-specific na mga gabay, quick reference cards para sa mga keyboard shortcut at seguridad. Accessible mula sa sidebar at command palette.

## Volunteer Experience

**Command palette** — Pindutin ang Ctrl+K (o Cmd+K sa Mac) para sa instant access sa navigation, search, mabilis na paglikha ng tala, at pagpapalit ng theme. Ang mga admin-only na command ay nafi-filter ayon sa role.

**Real-time notifications** — Ang mga papasok na tawag ay nag-trigger ng browser ringtone, push notification, at flashing na tab title. I-toggle nang independyente ang bawat uri ng notification sa settings.

**Volunteer presence** — Nakikita ng mga admin ang real-time na online, offline, at on-break count. Maaaring i-toggle ng mga volunteer ang break switch sa sidebar para pansamantalang ihinto ang mga papasok na tawag nang hindi umaalis sa kanilang shift.

**Keyboard shortcuts** — Pindutin ang ? para makita ang lahat ng available na shortcut. Mag-navigate sa mga pahina, buksan ang command palette, at gawin ang mga karaniwang aksyon nang hindi hinahawakan ang mouse.

**Note draft auto-save** — Awtomatikong nai-save ang mga tala bilang naka-encrypt na draft sa browser. Kung mag-reload ang pahina o umalis ang volunteer, ang kanyang trabaho ay mapapanatili. Ang mga draft ay nililinis mula sa localStorage sa logout.

**Encrypted data export** — I-export ang mga tala bilang isang GDPR-compliant na naka-encrypt na file (.enc) na protektado ng iyong multi-factor encryption key. Ang orihinal na autor lamang ang maaaring mag-decrypt ng export.

**Dark/light themes** — Mag-toggle sa pagitan ng dark mode, light mode, o sundin ang system theme. Ang preference ay nai-persist bawat session.

## Multi-Language at Mobile

**12+ na wika** — Kumpletong UI translations: English, Spanish, Chinese, Tagalog, Vietnamese, Arabic, French, Haitian Creole, Korean, Russian, Hindi, Portuguese, at German. RTL support para sa Arabic.

**Progressive Web App** — Mai-install sa anumang device sa pamamagitan ng browser. Ang service worker ay nagca-cache ng app shell para sa offline launch. Push notifications para sa mga papasok na tawag.

**Mobile-first design** — Responsive layout na idinisenyo para sa mga telepono at tablet. Collapsible sidebar, touch-friendly controls, at adaptive layouts.

## Authentication at Key Management

**Multi-factor key protection** — Ang iyong encryption key ay protektado ng hanggang tatlong independyenteng factor: isang PIN na pinili mo, ang iyong identity provider account, at opsyonal na isang hardware security key. Ang pag-compromise ng anumang isang factor ay hindi sapat.

**Identity provider integration** — Self-hosted na identity management (ikaw ang may kontrol). Invite-based onboarding — walang pagbabahagi ng mga secret key. Remote session revocation — i-lock out ang isang compromised device mula saanman.

**Automatic session management** — Ang mga session ay tahimik na nagre-refresh sa background. Ang idle auto-lock ay nagproprotekta sa mga walang bantay na device. Ang iyong encryption key ay nananatili sa isang isolated na proseso, hindi kailanman accessible sa pahina.

**Device linking** — I-set up ang mga bagong device nang ligtas. I-scan ang isang QR code o maglagay ng isang maikling provisioning code. Gumagamit ng ephemeral key exchange — ang iyong secret key ay hindi kailanman exposed sa panahon ng transfer.

**Recovery keys** — Sa panahon ng onboarding, tatanggap ka ng isang recovery key para sa mga emergency. Mandatory na naka-encrypt na backup bago ka makapagpatuloy.

**Hardware security keys** — Opsyonal na passkey support para sa phishing-resistant na login. Magrehistro ng isang hardware key o biometric, pagkatapos ay mag-sign in nang hindi nagta-type ng mga kredensyal.

**Per-note forward secrecy** — Bawat tala ay iniencrypt gamit ang isang natatanging random key, pagkatapos ay ang key na iyon ay naka-wrap sa pamamagitan ng ECIES para sa bawat awtorisadong mambabasa. Ang pag-compromise ng identity key ay hindi magreresulta sa pagbubunyag ng mga nakaraang tala.
