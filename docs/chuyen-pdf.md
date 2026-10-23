# Chuyển phiếu Excel → PDF

Nút **Tải hồ sơ PDF** (xuất một người hoặc hàng loạt) làm 3 bước:

1. Trình duyệt điền mẫu Excel (vùng in tuyệt đối, vừa 1 trang).
2. Gửi file `.xlsx` tới `/api/convert-pdf` → máy chủ của app kiểm tra đăng nhập rồi chuyển cho **máy chuyển PDF** đang cấu hình.
3. Trình duyệt ghép PDF phiếu (trang đầu) với các chứng chỉ đã chọn (các trang sau) thành một file.

Chưa cấu hình máy chuyển PDF thì nút vẫn chạy, nhưng tải về ZIP (phiếu Excel + PDF gộp chứng chỉ) như trước.

## Biến môi trường

Đặt trong `.env.local` (máy dev, khởi động lại `npm run dev` sau khi sửa) và Vercel → project → Settings → Environment Variables (Production + Preview, bật Sensitive, rồi Redeploy).

**Không** thêm tiền tố `NEXT_PUBLIC_` cho các biến dưới đây: có tiền tố thì khóa lộ ra trình duyệt.

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `PDF_CONVERTER` | không | `compdf` hoặc `gotenberg`. Bỏ trống: dùng bên đầu tiên đã có cấu hình (ComPDF trước, rồi Gotenberg). |
| `COMPDF_API_KEY` | với ComPDF | **Public Key** trong ComPDF → API Keys. Không dùng Secret Key. |
| `COMPDF_API_URL` | không | Đổi địa chỉ API ComPDF; mặc định `https://api-server.compdf.com`. |
| `GOTENBERG_URL` | với Gotenberg | Địa chỉ máy chủ Gotenberg (xem `docker/gotenberg/README.md`). |
| `GOTENBERG_USERNAME`, `GOTENBERG_PASSWORD` | không | Tài khoản basic auth của Gotenberg, nếu có bật. |

## ComPDF

- Gọi `POST /server/v2/process/xlsx/pdf` với header `x-api-key: <Public Key>`, nhận `downloadUrl` rồi tải PDF về.
- Mỗi lần xuất PDF cho một người trừ **1 lượt "Conversion & Editor"**. Ghép chứng chỉ làm trên trình duyệt, không tốn lượt.
- Gói Free: 200 lượt/tháng, lượt thừa không cộng dồn. Gói trả phí: 1.000 / 5.000 / 10.000 lượt mỗi tháng.
- Đổi gói (Free → trả phí): không cần sửa gì trong app, khóa giữ nguyên. Nếu ComPDF cấp khóa mới thì chỉ thay `COMPDF_API_KEY`.
- File trên máy chủ ComPDF tự xóa sau 2 ngày.

## Đổi sang bên khác

- **Sang Gotenberg (tự dựng):** đặt `GOTENBERG_URL` (và tài khoản nếu có), đặt `PDF_CONVERTER=gotenberg` hoặc xóa `COMPDF_API_KEY`.
- **Thêm một bên mới** (CloudConvert, ConvertAPI…):
  1. Tạo `src/lib/pdfConverter/<ten>.ts` có hàm `create<Ten>Converter(env, fetcher)` trả về `PdfConverter` (`name` + `convert(xlsx) → PDF`), trả `null` khi thiếu cấu hình, lỗi thì ném `PdfConvertFailure`. Làm theo mẫu `compdf.ts`.
  2. Thêm một dòng vào `PROVIDERS` trong `src/lib/pdfConverter/index.ts`, và các biến môi trường mới vào `PdfConverterEnv` + `src/app/api/convert-pdf/route.ts`.
  3. Đặt `PDF_CONVERTER=<ten>`.

Route, giao diện và phần ghép chứng chỉ không phải sửa.

## Lỗi thường gặp

| Thông báo trong app | Nguyên nhân |
|---|---|
| Chưa cấu hình máy chuyển PDF… | Chưa đặt khóa / địa chỉ; app tải ZIP thay cho PDF. |
| Đã chọn PDF_CONVERTER=… nhưng chưa đặt … | Đã chọn bên nhưng thiếu biến của bên đó. |
| ComPDF từ chối khóa API | Dán nhầm Secret Key, khóa sai hoặc đã bị thu hồi. |
| ComPDF không chuyển được file: … | Lý do ComPDF trả về, vd hết lượt trong tháng. |
| File Excel trống hoặc lớn hơn 4 MB | Giới hạn của Vercel (4,5 MB mỗi yêu cầu); thường do ảnh trong phiếu quá nặng. |
