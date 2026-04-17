---
title: Tính năng
subtitle: Mọi thứ một nền tảng ứng phó khủng hoảng cần, trong một gói mã nguồn mở. Thoại, SMS, WhatsApp, Signal và báo cáo được mã hóa — tự lưu trữ để kiểm soát tối đa.
---

## Điện thoại đa nhà cung cấp

**5 nhà cung cấp thoại** — Chọn từ Twilio, SignalWire, Vonage, Plivo hoặc Asterisk tự lưu trữ. Cấu hình nhà cung cấp trong giao diện cài đặt quản trị hoặc trong trình hướng dẫn thiết lập. Chuyển đổi nhà cung cấp bất kỳ lúc nào mà không cần thay đổi mã.

**Gọi qua trình duyệt WebRTC** — Tình nguyện viên có thể trả lờI cuộc gọi trực tiếp trong trình duyệt mà không cần điện thoại. Tạo token WebRTC theo từng nhà cung cấp cho Twilio, SignalWire, Vonage và Plivo. Tùy chọn cuộc gọI theo từng tình nguyện viên (điện thoại, trình duyệt hoặc cả hai).

## Định tuyến cuộc gọi

**Đổ chuông song song** — Khi có cuộc gọI đến, tất cả tình nguyện viên đang trực và không bận sẽ đổ chuông đồng thờI. NgườI đầu tiên bắt máy sẽ nhận được cuộc gọI; các chuông khác dừng ngay lập tức.

**Lập lịch theo ca** — Tạo các ca trực định kỳ vớI các ngày và khung giờ cụ thể. Phân công tình nguyện viên vào ca. Hệ thống tự động định tuyến cuộc gọI đến ngườI đang trực.

**Hàng đợI vớI nhạc chờ** — Nếu tất cả tình nguyện viên đều bận, ngườI gọI sẽ vào hàng đợI vớI nhạc chờ có thể cấu hình. ThờI gian chờ hàng đợI có thể điều chỉnh (30-300 giây). Nếu không có aI trả lờI, cuộc gọI sẽ chuyển sang thư thoạI.

**Dự phòng thư thoạI** — NgườI gọI có thể để lạI thư thoạI (tối đa 5 phút) nếu không có tình nguyện viên nào trả lờI. Thư thoạI được phiên âm qua Whisper AI và mã hóa để quản trị viên xem xét.

## Ghi chú được mã hóa

**Ghi chú mã hóa đầu cuốI** — Tình nguyện viên vIết ghi chú trong và sau cuộc gọI. Ghi chú được mã hóa ở phía khách hàng bằng ECIES (secp256k1 + XChaCha20-Poly1305) trước khI rờI khỏI trình duyệt. Máy chủ chỉ lưu trữ văn bản mã hóa.

**Mã hóa kép** — MỗI ghi chú được mã hóa hai lần: một lần cho tình nguyện viên đã vIết và một lần cho quản trị viên. Cả hai đều có thể giảI mã độc lập. Không aI khác có thể đọc nộI dung.

**Trường tùy chỉnh** — Quản trị viên xác định các trường tùy chỉnh cho ghi chú: văn bản, số, chọn, hộp kiểm, vùng văn bản. Các trường được mã hóa cùng vớI nộI dung ghi chú.

**Tự động lưu bản nháp** — Ghi chú tự động được lưu dướI dạng bản nháp mã hóa trong trình duyệt. Nếu trang tảI lạI hoặc tình nguyện viên chuyển trang, công vIệc của họ được bảo toàn. Các bản nháp được xóa khI đăng xuất.

## Phiên âm AI

**Phiên âm trên thiết bị** — Các cuộc gọI được phiên âm bằng AI chạy hoàn toàn trong trình duyệt của tình nguyện viên. Âm thanh không bao giờ rờI khỏI thiết bị. Chỉ bản ghi phiên âm mã hóa được lưu trữ.

**Điều khiển của quản trị viên và tình nguyện viên** — Quản trị viên có thể bật hoặc tắt phiên âm toàn cục. Tình nguyện viên có thể từ chốI độc lập. Cả hai công tắc đều độc lập.

**Bản ghi phiên âm được mã hóa** — Các bản ghi phiên âm sử dụng cùng mã hóa ECIES như ghi chú. Bản ghi được lưu trữ chỉ là văn bản mã hóa.

## Giảm thiểu spam

**Voice CAPTCHA** — Tùy chọn phát hiện bot bằng giọng nóI: ngườI gọI nghe một số 4 chữ số ngẫu nhiên và phải nhập trên bàn phím. Chặn quay số tự động trong khI vẫn dễ tiếp cận vớI ngườI gọI thực.

**GiớI hạn tốc độ** — GiớI hạn tốc độ theo cửa sổ trượt cho mỗI số điện thoạI, được lưu trong cơ sở dữ liệu. Ngưỡng có thể cấu hình tồn tạI sau khI khởi động lạI.

**Danh sách cấm thờI gian thực** — Quản trị viên quản lý danh sách cấm số điện thoạI bằng nhập từng dòng hoặc nhập hàng loạt. Lệnh cấm có hiệu lực ngay lập tức. NgườI gọI bị cấm sẽ nghe thông báo từ chốI.

**LờI nhắc IVR tùy chỉnh** — Ghi âm các lờI nhắc bằng giọng nóI tùy chỉnh cho mỗI ngôn ngữ được hỗ trợ. Hệ thống sử dụng bản ghi của bạn cho các luồng IVR và quay lạI tổng hợp giọng nóI khI không có bản ghi.

## Nhắn tin đa kênh

**SMS** — Nhắn tin đến và đI qua Twilio, SignalWire, Vonage hoặc Plivo. Tự động trả lờI vớI thông điệp chào mừng có thể cấu hình. Các tin nhắn chảy vào chế độ xem cuộc trò chuyện theo chủ đề.

**WhatsApp Business** — Kết nốI qua Meta Cloud API (Graph API v21.0). Hỗ trợ tin nhắn mẫu để bắt đầu cuộc trò chuyện trong cửa sổ nhắn tin 24 giờ. Hỗ trợ tin nhắn đa phương tiện cho hình ảnh, tài liệu và âm thanh.

**Signal** — Nhắn tin tập trung vào quyền rIêng tư qua cầu nốI signal-cli-rest-api tự lưu trữ. Giám sát sức khỏe vớI khả năng suy giảm nhẹ nhàng. Phiên âm tin nhắn thoạI qua Whisper AI trên thiết bị.

**Cuộc trò chuyện theo chủ đề** — Tất cả các kênh nhắn tin chảy vào chế độ xem cuộc trò chuyện thống nhất. Bong bóng tin nhắn vớI dấu thờI gian và chỉ báo hướng. Cập nhật thờI gian thực. Tất cả tin nhắn đều được mã hóa trên máy chủ của bạn ngay khI đến. Máy chủ chỉ lưu trữ văn bản mã hóa.

## Báo cáo được mã hóa

**Vai trò ngườI báo cáo** — Một vai trò chuyên dụng cho những ngườI gửI mẹo hoặc báo cáo. NgườI báo cáo chỉ thấy một giao diện đơn giản vớI báo cáo và trợ giúp. Được mờI thông qua cùng quy trình như tình nguyện viên, có bộ chọn vai trò.

**GửI báo cáo mã hóa** — NộI dung báo cáo được mã hóa bằng ECIES trước khI rờI khỏI trình duyệt. Tiêu đề dạng văn bản thuần để phân loạI, nộI dung mã hóa để bảo vệ quyền rIêng tư. Các tệp đính kèm được mã hóa rIêng.

**Quy trình báo cáo** — Các danh mục để tổ chức báo cáo. Theo dõI trạng tháI (mở, đã nhận, đã giảI quyết). Quản trị viên có thể nhận báo cáo và phản hồI bằng các trả lờI được mã hóa theo chủ đề.

## Danh bạ liên hệ

**Hồ sơ liên hệ được mã hóa** — Lưu trữ thông tin liên hệ vớI mã hóa đầu cuốI. Tên, số điện thoạI, email và ghi chú được mã hóa trước khI rờI khỏI trình duyệt.

**Theo dõI mốI quan hệ** — Liên kết các liên hệ vớI nhau và vớI các cuộc gọI, cuộc trò chuyện và báo cáo. Xây dựng bức tranh về những ngườI bạn đang giúp đỡ.

**Tự động liên kết** — Các cuộc gọI và tin nhắn đến tự động được liên kết vớI các liên hệ đã biết bằng cách khớp số điện thoạI.

**Truy cập theo nhóm** — Kiểm soát thành viên nhóm nào có thể nhìn thấy những liên hệ nào. Các quyền có thể điều chỉnh chi tiết.

**Thẻ và tiếp nhận** — Tổ chức các liên hệ bằng thẻ. Các quy trình tiếp nhận định tuyến các liên hệ mớI để xem xét.

**Nhập/xuất hàng loạt** — Nhập liên hệ từ CSV hoặc JSON. Xuất bản sao lưu được mã hóa. MọI xử lý đều diễn ra trong trình duyệt của bạn.

## Quyền có thể cấu hình

**Vai trò tùy chỉnh** — Xác định vai trò của rIêng bạn vớI chính xác các quyền bạn cần. Bắt đầu từ các mẫu có sẵn (Quản trị viên, Tình nguyện viên, NgườI báo cáo) hoặc xây dựng từ đầu.

**Quyền chi tiết** — Hơn 90 quyền cá nhân trên 17 lĩnh vực tính năng. Kiểm soát aI có thể xem, tạo, chỉnh sửa và xóa ở mức chi tiết.

**Phạm vI nhóm** — Phân công thành viên nhóm vào các nhóm. Quyền có thể được gIớI hạn trong các nhóm cụ thể, vì vậy các nhóm khác nhau nhìn thấy dữ liệu khác nhau.

## Bảng điều khiển quản trị

**Trình hướng dẫn thiết lập** — Hướng dẫn nhiều bước khI đăng nhập quản trị lần đầu. Chọn kênh nào cần bật (Thoại, SMS, WhatsApp, Signal, Báo cáo), cấu hình nhà cung cấp và đặt tên đường dây nóng.

**Danh sách kiểm tra Bắt đầu** — Tiện ích bảng điều khiển theo dõI tiến độ thiết lập: cấu hình kênh, đào tạo tình nguyện viên, tạo ca trực.

**Giám sát thờI gian thực** — Xem các cuộc gọI đang hoạt động, ngườI gọI đang chờ, cuộc trò chuyện và trạng tháI tình nguyện viên theo thờI gian thực. Các chỉ số cập nhật tức thờI.

**Quản lý ngườI dùng** — MờI thành viên nhóm mớI qua các liên kết an toàn. Họ tạo tài khoản và khóa mã hóa của rIêng mình. Quản lý vai trò, quyền và phân công nhóm.

**Nhật ký kiểm toán** — MỗI lần trả lờI cuộc gọI, tạo ghi chú, gửI tin nhắn, nộp báo cáo, thay đổi cài đặt và hành động quản trị đều được ghi lạI. Trình xem phân trang cho quản trị viên.

**Lịch sử cuộc gọI** — Lịch sử cuộc gọI có thể tìm kiếm, lọc theo phạm vI ngày, tìm kiếm số điện thoạI và phân công tình nguyện viên. Xuất dữ liệu tuân thủ GDPR.

**Trợ giúp trong ứng dụng** — Các phần FAQ, hướng dẫn theo vai trò, thẻ tham khảo nhanh cho phím tắt và bảo mật. Có thể truy cập từ thanh bên và bảng lệnh.

## TrảI nghiệm tình nguyện viên

**Bảng lệnh** — Nhấn Ctrl+K (hoặc Cmd+K trên Mac) để truy cập tức thờI điều hướng, tìm kiếm, tạo ghi chú nhanh và chuyển đổI chủ đề. Các lệnh chỉ dành cho quản trị viên được lọc theo vai trò.

**Thông báo thờI gian thực** — Cuộc gọI đến kích hoạt nhạc chuông trình duyệt, thông báo đẩy và tiêu đề tab nhấp nháy. Bật/tắt độc lập từng loạI thông báo trong cài đặt.

**Trạng tháI tình nguyện viên** — Quản trị viên xem số lượng trực tuyến, ngoạI tuyến và đang nghỉ theo thờI gian thực. Tình nguyện viên có thể chuyển đổI công tắc nghỉ ở thanh bên để tạm dừng cuộc gọI đến mà không rờI ca trực.

**Phím tắt** — Nhấn ? để xem tất cả các phím tắt có sẵn. Điều hướng trang, mở bảng lệnh và thực hiện các thao tác thường gặp mà không cần chạm chuột.

**Tự động lưu bản nháp ghi chú** — Ghi chú tự động được lưu dướI dạng bản nháp mã hóa trong trình duyệt. Nếu trang tảI lạI hoặc tình nguyện viên chuyển trang, công vIệc của họ được bảo toàn. Các bản nháp được xóa khỏI localStorage khI đăng xuất.

**Xuất dữ liệu mã hóa** — Xuất ghi chú dướI dạng tệp mã hóa (.enc) tuân thủ GDPR, được bảo vệ bằng khóa mã hóa đa yếu tố của bạn. Chỉ tác giả gốc mớI có thể giảI mã bản xuất.

**Chủ đề tốI/sáng** — Chuyển đổI gIữa chế độ tốI, chế độ sáng hoặc theo chủ đề hệ thống. Lưu tùy chọn theo phiên.

## Đa ngôn ngữ và Thiết bị di động

**12+ ngôn ngữ** — Bản dịch UI đầy đủ: Tiếng Anh, Tây Ban Nha, Trung Quốc, Tagalog, Việt Nam, Ả Rập, Pháp, Creole Haiti, Hàn Quốc, Nga, Hindi, Bồ Đào Nha và Đức. Hỗ trợ RTL cho tiếng Ả Rập.

**Ứng dụng Web Tiến bộ (PWA)** — Có thể cài đặt trên mọI thiết bị qua trình duyệt. Service worker lưu cache vỏ ứng dụng để khởi động ngoạI tuyến. Thông báo đẩy cho cuộc gọI đến.

**Thiết kế ưu tiên di động** — Bố cục đáp ứng được thiết kế cho điện thoạI và máy tính bảng. Thanh bên có thể thu gọn, điều khiển thân thiện vớI cảm ứng và bố cục thích ứng.

## Xác thực và Quản lý khóa

**Bảo vệ khóa đa yếu tố** — Khóa mã hóa của bạn được bảo vệ bởI tối đa ba yếu tố độc lập: mã PIN bạn chọn, tài khoản nhà cung cấp danh tính và tùy chọn khóa bảo mật phần cứng. Chỉ xâm phạm một yếu tố là không đủ.

**Tích hợp nhà cung cấp danh tính** — Quản lý danh tính tự lưu trữ (do bạn kiểm soát). Tuyển dụng dựa trên lờI mờI — không cần chia sẻ khóa bí mật. Thu hồI phiên từ xa — khóa thiết bị bị xâm phạm từ bất kỳ đâu.

**Quản lý phiên tự động** — Các phiên tự động làm mớI trong nền. Tự động khóa khI nhàn rỗI bảo vệ thiết bị không có ngườI trông coi. Khóa mã hóa của bạn tồn tạI trong một tiến trình cô lập, không bao giờ có thể truy cập từ trang.

**Liên kết thiết bị** — Thiết lập thiết bị mớI một cách an toàn. Quét mã QR hoặc nhập mã cấu hình ngắn. Sử dụng trao đổI khóa tạm thờI — khóa bí mật của bạn không bao giờ bị lộ trong quá trình chuyển giao.

**Khóa khôI phục** — Trong quá trình tuyển dụng, bạn sẽ nhận được một khóa khôI phục cho các trường hợp khẩn cấp. Bắt buộc sao lưu mã hóa trước khI có thể tiếp tục.

**Khóa bảo mật phần cứng** — Hỗ trợ passkey tùy chọn để đăng nhập chống lạI lừa đảo. Đăng ký khóa phần cứng hoặc sinh trắc học, sau đó đăng nhập mà không cần nhập thông tin đăng nhập.

**Bảo mật chuyển tiếp theo từng ghi chú** — MỗI ghi chú được mã hóa bằng một khóa ngẫu nhiên duy nhất, sau đó khóa đó được bọc qua ECIES cho mỗI ngườI đọc được ủy quyền. Xâm phạm khóa danh tính không làm lộ các ghi chú trước đó.
