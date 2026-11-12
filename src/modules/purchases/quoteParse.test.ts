import { describe, expect, it } from "vitest";
import { parseNumber, parseQuoteRows } from "./quoteParse";

/** Chữ lấy từ báo giá Nam Long (PO 9058221): tên hàng nằm ở dòng trên và dưới dòng số (ô gộp căn giữa). */
const NAM_LONG = [
  ["CÔNG TY TNHH VIỄN TIN NAM LONG"],
  ["MST: 0304153720"],
  ["Tài khoản:", "16879219", "Ngân hàng Á Châu ACB,", "CN Phan Đăng Lưu"],
  ["205/5 Thích Quảng Đức, Phường Đức Nhuận, Hồ Chí Minh, Việt Nam"],
  ["Điện thoại:", "84-8-7309 6168 - 39955880", "-", "Fax: 84-8-39973174"],
  ["Email:", "info@namlong.vn", "-", "Website:", "www.namlong.vn"],
  ["BÁO GIÁ / QUOTATION"],
  ["Đơn Đặt Hàng", "/ Purchase Oder"],
  ["Ngày phát hành báo giá (Date): 12/11/2026"],
  ["Kính gửi:", "Nguyễn Văn A - CÔNG TY TNHH THIÊN NHẬT MINH", "Số P.O (P.O Number): 9058221"],
  ["Địa chỉ:", "Địa chỉ TNM", "Người gởi (Sender):", "Kinh Doanh"],
  ["Điện thoại:", "0900000000", "Fax:", "Phone:", "0938473168"],
  ["Email:", "nhanvien@thiennhatminh.com", "Mã số thuế:", "0303590774", "Email:", "info@namlong.vn"],
  ["Chúng tôi xin chân thành cám ơn", "Quý Khách hàng đã quan tâm đến thiết bị/dịch vụ của chúng tôi."],
  ["SỐ", "ĐƠN GIÁ", "THÀNH TIỀN"],
  ["STT", "HÌNH ẢNH", "TÊN SẢN PHẨM", "ĐƠN VỊ"],
  ["LƯỢNG", "(VNĐ)", "(VNĐ)"],
  ["Cáp tín hiệu chống nhiễu Shielded twisted Benka 1x2x18"],
  ["1", "Mét", "200", "21,600", "4,320,000"],
  ["AWG 2 x 1.5mm (Benka 177 1218)"],
  ["TỔNG CỘNG (VNĐ)", "4,320,000"],
  ["Điều khoản thương mại:"],
  ["Đơn giá trên đã bao gồm thuế", "GTGT (", "8%-10% tuỳ ngành hàng, p", "hần mềm, license, .. không chịu thuế)"],
  ["Hình thức thanh toán chuyển khoản 100% ngay sau khi đặt", "hàng hoặc thỏa thuận", "hợp đồng."],
  ["Giao hàng: 01-02 ngày kể từ ngày xác nhận đặt hàng (cho những mặt hàng có sẵn trong kho)"],
  ["Công ty TNHH Viễn Tin Nam Long"],
  ["Phòng kinh doanh", "Chức vu:____________________"],
  ["Cellphone:", "0938 473 168"],
  ["Email:", "kinhdoanh@namlong.vn"],
];

describe("parseNumber", () => {
  it("đọc số kiểu VN và quốc tế", () => {
    expect(parseNumber("21,600")).toBe(21600);
    expect(parseNumber("4.320.000")).toBe(4320000);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("200")).toBe(200);
    expect(parseNumber("1.5")).toBe(1.5);
    expect(parseNumber("Mét")).toBeNull();
  });
});

describe("parseQuoteRows (báo giá Nam Long)", () => {
  const result = parseQuoteRows(NAM_LONG);
  it("nhận đúng NCC, MST, số và ngày báo giá, liên hệ", () => {
    expect(result.supplier).toBe("CÔNG TY TNHH VIỄN TIN NAM LONG");
    expect(result.taxCode).toBe("0304153720");
    expect(result.quoteNo).toBe("9058221");
    expect(result.quoteDate).toBe("2026-11-12");
    expect(result.contact).toContain("0938 473 168");
    expect(result.contact).toContain("kinhdoanh@namlong.vn");
  });
  it("ghép tên hàng ở dòng trên và dưới, tách quy cách trong ngoặc", () => {
    expect(result.items).toEqual([{ name: "Cáp tín hiệu chống nhiễu Shielded twisted Benka 1x2x18 AWG 2 x 1.5mm", spec: "Benka 177 1218", unit: "Mét", quantity: 200, unitPrice: 21600, amount: 4320000 }]);
  });
  it("tổng, VAT đã gồm, thanh toán trước, giao hàng; đủ tin cậy", () => {
    expect(result.total).toBe(4320000);
    expect(result.vatIncluded).toBe(true);
    expect(result.prepay).toBe(true);
    expect(result.advancePct).toBeNull();
    expect(result.deliveryText).toContain("01-02 ngày");
    expect(result.confident).toBe(true);
  });
  it("tạm ứng 30% và tổng không khớp thì không tin cậy", () => {
    const other = parseQuoteRows([["CÔNG TY CP ABC"], ["STT", "Tên hàng", "ĐVT", "SL", "Đơn giá", "Thành tiền"], ["1", "Ống đồng", "m", "10", "100.000", "1.000.000"], ["Tổng cộng", "2.000.000"], ["Thanh toán: tạm ứng 30% khi đặt hàng"]]);
    expect(other.items).toHaveLength(1);
    expect(other.advancePct).toBe(30);
    expect(other.confident).toBe(false);
  });
});
