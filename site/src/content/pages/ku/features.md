---
title: Taybetmendiyên
subtitle: Her tiştê ku platformek bersivê ji bo krîzê hewce dike, di pakêtek çavkaniya vekirî de. Deng, SMS, WhatsApp, Signal û raporên şîfrekirî — xwe-hostkirî ji bo kontrola herî zêde.
---

## Telefoniya Pir-Peydawer

**5 peydawerên dengî** — Ji Twilio, SignalWire, Vonage, Plivo an Asterîska xwe-hostkirî yek hilbijêre. Peydawerê xwe di UI mîhengên rêvebirinê de an di dema sihirbaza mîhenganê de mîheng bike. Bêyî guhertina kodê her dem peydawer biguherîne.

**Bangên WebRTC-ê yên Gerokê** — Dilxwaz dikarin bê telefon rasterast di gerokê de bersiva bangan bidin. Çêkirina tokenên WebRTC-ya taybetî ji bo her peydawer ji bo Twilio, SignalWire, Vonage û Plivo. Preferenceya bangê ji bo her dilxwazekî mîhengkirî (telefon, gerok an her du).

## Rêveberiya Bangên

**Zincîra Hevdem** — Gava ku yek bang dike, hemû dilxwazên li ser kar û ne mijûl bi hev re dileyizin. Yê yekem ku bersivê bide bangê werdigire; zincîrên din rasterast radiwestin.

**Sibeoqatkirina Li Ser Bingehê Vardê** — Vardên dubare bi roj û demjimêrên taybet çêke. Dilxwazan li gorî vardan bide kar. Pergal bixwe bangan şandiye kesan ku li ser kar in.

**Rêz bi Muzîka Benda** — Heke hemû dilxwaz mijûl bin, bangder têkevin rêzek bi muzîka benda ya mîhengkirî. Dema benda rêzê dikare were mîhengkirin (30-300 saniye). Heke kesek bersivê nede, bang diçin dengnameyê.

**Veguherîna Dengnameyê** — Bangdar dikarin peyamekê dengî (heta 5 deqîqe) bihêlin heke ti dilxwazek bersivê nede. Dengname bi Whisper AI tê transkrîbkirin û ji bo nirxandina rêvebir tê şîfrekirin.

## Nîştekên Şîfrekirî

**Nivîsandina Nîştekên End-to-End** — Dilxwaz di dema û piştî bangê de nîştek dinivîsin. Nîştek li aliya xerîdar bi ECIES (secp256k1 + XChaCha20-Poly1305) tê şîfrekirin berî ku ji gerokê derkeve. Server tenê ciphertext tomar dike.

**Şîfrekirina Duqat** — Her nîştek du caran tê şîfrekirin: carek ji bo dilxwazê ku nivîsandiye û carek ji bo rêvebir. Her du dikarin bixwe decrypt bikin. Kesekî din nikare naverokê bixwîne.

**Qadên Kesane** — Rêvebir qadên kesane ji bo nîştekan diyar dikin: nivîs, hejmar, hilbijartin, qutiya kontrolê, qada nivîsê. Qad bi naveroka nîştekê re tê şîfrekirin.

**Xweber Tomarkirina Draftê** — Nîştek bixwe wekî draftên şîfrekirî di gerokê de tên tomarkirin. Ger rûpel were nûkirin an dilxwaz derkeve, karê wî tê parastin. Draft dema derketinê tê jêbirin.

## Transkrîpsiyona AI

**Transkrîpsiyona li ser Cîhazê** — Bang bi AI-ya ku bi tevahî di geroka dilxwaz de diçe tê transkrîbkirin. Deng qet cîhazê terk nake. Tenê transkrîpsiyona şîfrekirî tê tomarkirin.

**Kontrolên Rêvebir û Dilxwaz** — Rêvebir dikarin transkrîpsiyonê li hemû cîhanê çalak an neçalak bikin. Dilxwaz dikarin bi serê xwe derkevin. Her du switch serbixwe ne.

**Transkrîpsiyên Şîfrekirî** — Transkrîpsiyon heman şîfrekirina ECIES ya nîştekan bi kar tînin. Transkrîpsiyona tomarkirî tenê ciphertext e.

## Kêmkirina Spamê

**Voice CAPTCHA** — Vebijêrk ji bo dîtina botên dengî: bangder jimareke keture ya 4-hejmarî dibihîze û divê ew li ser keypadê têkeve. Digrêyê otomatîk asteng dike lê ji bo bangderên rastî gihînbar e.

**Sînorê Rêjeyê** — Sînorê rêjeyê bi paceya herikbar ji bo her numreya telefonê, li databasê mayînde. Astengên mîhengkirî piştî nûkirina serverê dimînin.

**Lîsteyên Qedexeya Demê Rast** — Rêvebir lîsteyên qedexeya numreyên telefonê bi têketinek an jî importa komî birêve dibin. Qedexeyên demê rast bi bandor in. Bangderên qedexe peyamek redê dibihîzin.

**Promptên IVR-ya Kesane** — Ji bo her zimanekî piştgirîkirî promptên dengî yên kesane tomar bike. Pergal ji bo rêyên IVR-ê tomarên te bi kar tîne, dema ku tomar tuneye vegeriya text-to-speech dibe.

## Peyamkirina Pir-Kenal

**SMS** — Peyamên SMS-ê yên hatî û çûyî ji hêla Twilio, SignalWire, Vonage an Plivo ve. Bersiva xweber bi peyamên xêrhatinê yên mîhengkirî. Peyaman di nava dîtina axaftinê de diherikin.

**WhatsApp Business** — Bi Meta Cloud API (Graph API v21.0) ve têkiliyê deyne. Piştgirî ji bo peyamên şablonê ji bo destpêkirina axaftinan di nav paceya 24-saatî de. Piştgirî ji bo peyamên medya ji bo wêne, belge û deng.

**Signal** — Peyamkirina li ser bingeha nepeniyê bi rêya pirêya signal-cli-rest-api ya xwe-hostkirî. Çavdêriya tendirustiyê bi degradeyê bedew. Transkrîpsiyona peyama dengî bi Whisper AI ya li ser cîhazê.

**Axaftinên Biçûk** — Hemû kanalên peyamkirînê di dîtineke yekbûyî ya axaftinê de diherikin. Baloncikên peyamê bi demjimêr û nîşangerên rêyê. Nûvekirinên demê rast. Hemû peyam dema ku tên ser serverê te tên şîfrekirin. Server tenê ciphertext tomar dike.

## Raporên Şîfrekirî

**Rola Raporger** — Rola taybet ji bo kesên ku serişte an raporan pêşkêş dikin. Raporger tenê navberekê sade ku rapor û alîkarî tê de ne dibînin. Mîna dilxwazan bi heman rêyê tên vexwendin, bi hilbijarteka roleyê.

**Pêşkêşkirên Şîfrekirî** — Bedena raporê berî ku ji gerokê derkeve bi ECIES tê şîfrekirin. Sernavên plaintext ji bo tasnîfê ne, naveroka şîfrekirî ji bo nepeniyê ye. Pelên pêvekê bi serê xwe tên şîfrekirin.

**Rêya Karê Raporê** — Kategorî ji bo rêkxistina raporan. Şopandina rewşê (vekirî, hatî xwestin, hatî çareserkirin). Rêvebir dikarin raporan bixwazin û bi bersivên şîfrekirî yên biçûk bersiv bidin.

## Pelê Têkiliyan

**Tomarên Têkiliyan ên Şîfrekirî** — Agahiyên têkiliyê bi şîfrekirina end-to-end tomar bike. Nav, numreyên telefonê, e-maîl û nîştek berî ku ji gerokê derkevin tên şîfrekirin.

**Şopandina Pêwendiyan** — Têkiliyan bi hev û bi bang, axaftin û raporan ve girê bide. Dîrokeke temam a kesan ku tu alîkariya wan dikî çêke.

**Oto-girêdan** — Bang û peyamên hatî bi têkiliyên naskirî re bi rêya hevdana numreyên telefonê bixwe têne girêdan.

**Gihiştina Li Ser Bingehê Tîmê** — Kontrol bike ka kîjan endamên tîmê kîjan têkiliyan dibînin. Destûr biçûk û mîhengkirî ne.

**Etîket û Qebûlkirin** — Têkiliyan bi etîketan rêxistin bike. Rêyên qebûlkirinê têkiliyên nû şandine nirxandinê.

**Import/Eksporta Komî** — Têkiliyan ji CSV an JSON import bike. Backupên şîfrekirî eksport bike. Hemû pêvajoya li ser geroka te pêk tê.

## Destûrên Mîhengkirî

**Rolên Kesane** — Rolên xwe yên bi tam destûrên ku pêwîstî te ne diyar bike. Ji şablonên sêvekî (Rêvebir, Dilxwaz, Raporger) dest pê bike an ji nû ve çêke.

**Destûrên Biçûk** — Zêdetirî 90 destûrên takekesî di 17 qadên taybetmendiyê de. Kontrol bike ka kî dikare li ser astekî biçûk temaşe, çêke, biguhere û jê bibe.

**Qadîna Tîmê** — Endamên tîmê li tîman bide kar. Destûr dikarin werin sînorkirin ji bo tîmên taybet, ji ber vê yekê komên cihê dîtana cuda dibînin.

## Panela Rêvebirinê

**Sihirbaza Mîhengan** — Mîhengkirina gidekirî ya pir-qaîdeyê li ser têketina rêvebira yekem. Hilbijêre ka kîjan kanal bixebitînin (Deng, SMS, WhatsApp, Signal, Rapor), peydaweran mîheng bike, û navê xeta xwe ya germ saz bike.

**Lîsteya Kontrolê ya Destpêkê** — Widgeta panelê ku pêşveçûna mîhengan bişopîne: mîhengkirina kanalan, têketina dilxwazan, çêkirina vardan.

**Çavdêriya Demê Rast** — Bangên çalak, bangderên li ser rêzê, axaftin û rewşa dilxwazan bi demê rast bibîne. Metrîk demekî nû dibin.

**Rêveberiya Bikarhêner** — Bi rêya lînkên ewle endamên nû yên tîmê vexwîne. Ew hesab û kilîdên şîfrekirinê yên xwe çêdikin. Rol, destûr û erkên tîmê bi rêve bibe.

**Tomarkirina Lêkolînê** — Her bangek bersiv kirî, nîştek çêkirî, peyamek şandî, raporek pêşkêş kirî, mîhengek guherî û çalekiya rêvebirinê tê tomarkirin. Dîtina ku bi rûpelan ji bo rêvebiran.

**Dîroka Bangan** — Dîroka bangên ku dikare were lêgerîn û parzûnkirin bi navberên rojê, lêgerîna numreyê telefonê û erkê dilxwazî. Eksporta daneyên li gorî GDPR.

**Alîkariya di Nav Sepanê de** — Beşên FAQ, rêbernameyên taybetî ji bo rolê, kartên referansa lezgîn ji bo klavyeyê û ewlehiyê. Ji sidebar û paleta fermanan ve tê gihîn.

## Tecrûbeya Dilxwazê

**Paleta Fermanan** — Ctrl+K (an jî Cmd+K li ser Mac) pêlî bike ji bo gihînê bilez a navîgasyonê, lêgerînê, çêkirina bilez a nîştekan û guherandina tema. Fermanên tenê ji bo rêvebiran li gorî rolê tên parzûnkirin.

**Agahdariyên Demê Rast** — Bangên hatî dengê gerokê, agahdariya push û sernavê tabê yê bliqînê deynin. Her celebê agahdariyê bi serê xwe di mîhengan de biguherîne.

**Hebûna Dilxwazê** — Rêvebir hejmarên demê rast ên serhêl, derhêl û ser werisekê dibînin. Dilxwaz dikarin li sidebar switcha werisekê bikin da ku bêyî ku ji karê xwe derkevin bangên hatî demkî rawestînin.

**Kurtayên Klavyeyê** — ? pêlî bike da ku hemû kurtayên hebûnî bibîne. Li ser rûpelan bigere, paleta fermanan veke û çalakiyên hevpar bêyî ku bi mişkî were tijekirin bike.

**Xweber Tomarkirina Drafta Nîştekê** — Nîştek bixwe wekî draftên şîfrekirî di gerokê de tên tomarkirin. Ger rûpel were nûkirin an dilxwaz derkeve, karê wî tê parastin. Draft dema derketinê ji localStorage tê jêbirin.

**Eksporta Daneyên Şîfrekirî** — Nîştek wekî pelê şîfrekirî (.enc) ya li gorî GDPR eksport bike, bi kilîda şîfrekirina pir-faktorê ya te parastî. Tenê nivîskarê orjînal dikare eksportê decrypt bike.

**Tema Tarî/Ronî** — Di navbeyna moda tarî, moda ronî an tema pergalê de biguhere. Bijare ji bo her danişînê dom dike.

## Pirzimanî û Mobîl

**12+ ziman** — Wergerkirina UI-ya temam: Îngilîzî, Îspanyolî, Çînî, Tagalog, Viyetnamî, Erebî, Fransizî, Haîtî-kreolî, Koreyî, Rûsî, Hindî, Portekîzî û Almanî. Piştgirîya RTL ji bo Erebî.

**Sepana Web-a Pêşveçû** — Li ser her cîhazekî bi rêya gerokê tê sazkirin. Service worker ji bo destpêkirina offline app shell cache dike. Agahdariyên push ji bo bangên hatî.

**Sêwirana Pêşî Mobîl** — Layouta responsive ya ku ji bo telefon û tabletan hatiye sêwirandin. Sidebar-a têkildar, kontrolên dostane yên touch û layoutên adapte.

## Rastbûnê û Rêveberiya Kilîdê

**Parastina Kilîdê ya Pir-Faktor** — Kilîda şîfrekirina te heta sê faktorên serbixwe tê parastin: PINek ku te hilbijartiye, hesabê peydawerê nasnameya te, û bi vebijarkî kilîdeke ewlehiya hardware. Têkbirina her yek faktorekî têr nake.

**Yekbûna Peydawerê Nasnameyê** — Rêveberiya nasnameya xwe-hostkirî (di bin kontrola te de). Têketina li ser bingeha vexwendinê — hewceya parvekirinê bi kilîdên veşartî nîne. Betalkirina danişînê ji dûr — cîhazeke têkbirî ji her derê asteng bike.

**Rêveberiya Otomatîk a Danişînê** — Danişîn bêdeng di paşnava de nû dibin. Quflkirina otomatîk a bêalîkarî cîhazên bêçavdêrî diparêze. Kilîda şîfrekirina te di pêvajoyekî cuda de dimîne, qet ji rûpelê ve nayê gihiştin.

**Girêdana Cîhazan** — Cîhazên nû bi ewlehiyê saz bike. Kodê QR-ê bixwîne an kodê provîzyonê yê kurt têkeve. Bikar anîna guhertina kilîdên demkî — kilîda veşartî ya te di dema veguhastinê de qet eşkere nabe.

**Kilîdên Vegerrê** — Di dema têketinê de, tu dê kilîdeke vegerrê ji bo rewşên acîl bistînî. Pêdiviya bi backupa şîfrekirî ya mecbûrî berî ku pêşde biçe.

**Kilîdên Ewlehiya Hardware** — Piştgirîya vebijarkî ji bo passkey-ê ji bo têketina li dijî phishing-ê. Kilîdeke hardware an jî biometrîk qeyd bike, paşê bêyî ku agahiyên têketinê binivîsî têkeve.

**Forward Secrecy ya Her Nîştekê** — Her nîştek bi kilîdeke keture ya taybet tê şîfrekirin, paşê ew kilîd ji bo her xwendekarekî destûrdar bi ECIES tê pakirin. Têkbirina kilîda nasnameyê nîştekên berê eşkere nake.
