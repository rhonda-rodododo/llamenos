---
title: Ewlehî û Nepeniya Kesane
subtitle: Çi tê parastin, çi tê dîtin, û çi dikare binêr sibpoenayê bê girtin — li gorî taybetmendiyên ku tu bi kar tînî hatiye rêz kirin.
---

## Heke peydawerê hostingê te sibpoenayê bistîne

| Ew DIKARIN pêşkêş bikin | Ew NAKARIN pêşkêş bikin |
|-------------------------|--------------------------|
| Metadata bang/peyam (dem, dirêjî) | Naveroka nîştekan, transkrîpsiyon, naveroka raporan |
| Blobên databasê yên şîfrekirî | Navên dilxwazan (end-to-end encrypted) |
| Kîjan hesabên dilxwazan çaxê çalak bûn | Tomarên pelê têkiliyan (end-to-end encrypted) |
| | Naveroka peyaman (dema ku tê şîfrekirin, wekî ciphertext tê tomarkirin) |
| | Kilîdên decryptkirinê (bi PIN-a te, hesabê peydawerê nasnameya te û bi vebijarkî kilîda ewlehiya hardware ve tê parastin) |
| | Kilîdên şîfrekirinê yên her nîştekê (demkî — piştî pakirinê têne hilweşandin) |
| | Sirê HMAC-ya te ji bo valakirina hashên telefonê |

**Server daneyên ku nikare bixwîne tomar dike.** Metadata (kengî, çiqas, kîjan hesab) tê dîtin. Naverok (çi hatiye gotin, çi hatiye nivîsandin, kîjan têkiliyên te ne) nayê dîtin.

---

## Li gorî taybetmendiyê

Eşkerekirina te ya nepenî li ser wê yekê ye ka kîjan kanalên te çalak in:

### Bangên dengî

| Ger tu bi kar bînî... | Gihiştina sêyemîn partiyê | Gihiştina serverê | Naveroka end-to-end encrypted |
|-----------------------|---------------------------|-------------------|-------------------------------|
| Twilio/SignalWire/Vonage/Plivo | Dengê bangê (zindî), tomarên bangê | Metadata bangê | Nîştek, transkrîpsiyon |
| Asterîska xwe-hostkirî | Tiştek (di bin kontrola te de) | Metadata bangê | Nîştek, transkrîpsiyon |
| Gerok-ber-gerok (WebRTC) | Tiştek | Metadata bangê | Nîştek, transkrîpsiyon |

**Sibpoenaya peydawerê telefoniyê**: Tomarên hûragiri yên bangê (dem, numreyên telefonê, dirêjî) li wan hene. NÎŞTEK an TRANSKRÎPSIYONÊN bangê li wan NÎNE. Tomarkirin bi default neçalak e.

**Transkrîpsiyon**: Transkrîpsiyon bi tevahî di geroka te de bi AI-ya li ser cîhazê pêk tê. **Deng qet cîhaza te terk nake.** Tenê transkrîpsiyona şîfrekirî tê tomarkirin.

### Peyamên nivîsî

| Kanal | Gihiştina peydawer | Tomarkirina serverê | Nîşe |
|-------|-------------------|---------------------|------|
| SMS | Peydawerê te yê telefoniyê hemû peyam dixwîne | **Şîfrekirî** | Peydawer peyamên orjînal diparêze |
| WhatsApp | Meta hemû peyam dixwîne | **Şîfrekirî** | Peydawer peyamên orjînal diparêze |
| Signal | Torê Signal end-to-end encrypted e, lê pir dema ku tê deşîfre dike | **Şîfrekirî** | Ji SMS çêtir e, lê zero-knowledge nîne |

**Peyaman dema ku tên ser serverê te tên şîfrekirin.** Server tenê ciphertext tomar dike. Peydawerê telefonî an peyamê te dibe ku hîn jî peyama orjînal hebe — ev sînorê wan platforman e, ne tiştek ku em bikarin biguherînin.

**Sibpoenaya peydawerê peyamê**: Peydawerên SMS-ê naveroka temamî ya peyamê li xwe didin. Meta naveroka WhatsApp-ê li xwe dike. Peyamên Signal-ê heta pirê end-to-end encrypted in, lê pir (li ser serverê te diçe) berî ku ji bo tomarkirinê dîsa were şîfrekirin deşîfre dibe. Di hemû rewşan de, **serverê te tenê ciphertext heye** — peydawerê hostingê nikare naveroka peyaman bixwîne.

### Nîştek, transkrîpsiyon û rapor

Hemû naveroka ku ji hêla dilxwazan ve hatiye nivîsandin end-to-end encrypted e:

- Her nîştek ji **kilîdeke keture ya taybet** sûd werdigire (forward secrecy — têkbirina nîştekê yên din nateqîzîne)
- Kilîd ji bo dilxwaz û her rêvebirekî bi serê xwe tên pakirin
- Server tenê ciphertext tomar dike
- Decryptkirin di gerokê de pêk tê
- **Qadên kesane, naveroka raporan û pêvekên pelê bi serê xwe tên şîfrekirin**

**Sitandina cîhazê**: Bêyî PIN-a te **Û** gihiştina hesabê peydawerê nasnameya te, êrîşkar tenê blobek şîfrekirî werdigire ku bihesabî nayê decryptkirin. Ger tu her weha kilîdeke ewlehiya hardware bi kar bînî, **sê faktorên serbixwe** daneyên te diparêzin.

---

## Nepeniya numreyê telefonê yê dilxwazê

Dema ku dilxwaz bersiva bangan li ser telefonên xweyên kesane didin, numreyên wan ji peydawerê telefonî yê te re eşkere dibin.

| Senaryo | Numreya telefonê ji bo kê tê dîtin |
|---------|-------------------------------------|
| Banga PSTN-ê ber bi telefona dilxwazê | Peydawerê telefonî, kargêrê mobîl |
| Gerok-ber-gerok (WebRTC) | Kes (deng di gerokê de dimîne) |
| Asterîska xwe-hostkirî + telefona SIP | Tenê serverê Asterîska te |

**Ji bo parastina numreyên telefonê yên dilxwazan**: Bikar anîna bangên li ser bingeha gerokê (WebRTC) an jî peydankirina telefonên SIP-ê yên ku bi Asterîska xwe-hostkirî ve girêdayî ne.

---

## Nêz dem de hatiye weşandin

Van başkirinan niha zindî ne:

| Taybetmendî | Fêdeya nepeniyê |
|-------------|-----------------|
| Tomarkirina peyamên şîfrekirî | Peyamên SMS, WhatsApp û Signal wekî ciphertext li ser serverê te tên tomarkirin |
| Transkrîpsiyona li ser cîhazê | Deng qet geroka te terk nake — bi tevahî li ser cîhaza te tê pêvajoy kirin |
| Parastina kilîdê ya pir-faktor | Kilîdên şîfrekirinê yên te bi PIN-a te, peydawerê nasnameyê û bi vebijarkî kilîda ewlehiya hardware ve têne parastin |
| Kilîdên ewlehiya hardware | Kilîdên fizîkî faktorekê sêyemîn lê dikin ku nikare ji dûr were têkbirin |
| Buildên reproducible | Bipejirîne ku kodê hatî sazkirin bi çavkaniya gelemperî re li hev diçe |
| Pelê têkiliyan ên şîfrekirî | Tomarên têkiliyê, pêwendî û nîştek end-to-end encrypted in |

## Hîn jî hatiye plankirin

| Taybetmendî | Fêdeya nepeniyê |
|-------------|-----------------|
| Sepanên xwemalî ji bo standina bangan | Ti numreya telefonê ya kesane eşkere nabe |

---

## Tabloya kurteyê

| Cureyê daneyê | Şîfrekirî | Ji bo serverê tê dîtin | Dikare binêr sibpoenayê were girtin |
|---------------|-----------|------------------------|--------------------------------------|
| Nîştekên bangê | Erê (end-to-end) | Na | Tenê ciphertext |
| Transkrîpsiyon | Erê (end-to-end) | Na | Tenê ciphertext |
| Rapor | Erê (end-to-end) | Na | Tenê ciphertext |
| Pêvekên pelê | Erê (end-to-end) | Na | Tenê ciphertext |
| Tomarên têkiliyan | Erê (end-to-end) | Na | Tenê ciphertext |
| Nasnameyên dilxwazan | Erê (end-to-end) | Na | Tenê ciphertext |
| Metadata tîm/rol | Erê (şîfrekirî) | Na | Tenê ciphertext |
| Dîtinên qadên kesane | Erê (şîfrekirî) | Na | Tenê ciphertext |
| Naveroka SMS/WhatsApp/Signal | Erê (li ser serverê te) | Na | Ciphertext ji serverê te; peydawer dibe ku orjînal hebe |
| Metadata bangê | Na | Erê | Erê |
| Hashên telefonê yên bangderan | Hashê HMAC | Tenê hash | Hash (bêyî sirê te nayê valakirin) |

---

## Ji bo lêkolînerên ewlehiyê

Belgekirina teknîkî:

- [Danasîna protokolê](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/protocol/llamenos-protocol.md)
- [Modela tehdîdê](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/THREAT_MODEL.md)
- [Dabeşkirina daneyan](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/DATA_CLASSIFICATION.md)
- [Lêkolînên ewlehiyê](https://github.com/rhonda-rodododo/llamenos/tree/main/docs/security)
- [Belgekirina API](/api/docs)

Llamenos çavkaniya vekirî ye: [github.com/rhonda-rodododo/llamenos](https://github.com/rhonda-rodododo/llamenos)
