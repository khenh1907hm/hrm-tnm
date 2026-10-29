/**
 * Mã tỉnh/thành phố ở 3 số đầu của CCCD (Phụ lục Thông tư 07/2016/TT-BCA), nơi đăng ký khai sinh.
 * Tên giữ theo 63 tỉnh lúc cấp mã: sáp nhập tỉnh năm 2025 không đổi số CCCD đã cấp.
 */
export const PROVINCE_NAMES: Readonly<Record<string, string>> = {
  "001": "Hà Nội", "002": "Hà Giang", "004": "Cao Bằng", "006": "Bắc Kạn", "008": "Tuyên Quang",
  "010": "Lào Cai", "011": "Điện Biên", "012": "Lai Châu", "014": "Sơn La", "015": "Yên Bái",
  "017": "Hòa Bình", "019": "Thái Nguyên", "020": "Lạng Sơn", "022": "Quảng Ninh", "024": "Bắc Giang",
  "025": "Phú Thọ", "026": "Vĩnh Phúc", "027": "Bắc Ninh", "030": "Hải Dương", "031": "Hải Phòng",
  "033": "Hưng Yên", "034": "Thái Bình", "035": "Hà Nam", "036": "Nam Định", "037": "Ninh Bình",
  "038": "Thanh Hóa", "040": "Nghệ An", "042": "Hà Tĩnh", "044": "Quảng Bình", "045": "Quảng Trị",
  "046": "Thừa Thiên Huế", "048": "Đà Nẵng", "049": "Quảng Nam", "051": "Quảng Ngãi", "052": "Bình Định",
  "054": "Phú Yên", "056": "Khánh Hòa", "058": "Ninh Thuận", "060": "Bình Thuận", "062": "Kon Tum",
  "064": "Gia Lai", "066": "Đắk Lắk", "067": "Đắk Nông", "068": "Lâm Đồng", "070": "Bình Phước",
  "072": "Tây Ninh", "074": "Bình Dương", "075": "Đồng Nai", "077": "Bà Rịa - Vũng Tàu", "079": "TP. Hồ Chí Minh",
  "080": "Long An", "082": "Tiền Giang", "083": "Bến Tre", "084": "Trà Vinh", "086": "Vĩnh Long",
  "087": "Đồng Tháp", "089": "An Giang", "091": "Kiên Giang", "092": "Cần Thơ", "093": "Hậu Giang",
  "094": "Sóc Trăng", "095": "Bạc Liêu", "096": "Cà Mau",
};

export const PROVINCE_CODES: ReadonlySet<string> = new Set(Object.keys(PROVINCE_NAMES));

/** Tên tỉnh theo 3 số đầu của số CCCD (đang gõ dở cũng được), null khi chưa đủ 3 số hoặc mã không có. */
export function provinceOfCccd(value: string): string | null {
  const code = value.trim().slice(0, 3);
  return /^\d{3}$/.test(code) ? PROVINCE_NAMES[code] ?? null : null;
}
