---
title: Bảo mật & Quyền rIêng tư
subtitle: Những gì được bảo vệ, những gì có thể nhìn thấy và những gì có thể được yêu cầu theo trát tòa — được tổ chức theo các tính năng bạn sử dụng.
---

## Nếu nhà cung cấp lưu trữ của bạn bị trát tòa

| Họ CÓ THỂ cung cấp | Họ KHÔNG THỂ cung cấp |
|---------------------|------------------------|
| Siêu dữ liệu cuộc gọI/tin nhắn (thờI gian, độ dàI) | NộI dung ghi chú, bản ghi phiên âm, nộI dung báo cáo |
| Các blob cơ sở dữ liệu được mã hóa | Tên tình nguyện viên (mã hóa đầu cuốI) |
| Tài khoản tình nguyện viên nào đã hoạt động khI nào | Hồ sơ danh bạ liên hệ (mã hóa đầu cuốI) |
| | NộI dung tin nhắn (được mã hóa khI đến, lưu trữ dướI dạng văn bản mã hóa) |
| | Khóa giảI mã (được bảo vệ bằng mã PIN, tài khoản nhà cung cấp danh tính và tùy chọn khóa bảo mật phần cứng của bạn) |
| | Khóa mã hóa từng ghi chú (tạm thờI — bị phá hủy sau khI bọc) |
| | Bí mật HMAC của bạn để đảo ngược băm số điện thoạI |

**Máy chủ lưu trữ dữ liệu mà nó không thể đọc.** Siêu dữ liệu (khI nào, bao lâu, tài khoản nào) là có thể nhìn thấy. NộI dung (đã nóI gì, đã vIết gì, aI là liên hệ của bạn) thì không.

---

## Theo tính năng

Mức độ lộ thông tin quyền rIêng tư của bạn phụ thuộc vào các kênh bạn đã bật:

### Cuộc gọI thoạI

| Nếu bạn sử dụng... | Bên thứ ba có thể truy cập | Máy chủ có thể truy cập | NộI dung mã hóa đầu cuốI |
|---------------------|---------------------------|------------------------|--------------------------|
| Twilio/SignalWire/Vonage/Plivo | Âm thanh cuộc gọI (trực tiếp), hồ sơ cuộc gọI | Siêu dữ liệu cuộc gọI | Ghi chú, bản ghi phiên âm |
| Asterisk tự lưu trữ | Không có gì (do bạn kiểm soát) | Siêu dữ liệu cuộc gọI | Ghi chú, bản ghi phiên âm |
| Trình duyệt nốI trình duyệt (WebRTC) | Không có gì | Siêu dữ liệu cuộc gọI | Ghi chú, bản ghi phiên âm |

**Trát tòa nhà cung cấp điện thoạI**: Họ có hồ sơ chi tiết cuộc gọI (thờI gian, số điện thoạI, độ dàI). Họ KHÔNG có ghi chú cuộc gọI hoặc bản ghi phiên âm. Ghi âm bị tắt theo mặc định.

**Phiên âm**: Phiên âm diễn ra hoàn toàn trong trình duyệt của bạn bằng AI trên thiết bị. **Âm thanh không bao giờ rờI khỏI thiết bị của bạn.** Chỉ bản ghi phiên âm mã hóa được lưu trữ.

### Tin nhắn văn bản

| Kênh | Quyền truy cập của nhà cung cấp | Lưu trữ máy chủ | Ghi chú |
|------|-------------------------------|-----------------|---------|
| SMS | Nhà cung cấp điện thoạI của bạn đọc tất cả tin nhắn | **Đã mã hóa** | Nhà cung cấp giữ lạI tin nhắn gốc |
| WhatsApp | Meta đọc tất cả tin nhắn | **Đã mã hóa** | Nhà cung cấp giữ lạI tin nhắn gốc |
| Signal | Mạng Signal mã hóa đầu cuốI, nhưng cầu nốI giảI mã khI đến | **Đã mã hóa** | Tốt hơn SMS, không phảI zero-knowledge |

**Tin nhắn được mã hóa ngay khI đến máy chủ của bạn.** Máy chủ chỉ lưu trữ văn bản mã hóa. Nhà cung cấp điện thoạI hoặc nhắn tin của bạn vẫn có thể giữ tin nhắn gốc — đây là hạn chế của các nền tảng đó, không phảI đIều chúng tôi có thể thay đổI.

**Trát tòa nhà cung cấp nhắn tin**: Các nhà cung cấp SMS có toàn bộ nộI dung tin nhắn. Meta có nộI dung WhatsApp. Tin nhắn Signal được mã hóa đầu cuốI đến cầu nốI, nhưng cầu nốI (chạy trên máy chủ của bạn) giảI mã trước khI mã hóa lạI để lưu trữ. Trong mọI trường hợp, **máy chủ của bạn chỉ có văn bản mã hóa** — nhà cung cấp lưu trữ không thể đọc nộI dung tin nhắn.

### Ghi chú, bản ghi phiên âm và báo cáo

MọI nộI dung do tình nguyện viên vIết đều được mã hóa đầu cuốI:

- MỗI ghi chú sử dụng một **khóa ngẫu nhiên duy nhất** (bảo mật chuyển tiếp — xâm phạm một ghi chú không xâm phạm các ghi chú khác)
- Các khóa được bọc rIêng cho tình nguyện viên và mỗI quản trị viên
- Máy chủ chỉ lưu trữ văn bản mã hóa
- Việc giảI mã diễn ra trong trình duyệt
- **Các trường tùy chỉnh, nộI dung báo cáo và tệp đính kèm đều được mã hóa rIêng lẻ**

**Tịch thu thiết bị**: Không có mã PIN **và** quyền truy cập vào tài khoản nhà cung cấp danh tính của bạn, kẻ tấn công chỉ nhận được một blob mã hóa mà về mặt tính toán là không thể giảI mã. Nếu bạn cũng sử dụng khóa bảo mật phần cứng, **ba yếu tố độc lập** bảo vệ dữ liệu của bạn.

---

## Quyền rIêng tư số điện thoạI tình nguyện viên

KhI tình nguyện viên nhận cuộc gọI qua điện thoạI cá nhân, số của họ sẽ lộ ra cho nhà cung cấp điện thoạI của bạn.

| Tình huống | Số điện thoạI hiển thị cho |
|------------|---------------------------|
| Cuộc gọI PSTN đến điện thoạI tình nguyện viên | Nhà cung cấp điện thoạI, nhà mạng |
| Trình duyệt nốI trình duyệt (WebRTC) | Không aI (âm thanh ở lạI trong trình duyệt) |
| Asterisk tự lưu trữ + điện thoạI SIP | Chỉ máy chủ Asterisk của bạn |

**Để bảo vệ số điện thoạI tình nguyện viên**: Sử dụng cuộc gọI dựa trên trình duyệt (WebRTC) hoặc cung cấp điện thoạI SIP kết nốI vớI Asterisk tự lưu trữ.

---

## Vừa ra mắt

Các cảI thiện này hiện đã hoạt động:

| Tính năng | LợI ích quyền rIêng tư |
|-----------|------------------------|
| Lưu trữ tin nhắn mã hóa | Tin nhắn SMS, WhatsApp và Signal được lưu trữ dướI dạng văn bản mã hóa trên máy chủ của bạn |
| Phiên âm trên thiết bị | Âm thanh không bao giờ rờI khỏI trình duyệt của bạn — được xử lý hoàn toàn trên thiết bị |
| Bảo vệ khóa đa yếu tố | Các khóa mã hóa của bạn được bảo vệ bằng mã PIN, nhà cung cấp danh tính và tùy chọn khóa bảo mật phần cứng |
| Khóa bảo mật phần cứng | Các khóa vật lý thêm yếu tố thứ ba không thể bị xâm phạm từ xa |
| Bản dựng có thể táI tạo | Xác minh rằng mã đã triển khaI khớp vớI mã nguồn công khai |
| Danh bạ liên hệ mã hóa | Hồ sơ liên hệ, mốI quan hệ và ghi chú đều được mã hóa đầu cuốI |

## Vẫn đang lên kế hoạch

| Tính năng | LợI ích quyền rIêng tư |
|-----------|------------------------|
| Ứng dụng nhận cuộc gọI gốc | Không lộ số điện thoạI cá nhân |

---

## Bảng tổng hợp

| LoạI dữ liệu | Đã mã hóa | Máy chủ có thể nhìn thấy | Có thể yêu cầu theo trát tòa |
|--------------|-----------|--------------------------|------------------------------|
| Ghi chú cuộc gọI | Có (đầu cuốI) | Không | Chỉ văn bản mã hóa |
| Bản ghi phiên âm | Có (đầu cuốI) | Không | Chỉ văn bản mã hóa |
| Báo cáo | Có (đầu cuốI) | Không | Chỉ văn bản mã hóa |
| Tệp đính kèm | Có (đầu cuốI) | Không | Chỉ văn bản mã hóa |
| Hồ sơ liên hệ | Có (đầu cuốI) | Không | Chỉ văn bản mã hóa |
| Danh tính tình nguyện viên | Có (đầu cuốI) | Không | Chỉ văn bản mã hóa |
| Siêu dữ liệu nhóm/vai trò | Có (đã mã hóa) | Không | Chỉ văn bản mã hóa |
| Định nghĩa trường tùy chỉnh | Có (đã mã hóa) | Không | Chỉ văn bản mã hóa |
| NộI dung SMS/WhatsApp/Signal | Có (trên máy chủ của bạn) | Không | Văn bản mã hóa từ máy chủ của bạn; nhà cung cấp có thể có tin gốc |
| Siêu dữ liệu cuộc gọI | Không | Có | Có |
| Băm số điện thoạI ngườI gọI | Băm HMAC | Chỉ băm | Băm (không thể đảo ngược khI không có bí mật của bạn) |

---

## Dành cho các chuyên gia kiểm toán bảo mật

Tài liệu kỹ thuật:

- [Đặc tả giao thức](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/protocol/llamenos-protocol.md)
- [Mô hình đe dọa](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/THREAT_MODEL.md)
- [Phân loạI dữ liệu](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/DATA_CLASSIFICATION.md)
- [Kiểm toán bảo mật](https://github.com/rhonda-rodododo/llamenos/tree/main/docs/security)
- [Tài liệu API](/api/docs)

Llamenos là mã nguồn mở: [github.com/rhonda-rodododo/llamenos](https://github.com/rhonda-rodododo/llamenos)
