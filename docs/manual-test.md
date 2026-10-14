# Bảng kiểm tra thủ công (Manual Test Checklist)

> Phiên bản: 2026-10-13 · Môi trường: `npm run dev` với dữ liệu mẫu demo

Chạy theo thứ tự từ rủi ro **Cao** xuống **Thấp**. Sau mỗi kịch bản đánh dấu **✅ Đạt** hoặc **❌ Không đạt** và ghi chú nếu cần.

---

## Rủi ro Cao

| STT | Tính năng / Kịch bản kiểm thử | Bước thực hiện | Kết quả kỳ vọng | Đạt/Không đạt | Ghi chú |
|-----|-------------------------------|----------------|-----------------|---------------|---------|
| 1 | **Xuất phiếu PDF – thiếu font** | Xóa `public/fonts/BeVietnamPro-Regular.ttf`, nhấn Xuất hồ sơ PDF | Thông báo: "Thiếu public/fonts/BeVietnamPro-Regular.ttf" | `[ ]` | |
| 2 | **Xuất phiếu PDF – đủ font, in đủ chỉ huy** | Đảm bảo font có mặt; chọn nhân sự có gán chỉ huy; nhấn Tải PDF | PDF tải về, trang bìa có họ tên / chức vụ / SĐT / địa chỉ chỉ huy trưởng | `[ ]` | |
| 3 | **Phân quyền RBAC – HR không viết commander** | Chuyển sang HR; Cài đặt → Chỉ huy trưởng | Không có nút Thêm / Sửa / Ẩn; chỉ xem danh sách | `[ ]` | |
| 4 | **Chặn ẩn chỉ huy đang được nhân sự gán** | Admin; nhân sự mẫu dùng cmd-1; Cài đặt → Chỉ huy trưởng → Ẩn cmd-1 | Lỗi "Chỉ huy trưởng đang được nhân sự sử dụng, không thể ẩn." | `[ ]` | |
| 5 | **Hộp xác nhận cảnh báo trước khi lưu chứng chỉ** | Thêm chứng chỉ đã hết hạn (ngày hết hạn < hôm nay) | Hộp confirm hiện cảnh báo; chọn Hủy → chứng chỉ không được lưu | `[ ]` | |
| 6 | **OCR – thiếu tessdata** | Xóa `public/tessdata/vie.traineddata`; chọn ảnh CCCD; nhấn Đọc ảnh | Thông báo: "Thiếu public/tessdata/vie.traineddata — xem README mục Đọc ảnh để tải về." | `[ ]` | |

---

## Rủi ro Trung bình

| STT | Tính năng / Kịch bản kiểm thử | Bước thực hiện | Kết quả kỳ vọng | Đạt/Không đạt | Ghi chú |
|-----|-------------------------------|----------------|-----------------|---------------|---------|
| 7 | **Kéo thả tệp chứng chỉ chính** | Mở form thêm chứng chỉ; kéo file PDF vào vùng dropzone tệp chính | Vùng sáng lên; tên file hiển thị; submit thành công | `[ ]` | |
| 8 | **Kéo thả tệp bổ sung** | Kéo nhiều file vào vùng dropzone tệp bổ sung | File thêm vào danh sách; submit lưu đủ | `[ ]` | |
| 9 | **Gán chỉ huy trưởng cho nhân sự** | Admin → Thêm nhân sự; chọn chỉ huy từ dropdown; Lưu hồ sơ | Panel chi tiết hiển thị tên · chức vụ · SĐT · địa chỉ chỉ huy | `[ ]` | |
| 10 | **Hiển thị chỉ huy trong panel chi tiết** | Nhấn vào nhân sự đã gán chỉ huy | Mục "Chỉ huy trưởng liên hệ khẩn cấp" hiện đủ 4 trường | `[ ]` | |
| 11 | **Admin thêm chỉ huy mới** | Cài đặt → Chỉ huy trưởng → Thêm; điền đủ; Lưu | Hàng mới xuất hiện; thông báo "Đã thêm chỉ huy trưởng." | `[ ]` | |
| 12 | **Admin sửa thông tin chỉ huy** | Sửa SĐT của một bản ghi; Lưu | Bảng cập nhật; thông báo "Đã cập nhật chỉ huy trưởng." | `[ ]` | |
| 13 | **Xóa chữ ký cuối cùng** | Chỉ còn 1 chữ ký; nhấn Xóa | Lỗi "Không thể xóa chữ ký cuối cùng." | `[ ]` | |

---

## Rủi ro Thấp

| STT | Tính năng / Kịch bản kiểm thử | Bước thực hiện | Kết quả kỳ vọng | Đạt/Không đạt | Ghi chú |
|-----|-------------------------------|----------------|-----------------|---------------|---------|
| 14 | **Ẩn / hiện chỉ huy đã ẩn** | Ẩn một chỉ huy không được dùng; bật checkbox "Hiện chỉ huy đã ẩn" | Mất khỏi danh sách chính; hiện lại với nhãn "Đã ẩn" | `[ ]` | |
| 15 | **Dropdown chỉ liệt kê chỉ huy chưa ẩn** | Ẩn một chỉ huy; mở form thêm nhân sự | Dropdown không còn chỉ huy đã ẩn | `[ ]` | |
| 16 | **Nhắc hạn chứng chỉ** | Tab "Chứng chỉ hết hạn" → Chạy nhắc hạn thử → Đánh dấu đã gửi | Email mẫu hiện; sau khi đánh dấu, cột "Email nhắc" cập nhật | `[ ]` | |
| 17 | **Chuyển đổi vai trò Admin / HR** | Nhấn HR ở sidebar; thử thêm nhân sự | Nút "Thêm nhân sự" biến mất khi HR; hiện lại khi về Admin | `[ ]` | |

---

## Ghi chú chung

- Dữ liệu demo chỉ tồn tại trong phiên trình duyệt; reload là mất.
- Font BeVietnamPro đặt tại `public/fonts/`; tessdata tại `public/tessdata/`.
- Để kiểm tra kéo thả, dùng Chrome/Edge hoặc Firefox 100+.
