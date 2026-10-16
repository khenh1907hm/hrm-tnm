# TNM HRM

Ứng dụng Next.js 16 dùng dữ liệu giả trong bộ nhớ để minh họa quản lý nhân sự, chứng chỉ, chữ ký, nhắc hạn và xuất hồ sơ.

## Chạy ứng dụng

```bash
npm ci
npm run dev
```

Mở `http://localhost:3000`. Trước khi chạy môi trường phát triển hoặc tạo bản dựng, `scripts/setup-tesseract.mjs` sao chép worker và lõi WebAssembly của Tesseract.js 7 từ `node_modules` vào `public/tesseract/`. Script này cũng chạy sau khi cài gói.

Kiểm tra mã và tạo bản dựng:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Đọc ảnh

Tính năng đọc ảnh căn cước công dân chạy trong trình duyệt bằng Web Worker. Ảnh không được gửi ra ngoài. Hai tệp ngôn ngữ không đi kèm kho mã; tải `vie.traineddata` và `eng.traineddata` từ [tessdata_best của dự án Tesseract](https://github.com/tesseract-ocr/tessdata_best/tree/main) hoặc từ bộ dữ liệu Tesseract tương thích, rồi đặt trực tiếp tại:

```text
public/tessdata/vie.traineddata
public/tessdata/eng.traineddata
```

Ứng dụng đang dùng dữ liệu không nén (`gzip: false`). Sau khi đặt tệp, chạy lại ứng dụng và dùng nút “Đọc ảnh”; trình duyệt kiểm tra hai địa chỉ cùng nguồn `/tessdata/vie.traineddata` và `/tessdata/eng.traineddata`. Nếu thiếu dữ liệu tiếng Việt, giao diện báo “Chưa có tệp dữ liệu tiếng Việt, xem README mục Đọc ảnh” và vẫn cho phép nhập tay.

## Phông chữ xuất PDF

Để xuất tiếng Việt chính xác, đặt hai tệp Be Vietnam Pro vào:

```text
public/fonts/BeVietnamPro-Regular.ttf
public/fonts/BeVietnamPro-Bold.ttf
```

Có thể tải phông Be Vietnam Pro từ [Google Fonts](https://fonts.google.com/specimen/Be+Vietnam+Pro). Bản xuất PDF báo lỗi rõ ràng khi thiếu một trong hai tệp, không thay bằng phông khác.

## Email nhắc hạn

Vercel Cron gọi `GET /api/reminders/run` lúc 01:00 UTC (8:00 giờ Việt Nam) mỗi ngày (`vercel.json`). Admin cũng có thể bấm "Xem email cần gửi" → "Gửi email ngay" ở màn hình cảnh báo. Mỗi chứng chỉ chỉ gửi một lần cho mỗi mốc (bảng `reminder_log`). Địa chỉ nhận đặt trong phần Cài đặt của app.

Biến môi trường phía máy chủ (đặt trên Vercel, không dùng tiền tố `NEXT_PUBLIC_`):

| Biến | Ý nghĩa |
|---|---|
| `SUPABASE_SECRET_KEY` | Khóa bí mật Supabase (Project Settings → API Keys → Secret key), để đọc dữ liệu khi chạy tự động |
| `CRON_SECRET` | Chuỗi ngẫu nhiên dài; Vercel tự gửi kèm khi gọi lịch chạy |
| `SMTP_HOST`, `SMTP_PORT` | Ví dụ Gmail: `smtp.gmail.com`, `465` |
| `SMTP_USER`, `SMTP_PASS` | Tài khoản gửi; với Gmail dùng mật khẩu ứng dụng (App Password) |
| `MAIL_FROM` | Tùy chọn, ví dụ `TNM HRM <hr@congty.vn>`; mặc định là `SMTP_USER` |
| `APP_BASE_URL` | Địa chỉ app, dùng cho liên kết trong email |

## Giới hạn bản thử

- Dữ liệu nhân sự, loại chứng chỉ, chữ ký và nhật ký chỉ tồn tại trong bộ nhớ phiên; tải lại trang sẽ tạo lại dữ liệu mẫu.
- Chưa có đăng nhập thật; bộ chuyển vai trò Admin/HR chỉ phục vụ kiểm thử giao diện và facade.
- Chế độ demo (không có biến Supabase) chỉ giả lập nhắc hạn, không gửi email thật.
- Tệp tải lên và ảnh nhận diện chỉ giữ trong bộ nhớ trang. Tệp mẫu có thể chỉ có metadata nên không có bản xem trước.
- OCR phụ thuộc hai tệp ngôn ngữ cục bộ. PDF phụ thuộc hai tệp phông Be Vietnam Pro cục bộ.
