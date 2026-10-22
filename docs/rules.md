# Sổ quy tắc TNM HRM

Mỗi mã quy tắc liên kết với tối thiểu một test có tên chứa mã tương ứng (dùng dấu gạch dưới, ví dụ `DATE_01`). Script `npm run rules:check` kiểm tra chiều hai phía giữa sổ và các test. Trạng thái “Giả định” có nghĩa đang dùng mặc định nêu tại `docs/open-questions.md`.

| Mã | Mô tả | Trạng thái | Tên test |
|---|---|---|---|
| DATE-01 | Ngày hợp lệ chỉ ở dạng YYYY-MM-DD đủ 4-2-2 chữ số, là ngày có thật trên lịch (kể cả năm nhuận: 2000 nhuận, 1900 và 2100 không nhuận). | Đã chốt | `DATE_01` |
| DATE-02 | todayVN(clock) lấy ngày theo múi giờ Asia/Ho_Chi_Minh (UTC+7). | Đã chốt | `DATE_02` |
| DATE-03 | diffDays(a, b) = b - a tính theo ngày lịch. | Đã chốt | `DATE_03` |
| DATE-04 | addMonths cộng trừ tháng, nếu ngày không tồn tại thì lùi về ngày cuối tháng. | Đã chốt | `DATE_04` |
| DATE-05 | monthsBetween(start, end) trả số tháng tròn. Một tháng được tính tròn khi ngày của end ≥ ngày của start, hoặc end là ngày cuối của tháng và ngày của start lớn hơn ngày của end (quy tắc cuối tháng). end < start trả null. | Đã chốt | `DATE_05` |
| DATE-06 | formatTenure(tháng): 0 thành "0 tháng"; bỏ phần bằng 0 (12 thành "1 năm"); ví dụ 243 thành "20 năm 3 tháng". | Đã chốt | `DATE_06` |
| PHONE-01 | Chuẩn hóa: bỏ khoảng trắng, dấu chấm, gạch ngang, ngoặc; +84 hoặc 84 ở đầu (khi đủ 11 chữ số) đổi thành 0. | Đã chốt | `PHONE_01` |
| PHONE-02 | Hợp lệ khi sau chuẩn hóa khớp ^0[35789]\d{8}$ (10 số). | Giả định | `PHONE_02` |
| PHONE-03 | Số cũ 11 số đầu 01 báo lỗi riêng PHONE_OLD_11_DIGIT (yêu cầu cập nhật số mới), không tự động đổi. | Giả định | `PHONE_03` |
| PHONE-04 | Lưu dạng chỉ chữ số; formatPhone hiển thị dạng 0839 395 292. | Đã chốt | `PHONE_04` |
| PHONE-05 | Trùng số giữa hai nhân sự chỉ cảnh báo, không chặn. | Đã chốt | `PHONE_05` |
| CCCD-01 | Đúng 12 chữ số. Chuỗi 9 chữ số báo CCCD_IS_OLD_CMND (chứng minh nhân dân cũ, không chấp nhận). | Đã chốt | `CCCD_01` |
| CCCD-02 | 3 số đầu là mã tỉnh, phải nằm trong 001 đến 096 (đặt trong file cấu hình provinceCodes.ts để thay bằng danh sách chính thức; ghi TODO). | Đã chốt | `CCCD_02` |
| CCCD-03 | Số thứ 4 cho thế kỷ và giới tính: thế kỷ = 1900 + 100 * floor(d / 2), giới tính = chẵn là Nam, lẻ là Nữ. Số thứ 5 và 6 là hai số cuối năm sinh. Hàm decodeCccd trả {provinceCode, gender, birthYear}. | Đã chốt | `CCCD_03` |
| CCCD-04 | Năm sinh giải mã phải khớp năm của ngày sinh đã nhập; giới tính giải mã phải khớp giới tính đã nhập. Sai thì lỗi CCCD_DOB_MISMATCH hoặc CCCD_GENDER_MISMATCH, trừ khi Admin cung cấp mismatchOverrideReason (từ 5 ký tự trở lên); khi đó cho lưu, kèm cảnh báo lưu trên hồ sơ và ghi vào nhật ký. | Giả định | `CCCD_04` |
| CCCD-05 | Duy nhất trong toàn hệ thống kể cả nhân sự đã ẩn. Thông báo lỗi nêu mã nhân viên đang giữ số đó. | Đã chốt | `CCCD_05` |
| CCCD-06 | maskCccd hiển thị 3 số đầu, 5 dấu chấm tròn, 4 số cuối. | Đã chốt | `CCCD_06` |
| NAME-01 | Chuẩn hóa: Unicode NFC, bỏ ký tự độ rộng 0, cắt khoảng trắng đầu cuối, gộp nhiều khoảng trắng thành một. | Đã chốt | `NAME_01` |
| NAME-02 | Dài 2 đến 100 ký tự; chỉ gồm chữ cái Unicode, khoảng trắng, dấu nháy đơn, dấu chấm, gạch ngang; cấm chữ số; phải có ít nhất 2 từ. | Giả định | `NAME_02` |
| NAME-03 | Nếu toàn bộ viết hoa thì chuyển thành Title Case từng từ (ví dụ OCR trả về hoa hết); ngược lại giữ nguyên. | Đã chốt | `NAME_03` |
| EMP-01 | Mã nhân viên: ^TNM\d{3,5}$ sau khi cắt khoảng trắng và viết hoa; duy nhất toàn hệ thống kể cả đã ẩn; không bao giờ dùng lại. | Giả định | `EMP_01` |
| EMP-02 | Bắt buộc khi tạo: mã, họ tên, ngày sinh, giới tính (Nam hoặc Nữ), CCCD, số điện thoại, chức danh (một trong: Giám đốc, Nhân sự, Trưởng phòng kỹ thuật, Nhân viên kỹ thuật, Nhân viên hiện trường), ngày làm nghề. | Đã chốt | `EMP_02` |
| EMP-03 | Không bắt buộc khi tạo: nguyên quán, địa chỉ thường trú, nhóm ATLĐ (số nguyên 1 đến 6), người liên hệ khẩn cấp. Các trường này chỉ bị chặn ở bước xuất PDF (EXP-01). | Đã chốt | `EMP_03` |
| EMP-04 | Tuổi tính tại hôm nay: dưới 15 là lỗi; dưới 18 hoặc trên 65 là cảnh báo; trên 100 là lỗi. | Giả định | `EMP_04` |
| EMP-05 | Ngày làm nghề: không trước (ngày sinh + 15 năm), lỗi nếu vi phạm; ở tương lai thì cảnh báo. | Đã chốt | `EMP_05` |
| EMP-06 | Tình trạng làm việc: active | on_leave | resigned; resigned bắt buộc có endDate không trước ngày làm nghề và không ở tương lai. | Đã chốt | `EMP_06` |
| EMP-07 | Người liên hệ khẩn cấp (nếu có) phải trỏ tới một người trong danh sách chỉ huy trưởng còn tồn tại. | Đã chốt | `EMP_07` |
| EMP-08 | Ẩn thay vì xóa: archive bắt buộc có lý do từ 3 ký tự, ghi archivedAt, archivedBy, archiveReason. Nhân sự ẩn không xuất hiện trong danh sách mặc định (có tùy chọn bao gồm đã ẩn), không bị gửi nhắc, không được xuất PDF. restore khôi phục nguyên vẹn, kể cả các chứng chỉ của họ. | Giả định | `EMP_08` |
| EMP-09 | Số năm làm việc không lưu, luôn tính từ ngày làm nghề đến một ngày tham chiếu (DATE-05, DATE-06). | Đã chốt | `EMP_09` |
| EMP-10 | Ngày vào TNM (companyStartDate) không bắt buộc; nếu có thì không được trước ngày làm nghề (lỗi), ở tương lai thì cảnh báo. Không dùng để tính kinh nghiệm. | Giả định | `EMP_10` |
| EMP-11 | Chữ ký nhân sự (signatureImage) không bắt buộc: ảnh PNG nền trong suốt lưu trong hồ sơ, xuất vào vùng ảnh IMG_employeeSignature của mẫu. | Giả định | `EMP_11` |
| SRCH-01 | Tìm không phân biệt hoa thường và không dấu (bỏ dấu tiếng Việt, đ thành d). Mỗi từ trong câu tìm phải khớp ít nhất một trong: họ tên, mã nhân viên, số điện thoại (so khớp chuỗi con theo chữ số), số CCCD (chỉ khi câu tìm đúng 12 chữ số). | Đã chốt | `SRCH_01` |
| SRCH-02 | Sắp theo mã tự nhiên (TNM45 trước TNM100), phân trang page, pageSize mặc định 20, tối đa 100. | Đã chốt | `SRCH_02` |
| SRCH-03 | Kết hợp bộ lọc theo chức danh, chứng chỉ sắp hết hạn, chứng chỉ đã hết hạn và nhân sự thiếu ít nhất một chứng chỉ hiện hành còn hạn bắt buộc theo chức danh; các bộ lọc trạng thái kết hợp theo AND. Nhân sự đã ẩn bị loại mặc định, Admin có thể yêu cầu đưa vào. | Đã chốt | `SRCH_03` |
| CTYPE-01 | Loại chứng chỉ là dữ liệu có id, key, tên tiếng Việt, tên tiếng Anh tùy chọn, chức danh bắt buộc, thứ tự, trạng thái hệ thống/ẩn; nạp sẵn 7 loại hệ thống. | Mới | `CTYPE_01` |
| CTYPE-02 | Tạo loại: tên 2–100 ký tự, duy nhất sau chuẩn hóa không phân biệt hoa thường/dấu kể cả loại ẩn; tên tiếng Anh tối đa 100; chức danh bắt buộc là tập con 5 chức danh; loại mới xếp cuối. | Mới | `CTYPE_02` |
| CTYPE-03 | Mọi loại dùng chung một khuôn dạng chứng chỉ, không có trường riêng theo loại. | Mới | `CTYPE_03` |
| CTYPE-04 | Admin sửa tên, tên tiếng Anh, chức danh bắt buộc, thứ tự; loại hệ thống không ẩn; chỉ ẩn loại tự thêm khi không còn chứng chỉ hiện hành và có lý do; không xóa vĩnh viễn. | Mới | `CTYPE_04` |
| CTYPE-05 | Danh sách sắp theo sortOrder rồi tên; chỉ Admin quản lý loại, HR chỉ đọc; mọi thay đổi ghi nhật ký. | Mới | `CTYPE_05` |
| CTYPE-06 | Mặc định: An toàn lao động và Khám sức khỏe bắt buộc cả 5 chức danh; Bảo hiểm tai nạn lao động và An toàn điện bắt buộc Trưởng phòng kỹ thuật, Nhân viên kỹ thuật, Nhân viên hiện trường; Chứng chỉ hàn, Vận hành cần cẩu, Vận hành xe nâng hàng không bắt buộc chức danh nào. | Đã chốt theo bảng người dùng cung cấp | `CTYPE_06` |
| CERT-01 | Loại chứng chỉ lấy từ kho loại chứng chỉ (CTYPE-01), không cố định trong logic; chấp nhận loại tự thêm còn hoạt động. | Đã chốt | `CERT_01` |
| CERT-02 | Bắt buộc loại, số chứng chỉ, ngày hết hạn, tệp chính; tùy chọn ngày cấp, title phân biệt, 0–10 tệp bổ sung có nhãn tùy chọn tối đa 100 ký tự. | Đã chốt | `CERT_02` |
| CERT-03 | Số chứng chỉ: 3 đến 50 ký tự, chữ cái, chữ số, khoảng trắng và . - / _, bắt đầu bằng chữ cái hoặc chữ số. | Đã chốt | `CERT_03` |
| CERT-04 | Ngày cấp không ở tương lai và không trước ngày sinh nhân sự; ngày hết hạn không trước ngày cấp. Hết hạn cách ngày cấp quá 15 năm thì cảnh báo. Nhập chứng chỉ đã hết hạn thì cho phép kèm cảnh báo CERT_ALREADY_EXPIRED. | Đã chốt | `CERT_04` |
| CERT-05 | Tệp chính và từng tệp bổ sung chấp nhận JPEG/PNG/WebP/PDF, tối đa 10 MB mỗi tệp. | Đã chốt | `CERT_05` |
| CERT-06 | Một nhân sự có thể có nhiều chứng chỉ hiện hành cùng loại; cặp (loại, title chuẩn hóa) phải duy nhất. Title rỗng là một giá trị; title có 2–60 ký tự hợp lệ và chuẩn hóa không phân biệt hoa thường/dấu/khoảng trắng thừa. Trùng cặp trả CERT_ALREADY_EXISTS. | Đã chốt | `CERT_06` |
| CERT-07 | Gia hạn trong cùng cặp (loại, title), không đổi title; ngày hết hạn mới sau hạn cũ và ngày cấp mới (nếu có cả hai) không trước ngày cấp cũ; bản cũ được thay thế. | Đã chốt | `CERT_07` |
| CERT-08 | Không đổi loại của chứng chỉ khi sửa. Sửa phải qua lại toàn bộ CERT-02 đến CERT-05. | Đã chốt | `CERT_08` |
| CERT-09 | Cùng nhân sự, cùng loại, cùng số chứng chỉ (dù title khác) là lỗi CERT_DUPLICATE_NUMBER; khác nhân sự thì cảnh báo. | Đã chốt | `CERT_09` |
| CERT-10 | Archive cần lý do; restore chỉ được khi không có chứng chỉ hiện hành khác cùng (loại, title chuẩn hóa). | Đã chốt | `CERT_10` |
| CERT-11 | Admin thêm/bớt tệp bổ sung của chứng chỉ, tối đa 10 tệp, ghi nhật ký; tệp chính chỉ được thay thế và luôn được giữ lại nếu không gửi tệp thay thế. | Đã chốt | `CERT_11` |
| CERT-12 | Tên hiển thị chứng chỉ là tên loại, thêm ` (title)` nếu có; dùng thống nhất ở giao diện, email, cảnh báo và PDF. | Đã chốt | `CERT_12` |
| LIST-01 | Checklist trả một hàng cho mỗi chứng chỉ hiện hành của mọi loại chưa ẩn (theo title); loại chưa có chứng chỉ có một hàng trống với trạng thái missing nếu bắt buộc, ngược lại not_required. Chứng chỉ đã ẩn/thay thế và loại đã ẩn không xuất hiện. | Đã chốt | `LIST_01` |
| LIST-02 | Mỗi hàng có tên hiển thị, số chứng chỉ, hạn, số ngày còn lại, trạng thái, cờ tệp chính và số tệp bổ sung; chứng chỉ chưa có title hiển thị tên loại theo CERT-12. | Đã chốt | `LIST_02` |
| LIST-03 | Summary đếm missing, expiring, expired; thiếu chỉ tính loại bắt buộc chưa có chứng chỉ hiện hành, chứng chỉ hết hạn tính expired chứ không tính missing. | Đã chốt | `LIST_03` |
| STATUS-01 | daysLeft = diffDays(today, expiryDate) với today = todayVN(clock). | Đã chốt | `STATUS_01` |
| STATUS-02 | daysLeft < 0 là expired; 0 <= daysLeft <= 30 là expiring; daysLeft > 30 là valid; không có chứng chỉ là none. (Hằng số 30 đặt tên REMINDER_DAYS.) | Giả định | `STATUS_02` |
| STATUS-03 | Trạng thái chung của nhân sự là trạng thái xấu nhất trong các chứng chỉ hiện hành: expired > expiring > valid > none. | Đã chốt | `STATUS_03` |
| STATUS-04 | Chứng chỉ đã ẩn hoặc đã bị thay thế không tính. | Đã chốt | `STATUS_04` |
| ALERT-01 | listExpiring gồm chứng chỉ hiện hành có daysLeft <= 60. Nhóm: expired (<0), d30 (0 đến 30), d60 (31 đến 60). Sắp theo daysLeft tăng dần, rồi theo họ tên. | Đã chốt | `ALERT_01` |
| ALERT-02 | Mỗi dòng có reminderSendDate = addDays(expiryDate, -30) và cờ reminderSent theo nhật ký đã gửi. | Đã chốt | `ALERT_02` |
| REM-01 | computeDueReminders chọn chứng chỉ hiện hành, của nhân sự không ẩn và có tình trạng active hoặc on_leave, có 0 <= daysLeft <= 30, chưa có bản ghi nhật ký cho khóa (certificateId, 'EXPIRING_30', expiryDate). Khóa gồm cả expiryDate, nên nếu hạn bị sửa thì nhắc lại đúng. | Giả định | `REM_01` |
| REM-02 | Bù nhắc: chứng chỉ nhập muộn (chỉ còn 10 ngày) vẫn được chọn ở lần chạy đầu tiên, mỗi chứng chỉ chỉ một lần, không bao giờ gửi lặp mỗi ngày. | Đã chốt | `REM_02` |
| REM-03 | Chứng chỉ đã hết hạn (daysLeft < 0) chỉ được nhắc nếu cấu hình sendExpiredNotice bật (mặc định tắt), khóa 'EXPIRED', một lần duy nhất. | Giả định | `REM_03` |
| REM-04 | Mỗi chứng chỉ một email. Người nhận lấy từ cài đặt. Nếu không có người nhận thì kết quả skipped: NO_RECIPIENT và không ghi nhật ký đã gửi (để ngày sau còn gửi được). | Đã chốt | `REM_04` |
| REM-05 | run gửi qua interface Mailer; chỉ ghi nhật ký sau khi gửi thành công. Gửi lỗi thì không ghi, lần sau thử lại, kết quả trả về đủ danh sách thành công và thất bại. | Đã chốt | `REM_05` |
| REM-06 | Nội dung email (tiếng Việt): tên nhân sự, mã, loại chứng chỉ, số chứng chỉ, ngày hết hạn định dạng dd/mm/yyyy, số ngày còn lại, đường dẫn mở hồ sơ. | Đã chốt | `REM_06` |
| SIG-01 | Họ tên và chức danh người ký: 2 đến 100 ký tự. Ảnh: image/png, có cờ hasTransparency === true, tối đa 2 MB; thiếu cờ nền trong suốt thì lỗi SIG_NOT_TRANSPARENT. | Đã chốt | `SIG_01` |
| SIG-02 | Luôn đúng một chữ ký mặc định khi thư viện không rỗng. Chữ ký đầu tiên tự động là mặc định. | Đã chốt | `SIG_02` |
| SIG-03 | Không xóa được chữ ký cuối cùng. Xóa chữ ký mặc định thì chữ ký tạo sớm nhất còn lại thành mặc định. | Đã chốt | `SIG_03` |
| SET-01 | reminderEmails: tối đa 10 địa chỉ, mỗi địa chỉ hợp lệ, chuyển chữ thường, loại trùng. reminderDays cố định 30, không cho sửa. | Đã chốt | `SET_01` |
| RBAC-01 | Admin được mọi quyền. HR chỉ được: đọc nhân sự, đọc chứng chỉ, đọc chữ ký, đọc cài đặt, xuất PDF, hiện số CCCD đầy đủ. | Giả định | `RBAC_01` |
| RBAC-02 | Quyền kiểm tra bên trong từng use case (không chỉ ở giao diện). Vi phạm trả lỗi FORBIDDEN. | Đã chốt | `RBAC_02` |
| RBAC-03 | Có test kiểu bảng chạy toàn bộ tổ hợp (use case × vai trò) và so với ma trận quyền khai báo duy nhất ở một nơi. | Đã chốt | `RBAC_03` |
| AUD-01 | Mọi thao tác thay đổi dữ liệu thành công ghi một sự kiện {id, at, actorId, role, action, entityType, entityId, before, after}. Thao tác thất bại không ghi. | Đã chốt | `AUD_01` |
| AUD-02 | Trong before và after, số CCCD được che bằng maskCccd. Việc hiện số CCCD đầy đủ cũng ghi sự kiện cccd.reveal. | Đã chốt | `AUD_02` |
| AUD-03 | Nhật ký chỉ thêm, không sửa, không xóa. Chỉ Admin đọc được. | Đã chốt | `AUD_03` |
| EXP-01 | checkReadiness(employee, signDate, signerId) trả danh sách lỗi chặn nếu thiếu bất kỳ trường nào trên phiếu: họ tên, ngày sinh, giới tính, nguyên quán, địa chỉ thường trú, số điện thoại, ngày làm nghề, người liên hệ khẩn cấp, người ký (có trong thư viện), ngày ký hợp lệ. Nhân sự đã ẩn thì chặn. Chưa có nhóm ATLĐ trong khi có chứng chỉ huấn luyện an toàn được tick thì chỉ cảnh báo. | Giả định | `EXP_01` |
| EXP-02 | Ô tick hệ thống đúng khi có ít nhất một chứng chỉ hiện hành cùng loại còn hạn tại ngày ký; ghi chú hết hạn chỉ khi không còn chứng chỉ nào của loại đó hợp lệ. | Đã chốt | `EXP_02` |
| EXP-03 | Kinh nghiệm tính từ ngày làm nghề đến ngày ký. Ngày làm nghề sau ngày ký thì hiển thị "0 tháng" kèm cảnh báo. | Đã chốt | `EXP_03` |
| EXP-04 | Họ tên trên phiếu viết hoa toàn bộ. Ô giới tính tick đúng một trong hai. Ghi "Nhóm N" cạnh dòng huấn luyện an toàn khi dòng đó được tick. | Đã chốt | `EXP_04` |
| EXP-05 | Với mỗi loại được tick, mặc định chọn chứng chỉ hiện hành còn hạn có ngày hết hạn xa nhất; selectedCertificateIds ghi đè chọn mặc định, extraCertificateIds chọn loại tự thêm cho trang scan, includeSupplementary mặc định false và nếu bật thì tệp bổ sung theo ngay sau tệp chính. | Đã chốt | `EXP_05` |
| EXP-06 | Không sinh PDF ở giai đoạn này, chỉ trả cấu trúc dữ liệu để giai đoạn sau dựng PDF. | Đã chốt | `EXP_06` |
| OCR-01 | parseIdText(text) nhận văn bản OCR của một ảnh và trả {cccd, name, dob, gender, home, addr, currentAddr, phone} (trường không tìm thấy là null). | Đã chốt | `OCR_01` |
| OCR-02 | Dò theo nhãn đã bỏ dấu, chịu được lỗi OCR (ví dụ "Noi thuGng tru", "Noi 6 hien tai"). Họ tên lấy ở dòng IN HOA sau nhãn họ tên, bỏ phần rác viết thường phía sau. Ngày sinh lấy ở dòng nhãn hoặc hai dòng kế, bỏ qua dòng "ngày cấp". Giới tính chỉ lấy chữ Nam/Nữ sau nhãn "Giới tính / Sex". Số điện thoại lấy 10 số bắt đầu bằng 0 sau nhãn số thuê bao. Địa chỉ có thể xuống nhiều dòng cho đến khi gặp nhãn kế tiếp. | Đã chốt | `OCR_02` |
| OCR-03 | mergeParsed gộp nhiều ảnh của một người: lấy giá trị đầu tiên khác null cho mỗi trường. | Đã chốt | `OCR_03` |
| OCR-04 | Kết quả OCR không bao giờ tự lưu. Mọi trường qua đúng các validator của nhân sự (NAME, PHONE, CCCD, ngày) và gắn nguồn ocr để giao diện tô vàng. Số CCCD 9 chữ số (chứng minh nhân dân cũ) trên ảnh phải bị bỏ qua. | Đã chốt | `OCR_04` |
| OCR-05 | Test dùng văn bản OCR giả do bạn tự soạn mô phỏng đúng bố cục ảnh chụp màn hình VNeID (hai ảnh: ảnh 1 có họ tên, ngày sinh, giới tính, CCCD, nguyên quán, thường trú; ảnh 2 có số điện thoại), thêm dòng nhiễu và nhãn bị OCR đọc sai. Không dùng thông tin thật. | Đã chốt | `OCR_05` |
| OCRUI-01 | Chọn 1–4 ảnh JPG/PNG/WebP, tối đa 10 MB/ảnh; hỗ trợ click và kéo thả, từ chối tệp lỗi bằng thông báo tiếng Việt nhưng vẫn đọc ảnh hợp lệ. | Mới | `OCRUI_01` |
| OCRUI-02 | OCR chạy bằng Tesseract.js trong Web Worker, ngôn ngữ vie+eng từ public/tessdata nội bộ; có tiến độ và nút hủy, không khóa giao diện. | Mới | `OCRUI_02` |
| OCRUI-03 | Tiền xử lý ảnh xám, tăng tương phản, phóng rộng ảnh dưới 1400 px. | Mới | `OCRUI_03` |
| OCRUI-04 | Mỗi ảnh parse rồi merge; chỉ điền trường trống hoặc do lần OCR trước điền; không ghi đè dữ liệu HR đã gõ nếu chưa xác nhận; đánh dấu trường OCR. | Mới | `OCRUI_04` |
| OCRUI-05 | Mọi giá trị qua validator NAME/PHONE/CCCD/DATE; giá trị sai vào rejected; CCCD được đối chiếu ngày sinh và giới tính theo CCCD-04. | Mới | `OCRUI_05` |
| OCRUI-06 | Không tự lưu, không lưu/gửi ảnh gốc; giải phóng bộ nhớ và thu hồi object URL sau đọc. | Mới | `OCRUI_06` |
| OCRUI-07 | Hiển thị trường chưa tìm thấy; cho phép đọc thêm ảnh mà giữ dữ liệu đã điền. | Mới | `OCRUI_07` |
| OCRUI-08 | Văn bản thô chỉ hiện trong vùng thu gọn, mặc định ẩn và chỉ giữ trong bộ nhớ trang. | Mới | `OCRUI_08` |
| OCRUI-09 | Lỗi tải ngôn ngữ, ảnh lỗi, hủy giữa chừng đều có thông báo tiếng Việt và vẫn nhập tay được. | Mới | `OCRUI_09` |
| INV-01 | Không có hai chứng chỉ hiện hành cùng (nhân sự, loại, title chuẩn hóa). | Đã chốt | `INV_01` |
| INV-02 | Mã nhân viên và CCCD không trùng nhau trong toàn bộ dữ liệu, kể cả đã ẩn. | Đã chốt | `INV_02` |
| INV-03 | Thư viện chữ ký không rỗng thì có đúng 1 chữ ký mặc định. | Đã chốt | `INV_03` |
| INV-04 | Nhân sự đã ẩn không xuất hiện trong danh sách mặc định, màn hình hết hạn, kết quả nhắc hạn. | Đã chốt | `INV_04` |
| INV-05 | Số sự kiện nhật ký tăng đúng bằng số thao tác thay đổi thành công; thao tác lỗi không làm đổi dữ liệu. | Đã chốt | `INV_05` |
| INV-06 | Dữ liệu đầu vào không bị sửa. | Đã chốt | `INV_06` |
| INV-07 | normalizePhone lũy đẳng (chạy hai lần bằng chạy một lần); decodeCccd rồi đối chiếu luôn khớp với CCCD được sinh ra từ năm sinh và giới tính tương ứng. | Đã chốt | `INV_07` |
| INV-08 | Tên loại chứng chỉ duy nhất sau chuẩn hóa không phân biệt hoa thường và dấu, kể cả loại đã ẩn. | Đã chốt | `INV_08` |
| EXP-07 | Phiếu mẫu chỉ có 7 ô tick hệ thống; loại tự thêm không có ô tick và chỉ xuất hiện trong phần trang scan nếu được chọn. | Đã chốt | `EXP_07` |
| EXP-08 | Khi nhiều chứng chỉ hiện hành còn hạn của một loại cùng ngày hết hạn xa nhất, chọn title sau chuẩn hóa bỏ dấu, hạ chữ thường theo thứ tự mã ký tự tăng dần; nếu title chuẩn hóa bằng nhau thì chọn id theo thứ tự mã ký tự tăng dần. | Giả định | `EXP_08` |
