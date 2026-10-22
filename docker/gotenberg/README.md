# Máy chủ chuyển Excel → PDF có font của mẫu

PDF được tạo bằng LibreOffice trên máy chủ Gotenberg. Image gốc `gotenberg/gotenberg:8` không có các font mà mẫu hồ sơ dùng (Tahoma, Times New Roman, Calibri, Segoe UI Symbol), nên LibreOffice thay bằng font khác rộng hơn và bố cục PDF lệch so với Excel. Image trong thư mục này cài thêm các font đó.

## Font

Các tệp `.ttf` đặt trong `fonts/` (không đưa lên git):

```
tahoma.ttf tahomabd.ttf
times.ttf timesbd.ttf timesi.ttf timesbi.ttf
calibri.ttf calibrib.ttf calibrii.ttf calibriz.ttf
seguisym.ttf
```

Lấy từ `C:\Windows\Fonts` của máy Windows có bản quyền. Đây là font của Microsoft: chỉ dùng cho máy chủ nội bộ của công ty, không chia sẻ ra ngoài. Nếu mẫu dùng thêm font khác, chép thêm tệp tương ứng rồi build lại.

## Deploy lên Google Cloud Run

Chạy trong thư mục này (cần `gcloud` đã đăng nhập đúng project):

```bash
gcloud run deploy gotenberg --source . --region asia-southeast1 --port 3000 --memory 1Gi --allow-unauthenticated --set-env-vars GOTENBERG_API_BASIC_AUTH_USERNAME=<tên>,GOTENBERG_API_BASIC_AUTH_PASSWORD=<mật khẩu>
```

Nếu đã có service Gotenberg, dùng đúng tên service đó để thay image, giữ nguyên URL và biến môi trường trên Vercel. Tệp `.gcloudignore` ở đây bảo đảm thư mục `fonts/` được gửi lên khi build.

Kiểm tra: mở `https://<URL>/health` phải thấy `"status":"up"`, rồi xuất thử một hồ sơ PDF trong app.
