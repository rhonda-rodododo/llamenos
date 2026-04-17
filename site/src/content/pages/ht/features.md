---
title: Karakteristik
subtitle: Tout sa yon platfòm repons pou kriz bezwen, nan yon pake open-source. Vwa, SMS, WhatsApp, Signal, ak rapò chifre — self-hosted pou kontwòl maksimòm.
---

## Telefoni Multi-Founisè

**5 founisè vwa** — Chwazi nan Twilio, SignalWire, Vonage, Plivo, oswa Asterisk ki self-hosted. Konfigire founisè ou a nan entèfas anviwònman admin an oswa pandan setup wizard la. Chanje founisè nenpòt lè san chanje kòd.

**Rele atravè navigatè WebRTC** — Volontè ka reponn apèl dirèkteman nan navigatè yo san telefòn. Jenere jeton WebRTC espesifik pou chak founisè pou Twilio, SignalWire, Vonage, ak Plivo. Prefereans apèl konfigirab pou chak volontè (telefòn, navigatè, oswa tou de).

## Rooting Apèl

**Sonè paralèl** — Lè yon moun rele, tout volontè ki sou baz ak ki pa okipe sonè an menm tan. Premye a ki reponn pran apèl la; lòt sonè yo kanpe touswit.

**Pwogramasyon baz sou baz** — Kreye baz ki repete ak jou ak è espesifik. Asiyen volontè nan baz. Sistèm nan otomatikman root apèl yo bay moun ki sou devwa.

**File ak mizik atant** — Si tout volontè okipe, moun ki rele yo antre nan yon file ak mizik atant ki konfigirab. Tan limit pou file a ajistab (30-300 segonn). Si pèsonn pa reponn, apèl yo ale nan mesaj vokal.

**Ranplasman mesaj vokal** — Moun ki rele yo ka kite yon mesaj vokal (jiska 5 minit) si pa genyen okenn volontè ki reponn. Mesaj vokal yo transkri atravè Whisper AI epi chifre pou revizyon admin.

## Nòt Chifre

**Pran nòt soti nan yon bout jiska lòt** — Volontè ekri nòt pandan ak aprè apèl la. Nòt yo chifre sou bò kliyan an lè l sèvi ak ECIES (secp256k1 + XChaCha20-Poly1305) anvan yo kite navigatè a. Sèvè a sèlman estoke tèks chifre a.

**Chifreman doub** — Chak nòt chifre de fwa: yon fwa pou volontè a ki ekri li, ak yon fwa pou admin an. Tou de ka dekripte endepandaman. Pèsonn lòt pa ka li kontni an.

**Jàn espesyal** — Admin yo defini jàn espesyal pou nòt: tèks, nimewo, chwazi, bwat chèk, zòn tèks. Jàn yo chifre ansanm ak kontni nòt la.

**Anrejistreman otomatik bouyon** — Nòt yo anrejistre otomatikman kòm bouyon chifre nan navigatè a. Si paj la rechaje oswa volontè a pati, travay li prezevwe. Bouyon yo efase lè dekonksyon an fèt.

## Transkripsyon AI

**Transkripsyon sou aparey** — Apèl yo transkri lè l sèvi ak AI ki kouri nèt nan navigatè volontè a. Odio a pa janm kite aparey la. Sèlman transkri a ki chifre estoke.

**Kontwòl admin ak volontè** — Admin yo ka aktive oswa enfim transkripsyon nan nivo mondyal. Volontè yo ka chwazi pa patisipe endepandaman. De bouton yo endepandan.

**Transkri chifre** — Transkripsyon yo sèvi ak menm chifreman ECIES ak nòt yo. Transkri a ki estoke se sèlman tèks chifre.

## Rediksyon Spam

**CAPTCHA vwa** — Deteksyon opsyonèl pou robo vwa: moun ki rele a tande yon nimewo 4 chif ki pa posib pwediksyon epi li dwe antre li sou klavye a. Anpeche automatisation rele pandan li rete aksesib pou vre moun ki rele.

**Limitasyon vitès** — Limitasyon vitès ak fennèt glisan pou chak nimewo telefòn, ki pèsiste nan baz done a. Sey ki konfigirab yo siviv rekòmansman.

**Lis entèdiksyon an tan reyèl** — Admin yo jere lis entèdiksyon nimewo telefòn ak antre inik oswa enpòt mas. Entèdiksyon yo efè imedyat. Moun ki entèdi yo tande yon mesaj rejèksyon.

**Pwompt IVR personlize** — Anrejistre pwompt vwa personlize pou chak lang ki supporte. Sistèm nan itilize anrejistreman ou yo pou flux IVR yo, epi li retounen nan tèks pou lapawòl lè pa gen anrejistreman.

## Mesaj sou Plizyè Chèn

**SMS** — Mesaj SMS antre ak soti atravè Twilio, SignalWire, Vonage, oswa Plivo. Repons otomatik ak mesaj byenvini ki konfigirab. Mesaj yo koule nan yon vi konvèsasyon ki gen fil.

**WhatsApp Business** — Konekte atravè Meta Cloud API (Graph API v21.0). Sipò pou mesaj modèl pou kòmanse konvèsasyon nan fenèt mesaj 24 èdtan an. Sipò pou mesaj medya pou imaj, dokiman, ak odio.

**Signal** — Mesaj ki konsantre sou vi prive atravè yon pon signal-cli-rest-api ki self-hosted. Siveyans sante ak degrade grasye. Transkripsyon mesaj vwa atravè Whisper AI sou aparey.

**Konvèsasyon ki gen fil** — Tout chèn mesaj yo koule nan yon vi konvèsasyon inifye. Bèl mesaj ak tan ak endikatè direksyon. Mizajou an tan reyèl. Tout mesaj chifre sou sèvè ou a konsa yo rive. Sèvè a sèlman estoke tèks chifre a.

## Rapò Chifre

**Wòl rapòtè** — Yon wòl espesyal pou moun ki soumèt konsèy oswa rapò. Rapòtè yo sèlman wè yon entèfas senplifye ak rapò ak èd. Envite atravè menm flux ak volontè yo, ak selektè wòl.

**Soumisyon chifre** — Kò rapò a chifre lè l sèvi ak ECIES anvan li kite navigatè a. Tit tèks klè a se pou triyaj, kontni chifre a se pou vi prive. Fichye atachman yo chifre endepandaman.

**Pwosesis rapò** — Kategori pou òganize rapò yo. Swiv estati (ouvè, reklame, rezoud). Admin yo ka reklame rapò epi reponn ak replik chifre ki gen fil.

## Reperwa Kontak

**Dosye kontak chifre** — Estoke enfòmasyon kontak ak chifreman soti nan yon bout jiska lòt. Non, nimewo telefòn, imèl, ak nòt chifre anvan yo kite navigatè a.

**Swiv relasyon** — Lye kontak yo youn ak lòt ak ak apèl, konvèsasyon, ak rapò. Bati yon imaj ki konplè sou moun ou ede yo.

**Oto-lye** — Apèl ak mesaj ki antre otomatikman lye ak kontak ki koni yo atravè matche nimewo telefòn.

**Aksè baz sou ekip** — Kontwòle ki manm ekip ka wè ki kontak. Pèmisyon yo detaye epi konfigirab.

**Etikèt ak akseyi** — Organize kontak yo ak etikèt. Pwosesis akseyi yo root nouvo kontak pou revizyon.

**Enpòt/ekspòt mas** — Enpòte kontak soti nan CSV oswa JSON. Ekspòte bakop chifre. Tout trètman an fèt nan navigatè ou a.

## Pèmisyon Konfigirab

**Wòl personlize** — Defini pwòp wòl ou yo ak ekzakteman pèmisyon ou bezwen yo. Kòmanse ak modèl entegre yo (Admin, Volontè, Rapòtè) oswa bati depi nan anyen.

**Pèmisyon detaye** — Plis pase 90 pèmisyon endividyèl atravè 17 zòn karakteristik. Kontwòle ki moun ka gade, kreye, modifye, epi efase nan yon nivo detaye.

**Pòtej ekip** — Asiyen manm ekip nan ekip. Pèmisyon yo ka limite nan ekip espesifik, konsa gwoup diferan wè done diferan.

## Tablo Administratè

**Wizard konfigirasyon** — Konfigirasyon an plizyè etap gidé sou premye koneksyon admin an. Chwazi ki chèn pou aktive (Vwa, SMS, WhatsApp, Signal, Rapò), konfigire founisè yo, epi mete non liy dirèk ou a.

**Lis verification Kòmanse** — Widget tablo pou swiv pwogrè konfigirasyon an: konfigirasyon chèn, akèy volontè, kreyasyon baz.

**Siveyans an tan reyèl** — Gade apèl aktif, moun ki nan file, konvèsasyon, ak estati volontè an tan reyèl. Metrik yo mete ajou enstan.

**Jesyon itilizatè** — Envite nouvo manm ekip atravè lyen sekirite. Yo kreye pwòp kont ak kle chifreman yo. Jere wòl, pèmisyon, ak asiyasyon ekip.

**Jounal audit** — Chak apèl ki reponn, nòt ki kreye, mesaj ki voye, rapò ki soumèt, anviwònman ki modifye, ak aksyon admin anrejistre. Gade pajine pou admin yo.

**Istwa apèl** — Istwa apèl ki chache ak filtre ak entèval dat, rechèch nimewo telefòn, ak asiyasyon volontè. Ekspòte done ki konfòm ak GDPR.

**Èd nan aplikasyon an** — Seksyon FAQ, gid espesifik pou chak wòl, kat referans rapid pou rakousi klavye ak sekirite. Aksesib nan ba lateral ak palette kòmand.

## Eksperyans Volontè

**Palette kòmand** — Peze Ctrl+K (oswa Cmd+K sou Mac) pou aksè enstan nan navigasyon, rechèch, kreyasyon rapid nòt, ak chanjman tèm. Kòmand sèlman pou admin yo filtre selon wòl.

**Notifikasyon an tan reyèl** — Apèl ki antre deklanche sonè navigatè, notifikasyon push, ak tit onglet ki klere. Bouton toggl endepandan pou chak kalite notifikasyon nan anviwònman yo.

**Prezans volontè** — Admin yo wè konb moun konekte, dekonekte, ak sou brake an tan reyèl. Volontè yo ka toggle switch brake nan ba lateral la pou kanpe apèl ki antre pou yon ti tan san kite baz yo.

**Rakousi klavye** — Peze ? pou wè tout rakousi ki disponib. Navige nan paj yo, louvri palette kòmand, ak fè aksyon kouran san manyen sourit.

**Anrejistreman otomatik bouyon nòt** — Nòt yo anrejistre otomatikman kòm bouyon chifre nan navigatè a. Si paj la rechaje oswa volontè a pati, travay li prezevwe. Bouyon yo efase nan localStorage lè dekonksyon an fèt.

**Ekspòte done chifre** — Ekspòte nòt yo kòm yon fichye chifre (.enc) ki konfòm ak GDPR, pwoteje pa kle chifreman an plizyè fakè ou a. Sèlman otè orijinal la ka dekripte ekspòtasyon an.

**Tèm nwa/sere** — Toggle ant mod nwa, mod sere, oswa swiv tèm sistèm nan. Prefereans la pèsiste pou chak sesyon.

## Multileng ak Mobl

**12+ lang** — Tradiksyon UI konplè: Anglè, Panyòl, Chinwa, Tagalog, Vyetnamyen, Arab, Fransè, Kreyòl Ayisyen, Koreyen, Ris, Hindi, Pòtigè, ak Alman. Sipò RTL pou Arab.

**Pwogresif Web App** — Enstale sou nenpòt aparey atravè navigatè a. Service worker an cache koki aplikasyon an pou lanse offline. Notifikasyon push pou apèl ki antre.

**Konsepsyon mobl premye** — Layout responsif ki fèt pou telefòn ak tablèt. Ba lateral ki ka pliye, kontwòl ki zanmi ak touch, ak layout adaptif.

## Otantifikasyon ak Jesyon Kle

**Pwoteksyon kle an plizyè fakè** — Kle chifreman ou pwoteje pa jiska twa fakè endepandan: yon PIN ou chwazi, kont founisè idantite ou a, ak opsyonèlman yon kle sekirite materyèl. Konpwomèt nenpòt yon sèl fakè pa ase.

**Entegrasyon founisè idantite** — Jesyon idantite ki self-hosted (ou nan kontwòl). Akèy baz sou envitasyon — pa gen pataje kle sekrè. Revokasyon sesyon aletranje — fèmen yon aparey ki konpwomèt soti nan nenpòt kote.

**Jesyon sesyon otomatik** — Sesyon yo rafrechi an silans nan background. Blòt otomatik lè pa gen aktivite pwoteje aparey san siveyans. Kle chifreman ou rete nan yon pwosesis izole, pa janm aksesib nan paj la.

**Lyen aparey** — Konfigire nouvo aparey yo an sekirite. Skennen yon kòd QR oswa antre yon kòd pwovizyonèl kout. Itilize echanj kle efemè — kle sekrè ou pa janm ekspoze pandan transfè a.

**Kle rekipere** — Pandan akèy la, ou pral resevwa yon kle rekipere pou ijans. Bakop chifre obligatwa anvan ou ka kontinye.

**Kle sekirite materyèl** — Sipò opsyonèl pou passkey pou koneksyon ki rezistan pou phishing. Anrejistre yon kle materyèl oswa byometrik, Lè sa a, konekte san ou pa dwe tape okenn enfòmasyon koneksyon.

**Sekirite pwojeksyon pa nòt** — Chak nòt chifre ak yon kle o aza inik, Lè sa a, kle sa a pake atravè ECIES pou chak lektè otorize. Konpwomèt kle idantite a pa devwale nòt ki te fè anvan.
