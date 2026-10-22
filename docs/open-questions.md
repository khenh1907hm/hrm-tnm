# Câu hỏi còn mở và giả định đang dùng

## Giả định theo mặc định của yêu cầu

Chưa có bảng B8 đã chỉnh sửa, nên các mục dưới đây giữ nguyên giá trị mặc định từ prompt. Có thể đổi sau khi chủ sản phẩm duyệt:

1. Chứng chỉ còn hiệu lực đến hết ngày hết hạn; ngày hết hạn vẫn được xem là hợp lệ (STATUS-02, EXP-02).
2. CCCD không khớp ngày sinh hoặc giới tính thì chặn lưu; Admin có thể ghi đè bằng lý do ít nhất 5 ký tự và thao tác được ghi nhật ký (CCCD-04).
3. Người dưới 15 tuổi bị chặn; dưới 18 hoặc trên 65 tuổi chỉ cảnh báo (EMP-04).
4. Họ tên phải có ít nhất hai từ (NAME-02).
5. Mã nhân viên có dạng TNM và 3 đến 5 chữ số (EMP-01).
6. Điện thoại di động phải hợp lệ theo mẫu 10 số; số di động cũ 11 số đầu 01 báo lỗi yêu cầu cập nhật (PHONE-02, PHONE-03).
7. Tick chứng chỉ theo hiệu lực tại ngày ký phiếu (EXP-02).
8. Thiếu trường phiếu, ngoại trừ ảnh 3×4, chặn xuất (EXP-01).
9. Người nghỉ việc hoặc đã ẩn không nhận email nhắc hạn; người tạm nghỉ vẫn nhận (EMP-08, REM-01).
10. Chứng chỉ đã hết hạn chỉ được nhắc khi bật cấu hình, mặc định tắt (REM-03).
11. Gia hạn tạo bản ghi mới, thay thế bản cũ và hạn mới phải sau hạn cũ (CERT-07).
12. Chức danh và loại chứng chỉ là danh sách cố định (EMP-02, CERT-01).
13. HR được hiện CCCD đầy đủ; mỗi lần hiện đều được ghi nhật ký (RBAC-01).
14. EXP-08: khi nhiều chứng chỉ cùng loại có chung ngày hết hạn xa nhất, chọn theo title đã bỏ dấu và hạ chữ thường, thứ tự mã ký tự tăng dần; nếu vẫn hòa thì chọn id theo thứ tự mã ký tự tăng dần. Đây là mặc định tạm thời, cần xác nhận.
15. Nhân sự đã ẩn: không xuất hiện trong tìm kiếm và checklist mặc định; chỉ được xem lại khi Admin yêu cầu bao gồm nhân sự đã ẩn. Việc ẩn nhân sự không thay đổi chứng chỉ trong kho.
16. Tệp đã có sẵn trong dữ liệu mẫu chỉ chứa metadata; nút xem báo tệp chưa có dữ liệu trong phiên. Tệp người dùng chọn được giữ bằng đối tượng `File` trong state trang và URL xem trước bị thu hồi khi đóng. Tệp bổ sung mới mặc định lấy tên tệp làm nhãn; giao diện cho phép tải nhiều tệp trong một lần.
17. Bộ lọc chứng chỉ bắt buộc hiện áp dụng cho danh sách nhân sự bao gồm cả hồ sơ đã ẩn khi bộ lọc hồ sơ lưu trữ được bật; mặc định danh sách nhân sự đã ẩn không hiển thị.

## Cần xác nhận trước khi tích hợp dịch vụ thật

- `cccd_reader.py` được nhắc đến trong yêu cầu nhưng không có trong repo hiện tại; giai đoạn OCR sẽ cần tệp nguồn hoặc sẽ chỉ triển khai theo đặc tả OCR trong prompt.
- Chưa có dịch vụ gửi email, lưu tệp, hay danh bạ chỉ huy trưởng. Giai đoạn chưa có cơ sở dữ liệu sẽ dùng interface và bộ giả trong bộ nhớ.
- Bộ dữ liệu mẫu sẽ là dữ liệu giả, không đại diện hồ sơ nhân sự thật.

## Cải tiến sau (bộ nhớ tạm và phân trang)

Đã cố ý chưa làm trong đợt làm bộ nhớ tạm phía trình duyệt (`src/repositories/cached.ts`):

- **Tách CCCD khỏi dữ liệu danh sách.** Hiện Supabase vẫn gửi CCCD đầy đủ qua mạng (cột `cccd` và trong `doc`) cho mọi tài khoản admin/hr, nên che CCCD trong bộ nhớ tạm không bảo vệ được (xem được trong DevTools). Băm CCCD cũng không có tác dụng vì CCCD là số có cấu trúc, dò ngược được. Cách làm đúng: migration tách CCCD sang cột/bảng riêng có RLS chặn đọc hàng loạt, thêm hàm `getCccd(id)` ghi `audit_events`, kiểm trùng CCCD và xuất Excel gọi phía máy chủ. Ràng buộc duy nhất `employees_cccd_key` đã có ở DB.
- **Chọn cột cho danh sách** (không tải nguyên `doc`): hoãn cùng lý do trên. Số đo ngày 19/10/2026: 32 nhân sự ≈ 19 KB JSON, 109 chứng chỉ ≈ 52 KB; `extraFiles`/`extraFields` chỉ chứa mã tệp/đường dẫn, không có base64.
- Optimistic update; đồng bộ nhiều tab bằng BroadcastChannel; lưu cache ra ổ đĩa (localStorage/IndexedDB); phân trang cursor; Supabase realtime.
- Bộ nhớ tạm cho `settings` (một dòng, `get()` không qua `list()`), `report_templates` và `skill_posts` (gọi Supabase trực tiếp, không qua repository).
- Màn hình cảnh báo hạn tự tính lại lúc 00:00 giờ Việt Nam khi để mở qua đêm (hiện chỉ tính lại khi dữ liệu làm mới hoặc tải lại trang).
- Ngưỡng nâng cấp: khi một bảng vượt khoảng 10.000 dòng thì chuyển bảng đó sang phân trang ở máy chủ thay vì nạp cả bảng.
