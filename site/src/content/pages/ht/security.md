---
title: Sekirite ak Vi Prive
subtitle: Sa ki pwoteje, sa ki vizib, ak sa ki ka rekipere anba yon subpoena — òganize dapre karakteristik ou itilize yo.
---

## Si founisè hosting ou a resevwa yon subpoena

| Yo KA bay | Yo PA KA bay |
|-----------|--------------|
| Metadone apèl/mesaj (lè, dire) | Kontni nòt, transkripsyon, kò rapò |
| Encrypted database blobs | Non volontè yo (chifre soti nan yon bout jiska lòt) |
| Ki kont volontè ki aktif kilè | Dosye reperwa kontak (chifre soti nan yon bout jiska lòt) |
| | Kontni mesaj (chifre konsa li rive, estoke kòm tèks chifre) |
| | Kle dekriptaj (pwoteje pa PIN ou a, kont founisè idantite ou a, ak opsyonèlman kle sekirite materyèl ou a) |
| | Kle chifreman pa nòt (efemè — detwi apre pake) |
| | Sekrè HMAC ou a pou envèse has telefòn |

**Sèvè a estoke done li pa ka li.** Metadone (kilè, konbyen tan, ki kont) vizib. Kontni (sa ki te di, sa ki te ekri, ki moun ki kontak ou yo) pa vizib.

---

## Dapre karakteristik

Ekspozisyon vi prive ou depann de ki chèn ou aktive yo:

### Apèl vwa

| Si ou itilize... | Aksè twazyèm pati posib | Aksè sèvè posib | Kontni chifre soti nan yon bout jiska lòt |
|------------------|--------------------------|-----------------|------------------------------------------|
| Twilio/SignalWire/Vonage/Plivo | Odio apèl la (an dirèk), dosye apèl | Metadone apèl | Nòt, transkripsyon |
| Asterisk ki self-hosted | Anyen (ou nan kontwòl) | Metadone apèl | Nòt, transkripsyon |
| Navigatè-a-navigatè (WebRTC) | Anyen | Metadone apèl | Nòt, transkripsyon |

**Subpoena founisè telefoni**: Yo gen detay sou apèl yo (lè, nimewo telefòn, dire). Yo PA gen nòt apèl oswa transkripsyon. Anrejistreman enfim pa default.

**Transkripsyon**: Transkripsyon an fèt nèt nan navigatè ou a lè l sèvi ak AI sou aparey. **Odio a pa janm kite aparey ou a.** Sèlman transkripsyon ki chifre estoke.

### Mesaj tèks

| Chèn | Aksè founisè | Estokaj sèvè | Remak |
|------|-------------|--------------|-------|
| SMS | Founisè telefoni ou a li tout mesaj yo | **Chifre** | Founisè a kenbe mesaj orijinal yo |
| WhatsApp | Meta li tout mesaj yo | **Chifre** | Founisè a kenbe mesaj orijinal yo |
| Signal | Rezo Signal la chifre soti nan yon bout jiska lòt, men pon an dekripte konsa li rive | **Chifre** | Pi bon pase SMS, men pa zewo-konesans |

**Mesaj yo chifre konsa yo rive sou sèvè ou a.** Sèvè a sèlman estoke tèks chifre a. Founisè telefoni oswa mesaj ou a ka toujou gen mesaj orijinal la — sa a se yon limitasyon nan platfòm sa yo, pa yon bagay nou ka chanje.

**Subpoena founisè mesaj**: Founisè SMS yo gen tout kontni mesaj la. Meta gen kontni WhatsApp la. Mesaj Signal yo chifre soti nan yon bout jiska lòt rive nan pon an, men pon an (ki kouri sou sèvè ou a) dekripte anvan li rechifre pou estokaj. Nan tout ka, **sèvè ou a gen sèlman tèks chifre** — founisè hosting la pa ka li kontni mesaj yo.

### Nòt, transkripsyon, ak rapò

Tout kontni ekri pa volontè chifre soti nan yon bout jiska lòt:

- Chak nòt itilize yon **kle o aza inik** (sekrè ki pwojekte pi devan — konpwomèt yon nòt pa konpwomèt lòt yo)
- Kle yo pake endepandaman pou volontè a ak chak admin
- Sèvè a sèlman estoke tèks chifre a
- Dekriptaj fèt nan navigatè a
- **Jàn espesyal yo, kontni rapò a, ak fichye atachman yo tout chifre endividyèlman**

**Saisi aparey**: San PIN ou a **AK** aksè nan kont founisè idantite ou a, atakan yo jwenn sèlman yon blob chifre ki enposib pou dekripte sou plan kalkil. Si ou itilize tou yon kle sekirite materyèl, **twa fakè endepandan** pwoteje done ou yo.

---

## Vi prive nimewo telefòn volontè yo

Lè volontè yo reponn apèl sou telefòn pèsonèl yo, nimewo yo ekspoze bay founisè telefoni ou a.

| Senaryo | Nimewo telefòn vizib pou |
|---------|-------------------------|
| Apèl PSTN sou telefòn volontè a | Founisè telefoni, opératè selilè |
| Navigatè-a-navigatè (WebRTC) | Pèsonn (odio a rete nan navigatè a) |
| Asterisk ki self-hosted + telefòn SIP | Sèlman sèvè Asterisk ou a |

**Pou pwoteje nimewo telefòn volontè yo**: Itilize apèl ki baze sou navigatè (WebRTC) oswa bay telefòn SIP ki konekte ak yon Asterisk ki self-hosted.

---

## Resanman lanse

Amelyorasyon sa yo aktif kounye a:

| Karakteristik | Benefis vi prive |
|---------------|-----------------|
| Estokaj mesaj chifre | Mesaj SMS, WhatsApp, ak Signal estoke kòm tèks chifre sou sèvè ou a |
| Transkripsyon sou aparey | Odio a pa janm kite navigatè ou a — trètman nèt sou aparey ou |
| Pwoteksyon kle an plizyè fakè | Kle chifreman ou pwoteje pa PIN ou a, founisè idantite, ak opsyonèlman kle sekirite materyèl |
| Kle sekirite materyèl | Kle fizikal yo ajoute yon twazyèm fakè ki pa ka konpwomète aletranje |
| Bild ki repwodui | Verifye ke kòd deplwaye a matche ak sous piblik la |
| Reperwa kontak chifre | Dosye kontak, relasyon, ak nòt chifre soti nan yon bout jiska lòt |

## Toujou prevwa

| Karakteristik | Benefis vi prive |
|---------------|-----------------|
| Aplikasyon natif pou resevwa apèl | Pa gen ekspozisyon nimewo telefòn pèsonèl |

---

## Tablo rezime

| Kalite done | Chifre | Vizib pou sèvè a | Ka rekipere anba subpoena |
|-------------|--------|-----------------|---------------------------|
| Nòt apèl | Wi (soti nan yon bout jiska lòt) | Non | Sèlman tèks chifre |
| Transkripsyon | Wi (soti nan yon bout jiska lòt) | Non | Sèlman tèks chifre |
| Rapò | Wi (soti nan yon bout jiska lòt) | Non | Sèlman tèks chifre |
| Fichye atachman | Wi (soti nan yan bout jiska lòt) | Non | Sèlman tèks chifre |
| Dosye kontak | Wi (soti nan yon bout jiska lòt) | Non | Sèlman tèks chifre |
| Idantite volontè | Wi (soti nan yon bout jiska lòt) | Non | Sèlman tèks chifre |
| Metadone ekip/wòl | Wi (chifre) | Non | Sèlman tèks chifre |
| Definisyon jàn espesyal | Wi (chifre) | Non | Sèlman tèks chifre |
| Kontni SMS/WhatsApp/Signal | Wi (sou sèvè ou a) | Non | Tèks chifre soti nan sèvè ou a; founisè a ka gen orijinal la |
| Metadone apèl | Non | Wi | Wi |
| Has telefòn moun ki rele | Has HMAC | Sèlman has | Has (pa envèse san sekrè ou a) |

---

## Pou ayditè sekirite

Dokimantasyon teknik:

- [Spesifikasyon pwotokòl](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/protocol/llamenos-protocol.md)
- [Modèl menas](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/THREAT_MODEL.md)
- [Klasifikasyon done](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/DATA_CLASSIFICATION.md)
- [Aydit sekirite](https://github.com/rhonda-rodododo/llamenos/tree/main/docs/security)
- [Dokimantasyon API](/api/docs)

Llamenos se open source: [github.com/rhonda-rodododo/llamenos](https://github.com/rhonda-rodododo/llamenos)
