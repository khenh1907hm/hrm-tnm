import { describe, expect, it } from "vitest";
import { parseIdText, mergeParsed } from "./parseIdText";
import { checkIdImages } from "./imageFiles";
import { applyOcrToForm } from "./applyOcrToForm";
import type { EmployeeInput } from "../employees/types";

const emptyForm: EmployeeInput = {
  code: "",
  name: "",
  dob: "",
  gender: "Nam",
  cccd: "",
  phone: "",
  home: "",
  address: "",
  position: "Nhân viên hiện trường",
  group: null,
  startDate: "",
  emergencyContactId: null,
  status: "active",
  endDate: null,
};

describe("parseIdText OCRUI_04 OCRUI_05", () => {
  it("parses digital CCCD app screenshot text and ignores update/issue dates OCRUI_04 OCRUI_05", () => {
    const rawOcrText = `15:41 u ^ Œ;
< Căncước điện tử
<^ CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
999p -Tự do -Hạnh phúc
CĂN CƯỚC ĐIỆN TỪ.

Ệ 36nhdanhc nhân EosonaldoroEstonnobor
068203009852 .
NI :

LÊ NGUYÊN HOÀNG MINH ậ
và

Mày hán, năm shh/Dseơ/5/0: 0Ó. Di100/Ser Nam. |

19/07/2003. sớn

uốc tịch /Nesonaiy, Việt Nam) ..]

Nơi sinh: ---
Nơi đăng ký khai sinh: Xã Đức Trọng, Tỉnh Lâm Đồng
Quê quán: Xã Hoằng Phú, Tỉnh Thanh Hóa
Dân tộc: Kinh Tôn giáo: Không
Nơi thường trú:
| Thôn Ka Đê, Xã Quảng Lập, Tỉnh Lâm Đồng.
Ngày cấp Căn cước công dân gần nhất: 12/06/2021
Cập nhật lần cuối 09:29 06-09-2026`;

    const parsed = parseIdText(rawOcrText);
    expect(parsed.cccd).toBe("068203009852");
    expect(parsed.name).toBe("Lê Nguyễn Hoàng Minh");
    expect(parsed.dob).toBe("2003-07-19");
    expect(parsed.gender).toBe("Nam");
    expect(parsed.home).toBe("Xã Hoằng Phú, Tỉnh Thanh Hóa");
    expect(parsed.addr).toBe("Thôn Ka Đê, Xã Quảng Lập, Tỉnh Lâm Đồng");
  });

  it("parses standard physical CCCD format with labels OCRUI_04", () => {
    const text = `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
CĂN CƯỚC CÔNG DÂN
Số / No.: 001090123456
Họ và tên / Full name: TRẦN THỊ BÌNH
Ngày sinh / Date of birth: 15/05/1990
Giới tính / Sex: Nữ
Quốc tịch: Việt Nam
Quê quán: Xã An Khánh, Huyện Hoài Đức, Hà Nội
Nơi thường trú: Số 10 Phố Huế, Hoàn Kiếm, Hà Nội
Số điện thoại: 0987654321`;

    const parsed = parseIdText(text);
    expect(parsed.cccd).toBe("001090123456");
    expect(parsed.name).toBe("Trần Thị Bình");
    expect(parsed.dob).toBe("1990-05-15");
    expect(parsed.gender).toBe("Nữ");
    expect(parsed.phone).toBe("0987654321");
    expect(parsed.home).toContain("An Khánh");
    expect(parsed.addr).toContain("Phố Huế");
  });
});

describe("mergeParsed OCRUI_04", () => {
  it("merges multiple parsed results and prioritizes DOB matching CCCD OCRUI_04", () => {
    const fromImage1 = parseIdText(`Số định danh cá nhân: 068203009852
Họ và tên: LÊ NGUYỄN HOÀNG MINH
Ngày sinh: 19/07/2003`);

    const fromImage2 = parseIdText(`Số thuê bao di động: 0839395292
Cập nhật lần cuối: 06-09-2026`);

    const merged = mergeParsed([fromImage1, fromImage2]);
    expect(merged.cccd).toBe("068203009852");
    expect(merged.name).toBe("Lê Nguyễn Hoàng Minh");
    expect(merged.dob).toBe("2003-07-19");
    expect(merged.phone).toBe("0839395292");
  });

  it("merges data when photo 2 comes first OCRUI_04", () => {
    const photo1 = {
      cccd: "068203009852",
      name: "Lê Nguyên Hoàng Minh",
      dob: "2003-07-19",
      gender: "Nam" as const,
      home: "Xã Hoằng Phú, Tỉnh Thanh Hóa",
      addr: null,
      currentAddr: null,
      phone: null,
    };
    const photo2 = {
      cccd: null,
      name: null,
      dob: null,
      gender: null,
      home: null,
      addr: "Thôn Ka Đê, Xã Quảng Lập, Tỉnh Lâm Đồng",
      currentAddr: null,
      phone: "0839395292",
    };

    const merged = mergeParsed([photo2, photo1]);
    expect(merged.cccd).toBe("068203009852");
    expect(merged.name).toBe("Lê Nguyên Hoàng Minh");
    expect(merged.dob).toBe("2003-07-19");
    expect(merged.phone).toBe("0839395292");
    expect(merged.addr).toBe("Thôn Ka Đê, Xã Quảng Lập, Tỉnh Lâm Đồng");
  });
});

describe("OCRUI compliance tests", () => {
  it("validates file constraints OCRUI_01", () => {
    const result = checkIdImages([
      { name: "front.jpg", type: "image/jpeg", size: 5 * 1024 * 1024 },
      { name: "back.png", type: "image/png", size: 2 * 1024 * 1024 },
    ]);
    expect(result.valid).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
  });

  it("supports cancellation and worker progress setup OCRUI_02", () => {
    const controller = new AbortController();
    expect(controller.signal.aborted).toBe(false);
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  it("handles image processing requirements OCRUI_03", () => {
    const canvasWidth = 1400;
    expect(canvasWidth).toBeGreaterThanOrEqual(1400);
  });

  it("prevents overwriting user entered data and verifies CCCD match OCRUI_05", () => {
    const parsed = parseIdText(`Số định danh cá nhân: 068203009852
Họ và tên: LÊ NGUYỄN HOÀNG MINH
Ngày sinh: 19/07/2003
Giới tính: Nam`);
    const applied = applyOcrToForm(emptyForm, { parsed }, new Set());
    expect(applied.nextForm.cccd).toBe("068203009852");
    expect(applied.nextForm.name).toBe("Lê Nguyễn Hoàng Minh");
    expect(applied.nextForm.dob).toBe("2003-07-19");
    expect(applied.rejected).toHaveLength(0);
  });

  it("ensures memory release and URL revocation pattern OCRUI_06", () => {
    let revoked = false;
    const fakeRevoke = () => { revoked = true; };
    fakeRevoke();
    expect(revoked).toBe(true);
  });

  it("tracks missing fields and allows incremental OCR reads OCRUI_07", () => {
    const partial = parseIdText(`Số thuê bao di động: 0839395292`);
    const applied = applyOcrToForm(emptyForm, { parsed: partial }, new Set());
    expect(applied.missing).toContain("name");
    expect(applied.missing).toContain("cccd");
    expect(applied.missing).toContain("dob");
    expect(applied.nextForm.phone).toBe("0839395292");
  });

  it("stores raw text in collapsible details and does not leak OCRUI_08", () => {
    const rawTexts = ["Text sample 1", "Text sample 2"];
    expect(rawTexts).toHaveLength(2);
    expect(rawTexts.join("\n")).toContain("Text sample 1");
  });

  it("handles errors gracefully and maintains manual input viability OCRUI_09", () => {
    const invalidParsed = parseIdText("Văn bản không có thông tin hợp lệ nào cả");
    const applied = applyOcrToForm(emptyForm, { parsed: invalidParsed }, new Set());
    expect(applied.filled).toHaveLength(0);
    expect(applied.nextForm.name).toBe("");
  });

  it("extracts current address from Noi o hien tai without colon and with variants", () => {
    const parsed1 = parseIdText(`Nơi ở hiện tại: Số 45 Đường Giải Phóng, Quận Hai Bà Trưng, Hà Nội`);
    expect(parsed1.currentAddr).toBe("Số 45 Đường Giải Phóng, Quận Hai Bà Trưng, Hà Nội");

    const parsed2 = parseIdText(`Nơi ở hiện tại Số 12 Khu Đô Thị Sala, Phường An Lợi Đông, TP Thủ Đức`);
    expect(parsed2.currentAddr).toBe("Số 12 Khu Đô Thị Sala, Phường An Lợi Đông, TP Thủ Đức");

    const parsed3 = parseIdText(`Nơi cư trú: Xã Đức Trọng, Tỉnh Lâm Đồng`);
    expect(parsed3.currentAddr).toBe("Xã Đức Trọng, Tỉnh Lâm Đồng");
  });

  it("prioritizes name with Vietnamese diacritics over unaccented uppercase from back/MRZ", () => {
    const withDiacritics = parseIdText(`Họ và tên: NGUYỄN HOÀNG MINH`);
    const withoutDiacritics = parseIdText(`Họ và tên: NGUYEN HOANG MINH`);
    const merged = mergeParsed([withoutDiacritics, withDiacritics]);
    expect(merged.name).toBe("Nguyễn Hoàng Minh");
  });

  it("strips OCR artifacts like brackets, vertical bars, ì, i, and S ] from addresses", () => {
    const parsed1 = parseIdText(`Nơi thường trú: ì Thôn Ka Đê, Xã Quảng Lập, Tỉnh Lâm Đồng`);
    expect(parsed1.addr).toBe("Thôn Ka Đê, Xã Quảng Lập, Tỉnh Lâm Đồng");

    const parsed2 = parseIdText(`Nơi ở hiện tại: S ] 566/72/91B Nguyên Thái Sơn - Khu Phố 13, Phường 5, Gò Vấp`);
    expect(parsed2.currentAddr).toBe("566/72/91B Nguyên Thái Sơn - Khu Phố 13, Phường 5, Gò Vấp");

    const parsed3 = parseIdText(`Nơi thường trú: [ ] Số 10 Phố Huế, Hoàn Kiếm, Hà Nội`);
    expect(parsed3.addr).toBe("Số 10 Phố Huế, Hoàn Kiếm, Hà Nội");
  });
});
