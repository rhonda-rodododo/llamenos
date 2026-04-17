---
title: Awoodaha
subtitle: Wax kasta oo platform-ka jawaabta xisaadaha u baahan yahay, hal xirmo open-source ah. Cod, SMS, WhatsApp, Signal, iyo warbixinno sirta ah — is-hosted si loo helo xakame ugu badan.
---

## Telefooniyada Bixiye-Kala-Duwan

**5 bixiye cod ah** — Dooro Twilio, SignalWire, Vonage, Plivo, ama Asterisk is-hosted. Hagaaji bixiyahaaga UI-goosta goobaha maamulka ama inta lagu jiro setup wizard-ka. Beddel bixiyeyaal wakhti kasta adigoon beddelin koodhka.

**Wicitaan browser-ka WebRTC** — Siiwacalayaal wax ka jawaabi karaan wicitaanka si toos ah browser-ka adigoon telefoon u baahan. Sameynta token-ka WebRTC ee ku habboon bixiyaha: Twilio, SignalWire, Vonage, iyo Plivo. Hagaaji doonista wicitaanka siiwacalaha (telefoon, browser, ama labadaba).

## Waddooyinka Wicitaanka

**Ringing isdaba joog ah** — Marka wiciye uu waco, siiwacal kasta oo shaqada ku jira oo aan mashquul ahayn isla markiiba uu u dhaco. Siiwacalaha ugu horreeya ee qaata wuxuu helayaa wicitaanka; kuwa kale oo dhacaya si dhakhso ah way joooshaan.

**Jadwal shaqo ku salaysan** — Abuur shaqooyin soo noqnoqda maalmo iyo waqti go'an leh. U qoondee siiwacalayaasha shaqooyinka. Nidaamku si otomaatig ah u waddooyiya wicitaanka kuwa shaqada jooga.

**Saf music-hodan** — Haddii dhammaan siiwacalayaashu ay mashquul yihiin, wiciyayaashu waxay galaan saf music-hodan leh. Xadiga waqtiga safku waa la hagaajin karaa (30-300 ilbiriqsi). Marka aanu qof jawaabin, wicitaanku wuxuu u dhacaa fariimaha codka.

**Fariimaha codka ee backup** — Wiciyayaashu waxay ka tagi karaan fariin cod ah (ilaa 5 daqiiqo) haddii aan qof jawaabin. Fariimaha codka waxaa lagu turjumayaa AI Whisper oo lagu sirtayaa si loo faahfaahiyo maamulka.

## Qoraallada Sirta ah

**Qoraal dhinacyo-dhammaadka u dhexeeya sirta ah** — Siiwacalayaal waxay qoraayaan qoraal inta iyo kadib wicitaannada. Qoraalladu waxay ku sifaysan yihiin dhinaca isticmaalaha adigoon ka bixin browser-ka, iyagoo isticmaalaya ECIES (secp256k1 + XChaCha20-Poly1305). Server-ka waxa uu kaydiyaa kaliya ciphertext.

**Sirta laban-laabta ah** — Qoraal kasta waxaa lagu sifayaa laban-laab: mar uu qoray siiwacalaha, iyo mar maamulka. Labaduba si madax-bannaan ayay furi karaan. Qof kale ma akhri karo waxa ku qoran.

**Goobaha la hagaajiyo** — Maamulayaal waxay go'aamiyaan goobaha la dhaqmo ee qoraallada: text, number, select, checkbox, textarea. Goobaha waxaa lagu sifayaa isla qoraalka.

**Keydka otomaatig ee draft-ka** — Qoraalladu waxay si otomaatig ah ugu keydsamaan draft-ka sirta ah browser-ka. Haddii boggu dib u soo baxo ama siiwacaluhu ka tago, shaqadiisu way ilaashantaa. Draft-yada waxaa la nadiifiyaa marka la ka baxo.

## Turjumaadda AI

**Turjumaad kooxda korkaisa** — Wicitaannadu waxaa lagu turjumayaa AI oo si buuxda u shaqeeya browser-ka siiwacalaha. Codka marnaba ma ka tago device-ka. Kaliya transcript-ka sirta ah ayaa la keydiyaa.

**Xakamaynta maamulka iyo siiwacalaha** — Maamulayaal waxay awood u leeyihiin inay furan yihiin ama ay xirtoon turjumaadda guud ahaan. Siiwacalayaal shaqsiga ahaan way ka tagi karaan. Labada toggle waxay madax-bannaan yihiin.

**Transcript-ka sirta ah** — Transcript-yadu waxay isticmaalaan isla sirta ECIES ee qoraallada. Transcript-ka la keydiyaa waa ciphertext kaliya.

## Yareynta Spam-ka

**Voice CAPTCHA** — Xulasho ku saabsan bot-ka codka: wiciyayaashu waxay maqlaan lambbar 4-tiro ah oo isbedbeddel ah oo ay soo gelinayaan keyboard-ka telefoonka. Ka hortagaa wicitaannada otomaatig-ka ah inta la fududeynayo wiciyayaasha dhabta ah.

**Xaddidaadda xawaaraha** — Xaddidaadda xawaaraha ee daaqadda u dhexeysa ee lambarka telefoonka, oo ku jirta database-ka. Xaddidaad la hagaajin karo oo ka nool dib-u-soo-celinta.

**Liisaska reer-booliska waqti-dhabta ah** — Maamulayaal waxay maamulaan liisaska reer-booliska ee lambarrada telefoonka hal qoraal ama bulk import. Reer-booliska si dhakhso ah ayay dhaqan u galaan. Wiciyayaasha la reer-booliyay waxay maqlaan fariin diidmo ah.

**Fariimaha IVR la hagaajiyo** — Diiwaangeli fariimaha codka ee luuqad kasta ee la taageero. Nidaamku waxuu isticmaalaa diiwaangelintaada IVR, oo uu ugu laabto text-to-speech marka aan diiwaangelin jirin.

## Fariimaha Islahlabka Kala-Duwan

**SMS** — Fariimaha soo gala iyo soo baxa ee SMS via Twilio, SignalWire, Vonage, ama Plivo. Jawaab otomaatig ah fariin soo dhaweyn leh. Fariimuhu waxay u dhacaan muuqaalka wada-hadalka threaded.

**WhatsApp Business** — Ku xiriir via Meta Cloud API (Graph API v21.0). Taageerada fariimaha template-ka ee bilaabidda wada-hadalka gudaha 24-saacaddood ee fariimaha. Taageerada fariimaha media-ga ah ee sawirrada, dukumeentiyada, iyo codka.

**Signal** — Fariin ku saabsan astaamaha gaarka ah via self-hosted signal-cli-rest-api bridge. Baaritaanka caafimaadka iyagoo leh degradation raalligelin leh. Turjumaadda fariimaha codka via on-device Whisper AI.

**Wada-hadalka threaded-ka** — Dhammaan islaahlabka fariimuhu waxay u dhacaan muuqaal wada-hadal la mid ah. Buubbulada fariimaha iyagoo leh waqti iyo tilmaamaha jihada. Cusboonaysiinta waqti-dhabta ah. Dhammaan fariimuhu waxay ku sifaysan yihiin server-kaaga marka ay yimaadaan. Server-ka waxa uu kaydiyaa kaliya ciphertext.

## Warbixinno Sirta ah

**Doorashada reporter-ka** — Door muhiim ah oo loogu talagalay dadka soo gudbiya tilmaamo ama warbixinno. Reporters waxay arkaan interface fudud oo kaliya warbixinno iyo caawimaad leh. Waxaa loo casuumay isla waddada siiwacalayaasha, iyagoo leh door xulasho.

**Soo gudbinta sirta ah** — Waxa ku qoran warbixinnadu waxaa lagu sifayaa ECIES ka hor inta aysan ka bixin browser-ka. Cinwaannada plaintext ah ee triage, waxa ku qoran sirta ah ee gaarka ah. Lifaaqyaasha faylasha waxaa lagu sifayaa si gaar ah.

**Habka warbixinta** — Qaybaha ee habeynta warbixinno. Raacista xaaladda (open, claimed, resolved). Maamulayaal waxay qabsan karaan warbixinno oo jawaabi karaan jawaabaha threaded, sirta ah.

## Buugga Xiriirka

**Diiwaanada xiriirka ee sirta ah** — Keyd xogta xiriirka iyagoo leh sirta dhinacyo-dhammaadka u dhexeeya. Magacyada, lambarrada telefoonka, iimaylada, iyo qoraalladu waxaa lagu sifayaa ka hor inta aysan ka bixin browser-ka.

**Raacista xiriirka** — Xiriir qofka kale iyo wicitaannada, wada-hadalka, iyo warbixinno. Dhisaan sawirka qofka aad caawineyso.

**Isku-xirka otomaatig ah** — Wicitaannada iyo fariimaha soo gala si otomaatig ah waxay la xiriiraan dadka la yaqaan ee isbarbardhiga lambarrada telefoonka.

**Helitaanka ku salaysan kooxda** — Xakamee shaqalayaasha kooxda kuwa arki kara xiriirka gobannida. Ogolaanshaha way faahfaahsan yihiin oo la hagaajin karaa.

**Tag-yada iyo qaaddida** — Habee xiriirka tag-yada. Hababka qaaddida waxay waddooyiyaan xiriirka cusub si loo dib eego.

**Bulk import/export** — Soo deji xiriirka CSV ama JSON. Dhoofi backup-yada sirta ah. Dhammaan habeyntu waxay ka dhacdaa browser-kaaga.

## Oggolaanshaha la Hagaajiyo

**Doorka la hagaajiyo** — Go'aamid doorkaaga si aad u hesho oggolaanshaha aad u baahan tahay. Ka bilaaw template-yada gudaha (Admin, Volunteer, Reporter) ama ka dhiso bilow.

**Oggolaanshaha faahfaahsan** — In ka badan 90 oggolaanshaha kala duwan oo ka soo jeeda 17 aag farsamo. Xakamee kuwa arki kara, abuura, wax ka beddela, iyo tirtiri kara heer faahfaahsan.

**Xadidaadda kooxda** — U qoondee shaqalayaasha kooxaha. Oggolaanshaha waxay ku xiran karaan kooxaha gobannida, si kooxaha kala duwan ay u arkaan xogta kala duwan.

## Dashboard-ka Maamulka

**Setup wizard** — Hage multi-step marka ugu horreysa ee maamulku soo galo. Dooro islaahlabka aad furanayso (Cod, SMS, WhatsApp, Signal, Reports), hagaaji bixiyeyaasha, iyo magaca hotline-kaaga.

**Liiska Getting Started** — Widget dashboard oo raaciya horumarka setup-ka: hagaajinta islaahlabka, soo galinta siiwacalayaasha, abuurista shaqada.

**Baaritaanka waqti-dhabta ah** — Arag wicitaannada firfircoon, wiciyayaasha safka, wada-hadalka, iyo xaaladda siiwacalayaasha waqti-dhabta ah. Tirooyinku si dhakhso ah ayay cusbooneysiimaan.

**Maamulka isticmaalayaasha** — Casuum shaqalayaal cusub via xiriirada ammaanka. Waxay abuuraan koontadooda iyo furayaasha sirta ah. Maamul doorka, oggolaanshaha, iyo qoondeynta kooxaha.

**Diiwaangelinta baaritaanka** — Wicitaan kasta oo la jawaabay, qoraal la sameeyay, fariin la diray, warbixin la gudbiyay, goob la beddelay, iyo ficil maamul ah waxaa lagu diiwaangeliyaa. Muuqaal paginated ah maamulka.

**Taariikhda wicitaannada** — Taariikhda wicitaannada ee la raadin karo, la sifeeyo iyagoo leh waqti, raadinta lambarka telefoonka, iyo qoondeynta siiwacalaha. Dhoofinta xogta oo la raaco GDPR.

**Caawimaadka app-ka gudihiisa** — Qaybaha FAQ, haggaagga ku habboon doorka, kaararka tix-raaca ee keyboard shortcuts iyo amniga. La heli karaa sidebar-ka iyo command palette.

## Khibradda Siiwacalaha

**Command palette** — Riix Ctrl+K (ama Cmd+K Mac) si aad u hesho halbowlaha, raadinta, abuurista qoraal degdegsan, iyo beddelaanka theme-ka. Amarrada u gaarka ah maamulka waxay la sifayso doorka.

**Fariimaha waqti-dhabta ah** — Wicitaannada soo gala waxay keenaan ringtone browser-ka, push notification, iyo cinwaanka tab-ka ee dhalaalaya. Toggle nooc kasta oo fariin ah si madax-bannaan goobaha.

**Xaaladda joogtada siiwacalaha** — Maamulayaal waxay arkaan tirada online, offline, iyo on-break waqti-dhabta ah. Siiwacalayaal waxay beddeli karaan toggle break-ka ee sidebar-ka si ay u joojiyaan wicitaannada soo gala adigoon ka tagin shaqadooda.

**Keyboard shortcuts** — Riix ? si aad u aragto dhammaan shortcuts-yada la heli karo. Ku guuri bogag, fur command palette, iyo samee ficillo caadi ah adigoon taaban mouse-ka.

**Keydka otomaatig ee draft-ka qoraalka** — Qoraalladu waxay si otomaatig ah ugu keydsamaan draft-ka sirta ah browser-ka. Haddii boggu dib u soo baxo ama siiwacaluhu ka tago, shaqadiisu way ilaashantaa. Draft-yada waxaa la nadiifiyaa localStorage marka la ka baxo.

**Dhoofinta xogta sirta ah** — Dhoofi qoraallada sidii fayl sirta ah oo la raaco GDPR (.enc) oo uu ilaaliyo furaha multi-factor encryption-kaaga. Qofkii ugu horreeyay ee qoray oo keliya ayuu furi karaa dhoofinta.

**Theme-yada madow/caddaan** — U beddel dhexdhexaad mode-ka madow, caddaan, ama raac theme-ka nidaamka. Doonista kasta la keydiyaa.

## Luuqado Kala-Duwan & Mobile

**12+ luuqadood** — Turjumaadaha UI-ga buuxda: English, Spanish, Chinese, Tagalog, Vietnamese, Arabic, French, Haitian Creole, Korean, Russian, Hindi, Portuguese, iyo German. Taageerada RTL ee Arabic.

**Progressive Web App** — Ku rakib kasta oo kasta oo aad ka hesho browser-ka. Service worker-ka wuxuu kaydiyaa app shell si loo bilaabo offline. Push notifications wicitaannada soo gala.

**Habka ugu horreeya mobile-ka** — Qaab-dhisme responsive oo loogu talagalay telefoonada iyo tablet-yada. Sidebar la soo dhafi karo, xakamaynta la taaban karo, iyo qaab-dhisme adaptive.

## Xaqiijinta & Maamulka Furaha

**Ilaalinta furaha multi-factor** — Furahaaga sirta ah waxaa ilaaliya ilaa saddex arrimood madax-bannaan: PIN aad doorato, koontadaaga bixiye aqoontaada, iyo si ikhtiyaari ah furaha amniga hardware-ka. In la dhaawaco hal arrimood ma kugu filna.

**Isku-xirka bixiye aqoonta** — Maamulka aqoonsiga is-hosted (waxaad xakamaysaa). Soo galinta casuumad-based — ma jirto wax wadaagis furaha sirta ah. Ka reebista fadhiga remote — xir qalab la dhaawacay meel kasta.

**Maamulka fadhiga otomaatig ah** — Fadhiyadu waxay si aamusan u cusbooneysiimaan. Auto-lock-ka idle-ga wuxuu ilaaliyaa qalab aan la ilaalin. Furahaaga sirta ah wuxuu ku nool yahay hab dhac madax-bannaan, marnaba ma heli karo bogga.

**Isku-xirka qalabka** — Deji qalab cusub si ammaan ah. Soo scan QR code ama geli koodh provisioning gaagaaban. Isticmaalaya beddelka furaha ephemeral — furahaaga sirta ah marnaba ma soo baxdo inta lagu jiro wareejinta.

**Furaha soo kabashada** — Inta lagu jiro soo galida, waxaad heshaa furaha soo kabashada ee xaaladaha degdegga ah. Backup sirta ah oo qasacad ah ka hor intaadan sii wadin.

**Furaha amniga hardware-ka** — Taageerada ikhtiyaari ah ee passkey ee ka hortagaya phishing. Diiwaangeli furaha hardware ama biometrics, kadibna gal adigoon qorin aqoonsi.

**Sirta hore-ugu-dhacda qoraal kasta** — Qoraal kasta waxaa lagu sifayaa furaha random gaar ah, kadibna furahaas waxaa lagu duubaa ECIES ee aqoon kasta oo la ogolaaday. In la dhaawaco furaha aqoonsiga ma soo bandhigo qoraalladii hore.
