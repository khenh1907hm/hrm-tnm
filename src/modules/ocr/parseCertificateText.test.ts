import { describe, expect, it } from "vitest";
import { parseCertificateText } from "./parseCertificateText";

// Chữ giả lập đúng kiểu nhiễu Tesseract đọc từ giấy scan thật (số, tên đã thay bằng dữ liệu giả)
const ATLD_CARD = `CÔNG TY TNHH HUẢN LUYỆN  Ï Đặc lập - Tự do - Hạnh phúc
| THE AN TOÁN LAO ĐÔNG
¡ Hạ vả tên: NGUYỄN VĂN AN
| Sinh ngày: 01/01/1990
! „J- [Đã hoàn thành khỏa huấn luyện: Nhóm 3
| = l\\ | Antoàn làm việc trong công trình
| 2.1 IIR| xây dưng
| >- | {[Tuneay 2964209904 ngày 26/04/2025
Ị \\ A0289; SỔ ¡ [ ⁄4Te Hỗ ChrMftỒAngày 28/04/2025
| SỐ: 25E0139/2025/TẠTEĐ 7 . 6K an Truyền
Ị =—== | Thẻ này có giá trị đến ngày: 28/04/2027
Số: 25E0I59/2025/7T4TED SA -EY HN (ia Luận
Theo NI: 44/2016/ND-CP ngày 15/04/2016 Thẻ có giá trị đến ngày: 28/04/2027
Số: 25E06-044 /QD-HLATVN Tp. Hồ Chí Minh, ngày 28 tháng 04 năm 2025
Tổ chức từ ngày 24/04/2025 đến ngày 26/04/2025
#doclai so: S: 25E0159/2025/TATLD
#doclai so: SO: 25E0159/2025941
#doclai so: S: 25E0139/2025/TATED`;

const ATLD_HEIGHT = `THẺ AN TOÀN LAO ĐỌNG
¬Ÿ am Đã hoàn thành khóa huần luyện: Nhóm 3
_ An toàn làm việc trên cao
0 —. Từ ngày 29/05/2024 đến ngày 31/05/2024
: < 702592 Tp. Hỗ Chỉ Minh, ngày 01/06/2024
SÓ: 24FÙ0809/2024/TATLĐ 1... Hoãng Văn Truyền
Thẻ này có giá trị đến ngày: 01/06/2026
Số: 24F00809/20237P-4FEÈ
Số: 24F13-161 /QĐ-HLATVN Tp. Hỗ Chí Minh, ngày 01 tháng 06 năm 2024`;

const ATLD_GROUP1 = `GIẤY CHỨNG NHẬN HUẤN LUYỆN AN TOÀN, VỆ SINH LAO ĐỘNG
Na, Số 24F00815/N1/2024
#doclai so: SO 24F00815/N1/2024
thương trình khung huấn luyễn được xăy dưng thạn Hghị định.
Đối tượng huấn luyện: Nhóm 1
từ ngày 08 tháng 6 năm 2024 đến ngày 09 tháng 6 năm 2024
g9, Chứng nhận có giá trị 2 năm
từ ngày 10 tháng 6 năm 28 4 đến ngày 10 tháng 6 năm 2026 |
Zza” 5 THỢ là Chí Minh, ngày. 10 tháng 6 năm 2024`;

const ELECTRICAL = `CỤC AN TOÁN LAO ĐỌNG Họ tên: Trần Văn Bình
2 *ÔNG TỶ \\ Bậc an toản: 3/5. G
3 Cắp ngày: 12/09/2022. :
1 ,AN:TOÀN ĐIỆN O6 —
Số: 07/TTS/TATĐ
#doclai so: SO: 07/TTS/TATĐ
“4S °“PME Bệc an toàn -Z 3/5 SN`;

const CCCD = `#5 CĂNCƯỚC CÔNG DÁN GĐÓNH4 . MT N
s». 001090012345 ([L1.1JJ \\WØV
— Giới nh! Sex Nam Quốctich Việt Nam IDVNM09000123451001090012345<<1
hy v 9001011M5501014VNM<<<<<<<<<<<
lu LA. X Án : „ + | NGUYEN<<VAN<AN<<<<<<<<<<<<`;

const INSURANCE = `Số: P-25/BTA/P56/6201/000024
#doclai so: SO: P-25/BTA/P56/6201/000024
Hôm nay, ngày 26 tháng 12 năm 2025, tại Công ty Báo hiểm, chúng tôi
HỢP ĐỒNG BẢO HIỂM TAI NẠN CON NGƯỜI 24/24
Từ 00:00 h ngày 01/01/2026 đến 23:59 h ngày 31/12/2026. (0] Năm)`;

describe("parseCertificateText", () => {
  it("thẻ ATLĐ: số thẻ (sửa I→1, năm theo ngày cấp), hạn ở 'có giá trị đến ngày' chứ không phải thời gian học, nhóm và lĩnh vực", () => {
    expect(parseCertificateText(ATLD_CARD)).toEqual({
      kind: "atld", number: "25E0159/2025/TATLĐ", issueDate: "2025-04-28", expiryDate: "2027-04-28", safetyGroup: 3, title: "Nhóm 3 - Công trình xây dựng",
    });
    expect(parseCertificateText(ATLD_HEIGHT)).toEqual({
      kind: "atld", number: "24F00809/2024/TATLĐ", issueDate: "2024-06-01", expiryDate: "2026-06-01", safetyGroup: 3, title: "Nhóm 3 - Làm việc trên cao",
    });
  });

  it("giấy chứng nhận ATLĐ Nhóm 1: hạn viết bằng chữ, 'được xây dựng theo' không bị hiểu là lĩnh vực xây dựng", () => {
    expect(parseCertificateText(ATLD_GROUP1)).toEqual({
      kind: "atld", number: "24F00815/N1/2024", issueDate: "2024-06-10", expiryDate: "2026-06-10", safetyGroup: 1, title: "Nhóm 1",
    });
  });

  it("thẻ an toàn điện: số, bậc an toàn kể cả khi OCR đọc 'Bệc', ngày cấp; không tự bịa hạn", () => {
    expect(parseCertificateText(ELECTRICAL)).toEqual({ kind: "elec", number: "07/TTS/TATĐ", issueDate: "2022-09-12", title: "Bậc 3/5" });
  });

  it("CCCD: số 12 chữ số, hạn lấy từ dòng MRZ, sửa 1 chữ số OCR đọc nhầm nhờ chữ số kiểm tra và ngày-tháng sinh", () => {
    // MRZ đúng: ngày sinh 900101 (kiểm tra 1), hạn 350101 (kiểm tra 4); OCR đọc nhầm hạn thành 550101
    const parsed = parseCertificateText(CCCD);
    expect(parsed.kind).toBe("custom-ctype-cccd");
    expect(parsed.number).toBe("001090012345");
    expect(parsed.expiryDate).toBe("2035-01-01");
  });

  it("CCCD: ngày cấp ở mặt sau (dòng 'Date, month, year' do bước đọc lại vùng mặt sau thêm vào); đọc nhầm ra ngày tương lai thì bỏ", () => {
    expect(parseCertificateText(`${CCCD}
Date, month, year: 04/10/2022`, { today: "2026-10-23" }).issueDate).toBe("2022-10-04");
    // Ảnh mờ: OCR đọc 2022 thành 2027 → ngày cấp ở tương lai → không điền
    expect(parseCertificateText(`${CCCD}
Date, month, year: 04/10/2027`, { today: "2026-10-23" }).issueDate).toBeUndefined();
    // Trước năm 2016 chưa có CCCD → đọc nhầm
    expect(parseCertificateText(`${CCCD}
Date, month, year: 04/10/2012`, { today: "2026-10-23" }).issueDate).toBeUndefined();
  });

  it("hợp đồng bảo hiểm: số hợp đồng, thời hạn bảo hiểm từ … đến …", () => {
    expect(parseCertificateText(INSURANCE)).toEqual({ kind: "ins", number: "P-25/BTA/P56/6201/000024", issueDate: "2026-01-01", expiryDate: "2026-12-31" });
  });

  it("chữ viết tay / không nhận ra: bỏ trống, không đoán", () => {
    expect(parseCertificateText("GIÁY KHÁM SỨC KHỎE\nSố: mm _/GKSK-BVDKTMT\nTP.HCM. ngày 35 tháng Co... năm. 2É")).toEqual({ kind: "health" });
    expect(parseCertificateText("KẾT QUẢ XÉT NGHIỆM\nNhóm máu ABO")).toEqual({ kind: null });
    expect(parseCertificateText("SỐ C 968226. /GD-DT\n#doclai so: SO C 968226\nTrung học chuyên nghiệp\ntot nghiep hang")).toEqual({ kind: "custom-ctype-degree", number: "C 968226" });
  });

  it("đọc lại dòng số mất dấu '/' (25E0I592025) vẫn tách đúng mã và năm, bỏ phiếu thắng bản in đọc nhầm", () => {
    const rereads = "\n#doclai so: 25E0I592023PTTTP. A0 G L\n#doclai so: 25E0I592025PTTTP X L\n#doclai so: 25E0I592025 TT X L";
    const card = `THẺ AN TOÀN LAO ĐỘNG Nhóm 3\nTp. Hồ Chí Minh, ngày 28/04/2025\n| SỐ: 25E0139/2025/TẠTEĐ\nSố: 25E0I59/2025/7T4TED${rereads}`;
    expect(parseCertificateText(card).number).toBe("25E0159/2025/TATLĐ");
    // Lượt đọc cả trang chỉ có bản đọc nhầm (0139): các lần đọc lại không có nguồn độc lập xác nhận → để trống
    expect(parseCertificateText(`THẺ AN TOÀN LAO ĐỘNG Nhóm 3\nTp. Hồ Chí Minh, ngày 28/04/2025\n| SỐ: 25E0139/2025/TẠTEĐ${rereads}`).number).toBeUndefined();
    const insurance = "HỢP ĐỒNG BẢO HIỂM\nSố: P-25/BTA/P56/6201/000024\n#doclai so: P-25/BTA/P56/6201/000024";
    expect(parseCertificateText(insurance).number).toBe("P-25/BTA/P56/6201/000024");
  });

  it("chỉ điền khi các lần đọc khớp nhau: một lần đọc, đọc lệch nhau, ngày ở hai bản in lệch nhau thì để trống", () => {
    // Bằng tốt nghiệp: OCR đọc 968220 / 969220 / 989220 (đúng là 968226) → không lần nào khớp → để trống
    expect(parseCertificateText("SỐ C 968220. /GD-DT\n#doclai so: 6C 969220 /6\n#doclai so: SO C 989220\ntot nghiep hang").number).toBeUndefined();
    // Hai lần đọc lại cùng nhầm giống nhau nhưng lượt đọc cả trang ra số khác → không đủ hai nguồn độc lập → để trống
    expect(parseCertificateText("SỐ C 968220. /GD-DT\n#doclai so: C 969220\n#doclai so: C 969220\ntot nghiep hang").number).toBeUndefined();
    // Thẻ ATLĐ chỉ có hai lần đọc khác nhau, không có lần đọc lại → hòa → để trống; hạn ở hai bản in lệch nhau → để trống
    const split = parseCertificateText("THẺ AN TOÀN LAO ĐỘNG Nhóm 3\nSỐ: 25E0139/2025/TATLĐ\nSố: 25E0159/2025/TATLĐ\nThẻ này có giá trị đến ngày: 28/04/2027\nThẻ có giá trị đến ngày: 28/04/2023");
    expect(split.number).toBeUndefined();
    expect(split.expiryDate).toBeUndefined();
    // Số CCCD không khớp số trong dòng MRZ và chỉ đọc được một lần → để trống
    expect(parseCertificateText("CĂN CƯỚC CÔNG DÂN\nSố: 001090012345\nIDVNM09000123451001090012399<<1").number).toBeUndefined();
  });
});
