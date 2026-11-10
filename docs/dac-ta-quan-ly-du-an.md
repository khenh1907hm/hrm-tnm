# Đặc tả: Quản lý dự án, chấm công và ngân sách (giai đoạn 1)

| | |
|---|---|
| Công ty | Công ty TNHH Thiên Nhật Minh |
| Phân hệ | Quản lý dự án trong hệ thống Quản trị Online TNM |
| Phiên bản tài liệu | 0.1, ngày 10/11/2026 |
| Mục đích | Chốt phạm vi, dữ liệu, quy tắc tính tiền và báo cáo trước khi code |
| Trạng thái | Bản nháp sau buổi thảo luận BA đầu tiên, chưa có code |

Cách đọc: mỗi nội dung được gắn một trong ba nhãn, giống [tài liệu mô tả dự án](../Mo-ta-du-an-quan-ly-nhan-su-TNM.md).

- **[Đã chốt]**: chủ dự án đã nói rõ.
- **[Giả định]**: người viết đề xuất, chủ dự án chưa xác nhận. Nếu không ai phản đối thì làm theo.
- **[Cần xác nhận]**: phải hỏi lại. Đã ghi kèm đề xuất mặc định để không bị chặn tiến độ.

---

## 1. Tổng quan

### 1.1 Bối cảnh

Hệ thống hiện tại đang quản lý hồ sơ nhân sự và chứng chỉ an toàn của khoảng 500 người. Công ty muốn mở rộng sang **quản lý dự án** theo hướng gần giống Fastwork, với mục tiêu chính là **biết mỗi tổ viên làm bao nhiêu giờ trên mỗi dự án, tương ứng bao nhiêu tiền, để không vượt ngân sách dự án** [Đã chốt].

Hiện trạng dữ liệu cần lưu ý:

- Hồ sơ nhân sự (`employees`) chưa có đơn giá nhân công, cũng chưa có quan hệ cấp trên và cấp dưới.
- Tài khoản đăng nhập (`profiles`) chưa liên kết với hồ sơ nhân sự. Nghĩa là hệ thống chưa biết tài khoản nào là của nhân viên nào.
- Trước đây đã có bảng `projects` nhưng đã bị xóa (migration `20261015160000_drop_projects.sql`). Phân hệ này sẽ làm lại từ đầu.
- Đã có bảng `partners` (khách hàng, đối tác), có thể dùng lại cho khách hàng và thầu phụ.

### 1.2 Mục tiêu

1. Quản lý dự án gồm ngày bắt đầu, ngày kết thúc, ngân sách và trạng thái.
2. Xếp nhân sự trong dự án thành **cây chức vụ** (sơ đồ dự án).
3. **Chấm công theo ngày**: giờ thường và giờ tăng ca. Tổ trưởng nhập trên điện thoại, chỉ huy trưởng duyệt.
4. Tự tính tiền nhân công từ giờ công, đơn giá và hệ số tăng ca.
5. Theo dõi ngân sách theo 4 khoản và cảnh báo khi sắp vượt.
6. Báo cáo theo ngày, tuần, tháng, và xuất Excel bảng công cho kế toán.

### 1.3 Phạm vi giai đoạn 1 [Đã chốt]

- Dự án, ngân sách 4 khoản, thành viên dạng cây.
- Đơn giá giờ có lịch sử hiệu lực.
- Chấm công ngày, có bước duyệt.
- Thầu phụ theo 2 hình thức: chấm công theo người, hoặc khoán gọn.
- Phiếu chi cho vật tư và chi phí khác.
- Báo cáo ngày, tuần, tháng, và cảnh báo ngân sách.
- Xuất Excel bảng công theo mẫu kế toán.

### 1.4 Ngoài phạm vi giai đoạn 1

- **Hạng mục, công việc, biểu đồ Gantt, % tiến độ** [Đã chốt: để giai đoạn 2].
- Tính lương đầy đủ (bảo hiểm, thuế TNCN, tạm ứng). Hệ thống chỉ cung cấp bảng công và tiền công cho kế toán.
- Chấm công bằng GPS, khuôn mặt hoặc máy chấm công [Giả định].
- Quản lý kho vật tư, đặt hàng, công nợ nhà cung cấp [Giả định].

---

## 2. Người dùng và phân quyền

### 2.1 Nguyên tắc

**Quyền trong dự án đi theo vai trò trong dự án đó, không đi theo vai trò hệ thống** [Giả định]. Một người có thể là tổ trưởng ở dự án A nhưng chỉ là tổ viên ở dự án B, nên quyền nhập chấm công chỉ áp dụng ở dự án A.

Muốn vậy cần:

- **Liên kết tài khoản với hồ sơ nhân sự**: thêm trường `profiles.employee_id`. Admin chọn nhân viên khi cấp tài khoản.
- Tổ trưởng và chỉ huy trưởng dùng tài khoản thường (vai trò `employee` hoặc `engineer` như hiện có). Quyền trong dự án do bảng thành viên dự án quyết định.
- Thêm vào danh mục quyền theo từng người (`ACCESS_ITEMS`) các mục: `projects.view` (xem dự án), `projects.manage` (tạo và sửa dự án), `rates.manage` (quản lý đơn giá).

### 2.2 Bảng quyền

| Chức năng | Admin | PM của dự án | Chỉ huy trưởng (CHT) | Tổ trưởng | HR |
|---|:---:|:---:|:---:|:---:|:---:|
| Tạo dự án, gán PM | Có | Không | Không | Không | Không [Giả định] |
| Sửa thông tin và ngân sách dự án | Có | Có | Không | Không | Không |
| Thêm và xếp thành viên (cây) | Có | Có | Có [Giả định] | Không | Không |
| Nhập chấm công | Có | Có | Có | **Chỉ tổ mình** | Không |
| Duyệt hoặc từ chối chấm công | Có | Có | **Có** | Không | Không |
| Mở lại chấm công đã duyệt | Có | Không | Không | Không | Không |
| Xem giờ công | Có | Có | Có | Tổ mình | Có |
| **Xem đơn giá và tiền** [Đã chốt] | Có | **Dự án mình** | Không | Không | Không |
| Quản lý đơn giá từng người | Có | Không | Không | Không | Không |
| Nhập phiếu chi, đợt thanh toán thầu phụ | Có | Có | Không | Không | Không [Cần xác nhận] |
| Xuất Excel bảng công | Có | Dự án mình | Không | Không | Không [Cần xác nhận] |
| Khóa và mở khóa sổ tháng | Có | Không | Không | Không | Không |

Ghi chú:

- PM và CHT có thể là cùng một người.
- Một dự án có thể có nhiều CHT. Khi đó ai trong số họ duyệt cũng được [Giả định].

---

## 3. Dữ liệu cần quản lý

### 3.1 Dự án

| Trường | Bắt buộc | Ghi chú |
|---|:---:|---|
| Mã dự án | Có | Duy nhất, dạng `DA-2026-001` [Giả định] |
| Tên dự án | Có | |
| Khách hàng | Có | Chọn từ `partners` |
| Địa điểm công trường | Không | |
| PM | Có | Một nhân viên |
| Ngày bắt đầu và kết thúc **dự kiến** | Có | Kết thúc phải sau hoặc bằng bắt đầu |
| Ngày bắt đầu và kết thúc **thực tế** | Không | Ngày bắt đầu thực tế tự điền theo ngày chấm công đầu tiên, sửa tay được |
| Tổng thời gian thực hiện | Tự tính | Số ngày lịch và số ngày làm việc (trừ ngày nghỉ và ngày lễ), cả dự kiến và thực tế |
| Giờ chuẩn mỗi ngày | Có | Mặc định 8 |
| Ngày nghỉ trong tuần | Có | Mặc định Chủ nhật. Dùng để tự xác định loại tăng ca |
| Trạng thái | Có | Lập kế hoạch → Đang thi công → Tạm dừng → Hoàn thành → Lưu trữ |
| Mô tả, tệp đính kèm | Không | Hợp đồng, báo giá… |

Quy tắc:

- Chỉ dự án ở trạng thái **Đang thi công** mới nhận chấm công mới.
- Dự án đã có dữ liệu chấm công hoặc chi phí thì không xóa được, chỉ lưu trữ được (giống quy ước hiện có).

### 3.2 Ngân sách dự án [Đã chốt: 4 khoản]

| Khoản | Nguồn chi phí "đã dùng" |
|---|---|
| Nhân công | Chấm công đã duyệt của nhân viên công ty |
| Thầu phụ và thời vụ | Chấm công đã duyệt của người thầu phụ hoặc thời vụ, cộng các đợt thanh toán khoán gọn đã duyệt |
| Vật tư | Phiếu chi thuộc khoản vật tư |
| Chi phí khác | Phiếu chi thuộc khoản khác (ăn ở, đi lại, công tác phí…) |

Mỗi khoản có các trường:

- **Ngân sách (VNĐ)**
- **Ngưỡng cảnh báo**: mặc định 80% là vàng, 100% là đỏ [Giả định]

Riêng khoản nhân công có thêm **tổng giờ công kế hoạch** (không bắt buộc), để so sánh giờ thực tế với kế hoạch.

Điều chỉnh ngân sách (bổ sung hoặc cắt giảm) phải ghi lại **lịch sử**: ngày, số tiền cũ, số tiền mới, lý do, người sửa [Giả định].

### 3.3 Thành viên dự án và sơ đồ cây

Mỗi dòng là một người trong một dự án:

| Trường | Ghi chú |
|---|---|
| Nhân sự | Nhân viên công ty, hoặc người của thầu phụ hay thời vụ (xem 3.6) |
| Vai trò trong dự án | PM, Chỉ huy trưởng, Giám sát, Kỹ sư, Tổ trưởng, Tổ viên. Danh sách cố định ở giai đoạn 1 [Giả định] |
| **Quản lý trực tiếp** | Trỏ tới một thành viên khác của cùng dự án. **Sơ đồ cây được vẽ từ trường này** |
| Tổ hoặc đội | Tên tổ, ví dụ "Tổ điện 1". Tổ trưởng nhập công cho tất cả thành viên cùng tổ |
| Ngày vào và ngày rời dự án | Không cho chấm công ngoài khoảng này |
| Đơn giá riêng cho dự án | Không bắt buộc. Nếu có, dùng thay đơn giá chung (xem 3.4) |

Quy tắc cây:

- Mỗi dự án có đúng **một gốc**, là PM.
- Không được tạo vòng lặp, ví dụ A quản lý B và B lại quản lý A.
- Khi một người rời dự án mà vẫn còn cấp dưới, hệ thống yêu cầu chuyển các cấp dưới sang người quản lý khác trước.
- Màn hình sơ đồ: cây mở và thu gọn được, mỗi ô hiện ảnh, họ tên, vai trò và tổ. Có thể kéo thả để đổi người quản lý [Giả định].

**Kiểm tra chứng chỉ khi thêm thành viên** [Giả định]: nếu người được thêm có chứng chỉ an toàn bắt buộc đã hết hạn, hoặc sẽ hết hạn trước ngày kết thúc dự kiến, thì hiện cảnh báo vàng nhưng không chặn.

### 3.4 Đơn giá nhân công [Đã chốt: theo giờ]

| Trường | Ghi chú |
|---|---|
| Nhân sự | |
| Đơn giá giờ (VNĐ/giờ) | |
| Hiệu lực từ ngày | Bắt buộc |
| Hiệu lực đến ngày | Để trống nghĩa là đang áp dụng |
| Ghi chú | Ví dụ "Tăng lương 2027" |

Quy tắc:

- Các khoảng hiệu lực của cùng một người không được chồng lên nhau. Khi thêm đơn giá mới, hệ thống tự đóng khoảng đang mở vào ngày hôm trước.
- Thứ tự ưu tiên khi tính tiền: **đơn giá riêng của dự án** → **đơn giá của người đó tại ngày làm việc** → nếu không có thì **báo thiếu đơn giá**. Dòng công đó vẫn duyệt được, nhưng báo cáo tiền đánh dấu là "chưa đủ đơn giá" [Giả định].
- Đặt đơn giá theo bậc hoặc chức danh để áp hàng loạt: **[Cần xác nhận]**. Mặc định giai đoạn 1 đặt theo từng người, có nút "áp cùng đơn giá cho nhiều người".

### 3.5 Chấm công theo ngày

Chấm công gồm hai tầng: **phiếu công ngày** và các **dòng công** bên trong.

**Phiếu công ngày**: một phiếu cho mỗi dự án, mỗi ngày, mỗi tổ.

| Trường | Ghi chú |
|---|---|
| Dự án, ngày, tổ | Duy nhất theo bộ ba này |
| Người lập | Tổ trưởng (hoặc CHT, PM, Admin) |
| Trạng thái | Nháp → Đã gửi → Đã duyệt / Bị từ chối |
| Người duyệt, thời điểm duyệt | |
| Lý do từ chối | Bắt buộc khi từ chối |

**Dòng công**: mỗi người trong tổ một dòng.

| Trường | Ghi chú |
|---|---|
| Nhân sự | |
| Điểm danh | Có mặt / Vắng có phép / Vắng không phép / Nghỉ lễ |
| Giờ thường | Mặc định bằng giờ chuẩn của dự án. Nhập theo bước 0,5 giờ |
| Giờ tăng ca | Bước 0,5 giờ |
| Loại tăng ca | Tự đoán theo ngày: ngày thường, ngày nghỉ hằng tuần, ngày lễ. Sửa tay được |
| Giờ làm đêm | Tùy chọn, xem câu hỏi Q1 |
| Ghi chú | |
| **Đơn giá, hệ số, thành tiền (lưu cố định lúc duyệt)** | Chỉ Admin và PM đọc được (xem mục 7.2) |

### 3.6 Thầu phụ và lao động thời vụ [Đã chốt: cả hai hình thức]

**Hồ sơ thầu phụ**: dùng bảng `partners`, thêm loại "Thầu phụ". Mỗi thầu phụ trong một dự án chọn một trong hai hình thức.

**Hình thức A: chấm công theo người**

- Người của thầu phụ và lao động thời vụ được tạo hồ sơ trong danh sách nhân sự, có thêm trường **Loại lao động** (Chính thức / Thời vụ / Thầu phụ) và trường **Thuộc thầu phụ** [Cần xác nhận Q5].
  - Lợi ích: dùng lại được phần quản lý chứng chỉ an toàn, vì người thầu phụ vào công trường cũng cần thẻ an toàn.
  - Mã nhân sự dùng tiền tố riêng, ví dụ `TP001`, để không đụng quy tắc mã `TNM`.
- Chấm công và đơn giá giống hệt nhân viên. Tiền được tính vào **khoản thầu phụ**, không vào khoản nhân công.

**Hình thức B: khoán gọn**

| Trường | Ghi chú |
|---|---|
| Hợp đồng thầu phụ | Thầu phụ, dự án, số hợp đồng, nội dung, **giá trị hợp đồng**, ngày ký |
| Các đợt thanh toán | Ngày, số tiền, nội dung, chứng từ, trạng thái: Đề nghị → Đã duyệt → Đã chi |

- **Đã dùng** = tổng các đợt đã duyệt.
- **Cam kết** = giá trị hợp đồng trừ đi phần đã dùng. Phần cam kết được cộng vào dự báo ngân sách (mục 4.4).

### 3.7 Phiếu chi (vật tư và chi phí khác)

| Trường | Ghi chú |
|---|---|
| Dự án, ngày chi | |
| Khoản | Vật tư hoặc Chi phí khác |
| Nội dung, nhà cung cấp | |
| Số tiền (VNĐ) | |
| Ảnh hóa đơn hoặc chứng từ | Không bắt buộc |
| Người nhập, trạng thái | Nháp → Đã duyệt [Giả định: PM nhập, Admin duyệt; hoặc Admin nhập thì tự duyệt] |

### 3.8 Cấu hình chung (Admin)

**Hệ số tăng ca** [Giả định]. Mặc định theo Điều 98 Bộ luật Lao động 2019, Admin sửa được:

| Loại | Hệ số |
|---|---|
| Tăng ca ngày thường | 150% |
| Tăng ca ngày nghỉ hằng tuần | 200% |
| Tăng ca ngày lễ, Tết | 300% |
| Làm việc ban đêm | Cộng thêm 30% |
| Tăng ca ban đêm | Cộng thêm 20% |

**Trần giờ làm** (để cảnh báo). Mặc định theo Điều 107 Bộ luật Lao động 2019:

- Giờ thường cộng tăng ca không quá **12 giờ/ngày**
- Tăng ca không quá **40 giờ/tháng**
- Tăng ca không quá **200 giờ/năm** (300 giờ nếu công việc thuộc trường hợp luật cho phép, xem Q6)

**Lịch ngày lễ** theo năm. Admin nhập, có sẵn mẫu ngày lễ Việt Nam.

**Số ngày được nhập lùi**: mặc định 3 ngày [Giả định]. Quá hạn này thì chỉ CHT, PM hoặc Admin mới nhập bù được.

---

## 4. Quy tắc nghiệp vụ

### 4.1 Công thức tính tiền một dòng công

```
Đơn giá giờ  = đơn giá áp dụng tại ngày làm việc (mục 3.4)
Tiền thường  = Giờ thường × Đơn giá giờ
Tiền OT      = Giờ tăng ca × Đơn giá giờ × Hệ số tăng ca (theo loại)
Tiền đêm     = Giờ làm đêm × Đơn giá giờ × Phụ cấp đêm      (nếu dùng)
Thành tiền   = Tiền thường + Tiền OT + Tiền đêm, làm tròn đến đồng
```

Ví dụ: đơn giá 40.000 đ/giờ, làm 8 giờ thường và 2 giờ tăng ca ngày thường:

8 × 40.000 + 2 × 40.000 × 1,5 = 320.000 + 120.000 = **440.000 đ**

### 4.2 Luồng duyệt chấm công

```
Tổ trưởng lập (Nháp) ──Gửi──▶ Đã gửi ──CHT duyệt──▶ Đã duyệt ──Khóa sổ tháng──▶ Đã khóa
                                 │
                                 └──CHT từ chối (kèm lý do)──▶ Bị từ chối ──Tổ trưởng sửa, gửi lại──▶ Đã gửi
```

- Lúc duyệt, hệ thống **lưu cố định** đơn giá, hệ số và thành tiền vào từng dòng. Sau đó dù đơn giá có đổi, báo cáo cũ vẫn giữ nguyên số tiền.
- CHT có thể sửa giờ trước khi duyệt. Mọi chỉnh sửa đều ghi nhật ký (ai sửa, giá trị trước và sau).
- **Sửa sau khi đã duyệt**: chỉ Admin mới mở lại được phiếu, phải nhập lý do, có ghi nhật ký. Mở lại thì phiếu quay về "Đã gửi" [Cần xác nhận Q3].
- Nếu đơn giá thay đổi có hiệu lực lùi về quá khứ, Admin bấm **"Tính lại tiền"** cho một khoảng ngày chưa khóa sổ. Hệ thống ghi nhật ký chênh lệch.
- **Chỉ chấm công đã duyệt mới được tính vào "đã dùng"**. Phần đã gửi nhưng chưa duyệt chỉ hiện riêng dưới dạng "đang chờ duyệt".

### 4.3 Kiểm tra khi nhập và khi duyệt

| Mã | Kiểm tra | Mức |
|---|---|---|
| TS-01 | Ngày làm việc nằm ngoài thời gian dự án, hoặc ngoài khoảng ngày vào và ngày rời của thành viên | Chặn |
| TS-02 | Dự án không ở trạng thái Đang thi công | Chặn |
| TS-03 | Tổng giờ (thường cộng tăng ca) của một người **trên tất cả dự án** trong một ngày vượt 24 giờ | Chặn |
| TS-04 | Một người có công ở **2 dự án trở lên** trong cùng một ngày | Cảnh báo (vẫn cho, vì có thể sáng làm A, chiều làm B) |
| TS-05 | Vượt 12 giờ/ngày, vượt 40 giờ tăng ca/tháng, vượt trần tăng ca năm | Cảnh báo đỏ trên phiếu và trong báo cáo, không chặn [Giả định] |
| TS-06 | Người được chấm công không có đơn giá tại ngày đó | Cảnh báo cho Admin, vẫn duyệt được |
| TS-07 | Thẻ an toàn bắt buộc đã hết hạn tại ngày làm việc | Cảnh báo |
| TS-08 | Ngày đã khóa sổ | Chặn |
| TS-09 | Có mặt nhưng nhập 0 giờ, hoặc Vắng nhưng lại có giờ | Chặn |

### 4.4 Ngân sách và cảnh báo

Với **từng khoản** và với **tổng dự án**, hệ thống tính các chỉ số sau:

```
Đã dùng      = Σ chi phí đã duyệt
Chờ duyệt    = Σ chi phí đã gửi nhưng chưa duyệt
Cam kết      = phần còn lại của các hợp đồng khoán gọn
Còn lại      = Ngân sách − Đã dùng
% sử dụng    = Đã dùng / Ngân sách
Dự báo       = Đã dùng + Cam kết + (Chi phí trung bình mỗi ngày làm việc của 14 ngày gần nhất × Số ngày làm việc còn lại)
```

Riêng khoản nhân công, dự báo dùng chi phí trung bình mỗi ngày; các khoản vật tư và khác chỉ tính "Đã dùng + Cam kết" [Giả định].

**Cảnh báo:**

- Khi % sử dụng vượt 80%, rồi khi vượt 100%, hệ thống **gửi email cho PM và Admin**. Mỗi ngưỡng chỉ gửi một lần, dùng lại cơ chế email nhắc hạn đang có.
- Khi **Dự báo > Ngân sách**, hiện cảnh báo "dự kiến vượt" trên bảng điều khiển.
- Vượt 100% thì **chỉ cảnh báo, không chặn duyệt chấm công** [Cần xác nhận Q2]. Lý do: người lao động đã làm thì vẫn phải được ghi công.

### 4.5 Khóa sổ tháng

- Admin khóa sổ **theo dự án và theo tháng** sau khi đã xuất bảng công gửi kế toán.
- Trước khi khóa, hệ thống liệt kê các phiếu chưa duyệt và các ngày chưa có phiếu, để Admin xử lý xong mới khóa.
- Mở khóa phải nhập lý do và có ghi nhật ký [Cần xác nhận Q4].

---

## 5. Chức năng chi tiết

| Mã | Chức năng | Người dùng |
|---|---|---|
| PJ-01 | Danh sách dự án: lọc theo trạng thái, khách hàng, PM; thanh % ngân sách màu xanh, vàng, đỏ | Admin, PM, HR (không hiện tiền) |
| PJ-02 | Tạo và sửa dự án, nhập ngân sách 4 khoản | Admin (tạo), PM (sửa) |
| PJ-03 | Thành viên và sơ đồ cây: thêm nhiều người một lúc, gán tổ, gán quản lý, kéo thả | Admin, PM, CHT |
| PJ-04 | Đơn giá: theo người, lịch sử, áp hàng loạt, nhập từ Excel | Admin |
| PJ-05 | **Chấm công trên điện thoại** (mục 5.1) | Tổ trưởng, CHT |
| PJ-06 | Duyệt chấm công: danh sách phiếu chờ duyệt, duyệt nhiều phiếu một lần, từ chối kèm lý do | CHT, PM |
| PJ-07 | Bảng công dạng lưới (người × ngày), sửa nhanh trên máy tính | CHT, PM, Admin |
| PJ-08 | Thầu phụ: gán hình thức, hợp đồng khoán gọn, các đợt thanh toán | Admin, PM |
| PJ-09 | Phiếu chi vật tư và chi phí khác | Admin, PM |
| PJ-10 | Bảng điều khiển dự án (mục 6.4) | Admin, PM |
| PJ-11 | Báo cáo ngày, tuần, tháng (mục 6) | Theo quyền |
| PJ-12 | Xuất Excel bảng công theo mẫu kế toán | Admin, PM |
| PJ-13 | Khóa và mở khóa sổ tháng | Admin |
| PJ-14 | Cấu hình hệ số tăng ca, ngày lễ, trần giờ làm, số ngày nhập lùi | Admin |
| PJ-15 | Liên kết tài khoản với nhân viên; cấp tài khoản cho tổ trưởng và CHT | Admin |

### 5.1 Màn hình chấm công trên điện thoại (PJ-05)

Mục tiêu: **tổ trưởng chấm cho cả tổ trong vòng dưới 1 phút** [Giả định].

1. Mở ứng dụng: nếu người dùng chỉ là tổ trưởng ở một dự án, vào thẳng phiếu công của tổ mình cho ngày hôm nay.
2. Đầu trang là ngày (vuốt để đổi ngày), tên dự án và tên tổ, kèm nhãn ngày thường, Chủ nhật hoặc ngày lễ.
3. Danh sách tổ viên có ảnh. Mỗi người mặc định **Có mặt, 8 giờ thường, 0 giờ tăng ca**.
   - Chạm vào tên để đổi Vắng / Có mặt.
   - Nút **+0,5 / −0,5** cho giờ tăng ca.
4. Nút **"Cả tổ tăng ca 2 giờ"** để áp cùng một giá trị cho tất cả.
5. Nút **Gửi duyệt**. Sau khi gửi, phiếu chỉ còn xem được, trừ khi bị từ chối.
6. Nếu mất sóng ở công trường, phiếu được **lưu nháp trên máy** và tự gửi khi có mạng lại [Giả định].
7. Tổ trưởng **không thấy tiền**.

CHT nhận thông báo khi có phiếu mới (huy hiệu số lượng trên menu; email tổng hợp cuối ngày là tùy chọn).

---

## 6. Báo cáo

Tất cả báo cáo lọc được theo dự án, tổ, người, khoảng ngày, và loại lao động (Chính thức / Thời vụ / Thầu phụ). Các cột tiền chỉ hiện với Admin và PM của dự án.

### 6.1 Báo cáo ngày

- Danh sách người có công: giờ thường, giờ tăng ca, loại tăng ca, thành tiền.
- **Tổ nào chưa nộp phiếu, phiếu nào chưa duyệt**, người vắng mặt.
- Tổng giờ và tổng tiền trong ngày.
- Danh sách cảnh báo của ngày: vượt 12 giờ, làm 2 dự án, thiếu đơn giá, thẻ an toàn hết hạn.

### 6.2 Báo cáo tuần

- Bảng **người × 7 ngày** (giờ thường / giờ tăng ca), cộng theo người và theo tổ.
- So sánh giờ thực tế với giờ kế hoạch (nếu có nhập).
- 10 người tăng ca nhiều nhất trong tuần.
- Chi phí trong tuần và lũy kế.

### 6.3 Báo cáo tháng

- Mỗi tổ viên: tổng ngày công, giờ thường, giờ tăng ca theo từng loại, **thành tiền**.
- **Giờ tăng ca so với trần 40 giờ/tháng** và trần năm, đánh dấu đỏ người vượt.
- Ngân sách 4 khoản: Ngân sách / Đã dùng / Chờ duyệt / Cam kết / Còn lại / Dự báo.
- Tình trạng khóa sổ của tháng.

### 6.4 Bảng điều khiển dự án

- Thẻ số liệu: % ngân sách đã dùng, tiền còn lại, số ngày còn lại, dự báo vượt hay không.
- Biểu đồ **chi phí lũy kế theo thời gian**, có đường ngân sách và đường dự báo.
- Biểu đồ giờ công theo tuần (giờ thường và giờ tăng ca xếp chồng).
- Sơ đồ cây thu nhỏ, bấm vào để mở trang thành viên.

### 6.5 Báo cáo tổng nhiều dự án (cho giám đốc) [Giả định]

- Mỗi dòng là một dự án: % ngân sách, dự báo, trạng thái.
- Mỗi người: tổng giờ trên tất cả dự án trong tháng (để kiểm trần tăng ca theo người, không theo từng dự án).

### 6.6 Xuất Excel bảng công (PJ-12)

- Làm **theo mẫu kế toán đang dùng** [Đã chốt]. **Đang chờ chủ dự án gửi file mẫu.**
- Trong lúc chờ, bố cục tạm: mỗi người một dòng, mỗi ngày trong tháng một cột (ghi giờ thường/tăng ca), sau đó là các cột tổng giờ thường, tổng tăng ca theo loại, đơn giá, thành tiền, chữ ký.
- Dùng lại phần xuất Excel đang có trong `src/modules/excel-template`.

---

## 7. Mô hình dữ liệu đề xuất

### 7.1 Các bảng

Khác với các bảng hiện có (lưu phần lớn dữ liệu trong cột `doc jsonb`), **các số liệu giờ và tiền lưu thành cột riêng** để cộng dồn, lọc và làm báo cáo nhanh. Thông tin phụ vẫn để trong `doc`.

| Bảng | Cột chính |
|---|---|
| `projects` | id, code, name, customer_id → partners, pm_employee_id, planned_start, planned_end, actual_start, actual_end, std_hours_per_day, weekly_off_days, status, archived_at, doc |
| `project_budgets` | project_id, category (`labor`, `subcontract`, `material`, `other`), amount, warn_pct, planned_hours |
| `project_budget_changes` | project_id, category, old_amount, new_amount, reason, changed_by, changed_at |
| `project_members` | id, project_id, employee_id, role, **parent_member_id** (tự tham chiếu), team, joined_on, left_on, project_rate |
| `labor_rates` | employee_id, hourly_rate, effective_from, effective_to, note |
| `timesheets` (phiếu ngày) | id, project_id, work_date, team, status, created_by, submitted_at, approved_by, approved_at, reject_reason |
| `timesheet_lines` | id, timesheet_id, employee_id, attendance, regular_hours, ot_hours, ot_type, night_hours, note |
| `timesheet_costs` | line_id, rate, ot_multiplier, night_multiplier, amount, cost_category (`labor` / `subcontract`), computed_at |
| `subcontracts` | id, project_id, partner_id, mode (`timesheet` / `lump_sum`), contract_no, contract_value, signed_on |
| `subcontract_payments` | id, subcontract_id, pay_date, amount, status, doc |
| `project_expenses` | id, project_id, spent_on, category (`material` / `other`), description, supplier, amount, status, doc |
| `holidays` | date, name |
| `period_locks` | project_id, month, locked_by, locked_at, unlocked_reason |
| Bổ sung | `profiles.employee_id`; trong `employees.doc` thêm `laborType` và `subcontractorId`; `partners.doc` thêm loại "Thầu phụ"; `settings` thêm hệ số tăng ca, trần giờ làm, số ngày nhập lùi |

### 7.2 Che số tiền với người không có quyền

RLS của Postgres chặn theo **dòng**, không chặn theo **cột**. Vì vậy đơn giá và thành tiền được tách ra bảng riêng (`labor_rates`, `timesheet_costs`). RLS của hai bảng này chỉ cho Admin, và PM của dự án tương ứng, đọc. Tổ trưởng và CHT đọc được `timesheet_lines` nhưng không có cách nào thấy tiền, kể cả khi mở DevTools.

### 7.3 Ước lượng dung lượng

Khoảng 500 người × 300 ngày làm việc ≈ **150.000 dòng công mỗi năm**. Với chỉ mục theo (project_id, work_date) và (employee_id, work_date), Postgres xử lý được nhẹ nhàng. Báo cáo tháng nên dùng hàm SQL (RPC) cộng dồn ở máy chủ, không tải toàn bộ dòng về trình duyệt.

---

## 8. Yêu cầu phi chức năng

- **Điện thoại trước**: màn hình chấm công dùng tốt trên điện thoại Android tầm trung với màn hình 360 px, nút bấm tối thiểu 44 px.
- **Mạng yếu**: lưu nháp trên máy, gửi lại khi có mạng (mục 5.1).
- **Nhật ký**: mọi thao tác duyệt, từ chối, mở lại, sửa đơn giá, sửa ngân sách, khóa và mở khóa sổ đều ghi vào `audit_events` hiện có.
- **Tiền tệ**: VNĐ, số nguyên, hiển thị có dấu chấm ngăn cách hàng nghìn.
- **Múi giờ**: ngày làm việc tính theo giờ Việt Nam (UTC+7).

---

## 9. Tiêu chí nghiệm thu chính

1. Tạo được dự án có ngân sách 4 khoản. Thêm được 20 người, xếp thành cây 3 cấp (PM → CHT → Tổ trưởng → Tổ viên), và hệ thống không cho tạo vòng lặp.
2. Tổ trưởng đăng nhập trên điện thoại, chấm công cho tổ 10 người kèm 2 giờ tăng ca, gửi trong dưới 1 phút, và **không thấy bất kỳ số tiền nào**.
3. CHT duyệt phiếu. Báo cáo ngày hiện đúng thành tiền theo công thức ở mục 4.1, ví dụ 440.000 đ như ví dụ mẫu.
4. Đổi đơn giá của một người sau khi đã duyệt: báo cáo tháng cũ không đổi, cho đến khi Admin bấm "Tính lại tiền" (với tháng chưa khóa sổ).
5. Chấm một người 10 giờ ở dự án A và 15 giờ ở dự án B trong cùng một ngày: hệ thống chặn (TS-03).
6. Khi đã dùng chạm 80% ngân sách, PM và Admin nhận email đúng một lần.
7. Thầu phụ khoán gọn có hợp đồng 100 triệu, đã duyệt đợt 1 là 30 triệu: khoản thầu phụ hiện Đã dùng 30 triệu, Cam kết 70 triệu.
8. Xuất Excel bảng công tháng đúng mẫu kế toán, và tổng khớp với báo cáo tháng.
9. Sau khi khóa sổ tháng, không ai sửa được dòng công của tháng đó, trừ khi Admin mở khóa kèm lý do.

---

## 10. Giai đoạn 2 (dự kiến)

- Hạng mục và công việc (WBS): ngày bắt đầu và kết thúc, giờ kế hoạch, người phụ trách, % tiến độ, biểu đồ **Gantt**. Chấm công gắn vào hạng mục.
- So sánh chi phí với tiến độ (earned value đơn giản).
- Đặt đơn giá theo bậc hoặc chức danh.
- Thông báo đẩy trên điện thoại, hoặc gửi qua Zalo.
- Tạm ứng và đối chiếu với tiền công.

---

## 11. Câu hỏi cần xác nhận

| Mã | Câu hỏi | Đề xuất mặc định nếu chưa trả lời |
|---|---|---|
| Q1 | Công trường có làm **ca đêm** không? | Có trường giờ làm đêm nhưng ẩn đi, Admin bật khi cần |
| Q2 | Vượt 100% ngân sách thì **chỉ cảnh báo** hay **chặn duyệt**? | Chỉ cảnh báo |
| Q3 | Chấm công đã duyệt có cho sửa không, ai sửa? | Chỉ Admin mở lại, kèm lý do |
| Q4 | Có cần khóa sổ tháng sau khi gửi kế toán không? | Có, Admin khóa và mở |
| Q5 | Người thầu phụ và thời vụ có dùng chung danh sách nhân sự (để quản lý cả chứng chỉ) không? | Dùng chung, thêm trường Loại lao động, mã tiền tố `TP` |
| Q6 | Công việc của TNM có thuộc trường hợp được tăng ca tới **300 giờ/năm** không? | Dùng trần 200 giờ, Admin sửa được |
| Q7 | HR có được xuất bảng công (có tiền) không? Ai nhập phiếu chi? | HR không xem tiền. PM nhập phiếu chi, Admin duyệt |
| Q8 | Đơn giá giờ là **giá thực trả cho người lao động** hay **giá vốn** đã gồm bảo hiểm và phụ cấp? | Giá thực trả; giá vốn để giai đoạn 2 |
| Q9 | **File mẫu bảng công** của kế toán | Đang chờ chủ dự án gửi |

---

## 12. Thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| PM | Quản lý dự án, người chịu trách nhiệm ngân sách |
| CHT | Chỉ huy trưởng công trường, người duyệt chấm công |
| Phiếu công ngày | Bảng chấm công của một tổ, trong một dự án, trong một ngày |
| Đã dùng | Chi phí đã được duyệt |
| Cam kết | Phần còn phải trả của hợp đồng khoán gọn |
| Dự báo | Chi phí ước tính khi dự án kết thúc |
| Khóa sổ | Chốt dữ liệu một tháng, không cho sửa nữa |
| Khoán gọn | Thầu phụ nhận trọn gói theo hợp đồng, không chấm công từng người |

---

## 13. Trạng thái triển khai (10/11/2026)

**Đã có code (chạy được ở chế độ demo, test tự động đạt):**

| Phần | Vị trí |
|---|---|
| Migration bảng, RLS, hàm gửi / duyệt / từ chối / mở lại / tính lại / mở khóa sổ | `supabase/migrations/20261110090000_project_management.sql` |
| Logic tính tiền, kiểm tra phiếu công, cây, ngân sách, báo cáo (quy tắc PRJ-01 … PRJ-13 trong `docs/rules.md`) | `src/modules/projects/` |
| Lưu dữ liệu: bản demo (localStorage) và bản Supabase | `src/repositories/projects/` |
| Màn hình: Dự án (`/du-an`), Chấm công trên điện thoại (`/cham-cong`), Đơn giá & lịch làm việc (`/don-gia`), cột Hồ sơ nhân sự ở Tài khoản | `src/app/_components/projects/`, `AccountsView.tsx` |
| Xuất Excel bảng công tháng (bố cục tạm) | `src/modules/projects/timesheetWorkbook.ts` |

**Chưa làm:**

- Migration đã chạy trên Supabase ngày 10/11/2026 (phiên bản `20261110142317`). Đã chạy thử luồng gửi → duyệt → tính tiền trong giao dịch hủy ngay: đúng 440.000 đ, chặn sửa thẳng trạng thái. Chưa thử với tài khoản tổ trưởng thật.
- Chưa gửi email khi chạm 80% / 100% ngân sách. Hiện mới cảnh báo trên màn hình.
- Chưa có cảnh báo thẻ an toàn hết hạn trong phiếu công (TS-07). Quy tắc đã có, nhưng chưa nối dữ liệu chứng chỉ.
- Chưa có ảnh hóa đơn cho phiếu chi, chưa lưu nháp offline trên điện thoại.
- Xuất Excel đang dùng bố cục tạm, chờ mẫu kế toán (Q9).
