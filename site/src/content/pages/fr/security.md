---
title: Sécurité et confidentialité
subtitle: Ce qui est protégé, ce qui est visible et ce qui peut être obtenu par assignation — organisé par fonctionnalités utilisées.
---

## Si votre hébergeur reçoit une assignation à témoin

| Ils PEUVENT fournir | Ils NE PEUVENT PAS fournir |
|---------------------|---------------------------|
| Métadonnées d'appels/messages (durées, horaires) | Contenu des notes, transcriptions, corps des rapports |
| Blobs de base de données chiffrés | Noms des bénévoles (chiffrés de bout en bout) |
| Quels comptes bénévoles étaient actifs quand | Enregistrements du répertoire de contacts (chiffrés de bout en bout) |
| | Contenu des messages (chiffré à l'arrivée, stocké sous forme de texte chiffré) |
| | Clés de déchiffrement (protégées par votre code PIN, votre compte fournisseur d'identité et votre clé de sécurité matérielle optionnelle) |
| | Clés de chiffrement par note (éphémères — détruites après encapsulation) |
| | Votre secret HMAC pour inverser les hachages téléphoniques |

**Le serveur stocke des données qu'il ne peut pas lire.** Les métadonnées (quand, combien de temps, quels comptes) sont visibles. Le contenu (ce qui a été dit, ce qui a été écrit, qui sont vos contacts) ne l'est pas.

---

## Par fonctionnalité

Votre exposition à la confidentialité dépend des canaux que vous activez :

### Appels vocaux

| Si vous utilisez... | Accès tiers possible | Accès serveur possible | Contenu chiffré de bout en bout |
|---------------------|---------------------|------------------------|--------------------------------|
| Twilio/SignalWire/Vonage/Plivo | Audio de l'appel (en direct), enregistrements d'appels | Métadonnées d'appels | Notes, transcriptions |
| Asterisk auto-hébergé | Rien (sous votre contrôle) | Métadonnées d'appels | Notes, transcriptions |
| Navigateur à navigateur (WebRTC) | Rien | Métadonnées d'appels | Notes, transcriptions |

**Assignation du fournisseur de téléphonie** : Ils détiennent les détails d'appels (horaires, numéros de téléphone, durées). Ils n'ont PAS les notes d'appels ni les transcriptions. L'enregistrement est désactivé par défaut.

**Transcription** : La transcription se produit entièrement dans votre navigateur à l'aide d'une IA sur appareil. **L'audio ne quitte jamais votre appareil.** Seule la transcription chiffrée est stockée.

### Messagerie texte

| Canal | Accès du fournisseur | Stockage serveur | Remarques |
|-------|---------------------|-----------------|-----------|
| SMS | Votre opérateur téléphonique lit tous les messages | **Chiffré** | Le fournisseur conserve les messages originaux |
| WhatsApp | Meta lit tous les messages | **Chiffré** | Le fournisseur conserve les messages originaux |
| Signal | Le réseau Signal est chiffré de bout en bout, mais le pont déchiffre à l'arrivée | **Chiffré** | Mieux que le SMS, mais pas sans connaissance |

**Les messages sont chiffrés dès leur arrivée sur votre serveur.** Le serveur ne stocke que le texte chiffré. Votre opérateur téléphonique ou fournisseur de messagerie peut toujours détenir le message original — c'est une limitation de ces plateformes, pas quelque chose que nous pouvons changer.

**Assignation du fournisseur de messagerie** : Les fournisseurs SMS détiennent l'intégralité du contenu des messages. Meta détient le contenu WhatsApp. Les messages Signal sont chiffrés de bout en bout jusqu'au pont, mais le pont (fonctionnant sur votre serveur) les déchiffre avant de les rechiffrer pour le stockage. Dans tous les cas, **votre serveur ne dispose que de texte chiffré** — l'hébergeur ne peut pas lire le contenu des messages.

### Notes, transcriptions et rapports

Tout le contenu rédigé par les bénévoles est chiffré de bout en bout :

- Chaque note utilise une **clé aléatoire unique** (confidentialité persistante — le compromis d'une note ne compromet pas les autres)
- Les clés sont encapsulées séparément pour le bénévole et chaque administrateur
- Le serveur ne stocke que le texte chiffré
- Le déchiffrement se produit dans le navigateur
- **Les champs personnalisés, le contenu des rapports et les pièces jointes sont tous chiffrés individuellement**

**Saisie d'appareil** : Sans votre code PIN **ET** l'accès à votre compte fournisseur d'identité, les attaquants n'obtiennent qu'un blob chiffré qu'il est calculatoirement impossible de déchiffrer. Si vous utilisez également une clé de sécurité matérielle, **trois facteurs indépendants** protègent vos données.

---

## Confidentialité des numéros de téléphone des bénévoles

Lorsque les bénévoles répondent aux appels sur leur téléphone personnel, leur numéro est exposé à votre fournisseur de téléphonie.

| Scénario | Numéro de téléphone visible pour |
|----------|----------------------------------|
| Appel PSTN vers le téléphone du bénévole | Opérateur téléphonique, opérateur mobile |
| Navigateur à navigateur (WebRTC) | Personne (l'audio reste dans le navigateur) |
| Asterisk auto-hébergé + téléphone SIP | Votre serveur Asterisk uniquement |

**Pour protéger les numéros de téléphone des bénévoles** : Utilisez les appels via navigateur (WebRTC) ou fournissez des téléphones SIP connectés à un Asterisk auto-hébergé.

---

## Récemment lancé

Ces améliorations sont désormais en ligne :

| Fonctionnalité | Avantage pour la confidentialité |
|----------------|---------------------------------|
| Stockage des messages chiffrés | Les messages SMS, WhatsApp et Signal sont stockés sous forme de texte chiffré sur votre serveur |
| Transcription sur appareil | L'audio ne quitte jamais votre navigateur — traité entièrement sur votre appareil |
| Protection des clés multi-facteurs | Vos clés de chiffrement sont protégées par votre code PIN, votre fournisseur d'identité et votre clé de sécurité matérielle optionnelle |
| Clés de sécurité matérielles | Les clés physiques ajoutent un troisième facteur qui ne peut pas être compromis à distance |
| Builds reproductibles | Vérifiez que le code déployé correspond au code source public |
| Répertoire de contacts chiffré | Les fiches contact, les relations et les notes sont chiffrés de bout en bout |

## Toujours prévu

| Fonctionnalité | Avantage pour la confidentialité |
|----------------|---------------------------------|
| Applications natives de réception d'appels | Aucun numéro de téléphone personnel exposé |

---

## Tableau récapitulatif

| Type de données | Chiffré | Visible par le serveur | Obtenable par assignation |
|-----------------|---------|------------------------|---------------------------|
| Notes d'appels | Oui (bout en bout) | Non | Texte chiffré uniquement |
| Transcriptions | Oui (bout en bout) | Non | Texte chiffré uniquement |
| Rapports | Oui (bout en bout) | Non | Texte chiffré uniquement |
| Pièces jointes | Oui (bout en bout) | Non | Texte chiffré uniquement |
| Fiches contact | Oui (bout en bout) | Non | Texte chiffré uniquement |
| Identités des bénévoles | Oui (bout en bout) | Non | Texte chiffré uniquement |
| Métadonnées équipe/rôle | Oui (chiffré) | Non | Texte chiffré uniquement |
| Définitions de champs personnalisés | Oui (chiffré) | Non | Texte chiffré uniquement |
| Contenu SMS/WhatsApp/Signal | Oui (sur votre serveur) | Non | Texte chiffré depuis votre serveur ; le fournisseur peut détenir l'original |
| Métadonnées d'appels | Non | Oui | Oui |
| Hachages téléphoniques des appelants | Hachage HMAC | Hachage uniquement | Hachage (non inversible sans votre secret) |

---

## Pour les auditeurs en sécurité

Documentation technique :

- [Spécification du protocole](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/protocol/llamenos-protocol.md)
- [Modèle de menace](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/THREAT_MODEL.md)
- [Classification des données](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/DATA_CLASSIFICATION.md)
- [Audits de sécurité](https://github.com/rhonda-rodododo/llamenos/tree/main/docs/security)
- [Documentation API](/api/docs)

Llamenos est open source : [github.com/rhonda-rodododo/llamenos](https://github.com/rhonda-rodododo/llamenos)
