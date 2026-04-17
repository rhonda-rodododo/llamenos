---
title: Ewanum chuqa' Ichinil
translationStatus: placeholder
---

## We ri awuk'waxik ruma q'inoj nuk'ül jun subpoena

| Yetikïr nikiya' | Man yetikïr ta nikiya' |
|----------------|-----------------------|
| Metadata taq riqom/tzijol (ramaj, ruk'ijlem) | Rupam taq tzijol, taq rutz'ib'axik, rupam taq rutzijol |
| Taq blob database ewanin | Rub'i' taq to'onel (ewanum chi rij ri b'ey) |
| Achike taq kib'anatajib'al to'onel e k'o pa samaj | Taq ruwi' tz'ib' ewanin (ewanum chi rij ri b'ey) |
| | Rupam taq tzijol (ewanin toq ye'apon, yek'oje' el achi'el ciphertext) |
| | Taq ewanum richin nisik'ij (ek'oje' ruma PIN, kib'anatajib'al rucha'ojil chuqa' ruchajixik samajib'äl) |
| | Taq ewanum chi kijujunal tzijol (tz'aqät — ye'el chi rij ri nuya') |
| | Ri awanum HMAC richin nijäl ri taq hash ochochib'äl |

**Ri ruk'waxik ruma q'inoj yerusamajij taq tzijol ri man yetikïr ta nikisik'ij.** Ri metadata (jamäl, achike ramaj, achike taq kib'anatajib'al) e k'ojlemal. Ri rupam (achike xb'ix, achike xtz'ib'aj, achike e ri taq awachib'al) man ta e k'ojlemal ta.

---

## Chi rij ri taq samaj

### Taq riqom

| We nawokisaj... | K'o chi rij chuwäch | K'o chi rij ri ruk'waxik | Ewanum chi rij ri b'ey |
|-----------------|---------------------|--------------------------|------------------------|
| Twilio/SignalWire/Vonage/Plivo | Oqom (pa ri ramaj), taq ruwi' riqom | Metadata riqom | Tzq tzijol, taq rutz'ib'axik |
| Asterisk ruyon | Majun (achike rat at ajchajinel) | Metadata riqom | Tzq tzijol, taq rutz'ib'axik |
| K'ak' raqän-pa-k'ak' raqän (WebRTC) | Majun | Metadata riqom | Tzq tzijol, taq rutz'ib'axik |

### Taq tzijol

| B'ey | Ruk'ojlem rucha'ojil | Ruk'oje'el ruk'waxik | Rutzijol |
|------|---------------------|---------------------|---------|
| SMS | Ri awuk'waxik oqom nisik'ij konojel | **Ewanin** | Ri rucha'ojil nuk'äm ri' taq tzijol |
| WhatsApp | Meta nisik'ij konojel | **Ewanin** | Ri rucha'ojil nuk'äm ri' taq tzijol |
| Signal | Ri q'atalb'al Signal ewanin, xa xe chi ri rupam nujäl toq napon | **Ewanin** | Yalan utziläj chuwäch SMS, xa xe chi man taq'e ta |

**Konojel taq tzijol ewanin toq ye'apon pa ri awuk'waxik.** Ri ruk'waxik xa xe yerusamajij ciphertext. Ri awuk'waxik o rucha'ojil tzijol yek'oje' ri' taq tzijol — re re' jun ruch'ojinemal taq b'ey, man ta jun ta samaj yatikïr nab'än.

### Tzq tzijol, taq rutz'ib'axik chuqa' taq rutzijol

Konojel rupam xtz'ib'aj ruma taq to'onel ewanin chi rij ri b'ey:

- Jun tzijol jun ewanum rik'in jun ketz'ïb' ewanum (forward secrecy)
- Ri taq ewanum yek'oje' el chi kijujunal chi re ri to'onel chuqa' ri ajchajinel
- Ri ruk'waxik xa xe yerusamajij ciphertext
- Ri nisik'ij nub'än pa k'ak' raqän
- **Taq ruk'ojlem ichinil, rupam taq rutzijol chuqa' taq ruwi' ch'utiwuj ewanin chi kijujunal**

**We xapon jun samajib'äl:** Aw PIN **chuqa'** ri awuk'ojlem rucha'ojil k'o chi e k'oje'. We nawokisaj chik jun ruchajixik samajib'äl, **oxib' taq ruk'ojlem** yeruchajij ri awanima.

---

## Ichinil ochochib'äl to'onel

Toq ri taq to'onel nikib'äx pa ri ochochib'äl, ri taq ochochib'äl e k'ojlemal pa ri rucha'ojil.

| Rub'eyal | Achike winaq yetikïr nikil |
|----------|----------------------------|
| PSTN pa ochochib'äl to'onel | Rucha'ojil telefono, carrier |
| K'ak' raqän-pa-k'ak' raqän | Majun (ri oqom pa k'ak' raqän) |
| Asterisk ruyon + SIP | Xa xe ri awuk'waxik Asterisk |

---

## Rutzijol k'ak'a'

| Ruk'ojlem | Ruchajixik ichinil |
|-----------|-------------------|
| Ewanum tzijol | SMS, WhatsApp, Signal ewanin pa ruk'waxik |
| Rutz'ib'axik pa samajib'äl | Ri oqom majun q'ij nok pa k'ak' raqän |
| K'ïy ruk'ojlem ewanum | Ewanum rik'in PIN, rucha'ojil chuqa' ruchajixik samajib'äl |
| Ruchajixik samajib'äl | Oxib' ruk'ojlem richin ruchajixik |
| Build e k'atzinel | Rujikib'axik chi rij ri ruxe'el |
| Rucholajel tz'ib' ewanin | Tzq tzijol, taq achi'elal chuqa' taq tzijol ewanin |

---

## Rutzijol richin taq ajchajinel ewanum

- [Doxa'ib'al Protocol](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/protocol/llamenos-protocol.md)
- [Rutzub'al awachib'al K'axk'olil](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/THREAT_MODEL.md)
- [Ruch'akub'al Tzijol](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/DATA_CLASSIFICATION.md)
- [Taq rutzijol ewanum](https://github.com/rhonda-rodododo/llamenos/tree/main/docs/security)
- [API Documentation](/api/docs)

Llamenos jaqom ruxe'el jaqom: [github.com/rhonda-rodododo/llamenos](https://github.com/rhonda-rodododo/llamenos)
