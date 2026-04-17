---
title: Amniga & Qoysaska
subtitle: Waxa la ilaaliyo, waxa la arki karo, iyo waxa la heli karo subpoena hoosta — habeysan iyadoo ku salaysan astaamaha aad isticmaasho.
---

## Haddii bixiyahaaga hosting uu subpoena u helo

| Waxay KA KARAYAAN inay bixiyaan | Waxay KA KARI WAYAAN inay bixiyaan |
|------------------|---------------------|
| Metadata wicitaanka/fariinta (waqtiyada, muddada) | Waxa ku qoran qoraallada, transcript-yada, jirka warbixinnada |
| Blobs-ka database-ka ee sirta ah | Magacyada siiwacalayaasha (dhinacyo-dhammaadka u dhexeeya sirta ah) |
| Koontada siiwacalaha ee firfircoon markaas | Diiwaanada buugga xiriirka (dhinacyo-dhammaadka u dhexeeya sirta ah) |
| | Waxa ku qoran fariimaha (sirta ah marka yimaade, kaydsan sida ciphertext) |
| | Furayaasha furfurista (ilaaliya PIN-kaaga, koontada bixiyaha aqoontaada, iyo si ikhtiyaari ah furaha amnigaaga hardware-ka) |
| | Furayaasha sirta ee qoraal kasta (ephemeral — burburiya kadib duubidda) |
| | Sirtaada HMAC ee hash-yada telefoonka dib u celinta |

**Server-ka waxa uu kaydiyaa xog uu akhriki karin.** Metadata (goorma, intee, koontada) waa la arki karaa. Waxa ku qoran (waxa la yiri, waxa la qoray, yaa xiriirkaaga) ma aha.

---

## Astaamihii ku salaysan

Astaamahaaga gaarka ah waxay ku xiran tahay islaahlabka aad furanayso:

### Wicitaannada codka

| Haddii aad isticmaasho... | Saddexaad waxay heli karaan | Server waxa uu heli karaa | Waxa dhinacyo-dhammaadka u dhexeeya sirta ah |
|---------------|-------------------------|-------------------|------------------------------|
| Twilio/SignalWire/Vonage/Plivo | Codka wicitaanka (nool), diiwaanada wicitaanka | Metadata wicitaanka | Qoraallada, transcript-yada |
| Asterisk is-hosted | Waxba (waxaad xakamaysaa) | Metadata wicitaanka | Qoraallada, transcript-yada |
| Browser-to-browser (WebRTC) | Waxba | Metadata wicitaanka | Qoraallada, transcript-yada |

**Subpoena bixiyaha telefooniyada**: Waxay leeyihiin diiwaanada faahfaahinta wicitaanka (waqtiyada, lambarrada telefoonka, muddada). Ma laha qoraallada wicitaanka ama transcript-yada. Diiwaangelinta si default ah waa la xiray.

**Turjumaadda**: Turjumaaddu waxay ka dhacdaa si buuxda browser-kaaga adigoo isticmaalaya AI korkaaga. **Codku marnaba ma ka taga qalabkaaga.** Kaliya transcript-ka sirta ah ayaa la keydiyaa.

### Fariimaha qoraalka

| Islahlab | Helitaanka bixiye | Kaydinta server-ka | Qoraallada |
|---------|-----------------|----------------|-------|
| SMS | Bixiyahaaga telefooniyada wuxuu akhriyaa dhammaan fariimaha | **Sirta ah** | Bixiyaha wuxuu haystaa fariimaha asalka ah |
| WhatsApp | Meta wuxuu akhriyaa dhammaan fariimaha | **Sirta ah** | Bixiyaha wuxuu haystaa fariimaha asalka ah |
| Signal | Network-ka Signal waa dhinacyo-dhammaadka u dhexeeya sirta ah, laakiin bridge-ka wuxuu furfuraa marka yimaado | **Sirta ah** | Ka fiican SMS, ma ahan zero-knowledge |

**Fariimaha waxay noqdaan sirta ah marka ay yimaadaan server-kaaga.** Server-ka waxa uu kaydiyaa kaliya ciphertext. Bixiyahaaga telefooniyada ama fariimaha ayaa weli lahaan kara fariinta asalka ah — taas waa xaddidaadda platform-yadaas, ma ahan wax aan beddeli karno.

**Subpoena bixiyaha fariimaha**: Bixiyeyaasha SMS waxay leeyihiin waxa ku qoran fariimaha oo dhan. Meta waxay leedahay waxa ku qoran WhatsApp. Fariimaha Signal waxay ahaayeen dhinacyo-dhammaadka u dhexeeya sirta ah ilaa bridge-ka, laakiin bridge-ka (oo shaqeeya server-kaaga) wuxuu furfuraa kahor inta aysan dib u sifeyn kaydka. Dhammaan xaaladaha, **server-kaaga kaliya waxay leedahay ciphertext** — bixiyaha hosting-ka ma akhri karo waxa ku qoran fariimaha.

### Qoraallada, transcript-yada, iyo warbixinnada

Dhammaan waxa qoray siiwacalayaasha waa dhinacyo-dhammaadka u dhexeeya sirta ah:

- Qoraal kasta wuxuu isticmaalaa **furaha random gaar ah** (forward secrecy — in la dhaawaco hal qoraal ma dhaawaco kuwa kale)
- Furayaasha waxaa la duubaa si kala duwan u siiwacalaha iyo maamul kasta
- Server-ka waxa uu kaydiyaa kaliya ciphertext
- Furfurista waxay ka dhacdaa browser-ka
- **Goobaha la hagaajiyo, waxa ku qoran warbixinnada, iyo lifaaqyada faylasha oo dhan waxaa lagu sifayaa si gaar ah**

**Qabsashida qalabka**: Adigoon heyn PIN-kaaga **iyo** helitaanka koontadaada bixiye aqoonta, cadowgu wuxuu helaa blob sirta ah oo aan si kombiyuutar ah loo furfuri karin. Haddii aad sidoo kale isticmaasho furaha amniga hardware-ka, **saddex arrimood madax-bannaan** ayay ilaaliyaan xogtaada.

---

## Qoysasha lambarka telefoonka siiwacalaha

Marka siiwacalayaashu waxay ka qaataan wicitaannada telefoonadooda shakhsiga ah, lambarradoodu waxay u soo baxaan bixiyahaaga telefooniyada.

| Xaalad | Lambarka telefoonka ee la arki karaa |
|----------|------------------------|
| Wicitaan PSTN ilaa telefoonka siiwacalaha | Bixiyaha telefooniyada, bixiyaha telefoonka |
| Browser-to-browser (WebRTC) | Qofna (codku wuxuu ku jiraa browser-ka) |
| Asterisk is-hosted + SIP phone | Kaliya server-kaaga Asterisk |

**Si loo ilaaliyo lambarrada telefoonka siiwacalayaasha**: Istiicmaal wicitaanka ku salaysan browser-ka (WebRTC) ama bixi telefoonada SIP oo ku xiran Asterisk is-hosted.

---

## Wixii dhowaan la soo saaro

Hormararkan maanta way nool yihiin:

| Astaanta | Faa'iidada qoyska |
|---------|-----------------|
| Kaydinta fariimaha sirta ah | Fariimaha SMS, WhatsApp, iyo Signal waxaa lagu kaydiyaa ciphertext server-kaaga |
| Turjumaad korka qalabka | Codku marnaba ma ka taga browser-kaaga — waxaa loogu talagalay si buuxda qalabkaaga |
| Ilaalinta furaha multi-factor | Furayaashaaga sirta ah waxaa ilaaliya PIN-kaaga, bixiyaha aqoontaada, iyo si ikhtiyaari ah furaha amnigaaga hardware-ka |
| Furayaasha amniga hardware-ka | Furayaasha jirka waxay ku darayaan saddexaad oo aan remote loo dhaawici karin |
| Dhisme la soo celi karo | Xaqiiji in koodhka la adeegsado uu la mid yahay iskoodka dadweynaha |
| Buugga xiriirka sirta ah | Diiwaanada xiriirka, xiriirka, iyo qoraalladu waa dhinacyo-dhammaadka u dhexeeya sirta ah |

## Weli la qorsheeyay

| Astaanta | Faa'iidada qoyska |
|---------|-----------------|
| Apps-ka ugu dambeyn ee qaadda wicitaannada | Lambarrada telefoonka shakhsiga ah ma soo baxdo |

---

## Tusmada soo koobidda

| Nooca xogta | Sirta ah | La arki karaa server-ka | La heli karaa subpoena hoosta |
|-----------|-----------|-------------------|---------------------------|
| Qoraallada wicitaanka | Haa (dhinacyo-dhammaadka u dhexeeya) | Maya | Ciphertext kaliya |
| Transcript-yada | Haa (dhinacyo-dhammaadka u dhexeeya) | Maya | Ciphertext kaliya |
| Warbixinnada | Haa (dhinacyo-dhammaadka u dhexeeya) | Maya | Ciphertext kaliya |
| Lifaaqyada faylasha | Haa (dhinacyo-dhammaadka u dhexeeya) | Maya | Ciphertext kaliya |
| Diiwaanada xiriirka | Haa (dhinacyo-dhammaadka u dhexeeya) | Maya | Ciphertext kaliya |
| Aqoonta siiwacalaha | Haa (dhinacyo-dhammaadka u dhexeeya) | Maya | Ciphertext kaliya |
| Metadata kooxda/doorka | Haa (sirta ah) | Maya | Ciphertext kaliya |
| Goobaha la hagaajiyo | Haa (sirta ah) | Maya | Ciphertext kaliya |
| Waxa ku qoran SMS/WhatsApp/Signal | Haa (server-kaaga) | Maya | Ciphertext ka yimid server-kaaga; bixiyaha laga yaabee inuu leeyahay asalka |
| Metadata wicitaanka | Maya | Haa | Haa |
| Hash-yada telefoonka wiciyaha | HMAC hashed | Hash kaliya | Hash (aan la soo celin karin adigoon heyn sirtaada) |

---

## Hawl-wadeennada baarista amniga

Dukumeentiyada farsamada:

- [Protocol Specification](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/protocol/llamenos-protocol.md)
- [Threat Model](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/THREAT_MODEL.md)
- [Data Classification](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/DATA_CLASSIFICATION.md)
- [Security Audits](https://github.com/rhonda-rodododo/llamenos/tree/main/docs/security)
- [API Documentation](/api/docs)

Llamenos waa open source: [github.com/rhonda-rodododo/llamenos](https://github.com/rhonda-rodododo/llamenos)
