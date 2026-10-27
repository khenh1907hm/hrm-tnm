# Tự đọc thông tin chứng chỉ từ tệp (OCR)

Khi thêm chứng chỉ, chọn **tệp chính** (PDF scan hoặc ảnh chụp) là app tự đọc và điền vào các ô còn trống. Đọc ngay trên
trình duyệt bằng Tesseract (tiếng Việt + Anh), tệp không gửi đi đâu, không tốn lượt ComPDF.

Mã nguồn: `src/modules/ocr/readDocumentText.ts` (đọc chữ), `src/modules/ocr/parseCertificateText.ts` (lấy thông tin),
giao diện ở `src/app/_components/CertificateFormModal.tsx`.

## Nguyên tắc: thà để trống còn hơn điền sai

- **Số chứng chỉ**: chỉ điền khi ít nhất **2 lần đọc khớp nhau** và số đó **có trong lượt đọc cả trang** (hai nguồn độc lập).
  Các lần đọc: lượt đọc cả trang (thẻ in hai bản thì có hai lần) + 4 lần đọc lại riêng dòng số (cắt sát dòng, phóng 2–3 lần,
  ảnh xám và kênh mực đỏ, chỉ cho phép chữ in hoa/số/dấu ngăn cách). Hòa hoặc lệch nhau → để trống.
- **Ngày**: in ở nhiều chỗ (thẻ in hai bản) thì các chỗ phải khớp nhau. Ngày cấp ở tương lai, sau ngày hết hạn, hoặc
  CCCD cấp trước 2016 → bỏ.
- Ô đã có chữ thì không đè. Ô tự điền có viền xanh để đối chiếu với giấy gốc trước khi lưu.
- Chữ **viết tay** OCR không đọc chắc chắn được → luôn để trống cho người dùng nhập.

## Từng loại

| Loại (key) | Nhận ra bằng | Lấy được | Để trống (nhập tay) |
|---|---|---|---|
| Căn cước công dân (`custom-ctype-cccd`) | "Căn cước", dòng MRZ "IDVNM…" | **Số** (khớp 9 số cuối trong MRZ), **ngày hết hạn** (MRZ: chữ số kiểm tra + trùng ngày-tháng sinh, sửa được 1 chữ số đọc nhầm), **ngày cấp** (mặt sau, phía trên: định vị theo khối MRZ, đọc lại riêng vùng ngày, nhiều lần đọc phải khớp) | — |
| An toàn lao động – thẻ (`atld`) | "Thẻ an toàn lao động" | **Số thẻ** `…/YYYY/TATLĐ` (năm lấy theo ngày cấp), **ngày cấp** (dòng "Tp. Hồ Chí Minh, ngày …"), **ngày hết hạn** ("có giá trị đến ngày", không lấy thời gian học "Từ ngày … đến ngày …"), **nhóm**, **lĩnh vực** Nhóm 3 → tên phân biệt "Nhóm 3 - Làm việc trên cao / Lĩnh vực điện / Công trình xây dựng" | Số thẻ khi cả hai bản in bị dấu mộc đè (vd thẻ lĩnh vực điện) |
| An toàn lao động – giấy chứng nhận Nhóm 1 (`atld`) | "Huấn luyện an toàn, vệ sinh lao động" | **Số** `…/N1/YYYY`, **ngày cấp**, **hạn** ("có giá trị 2 năm từ ngày … đến ngày …" viết bằng chữ), **nhóm** | — |
| An toàn điện – thẻ bậc (`elec`) | "Thẻ an toàn điện", "Bậc an toàn" | **Ngày cấp** ("Cấp ngày"), **bậc** → tên phân biệt "Bậc 3/5" | Số thẻ (dấu mộc đè); hạn (thẻ không ghi) |
| Bảo hiểm tai nạn (`ins`) | "Bảo hiểm" + "Hợp đồng" | **Số hợp đồng**, **ngày cấp** = ngày bắt đầu bảo hiểm, **hạn** ("Từ 00:00 h ngày … đến 23:59 h ngày …") | — |
| Khám sức khỏe (`health`) | "Giấy khám sức khỏe" | Nhận ra loại | Số (viết tay mực đỏ), ngày khám (viết tay); hạn (giấy không ghi) |
| Sức khỏe làm việc trên cao (`custom-ctype-height-health`) | "Chứng chỉ hành nghề" + "làm việc trên cao" | Nhận ra loại | Số (giấy để trống), ngày (viết tay) |
| Bằng cấp chuyên môn (`custom-ctype-degree`) | "Tốt nghiệp", "văn bằng" | Số bằng khi các lần đọc khớp nhau | Số khi OCR đọc lệch (ảnh mờ), ngày (viết tay); bằng không có hạn |

Kết quả trên hồ sơ thật TNM0015 (11 giấy, ảnh scan ~100 dpi, 23/10/2026): **38 ô đúng, 7 ô để trống, 0 ô sai**.
7 ô trống: số + ngày giấy khám sức khỏe (viết tay), ngày giấy làm việc trên cao (viết tay), số + ngày bằng tốt nghiệp
(OCR đọc lệch / viết tay), số thẻ ATLĐ lĩnh vực điện và số thẻ an toàn điện (dấu mộc đè lên số).

## Thêm / sửa một loại

1. Thêm nhận diện trong `detectKind` và hàm `parse…` trong `parseCertificateText.ts`; số dùng `agreedNumber`, ngày dùng `dateAfterLabel`.
2. Nếu số nằm trên dòng không bắt đầu bằng "Số", thêm dạng của dòng vào `NUMBER_LINE` / `CERTIFICATE_NUMBER_SHAPE` trong `readDocumentText.ts` để được đọc lại.
3. Thêm test với chữ giả lập (không dùng dữ liệu thật) trong `parseCertificateText.test.ts`.
