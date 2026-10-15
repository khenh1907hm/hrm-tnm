# Đặc tả: FORM báo cáo (Mẫu hồ sơ nhân sự gửi khách hàng)

| | |
|---|---|
| Phiên bản | 0.1 (bản nháp chờ duyệt), 14/10/2026 |
| Màn hình liên quan | "FORM Báo cáo (Excel)" — mở rộng và thay thế màn hiện có |
| Mẫu nghiệm thu | `Mẫu bìa Hồ sơ an toàn Taikisha.xlsm` → chuyển thành `.xlsx` |

## 1. Mục tiêu

Người dùng tự thiết kế phiếu hồ sơ bằng Excel **một lần cho mỗi dự án**, sau đó xuất hồ sơ cho từng nhân sự bằng vài cú bấm. File xuất ra **giữ nguyên 100% định dạng** của mẫu, chỉ thay dữ liệu. Chứng chỉ đính kèm nằm **lần lượt bên dưới phiếu**, mỗi chứng chỉ một trang in.

## 2. Khái niệm

| Khái niệm | Gồm những gì |
|---|---|
| **Mẫu hồ sơ** | File thiết kế `.xlsx` · Bản đồ trường (ô/vùng → trường) · Danh sách chứng chỉ đính kèm (chọn loại + thứ tự) · Giá trị cố định của mẫu · Các phiên bản |
| **Thư viện trường** | Mọi trường dùng được trên mẫu. Một trường định nghĩa một lần, dùng cho nhiều mẫu |
| **Dự án** | Tên dự án · Khách hàng · Mẫu mặc định · **Biến dự án** (giá trị dùng chung cho mọi nhân sự đi dự án đó) |
| **Lần xuất** | Ai xuất · Lúc nào · Dự án · Mẫu + phiên bản · Danh sách nhân sự · Giá trị đã dùng (để xuất lại y hệt) |

### 2.1 Các loại trường

| Nhóm | Ví dụ | Ai cung cấp giá trị |
|---|---|---|
| Hệ thống | Mã NV, Họ tên, Ngày sinh, Giới tính, CCCD, Quê quán, Thường trú, Địa chỉ hiện tại, Điện thoại, Chức vụ, Ngày nhận việc, Ảnh 3×4, Chỉ huy trưởng (tên, quan hệ, SĐT, địa chỉ) | Hồ sơ nhân sự |
| Tự tính | Tuổi · Thâm niên ("6 năm 9 tháng") · Ngày xuất · "Có chứng chỉ <loại>" (☑/☐) · "Giới tính là Nam/Nữ" (☑/☐) | App tự tính tại ngày xuất |
| Tùy chỉnh | Do người dùng tạo; kiểu **Chữ / Ngày / Ô đánh dấu / Ảnh** | Mẫu, Dự án hoặc người xuất (xem 2.2) |

### 2.2 Giá trị của trường tùy chỉnh lấy từ đâu

Khi tạo trường tùy chỉnh, chọn **phạm vi**:

- **Cố định theo mẫu** — ví dụ: chữ ký + con dấu giám đốc, logo nhà thầu. Nhập khi cài mẫu.
- **Theo dự án (biến dự án)** — ví dụ: *Ngày bắt đầu làm việc ở dự án*, Tên dự án, Logo khách hàng. Nhập **một lần** trong Dự án; mọi nhân sự xuất theo dự án đó tự dùng chung.
- **Nhập khi xuất** — giá trị chỉ biết lúc gửi, ví dụ "Đợt gửi số".

**Thứ tự ưu tiên khi điền (cao → thấp):**

```
Giá trị sửa riêng cho 1 người lúc xuất
  → Biến dự án
    → Giá trị cố định của mẫu
      → Giá trị mặc định của trường
        → để trống + cảnh báo
```

Ví dụ: dự án Taikisha đặt *Ngày bắt đầu ở dự án = 20/10/2026*. Xuất 10 người thì cả 10 tự nhận ngày này; riêng anh A vào muộn thì sửa riêng thành 01/11/2026 ở bước xuất, 9 người còn lại không đổi.

*(Kiểu "lưu riêng cố định cho từng nhân sự" để sau khi dùng thử — đã thống nhất.)*

## 3. Quy tắc điền dữ liệu

| Kiểu | Quy tắc |
|---|---|
| Chữ | Ghi vào ô, **giữ nguyên định dạng ô của mẫu** (phông, cỡ, căn lề, xuống dòng, thu nhỏ cho vừa). Có tùy chọn IN HOA |
| Ngày | Định dạng `dd/mm/yyyy` |
| Ô đánh dấu | Ghi ký tự `☑` hoặc `☐` vào ô |
| Ảnh | Đặt vào **vùng ô** đã chọn. Mặc định **Vừa khung** (giữ tỉ lệ, căn giữa); tùy chọn **Lấp đầy** (cắt phần thừa) cho ảnh 3×4. Ảnh lớn được thu nhỏ để file nhẹ |
| Thiếu dữ liệu | Để trống ô, **liệt kê cảnh báo** trước khi xuất, **vẫn cho xuất** |

Các ô **không gắn trường** giữ nguyên tuyệt đối như file thiết kế.

## 4. Cấu trúc file xuất (phương án a đã chốt)

Mỗi nhân sự → **một file `.xlsx`**, trong **một sheet**:

1. **Trang 1:** phiếu thông tin đã điền.
2. **Các trang tiếp theo:** mỗi chứng chỉ được chọn là một trang, theo thứ tự đã cài ở mẫu, có **ngắt trang** trước mỗi chứng chỉ:
   - Dòng tiêu đề nhỏ: tên chứng chỉ · số · ngày hết hạn · (tệp chính / tệp bổ sung).
   - Ảnh scan vừa khung trang theo vùng in của mẫu.
   - Chứng chỉ dạng PDF nhiều trang → mỗi trang PDF thành một trang ảnh.

In file ra là được đủ bộ: phiếu rồi lần lượt từng chứng chỉ. Cần PDF thì mở Excel → *Lưu thành PDF*.

**Xuất nhiều người cùng lúc:** mỗi người một file, gom vào **một file ZIP** đặt tên `HoSo_<DuAn>_<NgayXuat>.zip`. *(Giả định — xem mục 11.)*

## 5. Màn hình

### M1. Danh sách mẫu
Bảng: tên mẫu · dự án đang dùng · phiên bản hiện tại · người sửa cuối · ngày sửa. Thao tác: Tạo mẫu · Sửa · Nhân bản · Xuất/Nhập cấu hình · Ẩn.

### M2. Thiết kế mẫu
- **Tải file `.xlsx`** do người dùng vẽ bằng Excel. Từ chối `.xlsm`/`.xls` kèm hướng dẫn lưu lại thành `.xlsx`.
- **Xem trước sheet dạng lưới** giống Excel (ô gộp, màu, viền).
- **Gắn trường:** bấm 1 ô (trường chữ/ngày/☑) hoặc kéo chọn 1 vùng (trường ảnh) → chọn trường ở bảng bên phải. Ô đã gắn hiện nhãn màu tên trường.
- **Tab Chứng chỉ đính kèm:** tick các loại chứng chỉ dự án yêu cầu, kéo thả để sắp thứ tự, chọn đính kèm tệp chính / tệp bổ sung.
- **Tab Giá trị cố định:** nhập giá trị cho các trường phạm vi "cố định theo mẫu" (vd tải ảnh chữ ký + con dấu).
- **Xuất thử** với 1 nhân sự mẫu để kiểm tra.
- **Lưu** → tạo **phiên bản mới**. Tab **Lịch sử phiên bản**: xem, xuất thử, khôi phục phiên bản cũ.

### M3. Thư viện trường
Danh sách trường hệ thống + tự tính (chỉ xem) và trường tùy chỉnh (tạo/sửa/ẩn): tên, kiểu (Chữ/Ngày/☑/Ảnh), phạm vi (mẫu/dự án/khi xuất), giá trị mặc định, IN HOA (với Chữ), Vừa khung/Lấp đầy (với Ảnh). Không xóa được trường đang được mẫu dùng — chỉ ẩn.

### M4. Dự án
Danh sách dự án: tên · khách hàng · mẫu mặc định. Trong mỗi dự án: nhập **biến dự án** (các trường phạm vi "theo dự án" mà mẫu đang dùng).

> Đây là danh mục dự án **gọn nhẹ chỉ phục vụ xuất hồ sơ**; chưa gắn nhân sự/chứng chỉ vào công trình (vẫn ngoài phạm vi giai đoạn 1).

### M5. Xuất hồ sơ
1. Chọn **Dự án** (tự chọn mẫu mặc định, đổi được) — hoặc chọn mẫu không theo dự án.
2. Chọn **một hoặc nhiều nhân sự** (lọc theo chức vụ, tìm kiếm).
3. **Giá trị chung:** hiện các biến dự án + trường "nhập khi xuất", đã điền sẵn; sửa được cho cả lô.
4. **Từng người:** bảng mỗi dòng một nhân sự — sửa riêng giá trị nếu khác; tick/bỏ tick chứng chỉ đính kèm (mặc định theo mẫu, chỉ chứng chỉ còn hạn tại ngày xuất).
5. **Kiểm tra:** danh sách ô thiếu theo từng người (cảnh báo, không chặn).
6. **Xuất** → 1 file `.xlsx` hoặc 1 file `.zip`.

## 6. Phân quyền

Admin và HR đều: tạo/sửa mẫu, thư viện trường, dự án, xuất hồ sơ. *(Khác tài liệu gốc — HR được sửa mẫu theo yêu cầu 14/10/2026.)*

## 7. Phiên bản

- Mỗi lần lưu mẫu tạo phiên bản **không sửa được** (file thiết kế + bản đồ trường + chứng chỉ + giá trị cố định).
- Mỗi lần xuất ghi lại phiên bản đã dùng và giá trị đã điền → **xuất lại cho ra y hệt**.
- Khôi phục phiên bản cũ = tạo phiên bản mới có nội dung như phiên bản cũ.

## 8. Lưu trữ (giai đoạn thử)

- Lưu trên trình duyệt của máy bằng **IndexedDB** (chứa được file Excel và ảnh dung lượng lớn; `localStorage` hiện tại chỉ ~5 MB, không đủ).
- Nút **Xuất cấu hình / Nhập cấu hình** (1 file) để sao lưu và chuyển sang máy khác.
- Khi dự án có cơ sở dữ liệu máy chủ → chuyển sang lưu chung cho cả phòng.

## 9. Chuyển mẫu Taikisha thành mẫu chuẩn đầu tiên

| Việc | Chi tiết |
|---|---|
| Bỏ | Sheet "Data" (dữ liệu ~140 nhân sự), macro VBA, liên kết ngoài `Sour_Lylich`, hàm `CommPic`, ảnh chân dung mẫu đang dán sẵn |
| Thay ô tích Form Control | 9 ô chứng chỉ + 2 ô Nam/Nữ → ô `☑/☐` gắn trường tự tính |
| Gắn trường | X8 Họ tên (IN HOA) · X10 Ngày sinh · AM10/AT10 Nam/Nữ · X12 Quê quán · X14 Thường trú · X16 Điện thoại · E8:K16 Ảnh 3×4 · C19:Z33 Ảnh CCCD · AB26 Ngày bắt đầu ở dự án (biến dự án) · AB31 Thâm niên · L36/AI36/L38/AI38 Chỉ huy trưởng · AD42 Nhóm an toàn · ô ☑ chứng chỉ dòng 42–51 · AD54:AY62 Chữ ký + con dấu (cố định theo mẫu) · AD65 Ngày xuất |
| Giữ nguyên | Logo Taikisha, logo ISO, toàn bộ ô gộp, cột, phông, viền, màu, vùng in B1:AZ73, khổ A4 dọc tỉ lệ 90%, chú thích cuối trang |

## 10. Tiêu chí nghiệm thu

1. Xuất mẫu Taikisha cho 1 nhân sự: mở bằng Excel, so với file thiết kế — ô gộp, độ rộng cột, chiều cao dòng, phông, viền, màu, vùng in, khổ giấy, logo **giống hệt**; chỉ ô đã gắn trường thay đổi. Có **test tự động** so sánh cấu trúc cho mọi mẫu.
2. Tên tiếng Việt có dấu hiển thị đúng; ngày theo `dd/mm/yyyy`; ô ☑/☐ đúng theo dữ liệu.
3. Ảnh 3×4 và chữ ký nằm gọn trong vùng, không méo, không đè ô khác.
4. Chứng chỉ được chọn xuất hiện ở các trang sau theo đúng thứ tự cài đặt, mỗi chứng chỉ một trang khi in.
5. Biến dự án nhập một lần dùng cho mọi nhân sự của lô; sửa riêng 1 người không ảnh hưởng người khác.
6. Thiếu dữ liệu → có danh sách cảnh báo, vẫn xuất được, ô thiếu để trống.
7. Xuất 20 người → 1 file ZIP gồm 20 file, mỗi file đúng người.
8. Sửa mẫu → phiên bản mới; xuất lại một lần xuất cũ cho kết quả như lúc đầu.
9. Xuất cấu hình ở máy A, nhập ở máy B → mẫu, trường, dự án giống hệt.

## 11. Giả định cần xác nhận

| # | Giả định |
|---|---|
| G1 | Xuất nhiều người = ZIP mỗi người 1 file (không gộp nhiều người vào 1 file) |
| G2 | Mặc định chỉ đính kèm chứng chỉ **còn hạn** tại ngày xuất; muốn kèm chứng chỉ hết hạn thì tick tay và có cảnh báo |
| G3 | Một mẫu chỉ dùng **một sheet** làm phiếu |
| G4 | Ô "Nhóm an toàn" (AD42) lấy từ *Nhóm* của nhân sự (đã có trong hồ sơ) |

## 12. Rủi ro kỹ thuật

| Rủi ro | Cách xử lý |
|---|---|
| Thư viện `exceljs` có thể làm lệch một số định dạng khi lưu lại | Làm **thử nghiệm kỹ thuật trước tiên** với mẫu Taikisha; nếu lệch, chuyển sang cách chỉnh trực tiếp file XML bên trong `.xlsx` (chỉ sửa ô gắn trường, không đụng phần còn lại) |
| File có nhiều ảnh scan nặng | Thu nhỏ ảnh về độ phân giải đủ in A4 (~150 dpi) |
| PDF chứng chỉ phải chuyển thành ảnh trong trình duyệt | Dùng `pdf.js`; PDF lỗi/có mật khẩu → cảnh báo, bỏ qua tệp đó |

## 13. Kế hoạch thực hiện

| Bước | Nội dung | Kết quả để duyệt |
|---|---|---|
| 1 | Thử nghiệm kỹ thuật + chuyển mẫu Taikisha sang `.xlsx` | File mẫu `.xlsx` + file xuất thử 1 người để bạn mở so sánh |
| 2 | Bộ máy điền dữ liệu (chữ/ngày/☑/ảnh) + test giữ định dạng | Test tự động xanh |
| 3 | M2 Thiết kế mẫu + M3 Thư viện trường | Tự gắn trường trên giao diện |
| 4 | M4 Dự án + biến dự án | Nhập biến một lần |
| 5 | M5 Xuất hàng loạt + trang chứng chỉ + ZIP | Xuất bộ hồ sơ hoàn chỉnh |
| 6 | Phiên bản + Xuất/Nhập cấu hình + IndexedDB | Đủ tiêu chí mục 10 |
