# Hệ thống thiết kế TNM HRM — Hướng C "Xanh tin cậy"

| | |
|---|---|
| Ngày chốt | 15/10/2026 |
| Nguồn tham khảo | Bộ dữ liệu UI/UX Pro Max (giấy phép MIT) — bảng màu "SaaS (General)", phông "Vietnamese Friendly", phong cách Flat + Data-Dense, quy tắc UX/a11y. Đã chọn lọc cho phần mềm văn phòng nhiều bảng dữ liệu. |
| Nơi định nghĩa token | `src/app/globals.css` (`:root`) |

## 1. Tinh thần

Phần mềm văn phòng dùng cả ngày: **phẳng, sáng, rõ ràng, dày dữ liệu nhưng dễ đọc**. Màu xanh dương tạo cảm giác tin cậy; màu cam chỉ dành cho điểm cần chú ý. Không gradient trang trí, không kính mờ, không hiệu ứng thừa.

## 2. Màu (chỉ dùng qua token, không viết mã hex trong component)

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--brand` | `#2563EB` | Nút chính, liên kết, mục đang chọn |
| `--brand-hover` | `#1D4ED8` | Hover nút chính |
| `--brand-soft` | `#E9EFF8` | Nền nhạt của mục chọn, ô nổi bật |
| `--accent` | `#EA580C` | Điểm nhấn hiếm: huy hiệu đếm, cảnh báo cần làm ngay |
| `--bg` | `#F8FAFC` | Nền trang (kèm họa tiết chấm) |
| `--surface` | `#FFFFFF` | Thẻ, bảng, hộp thoại, thanh bên |
| `--soft` | `#F1F5F9` | Nền phụ, hover dòng bảng |
| `--ink` | `#1E293B` | Chữ chính |
| `--muted` | `#475569` | Chữ phụ (đạt 4.5:1 trên nền trắng) |
| `--line` | `#E2E8F0` | Viền, đường kẻ |
| `--ok` / `--ok-bg` | `#166534` / `#DCFCE7` | Trạng thái tốt, thành công |
| `--warn` / `--warn-bg` | `#9A3412` / `#FFEDD5` | Sắp hết hạn, cần chú ý |
| `--bad` / `--bad-bg` | `#991B1B` / `#FEE2E2` | Lỗi, thiếu, đã hết hạn |
| `--info` / `--info-bg` | `#1E40AF` / `#DBEAFE` | Thông tin trung tính |
| `--focus` | `#2563EB` | Viền nổi khi dùng bàn phím |

Quy tắc:
- Chữ trên nền màu dùng **sắc đậm cùng họ màu** (vd chữ `--ok` trên nền `--ok-bg`), không dùng đen/xám.
- **Không truyền đạt ý nghĩa chỉ bằng màu**: trạng thái luôn có chữ ("Sắp hết hạn") hoặc biểu tượng đi kèm.
- Độ tương phản chữ thường tối thiểu **4.5:1**; biểu tượng/viền điều khiển tối thiểu **3:1**.

## 3. Nền

Nền trang `--bg` + họa tiết **chấm nhỏ** màu xanh rất nhạt:

```css
background-color: var(--bg);
background-image: radial-gradient(var(--pattern-dot) 1px, transparent 1px);
background-size: 10px 10px;
```

Đổi màu họa tiết bằng token `--pattern-dot`. Thẻ/bảng luôn nền trắng đặc để chữ không đè lên họa tiết.

## 4. Chữ

- Phông: **Be Vietnam Pro** (hỗ trợ tiếng Việt tốt nhất), dự phòng `Noto Sans`, `system-ui`, `sans-serif`. Nạp bằng `next/font` để tự lưu trữ, không chặn hiển thị.
- Thang cỡ: **12 · 14 · 16 · 18 · 24**. Nội dung chung 15px, bảng dữ liệu 14px, chú thích tối thiểu 12px. Không dùng chữ nhỏ hơn 12px.
- Độ dày: tiêu đề 600, nhãn 500, nội dung 400.
- Giãn dòng nội dung 1.5.
- Cột số (mã, ngày, số ngày còn lại) dùng **số đều nhau** (`font-variant-numeric: tabular-nums`).
- Ưu tiên xuống dòng hơn cắt chữ; mã/ID dài dùng `overflow-wrap: anywhere`.

## 5. Khoảng cách, góc, đường viền

- Nhịp khoảng cách **4/8px**: 4 · 8 · 12 · 16 · 24 · 32.
- Bo góc: điều khiển 6px, thẻ/hộp thoại 10px, huy hiệu dạng viên thuốc 999px.
- Viền 1px `--line`. Bóng đổ chỉ dùng cho lớp nổi (hộp thoại, thông báo), không dùng cho thẻ thường.
- Dòng bảng cao ~40px, hover nền `--soft`, tiêu đề cột dính khi cuộn.

## 6. Biểu tượng

- **Không dùng emoji làm biểu tượng.** Dùng bộ **Lucide** (`lucide-react`), nét 2px, kiểu outline thống nhất.
- Cỡ: 16px trong nút/dòng chữ, 20px tiêu đề phần.
- Biểu tượng đứng cạnh chữ: `aria-hidden`. Nút chỉ có biểu tượng: bắt buộc `aria-label`.

## 7. Tương tác và chuyển động

- Mọi phần tử bấm được có `cursor: pointer` và trạng thái hover, chuyển màu 150–200ms.
- **Viền nổi bàn phím** luôn hiện (`:focus-visible`, 2px `--focus`), không bao giờ tắt outline.
- Vùng bấm tối thiểu 24×24px (web), nút chính cao ≥36px.
- Chỉ animate `transform`/`opacity`; lúc rời đi nhanh hơn lúc xuất hiện.
- Tôn trọng `prefers-reduced-motion`: tắt chuyển động trang trí.
- Hành động phá hủy (lưu trữ, xóa) dùng màu `--bad` và có xác nhận.

## 8. Biểu mẫu

- Mỗi ô có **nhãn hiển thị** (không dùng placeholder thay nhãn); ô bắt buộc đánh dấu.
- Lỗi hiển thị **ngay dưới ô**, nói rõ nguyên nhân và cách sửa.
- Nút gửi có trạng thái đang xử lý; kết quả báo bằng thông báo (mục 9).

## 9. Thông báo (Toast)

Component dùng chung: `src/app/_components/Toast.tsx` (`ToastProvider`, `useToast`).

- Vị trí **góc dưới bên phải**, xếp chồng tối đa 4, mới nhất ở dưới cùng.
- 4 loại: `success` (xanh lá), `info` (xanh dương), `warning` (cam), `error` (đỏ) — mỗi loại có biểu tượng riêng, không chỉ dựa vào màu.
- **Thanh thời gian** chạy ở cạnh dưới; tự đóng sau ~4–5 giây (thông báo dài được thêm thời gian, tối đa 10 giây). **Rê chuột vào thì tạm dừng.** Có nút đóng.
- Không cướp focus; đọc cho trình đọc màn hình qua `aria-live` (`polite`; lỗi dùng `role="alert"`).
- Giảm chuyển động: không trượt vào, thanh thời gian vẫn đếm nhưng không hiệu ứng thừa.
- Cách gọi: `notify("Đã lưu hồ sơ.")` hoặc `notify("Không đọc được ảnh.", "error")`. Không truyền loại thì tự đoán: câu bắt đầu "Đã…" → `success`; có "không thể / không đọc / lỗi / không hợp lệ / thiếu" → `error`/`warning`; còn lại → `info`.

## 10. Kiểm tra trước khi giao giao diện

- [ ] Không còn emoji làm biểu tượng; biểu tượng cùng một bộ, cùng nét
- [ ] Tương phản chữ ≥ 4.5:1, biểu tượng/viền điều khiển ≥ 3:1
- [ ] Dùng bàn phím đi hết các nút, thấy rõ viền nổi; thứ tự Tab khớp thứ tự nhìn
- [ ] Bật giảm chuyển động: không còn chuyển động trang trí
- [ ] Hẹp 375px / 768px / 1024px / 1440px: không cuộn ngang trang
- [ ] Màu chỉ lấy từ token, không có mã hex mới trong component
