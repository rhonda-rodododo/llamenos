---
title: Sicherheit und Datenschutz
subtitle: Was geschützt ist, was sichtbar ist und was per Vorladung erhältlich ist — sortiert nach den Funktionen, die Sie nutzen.
---

## Wenn Ihr Hosting-Anbieter eine Vorladung erhält

| Sie KÖNNEN bereitstellen | Sie KÖNNEN NICHT bereitstellen |
|--------------------------|-------------------------------|
| Anruf-/Nachrichten-Metadaten (Zeiten, Dauern) | Inhalt von Notizen, Transkriptionen, Berichtstexte |
| Verschlüsselte Datenbank-Blobs | Namen von Freiwilligen (End-to-End-verschlüsselt) |
| Welche Freiwilligenkonten wann aktiv waren | Kontaktverzeichnis-Einträge (End-to-End-verschlüsselt) |
| | Nachrichteninhalte (bei Eingang verschlüsselt, als Chiffretext gespeichert) |
| | Entschlüsselungsschlüssel (geschützt durch Ihre PIN, Ihr Identitätsprovider-Konto und optionalen Hardware-Sicherheitsschlüssel) |
| | Pro-Notiz-Verschlüsselungsschlüssel (ephemeral — nach Verpackung zerstört) |
| | Ihr HMAC-Geheimnis zum Umkehren von Telefon-Hashes |

**Der Server speichert Daten, die er nicht lesen kann.** Metadaten (wann, wie lange, welche Konten) sind sichtbar. Inhalt (was gesagt wurde, was geschrieben wurde, wer Ihre Kontakte sind) nicht.

---

## Nach Funktion

Ihre Datenschutz-Offenlegung hängt davon ab, welche Kanäle Sie aktivieren:

### Sprachanrufe

| Wenn Sie verwenden... | Möglicher Zugriff durch Dritte | Möglicher Serverzugriff | End-to-End-verschlüsselter Inhalt |
|-----------------------|-------------------------------|------------------------|-----------------------------------|
| Twilio/SignalWire/Vonage/Plivo | Anrufaudio (live), Anrufaufzeichnungen | Anruf-Metadaten | Notizen, Transkriptionen |
| Selbstgehosteter Asterisk | Nichts (unter Ihrer Kontrolle) | Anruf-Metadaten | Notizen, Transkriptionen |
| Browser-zu-Browser (WebRTC) | Nichts | Anruf-Metadaten | Notizen, Transkriptionen |

**Vorladung an Telefonieanbieter**: Sie haben Anrufdetails (Zeiten, Telefonnummern, Dauern). Sie haben KEINE Anrufnotizen oder Transkriptionen. Aufzeichnung ist standardmäßig deaktiviert.

**Transkription**: Die Transkription findet vollständig in Ihrem Browser mit On-Device-KI statt. **Audio verlässt Ihr Gerät nie.** Es wird nur die verschlüsselte Transkription gespeichert.

### Textnachrichten

| Kanal | Anbieterzugriff | Serverspeicherung | Anmerkungen |
|-------|----------------|-------------------|-------------|
| SMS | Ihr Telefonanbieter liest alle Nachrichten | **Verschlüsselt** | Anbieter behält Originalnachrichten |
| WhatsApp | Meta liest alle Nachrichten | **Verschlüsselt** | Anbieter behält Originalnachrichten |
| Signal | Das Signal-Netzwerk ist End-to-End-verschlüsselt, aber die Brücke entschlüsselt bei Eingang | **Verschlüsselt** | Besser als SMS, aber nicht Zero-Knowledge |

**Nachrichten werden auf Ihrem Server bei Eingang sofort verschlüsselt.** Der Server speichert nur den Chiffretext. Ihr Telefon- oder Messaging-Anbieter kann weiterhin die Originalnachricht haben — das ist eine Einschränkung dieser Plattformen, nichts, das wir ändern können.

**Vorladung an Messaging-Anbieter**: SMS-Anbieter haben den vollständigen Nachrichteninhalt. Meta hat den WhatsApp-Inhalt. Signal-Nachrichten sind End-to-End-verschlüsselt bis zur Brücke, aber die Brücke (läuft auf Ihrem Server) entschlüsselt vor der erneuten Verschlüsselung zur Speicherung. In allen Fällen **hat Ihr Server nur Chiffretext** — der Hosting-Anbieter kann den Nachrichteninhalt nicht lesen.

### Notizen, Transkriptionen und Berichte

Alle von Freiwilligen geschriebenen Inhalte sind End-to-End-verschlüsselt:

- Jede Notiz verwendet einen **eindeutigen zufälligen Schlüssel** (Forward Secrecy — der Kompromittierung einer Notiz gefährdet nicht die anderen)
- Die Schlüssel werden separat für den Freiwilligen und jeden Administrator verpackt
- Der Server speichert nur den Chiffretext
- Die Entschlüsselung findet im Browser statt
- **Benutzerdefinierte Felder, Berichtsinhalte und Dateianhänge werden alle einzeln verschlüsselt**

**Gerätebeschlagnahmung**: Ohne Ihre PIN **UND** Zugriff auf Ihr Identitätsprovider-Konto erhalten Angreifer nur einen verschlüsselten Blob, dessen Entschlüsselung rechnerisch nicht durchführbar ist. Wenn Sie auch einen Hardware-Sicherheitsschlüssel verwenden, schützen **drei unabhängige Faktoren** Ihre Daten.

---

## Datenschutz der Telefonnummern von Freiwilligen

Wenn Freiwillige Anrufe auf ihren persönlichen Telefonen entgegennehmen, ist ihre Nummer für Ihren Telefonieanbieter sichtbar.

| Szenario | Telefonnummer sichtbar für |
|----------|---------------------------|
| PSTN-Anruf an das Telefon des Freiwilligen | Telefonieanbieter, Mobilfunkbetreiber |
| Browser-zu-Browser (WebRTC) | Niemand (Audio bleibt im Browser) |
| Selbstgehosteter Asterisk + SIP-Telefon | Nur Ihr Asterisk-Server |

**Um die Telefonnummern von Freiwilligen zu schützen**: Verwenden Sie browserbasierte Anrufe (WebRTC) oder stellen Sie SIP-Telefone bereit, die mit einem selbstgehosteten Asterisk verbunden sind.

---

## Kürzlich veröffentlicht

Diese Verbesserungen sind jetzt live:

| Funktion | Datenschutzvorteil |
|----------|-------------------|
| Verschlüsselte Nachrichtenspeicherung | SMS-, WhatsApp- und Signal-Nachrichten werden als Chiffretext auf Ihrem Server gespeichert |
| On-Device-Transkription | Audio verlässt Ihren Browser nie — vollständig auf Ihrem Gerät verarbeitet |
| Multifaktorielle Schlüsselschutz | Ihre Verschlüsselungsschlüssel sind durch Ihre PIN, Ihren Identitätsprovider und optionalen Hardware-Sicherheitsschlüssel geschützt |
| Hardware-Sicherheitsschlüssel | Physische Schlüssel fügen einen dritten Faktor hinzu, der nicht remote kompromittiert werden kann |
| Reproduzierbare Builds | Überprüfen Sie, ob der bereitgestellte Code mit der öffentlichen Quelle übereinstimmt |
| Verschlüsseltes Kontaktverzeichnis | Kontaktdatensätze, Beziehungen und Notizen sind End-to-End-verschlüsselt |

## Noch geplant

| Funktion | Datenschutzvorteil |
|----------|-------------------|
| Native Anruf-Apps | Keine persönliche Telefonnummer wird offengelegt |

---

## Zusammenfassungstabelle

| Datentyp | Verschlüsselt | Für Server sichtbar | Per Vorladung erhältlich |
|----------|--------------|---------------------|--------------------------|
| Anrufnotizen | Ja (End-to-End) | Nein | Nur Chiffretext |
| Transkriptionen | Ja (End-to-End) | Nein | Nur Chiffretext |
| Berichte | Ja (End-to-End) | Nein | Nur Chiffretext |
| Dateianhänge | Ja (End-to-End) | Nein | Nur Chiffretext |
| Kontakteinträge | Ja (End-to-End) | Nein | Nur Chiffretext |
| Freiwilligenidentitäten | Ja (End-to-End) | Nein | Nur Chiffretext |
| Team/Rollen-Metadaten | Ja (verschlüsselt) | Nein | Nur Chiffretext |
| Benutzerdefinierte Felddefinitionen | Ja (verschlüsselt) | Nein | Nur Chiffretext |
| SMS/WhatsApp/Signal-Inhalt | Ja (auf Ihrem Server) | Nein | Chiffretext von Ihrem Server; Anbieter kann Original haben |
| Anruf-Metadaten | Nein | Ja | Ja |
| Anrufer-Telefon-Hashes | HMAC-Hash | Nur Hash | Hash (nicht umkehrbar ohne Ihr Geheimnis) |

---

## Für Sicherheitsauditoren

Technische Dokumentation:

- [Protokollspezifikation](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/protocol/llamenos-protocol.md)
- [Bedrohungsmodell](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/THREAT_MODEL.md)
- [Datenklassifizierung](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/DATA_CLASSIFICATION.md)
- [Sicherheitsaudits](https://github.com/rhonda-rodododo/llamenos/tree/main/docs/security)
- [API-Dokumentation](/api/docs)

Llamenos ist Open Source: [github.com/rhonda-rodododo/llamenos](https://github.com/rhonda-rodododo/llamenos)
