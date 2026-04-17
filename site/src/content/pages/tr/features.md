---
title: Özellikler
subtitle: Bir kriz müdahale platformunun ihtiyaç duyduğu her şey, tek bir açık kaynak pakette. Ses, SMS, WhatsApp, Signal ve şifreli raporlar — maksimum kontrol için kendi sunucunuzda barındırılır.
---

## Çoklu Sağlayıcı Telefon sistemi

**5 ses sağlayıcısı** — Twilio, SignalWire, Vonage, Plivo veya kendi sunucunuzda barındırılan Asterisk arasından seçim yapın. Sağlayıcınızı yönetici ayarları arayüzünde veya kurulum sihirbazı sırasında yapılandırın. Kod değişikliği yapmadan istediğiniz zaman sağlayıcı değiştirin.

**WebRTC tarayıcı üzerinden arama** — Gönüllüler, telefona ihtiyaç duymadan tarayıcı üzerinden aramaları yanıtlayabilir. Twilio, SignalWire, Vonage ve Plivo için sağlayıcıya özel WebRTC token oluşturma. Gönüllü başına yapılandırılabilir arama tercihi (telefon, tarayıcı veya her ikisi).

## Çağrı Yönlendirme

**Eşzamanlı çalma** — Bir arayan arama yaptığında, her vardiyadaki ve meşgul olmayan gönüllüye aynı anda çalma başlar. İlk cevap veren gönüllü aramayı alır; diğer çalmalar anında durur.

**Vardiya tabanlı zamanlama** — Belirli günler ve saat aralıkları ile yinelenen vardiyalar oluşturun. Gönüllüleri vardiyalara atayın. Sistem, aramaları otomatik olarak görevde olan kişilere yönlendirir.

**Bekle müziği olan kuyruk** — Tüm gönüllüler meşgulse, arayanlar yapılandırılabilir bekle müziği olan bir kuyruğa girer. Kuyruk zaman aşımı ayarlanabilir (30-300 saniye). Kimse cevap vermezse, aramalar sesli mesaja düşer.

**Sesli mesaj yedekleme** — Hiçbir gönüllü cevap vermezse, arayanlar bir sesli mesaj bırakabilir (en fazla 5 dakika). Sesli mesajlar, Whisper AI ile metne dönüştürülür ve yönetici incelemesi için şifrelenir.

## Şifreli Notlar

**Uçtan uca şifreli not alma** — Gönüllüler, arama sırasında ve sonrasında not yazar. Notlar, tarayıcıdan ayrılmadan önce istemci tarafında ECIES (secp256k1 + XChaCha20-Poly1305) kullanılarak şifrelenir. Sunucu yalnızca şifreli metni saklar.

**Çift şifreleme** — Her not iki kez şifrelenir: bir kez yazan gönüllü için, bir kez de yönetici için. Her ikisi de bağımsız olarak şifreyi çözebilir. Başka hiç kimse içeriği okuyamaz.

**Özel alanlar** — Yöneticiler, notlar için özel alanlar tanımlar: metin, sayı, seçim, onay kutusu, metin alanı. Alanlar, not içeriğinin yanı sıra şifrelenir.

**Taslak otomatik kaydetme** — Notlar, tarayıcıda şifreli taslaklar olarak otomatik kaydedilir. Sayfa yeniden yüklenirse veya gönüllü başka bir sayfaya giderse, çalışmaları korunur. Taslaklar, oturum kapatıldığında temizlenir.

## AI Transkripsiyon

**Cihaz üzerinde transkripsiyon** — Aramalar, tamamen gönüllünün tarayıcısında çalışan AI kullanılarak metne dönüştürülür. Ses hiçbir şekilde cihazı terk etmez. Yalnızca şifrelenmiş transkript saklanır.

**Yönetici ve gönüllü kontrolleri** — Yöneticiler, transkripsiyonu genel olarak etkinleştirebilir veya devre dışı bırakabilir. Gönüllüler bireysel olarak devre dışı bırakabilir. Her iki anahtar da birbirinden bağımsızdır.

**Şifreli transkriptler** — Transkriptler, notlarla aynı ECIES şifrelemesini kullanır. Saklanan transkript yalnızca şifreli metindir.

## Spam Önleme

**Ses CAPTCHA** — İsteğe bağlı ses botu algılama: arayanlar rastgele bir 4 basamaklı sayı duyar ve tuş takımına girmesi gerekir. Otomatik aramaları engellerken gerçek arayanlar için erişilebilir kalır.

**Hız sınırlama** — Veritabanında kalıcı, telefon numarası başına kayan pencere hız sınırlaması. Yeniden başlatmalardan sağ kalabilen yapılandırılabilir eşikler.

**Gerçek zamanlı yasak listeleri** — Yöneticiler, tek giriş veya toplu içe aktarma ile telefon numarası yasak listelerini yönetir. Yasaklar anında yürürlüğe girer. Yasaklanan arayanlar bir ret mesajı duyar.

**Özel IVR seslendirmeleri** — Desteklenen her dil için özel ses kayıtları yapın. Sistem, IVR akışları için kayıtlarınızı kullanır; kayıt yoksa metin-ses dönüşümüne geri döner.

## Çok Kanallı Mesajlaşma

**SMS** — Twilio, SignalWire, Vonage veya Plivo üzerinden gelen ve giden SMS mesajlaşma. Yapılandırılabilir karşılama mesajları ile otomatik yanıt. Mesajlar, iş parçacıklı konuşma görünümüne akar.

**WhatsApp Business** — Meta Cloud API (Graph API v21.0) üzerinden bağlantı. 24 saatlik mesajlaşma penceresi içinde konuşma başlatmak için şablon mesaj desteği. Görüntü, belge ve ses için medya mesaj desteği.

**Signal** — Kendi sunucunuzda barındırılan signal-cli-rest-api köprüsü üzerinden gizlilik odaklı mesajlaşma. Zarif düşüş ile sağlık izleme. Ses mesajı transkripsiyonu, cihaz üzerinde Whisper AI ile yapılır.

**İş parçacıklı konuşmalar** — Tüm mesajlaşma kanalları, birleşik bir konuşma görünümüne akar. Zaman damgaları ve yön göstergeleri ile mesaj baloncukları. Gerçek zamanlı güncellemeler. Tüm mesajlar, sunucunuza ulaştıkları anda şifrelenir. Sunucu yalnızca şifreli metni saklar.

## Şifreli Raporlar

**Raporlayıcı rolü** — İpucu veya rapor gönderen kişiler için özel bir rol. Raporlayıcılar, yalnızca raporlar ve yardım içeren basitleştirilmiş bir arayüz görür. Gönüllülerle aynı akış üzerinden davet edilir, rol seçici ile.

**Şifreli gönderimler** — Rapor gövdesi içeriği, tarayıcıdan ayrılmadan önce ECIES kullanılarak şifrelenir. Triage için düz metin başlıklar, gizlilik için şifreli içerik. Dosya ekleri ayrıca şifrelenir.

**Rapor iş akışı** — Raporları düzenlemek için kategoriler. Durum izleme (açık, üstlenildi, çözüldü). Yöneticiler raporları üstlenebilir ve iş parçacıklı, şifreli yanıtlarla geri dönebilir.

## Kişi Rehberi

**Şifreli kişi kayıtları** — Uçtan uca şifreleme ile kişi bilgisi saklayın. İsimler, telefon numaraları, e-postalar ve notlar, tarayıcıdan ayrılmadan önce şifrelenir.

**İlişki izleme** — Kişileri birbirine ve aramalara, konuşmalara ve raporlara bağlayın. Kime yardım ettiğinizin bir resmini oluşturun.

**Otomatik bağlama** — Gelen aramalar ve mesajlar, telefon numaraları eşleştirilerek otomatik olarak bilinen kişilerle ilişkilendirilir.

**Takım tabanlı erişim** — Hangi takım üyesinin hangi kişiyi görebileceğini kontrol edin. İzinler ayrıntılı ve yapılandırılabilir.

**Etiketler ve kabul** — Kişileri etiketlerle düzenleyin. Kabul iş akışları, yeni kişileri incelemeye yönlendirir.

**Toplu içe/dışa aktarma** — Kişileri CSV veya JSON'dan içe aktarın. Şifreli yedeklemeleri dışa aktarın. Tüm işlem tarayıcınızda gerçekleşir.

## Yapılandırılabilir İzinler

**Özel roller** — İhtiyaç duyduğunuz tam izinlere sahip kendi rollerinizi tanımlayın. Yerleşik şablonlardan (Yönetici, Gönüllü, Raporlayıcı) başlayın veya sıfırdan oluşturun.

**Ayrıntılı izinler** — 17 özellik alanında 90'dan fazla bireysel izin. Kimin görüntüleyebileceğini, oluşturabileceğini, düzenleyebileceğini ve silebileceğini ince bir düzeyde kontrol edin.

**Takım kapsamı** — Takım üyelerini takımlara atayın. İzinler belirli takımlarla sınırlandırılabilir, böylece farklı gruplar farklı verileri görür.

## Yönetici Panosu

**Kurulum sihirbazı** — İlk yönetici oturumunda rehberli çok adımlı kurulum. Hangi kanalları etkinleştireceğinizi seçin (Ses, SMS, WhatsApp, Signal, Raporlar), sağlayıcıları yapılandırın ve yardım hattı adınızı ayarlayın.

**Başlangıç kontrol listesi** — Kurulum ilerlemesini izleyen pano widget'ı: kanal yapılandırması, gönüllü katılımı, vardiya oluşturma.

**Gerçek zamanlı izleme** — Aktif aramaları, kuyruktaki arayanları, konuşmaları ve gönüllü durumunu gerçek zamanlı olarak görün. Metrikler anında güncellenir.

**Kullanıcı yönetimi** — Güvenli bağlantılar üzerinden yeni takım üyeleri davet edin. Kendi hesaplarını ve şifreleme anahtarlarını oluştururlar. Rolleri, izinleri ve takım atamalarını yönetin.

**Denetim günlüğü** — Cevap verilen her arama, oluşturulan not, gönderilen mesaj, gönderilen rapor, değiştirilen ayar ve yönetici eylemi kaydedilir. Yöneticiler için sayfalanmış görüntüleyici.

**Çağrı geçmişi** — Tarih aralıkları, telefon numarası araması ve gönüllü ataması ile aranabilir, filtrelenebilir çağrı geçmişi. GDPR uyumlu veri dışa aktarımı.

**Uygulama içi yardım** — SSS bölümleri, rol rehberleri, klavye kısayolları ve güvenlik için hızlı başvuru kartları. Kenar çubuğundan ve komut paletinden erişilebilir.

## Gönüllü Deneyimi

**Komut paleti** — Hızlı navigasyon, arama, hızlı not oluşturma ve tema değiştirme için Ctrl+K'ye (Mac'te Cmd+K) basın. Yalnızca yöneticiye özel komutlar role göre filtrelenir.

**Gerçek zamanlı bildirimler** — Gelen aramalar, tarayıcı zil sesi, anlık bildirim ve yanıp sönen sekme başlığı tetikler. Her bildirim türünü ayarlarda bağımsız olarak açın/kapatın.

**Gönüllü varlığı** — Yöneticiler, gerçek zamanlı çevrimiçi, çevrimdışı ve molada sayılarını görür. Gönüllüler, vardiyadan ayrılmadan gelen aramaları duraklatmak için kenar çubuğundaki mola anahtarını kullanabilir.

**Klavye kısayolları** — Mevcut tüm kısayolları görmek için ? tuşuna basın. Sayfalar arasında gezinin, komut paletini açın ve fareye dokunmadan yaygın eylemleri gerçekleştirin.

**Not taslak otomatik kaydetme** — Notlar, tarayıcıda şifreli taslaklar olarak otomatik kaydedilir. Sayfa yeniden yüklenirse veya gönüllü başka bir sayfaya giderse, çalışmaları korunur. Taslaklar, oturum kapatıldığında localStorage'dan temizlenir.

**Şifreli veri dışa aktarımı** — Notları, çok faktörlü şifreleme anahtarınızla korunan GDPR uyumlu bir şifreli dosyaya (.enc) dışa aktarın. Yalnızca orijinal yazar dışa aktarılanı şifresini çözebilir.

**Koyu/açık temalar** — Koyu mod, açık mod veya sistem teması arasında geçiş yapın. Tercih oturum başına korunur.

## Çok Dilli ve Mobil

**12+ dil** — Tam UI çevirileri: İngilizce, İspanyolca, Çince, Tagalogca, Vietnamca, Arapça, Fransızca, Haiti Kreolcesi, Korece, Rusça, Hintçe, Portekizce ve Almanca. Arapça için RTL desteği.

**İlerici Web Uygulaması** — Tarayıcı üzerinden herhangi bir cihaza kurulabilir. Service worker, çevrimdışı başlatma için uygulama kabuğunu önbelleğe alır. Gelen aramalar için anlık bildirimler.

**Mobil öncelikli tasarım** — Telefonlar ve tabletler için tasarlanmış duyarlı düzen. Daraltılabilir kenar çubuğu, dokunmaya duyarlı kontroller ve uyarlanabilir düzenler.

## Kimlik Doğrulama ve Anahtar Yönetimi

**Çok faktörlü anahtar koruması** — Şifreleme anahtarınız en fazla üç bağımsız faktörle korunur: seçtiğiniz bir PIN, kimlik sağlayıcı hesabınız ve isteğe bağlı olarak bir donanım güvenlik anahtarı. Herhangi bir tek faktörün ele geçirilmesi yeterli değildir.

**Kimlik sağlayıcı entegrasyonu** — Kendi sunucunuzda barındırılan kimlik yönetimi (siz kontrol edersiniz). Davet tabanlı katılım — gizli anahtar paylaşımı yok. Uzaktan oturum iptali — ele geçirilmiş bir cihazı her yerden kilitleyin.

**Otomatik oturum yönetimi** — Oturumlar arka planda sessizce yenilenir. Boşta otomatik kilit, gözetimsiz cihazları korur. Şifreleme anahtarınız izole bir süreçte yaşar, sayfaya asla erişilemez.

**Cihaz bağlama** — Yeni cihazları güvenli bir şekilde kurun. Bir QR kodu tarayın veya kısa bir hazırlama kodu girin. Geçici anahtar değişimi kullanır — gizli anahtarınız aktarım sırasında asla açığa çıkmaz.

**Kurtarma anahtarları** — Katılım sırasında acil durumlar için bir kurtarma anahtarı alırsınız. İlerlemeden önce zorunlu şifreli yedekleme.

**Donanım güvenlik anahtarları** — Kimlik avına dayanıklı oturum açma için isteğe bağlı passkey desteği. Bir donanım anahtarı veya biyometrik kaydedin, ardından kimlik bilgisi yazmadan oturum açın.

**Not başına ileriye dönük gizlilik** — Her not, benzersiz rastgele bir anahtarla şifrelenir, ardından bu anahtar her yetkili okuyucu için ECIES ile sarmalanır. Kimlik anahtarının ele geçirilmesi, geçmiş notları açığa çıkarmaz.
