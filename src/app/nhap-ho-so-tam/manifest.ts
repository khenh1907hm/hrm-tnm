// TẠM: dữ liệu nhập hồ sơ 3 nhân sự (đợt Vinci 27/10/2026). Xóa cả thư mục nhap-ho-so-tam sau khi nhập xong.
import type { EmployeeInput } from "../../modules/employees/types";

export type ImportCert = {
  /** Khóa loại chứng chỉ; "labor" = loại "Hợp đồng lao động" (tạo nếu chưa có). */
  type: string; title: string; number: string; issueDate: string | null; expiryDate: string | null; safetyGroup?: number;
  /** Đường dẫn tệp tính từ thư mục Ho-so được chọn. */
  file: string;
};
export type ImportEmployee = { input: EmployeeInput; certs: ImportCert[] };

const V = "2026-1027 - Vinci";
const BH = { type: "ins", title: "Bảo hiểm tai nạn 24/24 PJICO (kèm hóa đơn thanh toán)", number: "P-25/BTA/P56/6201/000024", issueDate: "2025-12-26", expiryDate: "2026-12-31", file: `${V}/BH 24/2025-1226 - PJICO-BT_P-26.BTA.P56.6201.000024.pdf` };

export const LABOR_TYPE = { name: "HĐLĐ", englishName: "Labor contract" };

export const IMPORT_EMPLOYEES: ImportEmployee[] = [
  {
    input: { code: "TNM0018", name: "Trần Ngọc Đức", dob: "1983-02-19", gender: "Nam", cccd: "049083019184", phone: "0919047099", home: "Quế Long, Quế Sơn, Quảng Nam", address: "Tổ 9, khu phố 4, Long Bình, Thành phố Biên Hòa, Đồng Nai", currentAddress: "", position: "Nhân viên hiện trường", group: null, startDate: "2006-11-27", companyStartDate: "2023-01-01", emergencyContactId: null, status: "active", endDate: null },
    certs: [
      { type: "custom-ctype-cccd", title: "CMND cũ (đã đổi sang CCCD 049083019184)", number: "272765636", issueDate: "2015-06-29", expiryDate: "2024-12-31", file: `${V}/ID/TNM0018CM-Tran Ngoc Duc - 2015-0629.jpg` },
      { type: "labor", title: "Không xác định thời hạn", number: "009/TNM-2023", issueDate: "2023-01-01", expiryDate: null, file: `${V}/Labor/TNM0018HD-Tran Ngoc Duc - 2023-0101 - KXDTH.pdf` },
      { type: "health", title: "Mẫu 03 TT 32/2023 VietMedi - Sức khỏe loại II", number: "10/GKSK-260817D0043", issueDate: "2026-08-29", expiryDate: "2027-08-29", file: `${V}/KSK/TNM0018K-Tran Ngoc Duc - 2026-0829.pdf` },
      { type: "atld", safetyGroup: 3, title: "Nhóm 3 - An toàn trong lĩnh vực điện", number: "25C2665/2025/TATLĐ", issueDate: "2025-03-13", expiryDate: "2027-03-13", file: `${V}/AT - dien/TNM0018ATD-Tran Ngoc Duc - 2027-0313.pdf` },
      { type: "atld", safetyGroup: 3, title: "Nhóm 3 - An toàn làm việc trên cao", number: "26E11924/2026/TATLĐ", issueDate: "2026-05-25", expiryDate: "2028-05-25", file: `${V}/AT - tren cao/TNM0018ATTC-Tran Ngoc Duc - 2028-0525.pdf` },
      { type: "atld", safetyGroup: 3, title: "Nhóm 3 - An toàn làm việc trong công trình xây dựng", number: "25E0161/2025/TATLĐ", issueDate: "2025-04-28", expiryDate: "2027-04-28", file: `${V}/AT - xay dung/TNM0018ATXD-Tran Ngoc Duc - 2027-0428.pdf` },
      { ...BH },
      { type: "custom-ctype-degree", title: "Bằng nghề Điện công nghiệp bậc 4/7 (2003-2006)", number: "000813547/LĐTBXH-DN", issueDate: "2006-11-27", expiryDate: null, file: "Bang cap/TNM0018BN_DCN-Tran Ngoc Duc - 2006-1130.pdf" },
    ],
  },
  {
    input: { code: "TNM0848", name: "Phan Đức Phi", dob: "2002-12-25", gender: "Nam", cccd: "064202007614", phone: "0325740054", home: "Tuy Phước, Bình Định", address: "Tổ 1, Tây Sơn, Thị xã An Khê, Gia Lai", currentAddress: "", position: "Nhân viên hiện trường", group: null, startDate: "2022-10-10", companyStartDate: "2023-02-01", emergencyContactId: null, status: "active", endDate: null },
    certs: [
      { type: "custom-ctype-cccd", title: "", number: "064202007614", issueDate: "2022-01-23", expiryDate: "2027-12-25", file: `${V}/ID/TNM0848CM-Phan Duc Phi - 2022-0123.jpg` },
      { type: "labor", title: "Không xác định thời hạn", number: "200/TNM-2023", issueDate: "2023-02-01", expiryDate: null, file: `${V}/Labor/TNM0848HD-Phan Duc Phi - 2023-0101 - KXDTH.pdf` },
      { type: "health", title: "Mẫu 03 TT 32/2023 VietMedi - Sức khỏe loại II", number: "21/GKSK-260817D0054", issueDate: "2026-09-04", expiryDate: "2027-09-04", file: `${V}/KSK/TNM0848K-Phan Duc Phi - 2026-0904.pdf` },
      { type: "atld", safetyGroup: 3, title: "Nhóm 3 - An toàn trong lĩnh vực điện", number: "25E2170/2025/TATLĐ", issueDate: "2025-05-12", expiryDate: "2027-05-12", file: `${V}/AT - dien/TNM0848ATD-Phan Duc Phi - 2027-0512.pdf` },
      { type: "atld", safetyGroup: 3, title: "Nhóm 3 - An toàn làm việc trên cao", number: "26I2528/2026/TATLĐ", issueDate: "2026-09-07", expiryDate: "2028-09-07", file: `${V}/AT - tren cao/TNM0848ATTC-Phan Duc Phi - 2028-0907.pdf` },
      { type: "atld", safetyGroup: 3, title: "Nhóm 3 - An toàn làm việc trong xây dựng", number: "26I2520/2026/TATLĐ", issueDate: "2026-09-10", expiryDate: "2028-09-10", file: `${V}/AT - xay dung/TNM0848ATXD-Phan Duc Phi - 2028-0910.pdf` },
      { ...BH },
    ],
  },
  {
    input: { code: "TNM0138", name: "Nguyễn Hữu Thi", dob: "1984-04-03", gender: "Nam", cccd: "082084027018", phone: "0934847401", home: "Bình Phục Nhứt, Chợ Gạo, Tiền Giang", address: "Ấp Bình Khương II, Bình Phục Nhứt, Chợ Gạo, Tiền Giang", currentAddress: "", position: "Nhân viên kỹ thuật", group: null, startDate: "2009-03-14", companyStartDate: "2023-01-01", emergencyContactId: null, status: "active", endDate: null },
    certs: [
      { type: "custom-ctype-cccd", title: "", number: "082084027018", issueDate: "2024-07-31", expiryDate: "2044-04-03", file: `${V}/ID/TNM0138CM-Nguyen Huu Thi - 2024-0731.jpg` },
      { type: "labor", title: "Không xác định thời hạn", number: "142/TNM-2023", issueDate: "2023-01-01", expiryDate: null, file: `${V}/Labor/TNM0138HD-Nguyen Huu Thi - 2023-0101 - KXDTH.pdf` },
      { type: "health", title: "Mẫu 03 TT 32/2023 VietMedi - Sức khỏe loại I", number: "36/GKSK-260817D0069", issueDate: "2026-08-20", expiryDate: "2027-08-20", file: `${V}/KSK/TNM0138K-Nguyen Huu Thi - 2026-0820.pdf` },
      { type: "atld", safetyGroup: 3, title: "Nhóm 3 - An toàn trong lĩnh vực điện", number: "26C2049/2026/TATLĐ", issueDate: "2026-03-02", expiryDate: "2028-03-02", file: `${V}/AT - dien/TNM0138ATD-Nguyen Huu Thi - 2028-0302.pdf` },
      { type: "atld", safetyGroup: 3, title: "Nhóm 3 - An toàn làm việc trên cao", number: "26C2066/2026/TATLĐ", issueDate: "2026-03-04", expiryDate: "2028-03-04", file: `${V}/AT - tren cao/TNM0138ATTC-Nguyen Huu Thi - 2028-0304.pdf` },
      { type: "atld", safetyGroup: 3, title: "Nhóm 3 - An toàn làm việc trong công trình xây dựng", number: "25E0156/2025/TATLĐ", issueDate: "2025-04-28", expiryDate: "2027-04-28", file: `${V}/AT - xay dung/TNM0138ATXD-Nguyen Huu Thi - 2027-0428.pdf` },
      { ...BH },
      { type: "custom-ctype-degree", title: "Kỹ sư điện - Điện công nghiệp (bản sao)", number: "A 0124197", issueDate: "2009-03-14", expiryDate: null, file: "_bo-sung-nhap/TNM0138BC_DCN-Nguyen Huu Thi - 2009-0314 (nen).pdf" },
    ],
  },
];
