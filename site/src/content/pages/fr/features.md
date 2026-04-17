---
title: Fonctionnalités
subtitle: Tout ce qu'une plateforme de réponse aux crises a besoin, dans un package open-source. Voix, SMS, WhatsApp, Signal et rapports chiffrés — auto-hébergé pour un contrôle maximum.
---

## Téléphonie multi-fournisseurs

**5 fournisseurs de voix** — Choisissez parmi Twilio, SignalWire, Vonage, Plivo ou Asterisk auto-hébergé. Configurez votre fournisseur dans l'interface des paramètres administrateur ou pendant l'assistant de configuration. Changez de fournisseur à tout moment sans modification du code.

**Appels via navigateur WebRTC** — Les bénévoles peuvent répondre aux appels directement dans leur navigateur sans téléphone. Génération de jetons WebRTC spécifiques à chaque fournisseur pour Twilio, SignalWire, Vonage et Plivo. Préférence d'appel configurable par bénévole (téléphone, navigateur ou les deux).

## Routage d'appels

**Sonnerie parallèle** — Lorsqu'un appelant se présente, tous les bénévoles en service et disponibles sonnent simultanément. Le premier à répondre obtient l'appel ; les autres sonneries s'arrêtent immédiatement.

**Planification basée sur les quarts de travail** — Créez des quarts de travail récurrents avec des jours et des plages horaires spécifiques. Affectez des bénévoles aux quarts. Le système route automatiquement les appels vers les personnes de service.

**File d'attente avec musique d'attente** — Si tous les bénévoles sont occupés, les appelants entrent dans une file d'attente avec musique d'attente configurable. Le délai d'expiration de la file est ajustable (30-300 secondes). Si personne ne répond, les appels sont transférés vers la messagerie vocale.

**Messagerie vocale de secours** — Les appelants peuvent laisser un message vocal (jusqu'à 5 minutes) si aucun bénévole ne répond. Les messages vocaux sont transcrits via Whisper AI et chiffrés pour révision par l'administrateur.

## Notes chiffrées

**Prise de notes de bout en bout** — Les bénévoles rédigent des notes pendant et après l'appel. Les notes sont chiffrées côté client à l'aide d'ECIES (secp256k1 + XChaCha20-Poly1305) avant de quitter le navigateur. Le serveur ne stocke que le texte chiffré.

**Double chiffrement** — Chaque note est chiffrée deux fois : une fois pour le bénévole qui l'a rédigée, et une fois pour l'administrateur. Les deux peuvent déchiffrer indépendamment. Personne d'autre ne peut lire le contenu.

**Champs personnalisés** — Les administrateurs définissent des champs personnalisés pour les notes : texte, nombre, sélection, case à cocher, zone de texte. Les champs sont chiffrés avec le contenu de la note.

**Sauvegarde automatique des brouillons** — Les notes sont automatiquement enregistrées comme brouillons chiffrés dans le navigateur. Si la page se recharge ou si le bénévole part, son travail est préservé. Les brouillons sont effacés à la déconnexion.

## Transcription IA

**Transcription sur appareil** — Les appels sont transcrits à l'aide d'une IA fonctionnant entièrement dans le navigateur du bénévole. L'audio ne quitte jamais l'appareil. Seule la transcription chiffrée est stockée.

**Contrôles administrateur et bénévole** — Les administrateurs peuvent activer ou désactiver la transcription globalement. Les bénévoles peuvent se désinscrire individuellement. Les deux bascules sont indépendantes.

**Transcriptions chiffrées** — Les transcriptions utilisent le même chiffrement ECIES que les notes. La transcription stockée est uniquement du texte chiffré.

## Atténuation du spam

**CAPTCHA vocal** — Détection optionnelle des robots vocaux : l'appelant entend un nombre aléatoire de 4 chiffres et doit le saisir sur le clavier. Bloque la numérotation automatique tout en restant accessible aux vrais appelants.

**Limitation de débit** — Limitation de débit par fenêtre glissante pour chaque numéro de téléphone, persistée dans la base de données. Les seuils configurables survivent aux redémarrages.

**Listes de bannissement en temps réel** — Les administrateurs gèrent des listes de numéros de téléphone bannis avec saisie individuelle ou import en masse. Les bannissements prennent effet immédiatement. Les appelants bannis entendent un message de rejet.

**Invites IVR personnalisées** — Enregistrez des invites vocales personnalisées pour chaque langue prise en charge. Le système utilise vos enregistrements pour les flux IVR, avec retour à la synthèse vocale en l'absence d'enregistrement.

## Messagerie multi-canal

**SMS** — Messagerie SMS entrante et sortante via Twilio, SignalWire, Vonage ou Plivo. Réponse automatique avec messages de bienvenue configurables. Les messages s'affichent dans une vue conversationnelle en fils.

**WhatsApp Business** — Connexion via Meta Cloud API (Graph API v21.0). Prise en charge des messages modèles pour initier des conversations dans la fenêtre de messagerie de 24 heures. Prise en charge des messages multimédias pour images, documents et audio.

**Signal** — Messagerie axée sur la confidentialité via un pont signal-cli-rest-api auto-hébergé. Surveillance de l'état avec dégradation gracieuse. Transcription des messages vocaux via Whisper AI sur l'appareil.

**Conversations en fils** — Tous les canaux de messagerie s'affichent dans une vue conversationnelle unifiée. Bulles de messages avec horodatages et indicateurs de direction. Mises à jour en temps réel. Tous les messages sont chiffrés sur votre serveur dès leur arrivée. Le serveur ne stocke que le texte chiffré.

## Rapports chiffrés

**Rôle de rapporteur** — Un rôle dédié aux personnes qui soumettent des conseils ou des rapports. Les rapporteurs ne voient qu'une interface simplifiée avec rapports et aide. Invités via le même flux que les bénévoles, avec sélecteur de rôle.

**Soumissions chiffrées** — Le corps du rapport est chiffré à l'aide d'ECIES avant de quitter le navigateur. Les titres en texte brut servent au triage, le contenu chiffré assure la confidentialité. Les pièces jointes sont chiffrées séparément.

**Workflow des rapports** — Catégories pour organiser les rapports. Suivi des statuts (ouvert, pris en charge, résolu). Les administrateurs peuvent prendre en charge les rapports et y répondre avec des réponses chiffrées en fils.

## Répertoire de contacts

**Fiches contact chiffrées** — Stockez les informations de contact avec chiffrement de bout en bout. Les noms, numéros de téléphone, e-mails et notes sont chiffrés avant de quitter le navigateur.

**Suivi des relations** — Liez les contacts entre eux et aux appels, conversations et rapports. Construisez une image complète des personnes que vous aidez.

**Liaison automatique** — Les appels et messages entrants sont automatiquement liés aux contacts connus par correspondance des numéros de téléphone.

**Accès basé sur les équipes** — Contrôlez quels membres de l'équipe peuvent voir quels contacts. Les permissions sont granulaires et configurables.

**Étiquettes et admission** — Organisez les contacts avec des étiquettes. Les workflows d'admission acheminent les nouveaux contacts vers révision.

**Import/export en masse** — Importez des contacts depuis CSV ou JSON. Exportez des sauvegardes chiffrées. Tout le traitement s'effectue dans votre navigateur.

## Permissions configurables

**Rôles personnalisés** — Définissez vos propres rôles avec exactement les permissions dont vous avez besoin. Commencez à partir des modèles intégrés (Administrateur, Bénévole, Rapporteur) ou construisez à partir de zéro.

**Permissions granulaires** — Plus de 90 permissions individuelles réparties sur 17 domaines de fonctionnalités. Contrôlez qui peut voir, créer, modifier et supprimer à un niveau fin.

**Portée par équipe** — Affectez les membres de l'équipe à des équipes. Les permissions peuvent être limitées à des équipes spécifiques, permettant à différents groupes de voir différentes données.

## Tableau de bord administrateur

**Assistant de configuration** — Configuration guidée en plusieurs étapes lors de la première connexion administrateur. Choisissez les canaux à activer (Voix, SMS, WhatsApp, Signal, Rapports), configurez les fournisseurs et définissez le nom de votre ligne d'assistance.

**Liste de contrôle de démarrage** — Widget de tableau de bord qui suit la progression de la configuration : configuration des canaux, intégration des bénévoles, création des quarts de travail.

**Surveillance en temps réel** — Visualisez les appels actifs, les appelants en file d'attente, les conversations et le statut des bénévoles en temps réel. Les métriques se mettent à jour instantanément.

**Gestion des utilisateurs** — Invitez de nouveaux membres de l'équipe via des liens sécurisés. Ils créent leurs propres comptes et clés de chiffrement. Gérez les rôles, les permissions et les affectations d'équipe.

**Journal d'audit** — Chaque appel répondu, note créée, message envoyé, rapport soumis, paramètre modifié et action administrative est enregistré. Visionneuse paginée pour les administrateurs.

**Historique des appels** — Historique des appels consultable et filtrable avec plages de dates, recherche par numéro de téléphone et affectation de bénévole. Export de données conforme au RGPD.

**Aide intégrée** — Sections FAQ, guides spécifiques aux rôles, fiches de référence rapide pour les raccourcis clavier et la sécurité. Accessible depuis la barre latérale et la palette de commandes.

## Expérience bénévole

**Palette de commandes** — Appuyez sur Ctrl+K (ou Cmd+K sur Mac) pour un accès instantané à la navigation, à la recherche, à la création rapide de notes et au changement de thème. Les commandes réservées aux administrateurs sont filtrées par rôle.

**Notifications en temps réel** — Les appels entrants déclenchent une sonnerie de navigateur, une notification push et un titre d'onglet clignotant. Activez ou désactivez chaque type de notification indépendamment dans les paramètres.

**Présence des bénévoles** — Les administrateurs voient les comptes en ligne, hors ligne et en pause en temps réel. Les bénévoles peuvent basculer l'interrupteur de pause dans la barre latérale pour suspendre temporairement les appels entrants sans quitter leur quart de travail.

**Raccourcis clavier** — Appuyez sur ? pour voir tous les raccourcis disponibles. Naviguez entre les pages, ouvrez la palette de commandes et effectuez des actions courantes sans toucher la souris.

**Sauvegarde automatique des brouillons de notes** — Les notes sont automatiquement enregistrées comme brouillons chiffrés dans le navigateur. Si la page se recharge ou si le bénévole part, son travail est préservé. Les brouillons sont effacés du localStorage à la déconnexion.

**Export de données chiffré** — Exportez les notes sous forme de fichier chiffré (.enc) conforme au RGPD, protégé par votre clé de chiffrement multi-facteurs. Seul l'auteur original peut déchiffrer l'export.

**Thèmes sombre/clair** — Basculez entre le mode sombre, le mode clair ou suivez le thème du système. La préférence persiste par session.

## Multilingue et mobile

**12+ langues** — Traductions complètes de l'interface : anglais, espagnol, chinois, tagalog, vietnamien, arabe, français, créole haïtien, coréen, russe, hindi, portugais et allemand. Support RTL pour l'arabe.

**Application Web progressive** — Installable sur n'importe quel appareil via le navigateur. Le service worker met en cache l'enveloppe de l'application pour le lancement hors ligne. Notifications push pour les appels entrants.

**Design mobile-first** — Mise en page responsive conçue pour les téléphones et tablettes. Barre latérale rétractable, contrôles adaptés au tactile et mises en page adaptatives.

## Authentification et gestion des clés

**Protection des clés multi-facteurs** — Votre clé de chiffrement est protégée par jusqu'à trois facteurs indépendants : un code PIN de votre choix, votre compte fournisseur d'identité, et une clé de sécurité matérielle optionnelle. Le compromis d'un seul facteur ne suffit pas.

**Intégration du fournisseur d'identité** — Gestion d'identité auto-hébergée (sous votre contrôle). Intégration basée sur les invitations — aucun partage de clés secrètes. Révocation de session à distance — verrouillez un appareil compromis depuis n'importe où.

**Gestion automatique des sessions** — Les sessions se rafraîchissent silencieusement en arrière-plan. Le verrouillage automatique en cas d'inactivité protège les appareils sans surveillance. Votre clé de chiffrement vit dans un processus isolé, jamais accessible depuis la page.

**Liaison d'appareils** — Configurez de nouveaux appareils en toute sécurité. Scannez un code QR ou saisissez un code de provisionnement court. Utilise un échange de clés éphémère — votre clé secrète n'est jamais exposée pendant le transfert.

**Clés de récupération** — Lors de l'intégration, vous recevez une clé de récupération pour les urgences. Sauvegarde chiffrée obligatoire avant de pouvoir continuer.

**Clés de sécurité matérielles** — Prise en charge optionnelle des passkeys pour une connexion résistante au phishing. Enregistrez une clé matérielle ou biométrique, puis connectez-vous sans saisir d'identifiants.

**Confidentialité persistante par note** — Chaque note est chiffrée avec une clé aléatoire unique, puis cette clé est encapsulée via ECIES pour chaque lecteur autorisé. Le compromis de la clé d'identité ne révèle pas les notes précédentes.
