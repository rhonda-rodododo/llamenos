---
title: Raporlayıcı Kılavuzu
description: Şifreli raporları nasıl göndereceğiniz ve durumlarını nasıl takip edeceğiniz.
---

Raporlayıcı olarak, Llamenos platformu üzerinden kuruluşunuza şifreli raporlar gönderebilirsiniz. Raporlar uçtan uca şifrelidir — sunucu rapor içeriğinizi asla görmez.

## Başlangıç

Yöneticiniz size şunlardan birini verecektir:
- Bir **nsec** (Nostr gizli anahtarı) — `nsec1` ile başlayan bir dizgi
- Bir **davet bağlantısı** — sizin için kimlik bilgileri oluşturan tek kullanımlık bir URL

**nsec'inizi gizli tutun.** Kimliğiniz ve oturum açma kimlik bilginizdir. Bir parola yöneticisinde saklayın.

## Oturum açma

1. Uygulamayı tarayıcınızda açın
2. `nsec`'inizi oturum açma alanına yapıştırın
3. Kimliğiniz kriptografik olarak doğrulanır — gizli anahtarınız asla tarayıcınızdan ayrılmaz

İlk oturum açmadan sonra, gelecekteki oturum açmaları kolaylaştırmak için Ayarlar altında bir WebAuthn passkey kaydedebilirsiniz.

## Rapor gönderme

1. Raporlar sayfasından **Yeni Rapor**'a tıklayın
2. Raporunuz için bir **başlık** girin (bu, yöneticilerin triage yapmasına yardımcı olur — düz metin olarak saklanır)
3. Yöneticiniz rapor kategorileri tanımladıysa bir **kategori** seçin
4. Rapor içeriğinizi gövde alanına yazın — bu, tarayıcınızdan ayrılmadan önce şifrelenir
5. Yöneticinizin yapılandırdığı tüm **özel alanları** doldurun (isteğe bağlı)
6. İsterseniz **dosya ekleyin** — dosyalar, yüklemeden önce istemci tarafında şifrelenir
7. **Gönder**'e tıklayın

Raporunuz, "Açık" durumuyla Raporlar listenizde görünür.

## Rapor şifreleme

- Rapor gövdesi ve özel alan değerleri, ECIES (secp256k1 + XChaCha20-Poly1305) kullanılarak şifrelenir
- Dosya ekleri aynı şema kullanılarak ayrıca şifrelenir
- İçeriği şifresini çözebilen yalnızca siz ve yöneticidir
- Sunucu yalnızca şifreli metni saklar — veritabanı ele geçirilse bile rapor içeriğiniz güvendedir

## Raporlarınızı takip etme

Raporlar sayfanız, gönderdiğiniz tüm raporları şunlarla birlikte gösterir:
- **Başlık** ve **kategori**
- **Durum** — Açık, Üstlenildi (bir yönetici üzerinde çalışıyor) veya Çözüldü
- **Gönderim** tarihi

Bir rapora tıklayarak tam iş parçacığını, yönetici yanıtları dahil, görüntüleyebilirsiniz.

## Yöneticilere yanıt verme

Bir yönetici raporunuza yanıt verdiğinde, yanıt rapor iş parçacığında görünür. Siz de geri yanıt verebilirsiniz — iş parçacığındaki tüm mesajlar şifrelidir.

## Yapamayacaklarınız

Raporlayıcı olarak, herkesin gizliliğini korumak için erişiminiz sınırlıdır:
- Kendi raporlarınızı ve Yardım sayfasını **görebilirsiniz**
- Diğer raporlayıcıların raporlarını, çağrı kayıtlarını, gönüllü bilgilerini veya yönetici ayarlarını **göremezsiniz**
- Aramalara cevap veremez veya SMS/WhatsApp/Signal konuşmalarına yanıt veremezsiniz

## İpuçları

- Açıklayıcı başlıklar kullanın — yöneticilerin tam içeriği şifresini çözmeden triage yapmasına yardımcı olurlar
- Raporunuzu destekleyen dosyaları (ekran görüntüleri, belgeler) ekleyin
- Yönetici yanıtları için düzenli olarak kontrol edin — rapor listenizde durum değişikliklerini göreceksiniz
- SSS ve kılavuzlar için Yardım sayfasını kullanın
