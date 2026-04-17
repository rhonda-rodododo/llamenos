---
title: Gönüllü Kılavuzu
description: Gönüllü olarak bilmeniz gereken her şey — oturum açma, arama alma, mesajlara yanıt verme, not yazma ve transkripsiyon kullanma.
---

Bu kılavuz, gönüllü olarak bilmeniz gereken her şeyi kapsar: oturum açma, arama alma, mesajlara yanıt verme, not yazma ve transkripsiyon özelliğini kullanma.

## Kimlik bilgilerinizi alma

Yöneticiniz size şunlardan birini verecektir:

- Bir **nsec** (Nostr gizli anahtarı) — `nsec1` ile başlayan bir dizgi
- Bir **davet bağlantısı** — sizin için kimlik bilgileri oluşturan tek kullanımlık bir URL

**nsec'inizi gizli tutun.** Kimliğiniz ve oturum açma kimlik bilginizdir. nsec'inize sahip olan herkes sizin adınıza işlem yapabilir. Bir parola yöneticisinde saklayın.

## Oturum açma

1. Yardım hattı uygulamasını tarayıcınızda açın
2. `nsec`'inizi oturum açma alanına yapıştırın
3. Uygulama, kimliğinizi kriptografik olarak doğrular — gizli anahtarınız asla tarayıcınızdan ayrılmaz

İlk oturum açmadan sonra görünen adınızı ve tercih ettiğiniz dilinizi ayarlamanız istenecektir.

### Passkey ile oturum açma (isteğe bağlı)

Yöneticiniz passkey'leri etkinleştirdiyse, **Ayarlar** altında bir donanım anahtarı veya biyometrik kaydedebilirsiniz. Bu, nsec'inizi yazmadan diğer cihazlarda oturum açmanızı sağlar.

## Pano

Oturum açtıktan sonra şunları içeren panoyu göreceksiniz:

- **Aktif aramalar** — şu anda yürütülen aramalar
- **Vardiya durumunuz** — kenar çubuğunda gösterilir (mevcut vardiya veya bir sonraki vardiya)
- **Çevrimiçi gönüllüler** — kimlerin müsait olduğunun sayısı

## Arama alma

Vardiyanız sırasında bir arama geldiğinde şu şekilde bildirim alırsınız:

- Tarayıcıda bir **zil sesi** (Ayarlar'dan açılıp kapatılabilir)
- İzin verdiyseniz bir **anında bildirim**
- **Yanıp sönen sekme başlığı**

Aramayı cevaplamak için **Yanıtla**'ya tıklayın. Telefonunuz çalar — arayana bağlanmak için yanıtlayın. Başka bir gönüllü önce cevap verirse çalma durur.

## Arama sırasında

Aradayken şunları göreceksiniz:

- Süreyi gösteren bir **arama zamanlayıcısı**
- Gerçek zamanlı not yazabileceğiniz bir **not paneli**
- Arayanı işaretlemek için bir **spam bildir** düğmesi

Notlar şifreli taslaklar olarak otomatik kaydedilir. Notu manuel olarak da kaydedebilirsiniz.

## Not yazma

Notlar, sunucuya gönderilmeden önce tarayıcınızda şifrelenir. Yalnızca siz ve yönetici okuyabilirsiniz.

Yöneticiniz özel alanlar (metin, açılır menü, onay kutusu vb.) yapılandırdıysa, not formunda görüneceklerdir. İlgili olduğunca doldurun — bunlar not metninizin yanı sıra şifrelenir.

Geçmiş notlarınızı incelemek, düzenlemek veya aramak için kenar çubuğundaki **Notlar** bölümüne gidin. Notlarınızı şifreli bir dosya olarak dışa aktarabilirsiniz.

## Transkripsiyon

Transkripsiyon etkinse (yönetici ve kendi tercihiniz tarafından), aramalar bittikten sonra otomatik olarak metne dönüştürülür. Transkript, o arama için notunuzun yanında görünür.

Transkripsiyonu **Ayarlar** altından açıp kapatabilirsiniz. Devre dışı bıraktığınızda, yöneticinin genel ayarı ne olursa olsun aramalarınız transkripte dönüştürülmez.

Transkriptler, dinlenme durumunda şifrelenir — sunucu sesi geçici olarak işler, ardından ortaya çıkan metni şifreler.

## Konuşmalar

Yöneticiniz mesajlaşma kanallarını (SMS, WhatsApp veya Signal) etkinleştirdiyse, kenar çubuğunda bir **Konuşmalar** bağlantısı görürsünüz. Burada, yardım hattına metinle ulaşan kişilerden gelen iş parçacıklı konuşmalar gösterilir.

Her konuşma şunları gösterir:
- Kimin ne gönderdiğini gösteren zaman damgaları ile mesaj baloncukları
- Mesajın geldiği kanal (SMS, WhatsApp, Signal)
- Yeni mesajlar gerçek zamanlı olarak görünür

Yanıt vermek için konuşmanın altındaki yanıt kutusuna mesajınızı yazın. Yanıtınız, kişinin sizinle iletişim kurmak için kullandığı aynı kanal üzerinden gönderilir.

## Molaya çıkma

Gelen aramaları vardiyadan ayrılmadan duraklatmak için kenar çubuğundaki **mola** anahtarını kullanın. Moladayken telefonunuz arama almaz. Hazır olduğunuzda tekrar açın.

## İpuçları

- Hızlı navigasyon için komut paletini açmak üzere <kbd>Ctrl</kbd>+<kbd>K</kbd> (Mac'te <kbd>Cmd</kbd>+<kbd>K</kbd>) kullanın
- Tüm klavye kısayollarını görmek için <kbd>?</kbd> tuşuna basın
- Yerel uygulama deneyimi ve daha iyi bildirimler için uygulamayı PWA olarak kurun
- Gerçek zamanlı arama uyarıları için tarayıcı sekmesini vardiya süresince açık tutun
- SSS, kılavuzlar ve klavye kısayolları için **Yardım** sayfasını (kenar çubuğu bağlantısı veya komut paleti) kullanın
