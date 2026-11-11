# Đặc tả: Mua hàng dự án theo quy trình công ty (P-COST, P-CC, P-CF)

| | |
|---|---|
| Công ty | Công ty TNHH Thiên Nhật Minh |
| Phân hệ | Dự án → Ngân sách, Yêu cầu vật tư, Đặt hàng, Thanh toán nhà cung cấp |
| Phiên bản tài liệu | 0.1, ngày 11/11/2026 |
| Nguồn | Thư mục `Document_TNM/Quy trình`: tổng quan quy trình (00), P-COST-01, P-COST-03, P-COST-08, P-CC-07, P-CC-08 (kèm điều khoản PO), P-CF-03, P-COST-05 |
| Mục đích | Làm lại phần mua hàng dự án cho đúng quy trình công ty, thay luồng "lập đơn → sếp duyệt → tạm ứng" hiện tại |
| Trạng thái | Đã làm giai đoạn A, B, C (migration 20261117 → 20261121); xuất Excel / PDF đúng mẫu công ty (public/templates/quy-trinh), nhập ngân sách từ file P-COST-03 cũ |

Cách đọc giống [đặc tả quản lý dự án](dac-ta-quan-ly-du-an.md):

- **[Đã chốt]**: lấy thẳng từ biểu mẫu hoặc chủ dự án đã nói rõ.
- **[Giả định]**: người viết đề xuất. Nếu không ai phản đối thì làm theo.
- **[Cần xác nhận]**: phải hỏi lại. Đã ghi đề xuất mặc định để không chặn tiến độ.

---

## 1. Tổng quan

### 1.1 Quy trình công ty (theo sơ đồ 00)

Sáu bộ phận tham gia: **Lãnh đạo, Kỹ thuật/Kinh doanh (KT), Kế toán (KTo), Hành chánh (HC), Vật tư/kho (VT), Dự án (DA)**.

| # | Bước | Bộ phận | Biểu mẫu | Thời gian chuẩn |
|---|---|---|---|---|
| 1 | Nhận thông tin, hiểu yêu cầu, thiết kế → báo giá → Lãnh đạo kiểm tra → gửi khách | KT, Lãnh đạo | | |
| 2 | Trúng thầu: nhận PO / email thông báo trúng | KT | | |
| 3 | **Làm xác nhận dự án** | KT | P-COST-01 Confirmed Contract | 1 ngày |
| 4 | Lên số dự án, theo dõi; kiểm tra hợp đồng | Kế toán | | |
| 5 | Họp ngân sách | Lãnh đạo, KT | P-COST-02 Budget meeting sheet | 2 ngày |
| 6 | **Làm ngân sách** | KT | P-COST-03 Budget Sheet | 2 ngày |
| 7 | Hiểu yêu cầu dự án → **Yêu cầu vật tư / dụng cụ thi công** | Dự án | P-COST-08 Yêu cầu vật tư | 1 ngày |
| 8 | **Kiểm tra / hỏi giá**: thiết bị chính do KT, vật tư và vật tư phụ do VT | KT, VT | | 1 ngày |
| 9 | **Đơn đặt hàng nháp** | KT, VT | P-CC-07 Purchase Order Draft | 1 ngày |
| 10 | **Duyệt** | Lãnh đạo | | 1 ngày |
| 11 | **Đơn đặt hàng chính thức / theo dõi cost** | Hành chánh | P-CC-08 Purchase Order + điều khoản PO | 1 ngày |
| 12 | **Đề nghị thanh toán** | KT, VT | P-CF-03 Request for Payment | 1 ngày |
| 13 | **Duyệt** | Lãnh đạo | | 1 ngày |
| 14 | **Thanh toán cho nhà cung cấp** | Kế toán | | |
| 15 | Nhận vật tư / thực hiện dự án → nghiệm thu → kết thúc dự án | Dự án | | |
| 16 | Khối lượng hoàn thành → hồ sơ thanh toán / hóa đơn (thu tiền khách) → hồ sơ hoàn công | KT, Kế toán | | |
| 17 | Đánh giá | Lãnh đạo, KT | | |
| * | Vượt ngân sách, đổi mã số, công việc bảo hành | | P-COST-05 Explanatory Report | |

### 1.2 Hiện trạng trên web và chỗ sai

Phân hệ Đặt hàng hiện có (migration `20261112090000_purchase_orders.sql`):
nháp → chờ duyệt → sếp duyệt → tạm ứng / trả trước → theo dõi → nhận hàng → hoàn tất.

| Quy trình công ty | Web hiện tại |
|---|---|
| Mỗi đơn gắn **số dự án + mã ngân sách** (111…490) | Không có mã ngân sách. Ngân sách dự án chỉ có 4 khoản chung (nhân công, thầu phụ, vật tư, khác) |
| Duyệt đơn dựa trên **ngân sách còn lại E = A − D** của mã đó | Không kiểm tra ngân sách khi duyệt |
| Vượt ngân sách phải có **báo cáo giải thích P-COST-05** | Vượt vẫn duyệt bình thường |
| Có **xác nhận dự án P-COST-01** (giá trị hợp đồng, xác nhận / xác nhận tạm) | Dự án chỉ có "vốn" nhập tay |
| Bắt đầu từ **phiếu yêu cầu vật tư** của công trường, rồi **hỏi giá**, so sánh nhà cung cấp | Lập thẳng đơn hàng, không có báo giá NCC hay bảng so sánh |
| Chuỗi ký: Phụ trách → P. Kỹ thuật → P. Vật tư → Kế toán → Lãnh đạo → Hành chánh, mỗi người có **ngày mục tiêu** | Duyệt một cấp (sếp) |
| **Đơn nháp (P-CC-07)** khác **PO chính thức (P-CC-08)** gửi NCC, có số PO, điều khoản PO, NCC ký nhận | Một bản ghi đơn hàng, không có số PO, không in PO |
| **Đề nghị thanh toán theo từng PO và hóa đơn** (số HĐ, tiền trước thuế, VAT, lịch sử đã trả) | Thanh toán chỉ có loại (tạm ứng / trả trước / còn lại) và số tiền |
| In đúng các biểu mẫu để ký, đóng dấu | Chưa in |

### 1.3 Mục tiêu

1. Mọi khoản mua cho dự án đi theo đúng 6 bước: **Yêu cầu vật tư → Hỏi giá → Đơn nháp → Duyệt → PO → Đề nghị thanh toán → Chi**.
2. Ngân sách dự án lập **theo mã chi phí** như P-COST-03, kèm giá trị hợp đồng và lợi nhuận.
3. Khi duyệt đơn, người duyệt **thấy ngay A / B / C / D / E** của mã ngân sách. Vượt ngân sách thì **bắt buộc báo cáo giải thích**.
4. Thanh toán NCC theo **PO + hóa đơn**, không trả quá giá trị PO.
5. Mỗi bước **in hoặc xuất đúng mẫu** của công ty (Excel và PDF) để ký, đóng dấu, lưu hồ sơ.

### 1.4 Phạm vi

**Trong phạm vi** [Giả định]: mua hàng cho **dự án** (thiết bị, vật tư, thầu phụ, chi phí chung có PO).

**Ngoài phạm vi giai đoạn này** [Giả định]:

- Mua hàng **văn phòng**: giữ luồng hiện tại (sếp duyệt), không cần mã ngân sách.
- Báo giá cho khách, đấu thầu (bước 1–2): chỉ lưu số và tệp báo giá trong xác nhận dự án.
- Thu tiền khách hàng (khối lượng hoàn thành, hóa đơn bán ra), hồ sơ hoàn công, đánh giá dự án.
- Quản lý tồn kho (nhập, xuất kho chi tiết).
- Họp ngân sách P-COST-02 (chưa có biểu mẫu trong thư mục) [Cần xác nhận].

---

## 2. Người dùng, bộ phận và quyền

### 2.1 Bộ phận [Cần xác nhận: người phụ trách từng bộ phận]

Admin cấu hình ai thuộc bộ phận nào (theo hồ sơ nhân sự, một người có thể thuộc nhiều bộ phận). Đề xuất mặc định:

| Bộ phận | Mã | Người mặc định |
|---|---|---|
| Lãnh đạo | `leader` | Nguyễn Gia Luân |
| Phòng Kỹ thuật | `technical` | [Cần xác nhận] |
| Phòng Vật tư / kho | `material` | [Cần xác nhận] |
| Kế toán | `accounting` | [Cần xác nhận] |
| Hành chánh | `admin_office` | [Cần xác nhận] |
| **Phụ trách** (của từng dự án) | | PM của dự án [Giả định] |

### 2.2 Bảng quyền

| Việc | Dự án (CHT, tổ trưởng, kỹ sư) | Phụ trách (PM) | P. Kỹ thuật | P. Vật tư | Kế toán | Lãnh đạo | Hành chánh |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Lập xác nhận dự án | | Có | Có | | | | |
| Lên số dự án, kiểm tra hợp đồng | | | | | **Có** | | |
| Lập / sửa ngân sách theo mã | | Có | **Có** | | | | |
| Duyệt ngân sách | | ký | ký | | | **Duyệt** | |
| Lập phiếu yêu cầu vật tư | **Có** | Có | | | | | |
| Hỏi giá, nhập báo giá NCC, so sánh | | | **Thiết bị chính** | **Vật tư, VT phụ** | | | |
| Lập đơn nháp | | | Có | Có | | | |
| Ký đơn nháp | | ký | ký | ký | ký | **Duyệt** | ký |
| Phát hành PO chính thức | | | | | | | **Có** |
| Lập đề nghị thanh toán | | | Có | Có | | | |
| Duyệt đề nghị thanh toán | | ký | ký | ký | | **Duyệt** | |
| Chi tiền, ghi nhận đã thanh toán | | | | | **Có** | | |
| Nhận hàng, kiểm tra | **Có** | Có | | Có | | | |
| Xem số tiền | Không [Giả định] | Có | Có | Có | Có | Có | Có |

Tổ trưởng, CHT ở công trường chỉ thấy **số lượng** vật tư, không thấy giá [Giả định], giống quy tắc che tiền hiện có (`can_see_money`).

---

## 3. Dữ liệu

### 3.1 Xác nhận dự án (P-COST-01)

Gắn với dự án đã có. Một dự án có một xác nhận. Khi hợp đồng thay đổi thì tăng số lần sửa (Rev).

| Trường | Ghi chú |
|---|---|
| Số dự án | [Đã chốt] dạng `Pr25001-01`. Kế toán cấp số. [Cần xác nhận] quy tắc: `Pr` + 2 số năm + 3 số thứ tự + `-` + 2 số hạng mục? |
| Tên dự án, mô tả công việc | |
| Loại xác nhận | **Xác nhận** hoặc **Xác nhận tạm** [Đã chốt] |
| Ngày ban hành | |
| Số báo giá, ngày báo giá | ví dụ `TNM Q-0201-2025 (MURATA DA NANG) Rev-00` |
| Giá trị báo giá, **giá trị xác nhận** (VNĐ) | Giá trị xác nhận = giá trị hợp đồng dùng để tính lợi nhuận |
| Số chứng từ khách hàng (PO, hợp đồng), ngày | Có thể để trống khi xác nhận tạm |
| Điều khoản thanh toán của khách | Chữ tự do, ví dụ "Tạm ứng 15%, thanh toán theo tiến độ tháng đến 95%…" |
| Khách hàng, chủ đầu tư | Lấy từ danh mục đối tác (`partners`) |
| Ngày bắt đầu, ngày hoàn thành | Đồng bộ với ngày dự kiến của dự án |
| Tài liệu đính kèm | **Xác nhận**: báo giá có ký xác nhận hoặc PO / hợp đồng, báo giá TNM có ký đóng dấu, tiến độ tổng, bản vẽ. **Xác nhận tạm**: báo giá TNM có ký đóng dấu, hướng dẫn từ khách (email, PM ký xác nhận báo giá), tiến độ tổng, bản vẽ [Đã chốt] |
| Chuỗi ký | Phụ trách → P. Kỹ thuật → Vật tư-kho → Lãnh đạo → Kế toán → Hành chánh [Đã chốt theo ô ký trên mẫu] |

### 3.2 Ngân sách theo mã (P-COST-03)

**Mã chi phí** là danh mục chung của công ty. Admin sửa được tên, thêm, ẩn mã. Mặc định lấy đúng từ mẫu [Đã chốt]:

| Nhóm | Mã |
|---|---|
| **#100 Thiết bị, vật tư** | 111 Boiler, flue & tank · 112 Heat exchanger · 113 Kitchen equipment · 121 Chiller · 123 Air compressor & dryer · 132 Cooling tower · 141 Pump · 151 Heater · 161 Fan · 163 Air filter · 164 Fan coil unit · 165 Air handling unit · 166 Packaged unit / humidifier · 167 Duct, duct accessories · 168 Grilles · 169 VAV-CAV-silencer · 171 Mechanical piping materials · 172 Electrical piping · 173 MV panel / equipment · 174 Transformers · 175 Switch board / panel · 176 Cable ladder / trunking · 177 Cable · 178 Lighting & socket outlet · 179 Generator / UPS / battery · 181 ELV equipment · 182 Automatic control equip. / panel · 183 Automatic field devices · 184 Lightning equipment · 185 Solar module · 186 Solar inverter · 192 Fire protection M-equipment · 193 Fire protection E-equipment · 194 Sanitary equipment · 195 Miscellaneous material · 196 Clean room equipment · 197 (trống) |
| **#200 Lắp đặt (nhân công)** | 211 Piping installation · 221 Ducting installation · 231 Electrical work without material · 241 Building installation · 251 Hoisting & assembly · 252 Boom lift / scissor lift |
| **#300 Thi công kèm vật tư (thầu phụ)** | 311 Duct work · 321 Insulation · 331 Painting · 341 Electrical work with material · 342 Control wiring · 351 Piping work with material · 352 Building work · 353 CR panel · 354 Water treatment · 355 Fire fighting · 361 Misc. work w/ material · 362 Maintenance, T&C · 363 A/C work · 364 Sanitary work · 399 Not yet decided |
| **#400 Chi phí chung** | 411 Temporary facility · 415 Electrical & water fee · 416 Transportation · 417 Rental fee · 418 Importation fee · 421 Consultant fee · 454 Site office · 455 Insurance · 478 Safety equipment · 479 Office management · 480 Stationery, phone, internet · 483 Entertainment · 490 Misc expenses |

**Bảng ngân sách của dự án:**

- **Số ngân sách** = số dự án + `-` + số thứ tự lần lập, ví dụ `S25001-01-01` [Cần xác nhận: tiền tố `S` hay `TNM…-T`? Mẫu đang có cả hai kiểu].
- Trạng thái: **Xác nhận** hoặc **Xác nhận tạm**, giống P-COST-01.
- Phần đầu: tỷ giá VND/USD (mặc định 25.000), số báo giá, giá báo khách (offer), giá trị hợp đồng (lấy từ P-COST-01).
- Mỗi dòng mã: **giá gốc (nett)**, **ngân sách (C)**, **nhà cung cấp / thầu phụ** dự kiến, **dự phòng (D)** hoặc ghi chú, tỷ lệ C/B, D/C.
- Tổng phụ theo nhóm #100, #200, #300, #400.

Công thức [Đã chốt theo công thức trong mẫu]:

| Chỉ số | Công thức |
|---|---|
| Lợi nhuận báo giá | Giá báo khách − tổng giá gốc |
| Chi phí trực tiếp | Tổng ngân sách #100 ~ #300 |
| Tổng chi phí | Tổng ngân sách #100 ~ #400 |
| Lợi nhuận | Giá trị hợp đồng − tổng giá gốc |
| Lợi nhuận A | Giá trị hợp đồng − chi phí trực tiếp |
| Lợi nhuận B | Giá trị hợp đồng − tổng chi phí |
| % | Mỗi lợi nhuận chia giá trị hợp đồng |

**Chuỗi ký ngân sách:** Người phụ trách → Phòng kỹ thuật → Lãnh đạo công ty [Đã chốt theo ô ký]. Chỉ ngân sách **đã duyệt** mới được dùng để đặt hàng [Giả định].

**Quan hệ với 4 khoản ngân sách hiện có** [Giả định]: giữ 4 khoản để báo cáo tổng, nhưng **tự tính** từ các mã:

- #100 → Vật tư
- #200 → Nhân công (cộng chấm công của nhân viên công ty)
- #300 → Thầu phụ
- #400 → Chi phí khác

Chấm công đã duyệt tính vào mã nào trong #200 [Cần xác nhận]. Đề xuất: mỗi dự án chọn một mã mặc định (ví dụ 231). PM đổi được theo tổ.

**Sửa ngân sách sau khi duyệt:** tạo lần lập mới (`-02`, `-03`…), giữ bản cũ để đối chiếu. Đổi mã hoặc tăng ngân sách một mã phải kèm P-COST-05 [Đã chốt theo mục "Thay đổi bảng ngân sách" trên P-COST-05].

### 3.3 Phiếu yêu cầu vật tư (P-COST-08)

| Trường | Ghi chú |
|---|---|
| Dự án, số dự án | |
| Người yêu cầu, ngày yêu cầu | |
| Các dòng | STT, **tên vật tư**, **thông số kỹ thuật**, **nhà sản xuất**, đơn vị, số lượng, **ngày cần sử dụng**, ghi chú |
| Mã ngân sách dự kiến | Mỗi dòng. CHT không biết mã thì để trống, P. Vật tư điền [Giả định] |
| Chuỗi ký | Người yêu cầu → Phòng Vật tư, Kho → P. Kỹ thuật → Lãnh đạo [Đã chốt theo ô ký] |
| Trạng thái | Nháp → Đã gửi → Đang hỏi giá → Đã lên đơn (một phần / toàn bộ) → Đã nhận đủ / Hủy |

Lập trên điện thoại được (CHT, tổ trưởng ở công trường) [Giả định].

> **Lưu ý:** tệp mẫu `08-P-COST-08 Yêu cầu vật tư.xls` có sheet ẩn chứa virus macro Excel (XF.Classic). Khi làm bản in, hệ thống tự dựng mẫu mới, không dùng lại tệp này. Nên xóa sheet ẩn hoặc lưu lại thành `.xlsx` sạch.

### 3.4 Hỏi giá và so sánh

| Trường | Ghi chú |
|---|---|
| Từ dòng nào | Một hoặc nhiều dòng của phiếu yêu cầu vật tư, hoặc lập thẳng (thiết bị chính theo ngân sách) |
| Người hỏi giá | Thiết bị chính: P. Kỹ thuật. Vật tư, vật tư phụ: P. Vật tư [Đã chốt] |
| Báo giá NCC | Mỗi NCC: tên, mã NCC, người liên hệ, số và ngày báo giá, đơn giá từng dòng, điều kiện giao hàng, thanh toán, bảo hành, **tệp báo giá có đóng dấu** |
| Bảng so sánh | Hệ thống tự dựng từ các báo giá: so theo dòng, tổng, đánh dấu NCC được chọn và lý do |
| Số báo giá tối thiểu | [Cần xác nhận] Đề xuất: từ 50 triệu trở lên phải có ít nhất 2 báo giá, hoặc ghi lý do chỉ có 1 NCC |

Nhà cung cấp lưu trong danh mục đối tác (`partners`) với **mã NCC**, địa chỉ, điện thoại, email, mã số thuế, tài khoản ngân hàng [Giả định].

### 3.5 Đơn đặt hàng nháp (P-CC-07)

| Trường | Ghi chú |
|---|---|
| NCC, mã NCC, người nhận (Ông/Bà…), kính gửi | Từ báo giá được chọn |
| Ngày, số dự án, tên dự án | |
| **Mã số vật tư = mã ngân sách** | Một đơn một mã ngân sách [Cần xác nhận: mẫu có một ô "Mã số vật tư"; nếu đơn có nhiều mã thì tách đơn?] |
| V/v đặt hàng cho | Mô tả ngắn |
| Tham chiếu báo giá NCC, ngày báo giá | |
| Các dòng hàng | Lấy từ báo giá (tên, quy cách, đơn vị, số lượng, đơn giá) |
| **Giá trị đơn hàng** (VNĐ hoặc USD) | **Chưa gồm VAT** [Đã chốt: "Số tiền đặt hàng trên không bao gồm thuế GTGT"] |
| Ngày giao hàng / hoàn thành, nơi giao | |
| Điều kiện thanh toán | ví dụ tạm ứng 30%, còn lại sau nghiệm thu |
| Thời gian bảo hành | Mặc định "12 tháng kể từ ngày nghiệm thu bàn giao dự án" [Đã chốt theo mẫu] |
| Khác | Điều khoản riêng |
| **Xác nhận đặt hàng** | Ngày ban hành, **số ngân sách**, (A) giá trị ngân sách của mã, (B) đã đặt hàng, (C) đặt hàng lần này, **(D) = B + C**, **(E) = A − D ngân sách còn lại**. Hệ thống tự tính, không nhập tay [Đã chốt] |
| Hồ sơ kèm theo (Có / Không) | Báo giá NCC có đóng dấu · Bảng so sánh · Bản vẽ bốc khối lượng · Vật tư được khách hàng duyệt (approved) |
| Tài liệu yêu cầu NCC cung cấp | Hợp đồng mua bán · CO/CQ · Phiếu bảo hành khi giao hàng · Bảo đảm thanh toán |
| Chuỗi ký và **ngày mục tiêu** | Phụ trách → P. Kỹ thuật → P. Vật tư → Kế toán → Lãnh đạo → Hành chánh. Mỗi người có ngày mục tiêu; mặc định mỗi bước 1 ngày làm việc [Đã chốt theo mẫu] |

### 3.6 PO chính thức (P-CC-08)

Sinh từ đơn nháp sau khi Lãnh đạo duyệt. Hành chánh **phát hành**.

| Trường | Ghi chú |
|---|---|
| **Số PO** | [Cần xác nhận] Đề xuất `PO-<số dự án>-<3 số>`, ví dụ `PO-Pr25001-01-001` |
| Thông tin NCC đầy đủ | Địa chỉ, điện thoại, email |
| Nội dung | Như đơn nháp, bỏ phần ngân sách nội bộ (A–E) [Đã chốt: mẫu P-CC-08 không có phần này] |
| Điều khoản & điều kiện | Văn bản "PO's condition theo form P-CC-08": định nghĩa, chấp nhận, chất lượng, bảo đảm, vận chuyển, giá, thanh toán và chấp nhận, từ chối, rủi ro và tài sản, bảo hiểm, sở hữu trí tuệ, bản vẽ, **phạt 15%** khi đơn phương chấm dứt, pháp luật. Lưu một bản dùng chung, Admin sửa được |
| Tài liệu NCC phải cung cấp | Hợp đồng mua bán · Bảo đảm thanh toán · CO/CQ · Hóa đơn GTGT · Phiếu bảo hành khi giao hàng · Đề nghị thanh toán |
| Ký nhận | Bên bán ký tên đã nhận và chấp nhận đơn hàng. Hệ thống lưu **tệp PO có chữ ký NCC** và ngày NCC xác nhận |
| Theo dõi | Ngày giao dự kiến, ghi chú theo dõi, các lần giao hàng |
| Trạng thái | Đã phát hành → NCC đã xác nhận → Đang giao → Đã nhận đủ → Đã thanh toán đủ → Đóng / Hủy |

### 3.7 Nhận hàng

Giữ chức năng nhận hàng, kiểm tra hiện có. Thêm:

- Nhận **nhiều lần** theo từng đợt giao [Giả định].
- Mỗi đợt ghi số lượng nhận, số lượng đạt, ảnh, biên bản giao nhận.
- Tính vào **chi phí dự án theo mã ngân sách** khi PO đã nhận đủ, hoặc khi có hóa đơn [Cần xác nhận: ghi nhận chi phí lúc nào? Đề xuất: theo giá trị PO đã đặt (cam kết) để kiểm soát ngân sách, và theo hóa đơn đã thanh toán để báo cáo dòng tiền].

### 3.8 Đề nghị thanh toán (P-CF-03)

| Trường | Ghi chú |
|---|---|
| **Số RFP** | `RFP-` + số thứ tự [Đã chốt tiền tố theo mẫu] |
| Số dự án & số ngân sách, tên dự án | |
| Ngày ban hành, **ngày dự kiến thanh toán** | |
| Các dòng | Tên công ty (NCC), mã sản phẩm / mã ngân sách, **số P/O**, số tiền P/O, số tiền đã thanh toán, **số hóa đơn**, ngày hóa đơn, **tiền trước thuế**, **thuế GTGT**, giá trị thanh toán |
| Tạm ứng | Số hóa đơn ghi **"tạm ứng"** [Đã chốt theo lưu ý trên mẫu] |
| Lịch sử thanh toán cho PO | Hệ thống tự liệt kê các lần đã trả của từng PO, tổng đã trả |
| Tệp kèm | Hóa đơn GTGT, biên bản giao nhận / nghiệm thu, đề nghị thanh toán của NCC |
| Chuỗi ký | Phụ trách → P. Kỹ thuật → P. Vật tư → Lãnh đạo → **Kế toán chi** [Đã chốt theo ô ký] |
| Sau khi chi | Kế toán ghi ngày chi, hình thức (chuyển khoản / tiền mặt), số chứng từ |

### 3.9 Báo cáo giải thích (P-COST-05)

| Trường | Ghi chú |
|---|---|
| Loại | **Thay đổi bảng ngân sách** (vượt số tiền P/O, thay đổi mã số) · **Công việc bảo hành** · **Khác** (giải thích rõ) [Đã chốt] |
| Số dự án gốc, tên dự án | |
| Ngày hoàn thành | Chỉ cho dự án bảo hành |
| Bảng theo mã | Mã số · (A) ngân sách gốc · (B) đã đặt hàng · (C) cần đặt hàng · **(D) = B + C** giá trị cần · **(E) = D − A** chênh lệch. Dự án bảo hành thì ngân sách gốc = 0 [Đã chốt] |
| Diễn giải | Lý do, nguyên nhân, cách khắc phục và kết quả |
| Hồ sơ kèm | Yêu cầu từ khách hàng · Báo giá vượt · Báo cáo sự cố · Bản vẽ giải thích |
| Chuỗi ký | Phụ trách → P. Kỹ thuật → P. Vật tư → P. HC-KT → Lãnh đạo [Đã chốt theo ô ký] |
| Kết quả | Khi Lãnh đạo duyệt, ngân sách của các mã liên quan **tăng thêm phần chênh lệch** và tạo lần lập ngân sách mới [Giả định] |

---

## 4. Quy tắc nghiệp vụ

| Mã | Quy tắc | Nhãn |
|---|---|---|
| PRC-01 | Đơn mua cho dự án **bắt buộc** có số dự án đã xác nhận (hoặc xác nhận tạm) và mã ngân sách thuộc ngân sách **đã duyệt** | Đã chốt |
| PRC-02 | Đơn nháp tự tính A, B, C, D = B + C, E = A − D theo mã ngân sách. B = tổng các PO **đã duyệt, chưa hủy** của mã đó | Đã chốt |
| PRC-03 | **E < 0 thì không gửi duyệt được** cho đến khi có P-COST-05 đã duyệt bù phần thiếu | Đã chốt theo P-COST-05 |
| PRC-04 | Đơn nháp đi qua chuỗi ký theo thứ tự. Mỗi người chỉ ký được khi người trước đã ký. Ai từ chối thì đơn trả về người lập, kèm lý do | Giả định |
| PRC-05 | Quá ngày mục tiêu mà chưa ký thì nhắc người đó qua Telegram / email (dùng kênh nhắc hạn sẵn có) | Giả định |
| PRC-06 | Chỉ Hành chánh phát hành PO, và chỉ từ đơn nháp đã được Lãnh đạo duyệt. PO đã phát hành không sửa được giá trị; muốn đổi thì hủy và lập đơn mới, hoặc làm phụ lục kèm P-COST-05 | Giả định |
| PRC-07 | Giá trị đơn hàng **chưa gồm VAT**. Ngân sách so sánh theo giá **chưa VAT** | Đã chốt |
| PRC-08 | Tổng thanh toán cho một PO (trước thuế) **không vượt** giá trị PO. Muốn trả thêm phải tăng giá trị PO theo PRC-06 | Giả định |
| PRC-09 | Tạm ứng được thanh toán trước khi có hóa đơn (số hóa đơn = "tạm ứng"). Lần thanh toán sau phải **trừ tạm ứng** | Giả định |
| PRC-10 | Kế toán chỉ chi được RFP đã có Lãnh đạo duyệt | Đã chốt |
| PRC-11 | Thanh toán không có nghĩa là đã chấp nhận hàng (theo điều khoản PO). Trạng thái nhận hàng và thanh toán tách riêng | Đã chốt |
| PRC-12 | Mọi bước ký, trả về, phát hành, chi tiền đều ghi nhật ký: ai, lúc nào, ghi chú | Giả định |
| PRC-13 | Số tiền chỉ hiện với người có quyền xem tiền của dự án; công trường chỉ thấy số lượng | Giả định |
| PRC-14 | Ngoại tệ: đơn bằng USD thì quy đổi sang VNĐ theo tỷ giá của ngân sách để kiểm tra E | Giả định |

---

## 5. Màn hình

| Mã | Màn hình | Ai dùng |
|---|---|---|
| PRC-S1 | **Xác nhận dự án**: tab mới trong dự án, in P-COST-01 | KT, Kế toán |
| PRC-S2 | **Ngân sách theo mã**: bảng mã #100–#400, tổng phụ, lợi nhuận, các lần lập, chuỗi ký; in P-COST-03 | KT, Lãnh đạo |
| PRC-S3 | **Yêu cầu vật tư**: lập trên điện thoại, danh sách theo dự án, trạng thái; in P-COST-08 | Công trường, Vật tư |
| PRC-S4 | **Hỏi giá / so sánh**: nhập báo giá NCC, tệp đính kèm, bảng so sánh tự dựng, chọn NCC | KT, Vật tư |
| PRC-S5 | **Đơn nháp**: ô A–E nổi bật (đỏ khi E < 0), chuỗi ký có ngày mục tiêu, hồ sơ kèm; in P-CC-07 | KT, Vật tư, các người ký |
| PRC-S6 | **PO**: phát hành, in P-CC-08 kèm điều khoản, tải PO có NCC ký, theo dõi giao hàng | Hành chánh |
| PRC-S7 | **Đề nghị thanh toán**: chọn PO, nhập hóa đơn, lịch sử đã trả tự dựng; in P-CF-03 | KT, Vật tư, Lãnh đạo, Kế toán |
| PRC-S8 | **Báo cáo giải thích**: bảng theo mã, diễn giải, hồ sơ kèm; in P-COST-05 | Phụ trách, Lãnh đạo |
| PRC-S9 | **Việc chờ tôi ký**: danh sách mọi phiếu đang chờ người đăng nhập ký, quá hạn tô đỏ | Mọi người ký |
| PRC-S10 | **Theo dõi ngân sách dự án**: theo mã, ngân sách / đã đặt / đã nhận / đã trả / còn lại | PM, KT, Lãnh đạo |

**In và xuất:** mỗi biểu mẫu in PDF và xuất Excel **giống bố cục mẫu công ty**, có đủ ô ký và ngày mục tiêu. Làm giống cách đã làm Sơ đồ tổ chức dự án.

---

## 6. Mô hình dữ liệu đề xuất

| Bảng | Nội dung chính |
|---|---|
| `departments`, `department_members` | Bộ phận (leader, technical, material, accounting, admin_office) và người thuộc bộ phận |
| `cost_codes` | Mã chi phí: mã, tên, nhóm (#100…#400), thứ tự, ẩn / hiện |
| `project_contracts` | Xác nhận dự án (P-COST-01), số lần sửa |
| `project_budget_sheets`, `project_budget_lines` | Lần lập ngân sách (số, trạng thái, tỷ giá, giá báo, giá trị HĐ) và dòng theo mã (giá gốc, ngân sách, NCC, dự phòng) |
| `material_requests`, `material_request_lines` | Phiếu yêu cầu vật tư |
| `supplier_quotes`, `supplier_quote_lines` | Báo giá NCC, gắn dòng yêu cầu |
| `purchase_orders` (mở rộng) | Thêm: số PO, mã ngân sách, số ngân sách, loại (nháp / chính thức), tiền tệ, tỷ giá, điều kiện thanh toán, bảo hành, hồ sơ kèm, tệp PO NCC ký |
| `approval_steps` | Dùng chung cho mọi phiếu: loại phiếu, id phiếu, thứ tự, bộ phận, người ký, ngày mục tiêu, kết quả (ký / trả về), ghi chú, thời điểm |
| `payment_requests`, `payment_request_lines` | RFP và dòng theo PO, hóa đơn |
| `explanatory_reports`, `explanatory_report_lines` | P-COST-05 |
| `po_terms` | Điều khoản PO dùng chung (có phiên bản) |

Đổi trạng thái chỉ qua hàm trên máy chủ (RPC), giống chấm công và đặt hàng hiện tại. Ô A–E tính trên máy chủ, không tin số từ trình duyệt.

**Dữ liệu cũ** [Giả định]: các đơn hàng dự án đã có giữ nguyên, gắn nhãn "luồng cũ", chỉ xem. Đơn văn phòng giữ luồng hiện tại.

---

## 7. Chia giai đoạn

| Giai đoạn | Nội dung | Vì sao trước |
|---|---|---|
| **A** | Mã chi phí, ngân sách theo mã (P-COST-03), bộ phận và chuỗi ký dùng chung, đơn nháp có A–E (P-CC-07), chặn khi E < 0, màn "Việc chờ tôi ký" | Sửa đúng chỗ đang sai nhất: đặt hàng không kiểm soát ngân sách |
| **B** | PO chính thức (P-CC-08 + điều khoản), đề nghị thanh toán theo hóa đơn (P-CF-03), kế toán chi, báo cáo giải thích (P-COST-05) | Khép vòng tiền ra cho NCC |
| **C** | Xác nhận dự án (P-COST-01), phiếu yêu cầu vật tư (P-COST-08), hỏi giá / bảng so sánh, nhắc quá hạn, theo dõi ngân sách theo mã | Hoàn thiện đầu vào và báo cáo |

Mỗi giai đoạn có quy tắc trong `docs/rules.md` (mã PRC-xx) và test kèm, giống các phân hệ trước.

---

## 8. Tiêu chí nghiệm thu chính

1. Lập ngân sách dự án theo mã, lợi nhuận A / B tính đúng như công thức trong P-COST-03.
2. Đơn nháp cho mã 175, ngân sách 100 triệu, đã đặt 65 triệu, lần này 40 triệu: hiển thị **D = 105 triệu, E = −5 triệu, tô đỏ** và **không gửi duyệt được** (ví dụ lấy đúng từ mẫu P-CC-07).
3. Làm P-COST-05 cho mã đó (A = 12tr, B = 8tr, C = 8tr → D = 16tr, E = +4tr). Lãnh đạo duyệt thì ngân sách mã tăng 4 triệu và đơn gửi duyệt được.
4. Đơn đi đủ chuỗi ký theo thứ tự. Người sau không ký trước người trước. Trả về thì quay lại người lập.
5. Hành chánh phát hành PO có số PO, in ra đúng bố cục P-CC-08 và kèm điều khoản.
6. RFP cho PO 40 triệu: tạm ứng 30% (số HĐ "tạm ứng"), rồi thanh toán còn lại theo hóa đơn có VAT. Lịch sử thanh toán PO hiện đủ hai lần. Không cho trả quá 40 triệu trước thuế.
7. Kế toán chỉ thấy nút "Đã chi" trên RFP đã được Lãnh đạo duyệt.
8. Tổ trưởng mở đơn hàng của dự án chỉ thấy số lượng, không thấy giá.

---

## 9. Câu hỏi cần chủ dự án trả lời

1. **Người của từng bộ phận**: ai là P. Kỹ thuật, P. Vật tư, Kế toán, Hành chánh? "Phụ trách" có phải luôn là PM của dự án?
2. **Đánh số**: số dự án (`Pr25001-01`), số ngân sách (`S25001-01-01` hay `TNM25001-01-T-01`; chữ `T` nghĩa là gì?), số PO, số RFP theo quy tắc nào?
3. **Một đơn một mã ngân sách** hay một đơn được nhiều mã (khi đó A–E tính theo từng mã)?
4. **Mức phải có nhiều báo giá**: từ bao nhiêu tiền thì bắt buộc 2–3 báo giá và bảng so sánh?
5. **Chuỗi ký có rút gọn không**: đơn nhỏ (ví dụ dưới 5 triệu) có bỏ bớt người ký?
6. **Chấm công tính vào mã nào** trong #200?
7. **Ghi nhận chi phí** vào ngân sách lúc nào: khi PO được duyệt (cam kết), khi nhận hàng, hay khi có hóa đơn?
8. **P-COST-02 Họp ngân sách**: có biểu mẫu không? Cần làm trên hệ thống không?
9. **Đơn văn phòng**: giữ luồng sếp duyệt đơn giản như hiện tại, đúng không?
10. **Đơn hàng dự án đang có trên web**: giữ dạng chỉ xem, hay nhập lại vào luồng mới?
