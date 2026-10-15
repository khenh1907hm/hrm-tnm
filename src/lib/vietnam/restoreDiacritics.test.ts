import { describe, expect, it } from "vitest";
import { restoreAddressDiacritics, restoreNameDiacritics } from "./restoreDiacritics";

describe("restoreNameDiacritics", () => {
  it("restores common surnames, middle names and unambiguous given names", () => {
    expect(restoreNameDiacritics("NGUYEN VAN AN")).toBe("NGUYỄN VĂN AN");
    expect(restoreNameDiacritics("Tran Thi Huong")).toBe("Trần Thị Hương");
    expect(restoreNameDiacritics("LE DUC TUAN")).toBe("LÊ ĐỨC TUẤN");
  });

  it("leaves ambiguous given names and words that already carry tones", () => {
    expect(restoreNameDiacritics("NGUYEN VAN HUNG")).toBe("NGUYỄN VĂN HUNG");
    expect(restoreNameDiacritics("Phạm Thanh Hùng")).toBe("Phạm Thanh Hùng");
    expect(restoreNameDiacritics("Lê Nguyên Hoàng")).toBe("Lê Nguyên Hoàng");
  });
});

describe("restoreAddressDiacritics", () => {
  it("restores administrative words and province names", () => {
    expect(restoreAddressDiacritics("Xa Hoang Phu, Tinh Thanh Hoa")).toBe("Xã Hoang Phu, Tỉnh Thanh Hóa");
    expect(restoreAddressDiacritics("THON KA DE, XA QUANG LAP, TINH LAM DONG")).toBe("THÔN KA DE, XÃ QUANG LAP, TỈNH LÂM ĐỒNG");
    expect(restoreAddressDiacritics("to 5, khu pho 3, thi tran Lien Nghia")).toBe("tổ 5, khu phố 3, thị trấn Lien Nghia");
  });

  it("keeps words OCR already read with tones and words outside the dictionary", () => {
    expect(restoreAddressDiacritics("Khu Phố 13, Phường 5, Gò Vấp")).toBe("Khu Phố 13, Phường 5, Gò Vấp");
    expect(restoreAddressDiacritics("Đường Phương Mai, Phường 5")).toBe("Đường Phương Mai, Phường 5");
    expect(restoreAddressDiacritics("Phường Thái Nguyên Hà, Huế")).toBe("Phường Thái Nguyên Hà, Huế");
  });
});

describe("restoreAddressDiacritics with wrong tones", () => {
  it("fixes multi-word places and administrative words that start a segment", () => {
    expect(restoreAddressDiacritics("Khu Phô 9, Phưỡng An Nhơn, Thành phô Hô Chí Minh")).toBe("Khu Phố 9, Phường An Nhơn, Thành phố Hồ Chí Minh");
    expect(restoreAddressDiacritics("Xã Quảng Lập, Tỉnh Lâm Đông")).toBe("Xã Quảng Lập, Tỉnh Lâm Đồng");
  });

  it("restores Nguyễn at the start of a street name only", () => {
    expect(restoreAddressDiacritics("566/72/91B Nguyên Thái Sơn")).toBe("566/72/91B Nguyễn Thái Sơn");
    expect(restoreAddressDiacritics("Tỉnh Thái Nguyên")).toBe("Tỉnh Thái Nguyên");
    expect(restoreAddressDiacritics("Xóm Nguyên")).toBe("Xóm Nguyên");
  });
});

