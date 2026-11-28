# Kiểm thử mua hàng: từ YCVT đến Hoàn tất

Danh sách để mô phỏng toàn bộ luồng **Yêu cầu vật tư (P-COST-08) → PO nháp (P-CC-07) → PO (P-CC-08) → Tạm ứng / Thanh toán (P-CF-03) → Nhận hàng → Nhập kho → Chứng từ → Hoàn tất**,
gồm mọi kiểu điều kiện thanh toán và các trường hợp bị chặn. Mỗi dòng ghi **mã lỗi** hệ thống trả về để đối chiếu.

Lập theo code và hàm trong database ngày 28/11/2026 (`src/modules/purchases/flow.ts`, `materials.ts`, các hàm `purchase_*`, `material_*`, `approval_sign`).

---

## 0. Chuẩn bị

| # | Việc | Ghi chú |
|---|---|---|
| 0.1 | Một dự án **đã duyệt Confirm Contract** và **Ngân sách (Budget Sheet) đã duyệt**, có ít nhất 2 hạng mục (mã ngân sách) | Không có ngân sách duyệt thì gửi PO báo `PO_NO_BUDGET` |
| 0.2 | Một hạng mục để **ngân sách nhỏ** (vd 10 triệu) để thử vượt ngân sách | Dùng ở mục 3 |
| 0.3 | Tài khoản cho từng vai: **Người lập / PM**, **P. Vật tư**, **P. Kỹ thuật**, **Kế toán** (người chi tiền), **Lãnh đạo**, **Kho**, **Admin**, **Giám đốc** | Có thể dùng Admin + “Vai trò đang xem thử”, nhưng nên thử ít nhất một lần bằng tài khoản thật từng vai |
| 0.4 | Cấu hình **phòng ban phụ trách giai đoạn**: mặc định Nhận hàng, Nhập kho = Kho; Thu chứng từ = Người lập | Settings → giai đoạn mua hàng |
| 0.5 | Chuẩn bị file: **báo giá NCC có ký** (PDF/ảnh), hóa đơn giả có số | PO dự án gửi ký bắt buộc có báo giá ký |

Ký hiệu: ✅ phải làm được · ⛔ phải bị chặn (ghi mã lỗi) · 👁 kiểm tra hiển thị.

---

## 1. Yêu cầu vật tư (YCVT)

| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 1.1 | Lập YCVT, chưa có dòng nào, bấm Gửi | ⛔ `MR_NO_ITEMS` |
| 1.2 | Có dòng nhưng **thiếu Đơn vị tính** | ⛔ `MR_UNIT_REQUIRED` |
| 1.3 | Lập đủ, nhiều dòng thuộc **2 hạng mục khác nhau**, gửi | ✅ Số phiếu `YCVT-<mã dự án>-NNN`, trạng thái Chờ ký; chuỗi ký **P. Vật tư → P. Kỹ thuật → Lãnh đạo** |
| 1.4 | P. Kỹ thuật bấm ký khi P. Vật tư chưa ký | ⛔ `STEP_NOT_CURRENT` |
| 1.5 | Người không thuộc bộ phận bấm ký | ⛔ `STEP_NOT_YOURS` |
| 1.6 | P. Vật tư **Trả về** không ghi lý do / lý do < 3 ký tự | ⛔ `PO_REASON_REQUIRED` |
| 1.7 | P. Vật tư Trả về có lý do | ✅ Phiếu “Bị trả về”, người lập sửa được rồi gửi lại; chuỗi ký chạy lại từ đầu |
| 1.8 | Sửa / xóa phiếu đang chờ ký | ⛔ `MR_BAD_STATUS` (chỉ sửa khi Nháp / Bị trả về; chỉ xóa khi Nháp) |
| 1.9 | Ký đủ 3 bước | ✅ Phiếu “Đã duyệt”; người lập nhận thông báo |
| 1.10 | Giám đốc **duyệt thẳng** một phiếu đang chờ (bỏ qua các bước còn lại) | ✅ Phiếu duyệt ngay |
| 1.11 | Nhập báo giá khi phiếu **chưa duyệt** | ⛔ `MR_NOT_APPROVED` |
| 1.12 | Nhập báo giá thiếu tên NCC (< 2 ký tự) | ⛔ `PO_SUPPLIER_REQUIRED` |
| 1.13 | Nhập báo giá từ **file PDF/ảnh** | ✅ Tự điền NCC, số / ngày báo giá, điều kiện thanh toán, đơn giá khớp tên vật tư; dòng không khớp được liệt kê |
| 1.14 | Nhập **2–3 báo giá** cho hạng mục A, 1 báo giá cho hạng mục B | 👁 Bảng so sánh tô giá rẻ nhất từng dòng |
| 1.15 | Hạng mục giá trị **≥ 50 triệu** chỉ có 1 báo giá | 👁 Cảnh báo cần báo giá thứ 2 / ghi lý do (chỉ cảnh báo, không chặn) |
| 1.16 | Một báo giá có giá cho dòng của **2 hạng mục** rồi chọn lập PO | ⛔ `MR_QUOTE_MULTI_GROUP` |
| 1.17 | Báo giá không có dòng nào có giá, chọn lập PO | ⛔ `MR_QUOTE_EMPTY` |
| 1.18 | Chọn báo giá A1 → lập PO nháp | ✅ Một PO nháp, đủ NCC, đơn giá, hạng mục A; báo giá đánh dấu “đã dùng” |
| 1.19 | Sửa / xóa / chọn lại báo giá **đã dùng** | ⛔ `MR_QUOTE_USED` |
| 1.20 | Bấm “Lập PO nháp” cho hạng mục **đã có PO chưa hủy** | ⛔ `MR_GROUP_HAS_ORDER` |
| 1.21 | Mọi hạng mục đều có PO | 👁 Phiếu chuyển “Đã lên đơn”; danh sách phiếu hiện đúng tình trạng |
| 1.22 | Đóng phiếu không lý do / có lý do | ⛔ `PO_REASON_REQUIRED` / ✅ Phiếu “Đã đóng” |
| 1.23 | YCVT **văn phòng** (`YCVT-VP-NNN`) | ✅ Cả phiếu ra một PO, không chia hạng mục, trừ vào quỹ văn phòng năm |

---

## 2. PO nháp → ký duyệt (đơn dự án)

| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 2.1 | Mở PO nháp | 👁 Form đầy đủ trên trang đơn (NCC, giao hàng, dòng hàng, **điều kiện thanh toán**, tệp) không cần bấm Sửa |
| 2.2 | Gửi ký khi **chưa có hạng mục** | ⛔ `PO_BUDGET_CODE_REQUIRED` |
| 2.3 | Gửi ký khi **chưa có NCC** | ⛔ `PO_SUPPLIER_REQUIRED` |
| 2.4 | Gửi ký khi **chưa đính kèm báo giá có ký** | ⛔ `PO_ATTACH_REQUIRED` |
| 2.5 | Gửi ký PO không có dòng hàng | ⛔ `PO_NO_ITEMS` |
| 2.6 | Gửi ký PO **vượt ngân sách** hạng mục (A − (đã đặt B + PO này) < 0) | ⛔ `PO_OVER_BUDGET` |
| 2.7 | Gửi ký hợp lệ | ✅ Chuỗi ký **Phụ trách → P. Kỹ thuật → P. Vật tư → Kế toán → Lãnh đạo** |
| 2.8 | Trong lúc chờ ký, có PO khác cùng hạng mục được duyệt làm ngân sách hết; Lãnh đạo ký PO này | ⛔ `PO_OVER_BUDGET` (Lãnh đạo ký sẽ kiểm tra lại ngân sách) |
| 2.9 | Một bước Trả về (có lý do) | ✅ PO “Bị trả về”, người lập sửa rồi gửi lại |
| 2.10 | Lãnh đạo ký | ✅ PO “Đã duyệt”, lưu A / B tại thời điểm duyệt |
| 2.10b | Giám đốc **duyệt vượt cấp** PO đang chờ (các bước trước ghi “Giám đốc duyệt vượt cấp”) | ✅ PO duyệt ngay, **vẫn kiểm tra ngân sách** (vượt thì ⛔ `PO_OVER_BUDGET`); phiếu đã bị trả về thì ⛔ `STEP_NOT_CURRENT` |
| 2.11 | Đơn **văn phòng**: Sếp Duyệt / Từ chối trực tiếp (không chuỗi ký); đơn dự án mà dùng nút duyệt trực tiếp | ✅ / ⛔ `PO_USE_CHAIN` |

---

## 3. Điều kiện thanh toán: ma trận phải chạy hết

Trên PO có **2 câu hỏi độc lập**:
(1) **Tạm ứng**: Không / Có X% (2) **Phần thanh toán (còn lại)**: **Trước khi nhận hàng** / **Sau khi nhận hàng**.

| Ca | Tạm ứng | Thanh toán | Thanh tiến trình phải hiện |
|---|---|---|---|
| **A** | Không | Sau nhận hàng | … Theo dõi → Nhận hàng → Nhập kho → Chứng từ → **Đề nghị TT → Chi TT** → Hoàn tất |
| **B** | Không | Trước nhận hàng (100% trước giao) | … Theo dõi → **Đề nghị TT trước giao → Chi** → Nhận hàng → Nhập kho → Chứng từ → Hoàn tất |
| **C** | Có 30% | Còn lại sau nhận hàng | … PO → **Tạm ứng → Chi tạm ứng** → Theo dõi → … → Chứng từ → **Đề nghị TT → Chi** → Hoàn tất |
| **D** | Có 30% | Còn lại trước nhận hàng | … PO → **Tạm ứng → Chi** → Theo dõi → **TT trước giao → Chi** → Nhận hàng → … → Hoàn tất |
| **E** | Có 100% | (không còn gì) | Tạm ứng toàn bộ; sau nhận hàng không phải thanh toán thêm |
| **F** | Có 30% | Trước nhận hàng nhưng **chỉ trả một phần** (vd 50%) | Phần thiếu trả sau khi nhận hàng + đủ chứng từ (bước Đề nghị TT xuất hiện khi có khoản cuối) |

Mỗi ca chạy trọn từ PO đã duyệt đến Hoàn tất (mục 4–6), và kiểm tra:

| # | Kiểm tra | Áp dụng | Kết quả mong đợi |
|---|---|---|---|
| 3.1 | 👁 Nhãn điều kiện trên PO, PDF P-CC-08 | Mọi ca | “Không tạm ứng · Thanh toán sau khi nhận hàng”, “Tạm ứng 30% · còn lại thanh toán trước khi nhận hàng”… |
| 3.2 | Lập đề nghị **tạm ứng** khi PO không chọn tạm ứng | A, B | ⛔ `PO_PAYMENT_NOT_NEEDED` |
| 3.3 | Lập đề nghị **TT trước giao** khi PO chọn sau nhận hàng | A, C | ⛔ `PO_PAYMENT_NOT_NEEDED` |
| 3.4 | Lập tạm ứng **trước khi phát hành PO** / **trước khi NCC ký nhận** | C, D, E, F | ⛔ `PO_NOT_ISSUED` / `PO_NOT_ACCEPTED` |
| 3.5 | Tạm ứng **vượt X%** giá trị đơn (vd 30% của 100tr mà xin 31tr) | C, D, F | ⛔ `PO_ADVANCE_OVER_PCT` |
| 3.6 | Tạm ứng **chia 2 lần** (15tr + 15tr), lần 3 thêm 1tr | C | ✅ ✅ ⛔ `PO_ADVANCE_OVER_PCT` |
| 3.7 | Bấm **Đặt hàng** khi tạm ứng mới ký duyệt **chưa chi** | C, D, E, F | ⛔ `PO_ADVANCE_NOT_PAID` |
| 3.8 | Bấm **Nhận hàng** khi TT trước giao **chưa chi** | B, D, F | ⛔ `PO_PREPAY_NOT_PAID` |
| 3.9 | Đã nhận hàng rồi lập **TT trước giao** | B, D, F | ⛔ `PO_PREPAY_TOO_LATE` |
| 3.10 | Lập **thanh toán còn lại** trước khi nhận hàng | Mọi ca | ⛔ `PO_FINAL_TOO_EARLY` |
| 3.11 | Đã nhận hàng nhưng **chưa thu đủ chứng từ**, lập thanh toán còn lại | A, C, F | ⛔ `PO_FINAL_TOO_EARLY` |
| 3.12 | Tổng các khoản (trừ khoản bị từ chối) **vượt giá trị đơn** | Mọi ca | ⛔ `PO_PAY_OVER` |
| 3.13 | Số tiền 0 / âm / số lẻ; thuế âm | Mọi ca | ⛔ `PO_BAD_AMOUNT` |
| 3.14 | TT trước giao / thanh toán còn lại **không có số hóa đơn** | Mọi ca trừ tạm ứng | ⛔ `PO_INVOICE_REQUIRED` (tạm ứng không cần hóa đơn) |
| 3.15 | 👁 Số RFP `RFP-YYMM-NNNN` tăng dần, in đúng trên P-CF-03 | Mọi ca | |
| 3.16 | 👁 Bảng tiền: đã tạm ứng / đã TT trước / đã TT sau / **còn phải trả** | Mọi ca | Còn phải trả = giá trị thực nhận − tổng đã chi |

### 3b. Ký và chi một đề nghị thanh toán (chạy cho từng khoản)

| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 3b.1 | Gửi đề nghị | ✅ Chuỗi ký **Phụ trách → P. Kỹ thuật → P. Vật tư → Lãnh đạo** |
| 3b.2 | Kế toán bấm **Chi** khi chưa ký xong | ⛔ `PO_PAYMENT_NOT_APPROVED` |
| 3b.3 | Người không phải kế toán bấm Chi | ⛔ `PO_NOT_PAYER` |
| 3b.4 | Một bước **Trả về** (có lý do) | ✅ Khoản “Bị từ chối”, **không tính** vào tổng; lập đề nghị mới thay thế được (không bị `PO_PAY_OVER`) |
| 3b.5 | Lãnh đạo ký | ✅ Khoản “Đã duyệt, chờ chi”; kế toán nhận thông báo |
| 3b.6 | Kế toán Chi | ✅ Khoản “Đã chi”; bước Chi trên thanh chuyển xong |
| 3b.6b | Giám đốc **duyệt vượt cấp** một đề nghị đang chờ | ✅ Khoản chuyển “Đã duyệt, chờ chi” ngay |
| 3b.7 | Ký / trả về trên **app điện thoại** (tab Duyệt) | ✅ Như trên web; trả về bắt buộc ghi lý do |
| 3b.8 | Đơn văn phòng: Sếp Duyệt / Từ chối khoản trực tiếp | ✅; đơn dự án dùng nút này ⛔ `PO_USE_CHAIN` |

---

## 4. PO → NCC ký nhận → Đặt hàng → Theo dõi

| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 4.1 | Phát hành PO (P-CC-08) khi thiếu tên NCC | ⛔ `PO_SUPPLIER_REQUIRED` |
| 4.2 | Phát hành PO | ✅ Có ngày phát hành; tải PDF PO |
| 4.3 | Phát hành lần 2 / ghi NCC ký nhận khi chưa phát hành | ⛔ `PO_BAD_STATUS` |
| 4.4 | Ghi **NCC đã ký xác nhận PO** | ✅ Bước PO xong |
| 4.5 | Đặt hàng khi chưa phát hành / NCC chưa ký | ⛔ `PO_NOT_ISSUED` / `PO_NOT_ACCEPTED` |
| 4.6 | Đặt hàng (ca A, B: ngay; ca C–F: sau khi chi tạm ứng) | ✅ “Theo dõi đơn hàng” |
| 4.7 | Cập nhật theo dõi với ghi chú < 2 ký tự | ⛔ `PO_NOTE_REQUIRED` |
| 4.8 | Nhắc NCC giao hàng khi tới / quá ngày giao | 👁 Thông báo nhắc |

---

## 5. Nhận hàng → Nhập kho → Chứng từ

| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 5.1 | Nhận hàng **không có số biên bản giao nhận** hoặc chưa tích “hai bên đã ký” (đơn dự án) | ⛔ `PO_RECEIPT_RECORD_REQUIRED` |
| 5.2 | Nhận **đủ** số lượng | ✅ Giá trị thực nhận = giá trị đơn |
| 5.3 | Nhận **thiếu** (vd 8/10) hoặc **loại một phần** (nhận 10, đạt 8) | ✅ Giá trị thực nhận giảm; “còn phải trả” tính theo giá trị thực nhận |
| 5.4 | Nhập “đạt” lớn hơn “nhận” | 👁 Bị giới hạn bằng số nhận |
| 5.5 | **Sửa lại** nhận hàng trước khi nhập kho | ✅ Được |
| 5.6 | Sửa nhận hàng **sau khi nhập kho** | ⛔ `PO_ALREADY_STOCKED` |
| 5.7 | Người không phải Kho (và không phải Admin) bấm Nhập kho | 👁 Không thấy nút |
| 5.8 | Kho bấm Nhập kho | ✅ |
| 5.9 | Bấm **Đã thu đủ chứng từ** trước khi nhập kho | ⛔ `PO_NOT_STOCKED` |
| 5.10 | Bấm Đã thu đủ chứng từ | ✅ Mở được đề nghị thanh toán còn lại |

---

## 6. Hoàn tất / Thất bại

| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 6.1 | Hoàn tất khi chưa nhập kho / chưa đủ chứng từ | ⛔ `PO_NOT_STOCKED` / `PO_DOCS_NOT_COLLECTED` |
| 6.2 | Hoàn tất khi còn khoản **chờ ký** hoặc **đã duyệt chưa chi** | ⛔ `PO_PAYMENTS_PENDING` |
| 6.3 | Hoàn tất hợp lệ | ✅ “Thành công”, thanh tiến trình xong hết |
| 6.4 | Hủy đơn không lý do | ⛔ `PO_REASON_REQUIRED` |
| 6.5 | Hủy ở từng giai đoạn: nháp, chờ ký, đã duyệt, đang theo dõi, đã nhận | ✅ “Thất bại”; người lập chỉ hủy được tới Đã duyệt, sau đó cần Sếp / Admin |
| 6.6 | Hủy / hoàn tất đơn đã xong | ⛔ `PO_BAD_STATUS` |
| 6.7 | Hủy PO thì hạng mục YCVT được **lập PO lại** | ✅ (không còn `MR_GROUP_HAS_ORDER`) |

---

## 7. Ca đặc biệt nên thử (dễ phát sinh lỗi số liệu)

| # | Tình huống | Cần xem |
|---|---|---|
| 7.1 | Ca **C**: tạm ứng 30tr đã chi, sau đó **nhận thiếu** chỉ còn giá trị 25tr | “Còn phải trả” âm (đã trả dư 5tr): hệ thống hiện thế nào, có cần quy trình thu hồi? |
| 7.2 | Ca **B**: đã TT trước giao 100%, nhận hàng bị loại một phần | Như 7.1: trả dư so với thực nhận |
| 7.3 | **Hủy đơn** sau khi đã chi tạm ứng | Đơn “Thất bại” nhưng tiền đã chi: có ghi nhận phải thu lại NCC không? |
| 7.4 | Khoản bị trả về rồi lập lại cùng số tiền | Không bị tính trùng (`PO_PAY_OVER` không được báo sai) |
| 7.5 | Hai người cùng bấm ký / chi một khoản cùng lúc | Chỉ một lần thành công, người kia báo `STEP_NOT_CURRENT` / `PO_BAD_STATUS` |
| 7.6 | Đổi điều kiện thanh toán sau khi PO bị trả về rồi gửi lại | Thanh tiến trình đổi theo điều kiện mới |
| 7.7 | Hai PO cùng hạng mục, tổng vượt ngân sách | PO sau bị `PO_OVER_BUDGET` lúc gửi hoặc lúc Lãnh đạo ký |
| 7.8 | Đơn văn phòng vượt quỹ văn phòng năm | 👁 Có cảnh báo (quỹ tính ở ứng dụng, không chặn ở máy chủ) |

---

## 8. Thông báo và hiển thị cần nhìn ở mỗi bước

- 🔔 Người ký tiếp theo nhận thông báo (web, app, email); người lập nhận khi bị trả về / được duyệt; kế toán nhận khi khoản được duyệt chờ chi.
- 👁 **Thanh tiến trình** của PO: đúng các bước theo ca A–F, YCVT là bước đầu, chỉ một bước “đang ở”.
- 👁 **Nhật ký đơn**: bấm từng bước xem lịch sử của bước đó.
- 👁 Bảng **Đơn phiếu cần duyệt** (web) và tab **Duyệt** (app) hiện đúng phiếu chờ mình.
- 👁 Ngân sách: B (đã đặt) tăng khi PO được duyệt, giảm lại khi PO bị hủy.
