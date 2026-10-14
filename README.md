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

## Giới hạn bản thử

- Dữ liệu nhân sự, loại chứng chỉ, chữ ký và nhật ký chỉ tồn tại trong bộ nhớ phiên; tải lại trang sẽ tạo lại dữ liệu mẫu.
- Chưa có đăng nhập thật; bộ chuyển vai trò Admin/HR chỉ phục vụ kiểm thử giao diện và facade.
- Nhắc hạn chỉ chạy bằng Mailer giả. Không gửi email thật.
- Tệp tải lên và ảnh nhận diện chỉ giữ trong bộ nhớ trang. Tệp mẫu có thể chỉ có metadata nên không có bản xem trước.
- OCR phụ thuộc hai tệp ngôn ngữ cục bộ. PDF phụ thuộc hai tệp phông Be Vietnam Pro cục bộ.
