---
title: Yönetici Kılavuzu
description: Her şeyi yönetin — gönüllüler, vardiyalar, kanallar, konuşmalar, raporlar, yasak listeleri ve özel alanlar.
---

Yönetici olarak her şeyi yönetirsiniz: gönüllüler, vardiyalar, iletişim kanalları, konuşmalar, raporlar, yasak listeleri ve özel alanlar. Bu kılavuz temel yönetici iş akışlarını kapsar.

## Oturum açma

[kurulum](/docs/getting-started) sırasında oluşturulan `nsec` (Nostr gizli anahtarı) ile oturum açın. Giriş sayfası nsec formatını (`nsec1...`) kabul eder. Tarayıcınız anahtarla bir challenge imzalar — gizli anahtar asla cihazdan ayrılmaz.

İsteğe bağlı olarak Ayarlar'da bir WebAuthn passkey kaydederek ek cihazlarda parolasız giriş yapabilirsiniz.

## Kurulum sihirbazı

İlk oturum açmanızda uygulama sizi **kurulum sihirbazına** yönlendirir — adım adım bir süreç:

1. **Yardım hattınıza ad verin** — kullanıcılara gösterilen görünen adı ayarlayın
2. **Kanalları seçin** — Ses, SMS, WhatsApp, Signal ve Raporlar'ı açıp kapatın
3. **Sağlayıcıları yapılandırın** — etkinleştirilen her kanal için kimlik bilgilerini girin
4. **İnceleme** — ayarlarınızı onaylayın ve kurulumu tamamlayın

Sihirbaz tamamlandıktan sonra `setupCompleted` bayrağı ayarlanır ve sihirbaz bir daha görünmez. Bu ayarları daha sonra Ayarlar sayfasından değiştirebilirsiniz.

## Gönüllüleri yönetme

Kenar çubuğundaki **Gönüllüler** bölümüne gidin:

- **Gönüllü ekle** — yeni bir Nostr anahtar çifti oluşturur. nsec'i güvenli bir şekilde gönüllüyle paylaşın (yalnızca bir kez gösterilir).
- **Davet bağlantısı oluştur** — tek kullanımlık bir bağlantı oluşturur. Davet akışı rol seçicisi içerir (gönüllü, yönetici veya raporlayıcı).
- **Düzenle** — adı, telefon numarasını ve rolü güncelleyin.
- **Kaldır** — bir gönüllünün erişimini devre dışı bırakın.

Gönüllü telefon numaraları yalnızca yöneticilere görünür. Vardiyadayken paralel çalma için kullanılırlar.

## Raporlayıcıları yönetme

Raporlayıcılar, platform aracılığıyla ipucu veya rapor gönderen kişiler için özel bir roldür. Erişimleri kısıtlıdır — yalnızca kendi raporlarını ve Yardım sayfasını görüntüleyebilirler.

Raporlayıcı eklemek için:
1. Bir davet bağlantısı oluşturun ve **Raporlayıcı** rolünü seçin
2. Bağlantıyı raporlayıcıyla paylaşın — kendi kimlik bilgilerini oluşturacaklar
3. Raporlayıcılar oturum açar ve yalnızca Raporlar ve Yardım içeren basitleştirilmiş bir arayüz görür

## Vardiyaları yapılandırma

Yinelenen programlar oluşturmak için **Vardiyalar** bölümüne gidin:

1. **Vardiya Ekle**'ye tıklayın
2. Bir ad belirleyin, günleri seçin ve başlangıç/bitiş saatlerini ayarlayın
3. Gönüllüleri vardiyaya atayın
4. Kaydedin

Sistem, aramaları otomatik olarak görevde olan kişilere yönlendirir.

## Kanallar ve sağlayıcılar

Ses ve mesajlaşmayı yönetmek için **Ayarlar → Kanallar** bölümüne gidin:

- **Ses** — sağlayıcı seçin (Twilio, SignalWire, Vonage, Plivo, Asterisk)
- **SMS** — ses sağlayıcınız aracılığıyla SMS'i etkinleştirin
- **WhatsApp** — Meta Cloud API aracılığıyla WhatsApp Business'ı bağlayın
- **Signal** — signal-cli-rest-api köprüsünü yapılandırın
- **Raporlar** — şifreli rapor gönderimi için raporlayıcı rolünü etkinleştirin

Her kanal için gerekli kimlik bilgilerini girin ve webhook URL'lerini belirtin.

## Yasak listeleri

İstenmeyen arayanları yönetmek için **Yasaklama** bölümüne gidin:

- **Yasak ekle** — belirli bir telefon numarasını engelleyin
- **Toplu içe aktarma** — engellenecek numaraları içeren bir CSV yükleyin
- **Süre** — kalıcı veya geçici yasak belirleyin
- **Mesaj** — engellenen arayanların duyacağı mesajı yapılandırın

Yasaklar anında etkili olur.

## Notlar için özel alanlar

Gönüllü notları için özel alanları tanımlamak üzere **Ayarlar → Notlar** bölümüne gidin:

- Metin
- Sayı
- Seçim (açılır liste)
- Onay kutusu
- Metin alanı

Bu alanlar not içeriğiyle birlikte şifrelenir.

## İzleme ve denetim

- **Aktif aramalar** — mevcut aramaları ve kuyrukları gerçek zamanlı olarak görüntüleyin
- **Denetim günlüğü** — her arama, not, mesaj, rapor ve ayar değişikliği kaydedilir
- **Arama geçmişi** — tarih ve telefon numarasına göre arama arayın ve filtreleyin

## Veri dışa aktarma

Yöneticiler GDPR uyumlu olarak verileri dışa aktarabilir. Not dışa aktarımları şifrelenir ve yalnızca yazar tarafından şifresi çözülebilir.
