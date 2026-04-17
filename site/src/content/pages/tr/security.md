---
title: Güvenlik ve Gizlilik
subtitle: Ne korunuyor, ne görünür ve mahkeme celbi altında ne elde edilebilir — kullandığınız özelliklere göre düzenlenmiştir.
---

## Barındırma sağlayıcınız mahkeme celbi alırsa

| Sağlayabilirler | Sağlayamazlar |
|-----------------|---------------|
| Çağrı/mesaj meta verileri (zamanlar, süreler) | Not içeriği, transkriptler, rapor gövdeleri |
| Şifrelenmiş veritabanı blob'ları | Gönüllü isimleri (uçtan uca şifreli) |
| Hangi gönüllü hesaplarının ne zaman aktif olduğu | Kişi rehberi kayıtları (uçtan uca şifreli) |
| | Mesaj içeriği (varışta şifrelenir, şifreli metin olarak saklanır) |
| | Şifre çözme anahtarları (PIN'iniz, kimlik sağlayıcı hesabınız ve isteğe bağlı olarak donanım güvenlik anahtarınız tarafından korunur) |
| | Not başına şifreleme anahtarları (geçici — sarmalandıktan sonra yok edilir) |
| | Telefon hash'lerini tersine çevirmek için HMAC gizli anahtarınız |

**Sunucu, okuyamayacağı verileri saklar.** Meta veriler (ne zaman, ne kadar süreyle, hangi hesaplar) görünür. İçerik (ne söylendi, ne yazıldı, kişileriniz kimler) görünür değildir.

---

## Özellik bazında

Gizlilik maruziyetiniz, hangi kanalları etkinleştirdiğinize bağlıdır:

### Sesli aramalar

| Kullanırsanız... | Üçüncü taraflar erişebilir | Sunucu erişebilir | Uçtan uca şifreli içerik |
|------------------|---------------------------|-------------------|--------------------------|
| Twilio/SignalWire/Vonage/Plivo | Çağrı sesi (canlı), çağrı kayıtları | Çağrı meta verileri | Notlar, transkriptler |
| Kendi sunucunuzda Asterisk | Hiçbir şey (siz kontrol edersiniz) | Çağrı meta verileri | Notlar, transkriptler |
| Tarayıcıdan tarayıcıya (WebRTC) | Hiçbir şey | Çağrı meta verileri | Notlar, transkriptler |

**Telefon sağlayıcısı celbi**: Çağrı detay kayıtlarına (zamanlar, telefon numaraları, süreler) sahiptirler. Çağrı notlarına veya transkriptlere sahip değillerdir. Kayıt varsayılan olarak devre dışıdır.

**Transkripsiyon**: Transkripsiyon, tamamen tarayıcınızda cihaz üzerinde AI kullanılarak yapılır. **Ses hiçbir şekilde cihazınızı terk etmez.** Yalnızca şifrelenmiş transkript saklanır.

### Metin mesajlaşma

| Kanal | Sağlayıcı erişimi | Sunucu depolama | Notlar |
|-------|-------------------|-----------------|--------|
| SMS | Telefon sağlayıcınız tüm mesajları okur | **Şifreli** | Sağlayıcı orijinal mesajları saklar |
| WhatsApp | Meta tüm mesajları okur | **Şifreli** | Sağlayıcı orijinal mesajları saklar |
| Signal | Signal ağı uçtan uca şifrelidir, ancak köprü varışta şifreyi çözer | **Şifreli** | SMS'den daha iyi, ancak sıfır bilgi değil |

**Mesajlar, sunucunuza ulaştıkları anda şifrelenir.** Sunucu yalnızca şifreli metni saklar. Telefon veya mesajlaşma sağlayıcınız hâlâ orijinal mesaja sahip olabilir — bu, o platformların sınırlamasıdır ve değiştirebileceğimiz bir şey değildir.

**Mesajlaşma sağlayıcısı celbi**: SMS sağlayıcıları tam mesaj içeriğine sahiptir. Meta, WhatsApp içeriğine sahiptir. Signal mesajları köprüye uçtan uca şifrelidir, ancak köprü (sunucunuzda çalışan) depolamadan önce yeniden şifrelemeden önce şifreyi çözer. Her durumda, **sunucunuzda yalnızca şifreli metin vardır** — barındırma sağlayıcısı mesaj içeriğini okuyamaz.

### Notlar, transkriptler ve raporlar

Tüm gönüllü tarafından yazılan içerik uçtan uca şifrelidir:

- Her not, **benzersiz rastgele bir anahtar** kullanır (ileriye dönük gizlilik — bir notun ele geçirilmesi diğerlerini etkilemez)
- Anahtarlar, gönüllü ve her yönetici için ayrı ayrı sarmalanır
- Sunucu yalnızca şifreli metni saklar
- Şifre çözme tarayıcıda gerçekleşir
- **Özel alanlar, rapor içeriği ve dosya eklerinin tümü ayrı ayrı şifrelenir**

**Cihaz ele geçirme**: PIN'iniz **ve** kimlik sağlayıcı hesabınıza erişim olmadan, saldırganlar hesaplaması olarak çözülemeyecek şifreli bir blob elde eder. Donanım güvenlik anahtarı da kullanıyorsanız, **üç bağımsız faktör** verilerinizi korur.

---

## Gönüllü telefon numarası gizliliği

Gönüllüler kişisel telefonlarına arama aldıklarında, numaraları telefon sağlayıcınıza açık hale gelir.

| Senaryo | Telefon numarası şunlar tarafından görünür |
|---------|--------------------------------------------|
| Gönüllünün telefonuna PSTN araması | Telefon sağlayıcısı, telefon operatörü |
| Tarayıcıdan tarayıcıya (WebRTC) | Kimse (ses tarayıcıda kalır) |
| Kendi sunucunuzda Asterisk + SIP telefon | Yalnızca Asterisk sunucunuz |

**Gönüllü telefon numaralarını korumak için**: Tarayıcı tabanlı aramayı (WebRTC) kullanın veya kendi sunucunuzda barındırılan Asterisk'e bağlı SIP telefonları sağlayın.

---

## Yakın zamanda yayınlananlar

Bu iyileştirmeler bugün aktif:

| Özellik | Gizlilik faydası |
|---------|------------------|
| Şifreli mesaj depolama | SMS, WhatsApp ve Signal mesajları sunucunuzda şifreli metin olarak saklanır |
| Cihaz üzerinde transkripsiyon | Ses hiçbir şekilde tarayıcınızı terk etmez — tamamen cihazınızda işlenir |
| Çok faktörlü anahtar koruması | Şifreleme anahtarlarınız PIN'iniz, kimlik sağlayıcınız ve isteğe bağlı olarak donanım güvenlik anahtarınız tarafından korunur |
| Donanım güvenlik anahtarları | Fiziksel anahtarlar, uzaktan ele geçirilemeyecek üçüncü bir faktör ekler |
| Tekrarlanabilir derlemeler | Dağıtılan kodun kamuya açık kaynakla eşleştiğini doğrulayın |
| Şifreli kişi rehberi | Kişi kayıtları, ilişkiler ve notlar uçtan uca şifrelidir |

## Hâlâ planlananlar

| Özellik | Gizlilik faydası |
|---------|------------------|
| Yerel arama alma uygulamaları | Kişisel telefon numaraları açığa çıkmaz |

---

## Özet tablosu

| Veri türü | Şifreli | Sunucuya görünür | Mahkeme celbiyle elde edilebilir |
|-----------|---------|------------------|----------------------------------|
| Çağrı notları | Evet (uçtan uca) | Hayır | Yalnızca şifreli metin |
| Transkriptler | Evet (uçtan uca) | Hayır | Yalnızca şifreli metin |
| Raporlar | Evet (uçtan uca) | Hayır | Yalnızca şifreli metin |
| Dosya ekleri | Evet (uçtan uca) | Hayır | Yalnızca şifreli metin |
| Kişi kayıtları | Evet (uçtan uca) | Hayır | Yalnızca şifreli metin |
| Gönüllü kimlikleri | Evet (uçtan uca) | Hayır | Yalnızca şifreli metin |
| Takım/rol meta verileri | Evet (şifreli) | Hayır | Yalnızca şifreli metin |
| Özel alan tanımları | Evet (şifreli) | Hayır | Yalnızca şifreli metin |
| SMS/WhatsApp/Signal içeriği | Evet (sunucunuzda) | Hayır | Sunucunuzdan şifreli metin; sağlayıcı orijinale sahip olabilir |
| Çağrı meta verileri | Hayır | Evet | Evet |
| Arayan telefon hash'leri | HMAC hash'li | Yalnızca hash | Hash (gizli anahtarınız olmadan tersine çevrilemez) |

---

## Güvenlik denetçileri için

Teknik dokümantasyon:

- [Protokol Spesifikasyonu](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/protocol/llamenos-protocol.md)
- [Tehdit Modeli](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/THREAT_MODEL.md)
- [Veri Sınıflandırması](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/DATA_CLASSIFICATION.md)
- [Güvenlik Denetimleri](https://github.com/rhonda-rodododo/llamenos/tree/main/docs/security)
- [API Dokümantasyonu](/api/docs)

Llamenos açık kaynaklıdır: [github.com/rhonda-rodododo/llamenos](https://github.com/rhonda-rodododo/llamenos)
