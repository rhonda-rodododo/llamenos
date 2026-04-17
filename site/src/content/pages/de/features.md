---
title: Funktionen
subtitle: Alles, was eine Krisenreaktionsplattform braucht, in einem Open-Source-Paket. Sprache, SMS, WhatsApp, Signal und verschlüsselte Berichte — selbstgehostet für maximale Kontrolle.
---

## Telefonie mit mehreren Anbietern

**5 Sprachanbieter** — Wählen Sie zwischen Twilio, SignalWire, Vonage, Plivo oder selbstgehostetem Asterisk. Konfigurieren Sie Ihren Anbieter in der Admin-Einstellungs-Oberfläche oder während des Einrichtungsassistenten. Wechseln Sie jederzeit den Anbieter, ohne Code zu ändern.

**WebRTC-Browser-Anrufe** — Freiwillige können Anrufe direkt im Browser entgegennehmen, ohne Telefon. Anbieterspezifische WebRTC-Token-Generierung für Twilio, SignalWire, Vonage und Plivo. Konfigurierbare Anrufpräferenz pro Freiwilligem (Telefon, Browser oder beides).

## Anrufweiterleitung

**Paralleles Klingeln** — Wenn ein Anrufer durchstellt, klingeln alle freiwilligen Helfer, die im Dienst und nicht beschäftigt sind, gleichzeitig. Der Erste, der abhebt, bekommt den Anruf; die anderen Klingeltöne hören sofort auf.

**Schichtbasierte Planung** — Erstellen Sie wiederkehrende Schichten mit bestimmten Tagen und Zeiten. Weisen Sie Freiwillige Schichten zu. Das System leitet Anrufe automatisch an diejenigen weiter, die gerade im Dienst sind.

**Warteschlange mit Wartemusik** — Wenn alle Freiwilligen beschäftigt sind, gelangen Anrufer in eine Warteschlange mit konfigurierbarer Wartemusik. Das Warteschlangen-Timeout ist einstellbar (30-300 Sekunden). Wenn niemand antwortet, werden die Anrufe an die Voicemail weitergeleitet.

**Voicemail-Fallback** — Anrufer können eine Sprachnachricht hinterlassen (bis zu 5 Minuten), wenn kein Freiwilliger antwortet. Sprachnachrichten werden über Whisper AI transkribiert und zur Überprüfung durch den Administrator verschlüsselt.

## Verschlüsselte Notizen

**End-to-End-verschlüsselte Notizerfassung** — Freiwillige schreiben Notizen während und nach dem Anruf. Notizen werden clientseitig mit ECIES (secp256k1 + XChaCha20-Poly1305) verschlüsselt, bevor sie den Browser verlassen. Der Server speichert nur den Chiffretext.

**Doppelte Verschlüsselung** — Jede Notiz wird zweimal verschlüsselt: einmal für den Freiwilligen, der sie geschrieben hat, und einmal für den Administrator. Beide können unabhängig voneinander entschlüsseln. Niemand sonst kann den Inhalt lesen.

**Benutzerdefinierte Felder** — Administratoren definieren benutzerdefinierte Felder für Notizen: Text, Zahl, Auswahl, Kontrollkästchen, Textbereich. Die Felder werden zusammen mit dem Notizinhalt verschlüsselt.

**Entwurfs-Autosave** — Notizen werden automatisch als verschlüsselte Entwürfe im Browser gespeichert. Wenn die Seite neu lädt oder der Freiwillige wegnavigiert, bleibt seine Arbeit erhalten. Entwürfe werden beim Abmelden gelöscht.

## KI-Transkription

**On-Device-Transkription** — Anrufe werden mit einer KI transkribiert, die vollständig im Browser des Freiwilligen läuft. Audio verlässt das Gerät nie. Es wird nur die verschlüsselte Transkription gespeichert.

**Admin- und Freiwilligen-Steuerung** — Administratoren können die Transkription global aktivieren oder deaktivieren. Freiwillige können sich individuell abmelden. Beide Schalter sind unabhängig voneinander.

**Verschlüsselte Transkriptionen** — Transkriptionen verwenden dieselbe ECIES-Verschlüsselung wie Notizen. Die gespeicherte Transkription ist nur Chiffretext.

## Spam-Abwehr

**Sprach-CAPTCHA** — Optionale Sprachbot-Erkennung: Der Anrufer hört eine zufällige 4-stellige Zahl und muss sie auf dem Tastenfeld eingeben. Blockiert automatisches Wählen und bleibt gleichzeitig für echte Anrufer zugänglich.

**Ratenbegrenzung** — Gleitende Ratenbegrenzung pro Telefonnummer, persistent in der Datenbank. Konfigurierbare Schwellenwerte überleben Neustarts.

**Echtzeit-Sperrlisten** — Administratoren verwalten Sperrlisten für Telefonnummern mit Einzeleingabe oder Massenimport. Sperren treten sofort in Kraft. Gesperrte Anrufer hören eine Ablehnungsnachricht.

**Benutzerdefinierte IVR-Ansagen** — Nehmen Sie benutzerdefinierte Sprachansagen für jede unterstützte Sprache auf. Das System verwendet Ihre Aufnahmen für IVR-Abläufe und fällt auf Text-to-Speech zurück, wenn keine Aufnahme vorhanden ist.

## Multi-Channel-Messaging

**SMS** — Eingehende und ausgehende SMS-Nachrichten über Twilio, SignalWire, Vonage oder Plivo. Automatische Antwort mit konfigurierbaren Willkommensnachrichten. Nachrichten fließen in eine Thread-basierte Konversationsansicht.

**WhatsApp Business** — Verbindung über Meta Cloud API (Graph API v21.0). Unterstützung von Vorlagen-Nachrichten zum Starten von Gesprächen innerhalb des 24-Stunden-Nachrichtenfensters. Unterstützung von Mediennachrichten für Bilder, Dokumente und Audio.

**Signal** — Datenschutzorientiertes Messaging über eine selbstgehostete signal-cli-rest-api-Brücke. Gesundheitsüberwachung mit graceful degradation. Sprachnachrichten-Transkription über On-Device Whisper AI.

**Thread-basierte Konversationen** — Alle Messaging-Kanäle fließen in eine einheitliche Konversationsansicht. Nachrichtenblasen mit Zeitstempeln und Richtungsindikatoren. Echtzeit-Updates. Alle Nachrichten werden auf Ihrem Server bei Eingang sofort verschlüsselt. Der Server speichert nur den Chiffretext.

## Verschlüsselte Berichte

**Reporter-Rolle** — Eine dedizierte Rolle für Personen, die Tipps oder Berichte einreichen. Reporter sehen nur eine vereinfachte Oberfläche mit Berichten und Hilfe. Eingeladen über denselben Ablauf wie Freiwillige, mit Rollenwahl.

**Verschlüsselte Einreichungen** — Der Berichtstext wird mit ECIES verschlüsselt, bevor er den Browser verlässt. Klartext-Titel dienen der Triage, verschlüsselter Inhalt dem Datenschutz. Dateianhänge werden separat verschlüsselt.

**Berichts-Workflow** — Kategorien zur Organisation von Berichten. Status-Tracking (offen, beansprucht, gelöst). Administratoren können Berichte übernehmen und mit verschlüsselten Thread-Antworten reagieren.

## Kontaktverzeichnis

**Verschlüsselte Kontaktdatensätze** — Speichern Sie Kontaktinformationen mit End-to-End-Verschlüsselung. Namen, Telefonnummern, E-Mails und Notizen werden verschlüsselt, bevor sie den Browser verlassen.

**Beziehungs-Tracking** — Verknüpfen Sie Kontakte miteinander und mit Anrufen, Gesprächen und Berichten. Erstellen Sie ein vollständiges Bild der Personen, denen Sie helfen.

**Automatische Verknüpfung** — Eingehende Anrufe und Nachrichten werden automatisch mit bekannten Kontakten anhand übereinstimmender Telefonnummern verknüpft.

**Team-basierter Zugriff** — Steuern Sie, welche Teammitglieder welche Kontakte sehen können. Berechtigungen sind granulär und konfigurierbar.

**Tags und Intake** — Organisieren Sie Kontakte mit Tags. Intake-Workflows leiten neue Kontakte zur Überprüfung weiter.

**Massenimport/-export** — Importieren Sie Kontakte aus CSV oder JSON. Exportieren Sie verschlüsselte Backups. Die gesamte Verarbeitung findet in Ihrem Browser statt.

## Konfigurierbare Berechtigungen

**Benutzerdefinierte Rollen** — Definieren Sie eigene Rollen mit genau den Berechtigungen, die Sie benötigen. Beginnen Sie mit integrierten Vorlagen (Administrator, Freiwilliger, Reporter) oder bauen Sie von Grund auf neu.

**Granulare Berechtigungen** — Über 90 einzelne Berechtigungen in 17 Funktionsbereichen. Steuern Sie, wer auf feiner Ebene ansehen, erstellen, bearbeiten und löschen kann.

**Team-Scoping** — Weisen Sie Teammitglieder Teams zu. Berechtigungen können auf bestimmte Teams begrenzt werden, sodass verschiedene Gruppen unterschiedliche Daten sehen.

## Admin-Dashboard

**Einrichtungsassistent** — Geführte mehrstufige Einrichtung beim ersten Admin-Login. Wählen Sie, welche Kanäle aktiviert werden sollen (Sprache, SMS, WhatsApp, Signal, Berichte), konfigurieren Sie Anbieter und legen Sie den Namen Ihrer Hotline fest.

**Erste-Schritte-Checkliste** — Dashboard-Widget, das den Einrichtungsfortschritt verfolgt: Kanalkonfiguration, Onboarding von Freiwilligen, Schichterstellung.

**Echtzeit-Überwachung** — Sehen Sie aktive Anrufe, Anrufer in der Warteschlange, Gespräche und den Status von Freiwilligen in Echtzeit. Metriken aktualisieren sich sofort.

**Benutzerverwaltung** — Laden Sie neue Teammitglieder über sichere Links ein. Sie erstellen ihre eigenen Konten und Verschlüsselungsschlüssel. Verwalten Sie Rollen, Berechtigungen und Teamzuweisungen.

**Audit-Logging** — Jeder beantwortete Anruf, erstellte Notiz, gesendete Nachricht, eingereichte Meldung, geänderte Einstellung und Admin-Aktion wird protokolliert. Seitige Ansicht für Administratoren.

**Anrufverlauf** — Durchsuchbarer, filterbarer Anrufverlauf mit Datumsbereichen, Telefonnummernsuche und Freiwilligenzuweisung. GDPR-konformer Datenexport.

**In-App-Hilfe** — FAQ-Bereiche, rollenspezifische Anleitungen, Schnellreferenzkarten für Tastenkürzel und Sicherheit. Erreichbar über die Seitenleiste und die Befehlspalette.

## Freiwilligen-Erlebnis

**Befehlspalette** — Drücken Sie Strg+K (oder Cmd+K auf dem Mac) für sofortigen Zugriff auf Navigation, Suche, schnelles Notizerstellen und Theme-Umschaltung. Admin-only-Befehle werden nach Rolle gefiltert.

**Echtzeit-Benachrichtigungen** — Eingehende Anrufe lösen einen Browser-Klingelton, Push-Benachrichtigungen und einen blinkenden Tab-Titel aus. Schalten Sie jede Benachrichtigungsart unabhängig in den Einstellungen um.

**Freiwilligen-Präsenz** — Administratoren sehen Echtzeit-Zahlen von online, offline und in Pause. Freiwillige können den Pause-Schalter in der Seitenleiste umlegen, um eingehende Anrufe vorübergehend zu pausieren, ohne ihre Schicht zu verlassen.

**Tastenkürzel** — Drücken Sie ?, um alle verfügbaren Kürzel anzuzeigen. Navigieren Sie zwischen Seiten, öffnen Sie die Befehlspalette und führen Sie häufige Aktionen aus, ohne die Maus zu berühren.

**Entwurfs-Autosave für Notizen** — Notizen werden automatisch als verschlüsselte Entwürfe im Browser gespeichert. Wenn die Seite neu lädt oder der Freiwillige wegnavigiert, bleibt seine Arbeit erhalten. Entwürfe werden aus dem localStorage beim Abmelden gelöscht.

**Verschlüsselter Datenexport** — Exportieren Sie Notizen als GDPR-konforme verschlüsselte Datei (.enc), geschützt durch Ihren multifaktoriellen Verschlüsselungsschlüssel. Nur der ursprüngliche Autor kann den Export entschlüsseln.

**Dunkle/helle Themes** — Wechseln Sie zwischen dunklem Modus, hellem Modus oder System-Theme. Die Präferenz bleibt pro Sitzung erhalten.

## Mehrsprachig und mobil

**12+ Sprachen** — Vollständige UI-Übersetzungen: Englisch, Spanisch, Chinesisch, Tagalog, Vietnamesisch, Arabisch, Französisch, Haitianisch-Kreolisch, Koreanisch, Russisch, Hindi, Portugiesisch und Deutsch. RTL-Unterstützung für Arabisch.

**Progressive Web App** — Auf jedem Gerät über den Browser installierbar. Der Service Worker cached den App-Shell für Offline-Start. Push-Benachrichtigungen für eingehende Anrufe.

**Mobile-First-Design** — Responsives Layout für Telefone und Tablets. Einklappbare Seitenleiste, touch-freundliche Steuerelemente und adaptive Layouts.

## Authentifizierung und Schlüsselverwaltung

**Multifaktorielle Schlüsselschutz** — Ihr Verschlüsselungsschlüssel ist durch bis zu drei unabhängige Faktoren geschützt: eine von Ihnen gewählte PIN, Ihr Identitätsprovider-Konto und ein optionaler Hardware-Sicherheitsschlüssel. Der Kompromittierung eines einzelnen Faktors reicht nicht aus.

**Identitätsprovider-Integration** — Selbstgehostetes Identitätsmanagement (unter Ihrer Kontrolle). Einladungsbasiertes Onboarding — kein Teilen geheimer Schlüssel. Remote-Sitzungswiderruf — sperren Sie ein kompromittiertes Gerät von überall aus.

**Automatische Sitzungsverwaltung** — Sitzungen werden im Hintergrund still aktualisiert. Die automatische Sperre bei Inaktivität schützt unbeaufsichtigte Geräte. Ihr Verschlüsselungsschlüssel lebt in einem isolierten Prozess, der von der Seite nie erreichbar ist.

**Geräteverknüpfung** — Richten Sie neue Geräte sicher ein. Scannen Sie einen QR-Code oder geben Sie einen kurzen Bereitstellungscode ein. Verwendet einen vergänglichen Schlüsselaustausch — Ihr geheimer Schlüssel wird während der Übertragung nie offengelegt.

**Wiederherstellungsschlüssel** — Während des Onboardings erhalten Sie einen Wiederherstellungsschlüssel für Notfälle. Obligatorisches verschlüsseltes Backup, bevor Sie fortfahren können.

**Hardware-Sicherheitsschlüssel** — Optionale Passkey-Unterstützung für phishing-resistenten Login. Registrieren Sie einen Hardware-Schlüssel oder biometrische Daten und melden Sie sich ohne Eingabe von Anmeldedaten an.

**Forward Secrecy pro Notiz** — Jede Notiz wird mit einem eindeutigen zufälligen Schlüssel verschlüsselt, und dieser Schlüssel wird dann per ECIES für jeden autorisierten Leser verpackt. Der Kompromittierung des Identitätsschlüssels offenbart keine früheren Notizen.
