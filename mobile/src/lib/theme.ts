/**
 * Giao diện "Sunrise" theo bảng màu đồng phục TNM (đã chốt):
 * xanh da trời chủ đạo, navy chữ, cam nút chính, đen thẻ nổi bật, hồng đỏ điểm nhấn, trắng.
 */
export const colors = {
  sky: "#6EC1F5",
  skyDeep: "#1B4FB8",
  skyTint: "#E1F2FD",
  navy: "#0B1F66",
  orange: "#FF6B00",
  black: "#121418",
  rose: "#FF2E6E",
  white: "#FFFFFF",

  bg: "#F4F9FF",
  ink: "#0B1F66",
  muted: "#4A5A86",
  faint: "#7A8BB3",
  line: "#DCE6F4",
  field: "#F2F8FE",
  fieldLine: "#D5E9FA",
  bad: "#9E0F3E",
  badBg: "#FFEFF4",
  badLine: "#FFC4D6",
  warn: "#8A3A00",
  warnBg: "#FFF4E8",
};

/** Gradient: Bình minh (nút chính, vòng tải) và Bầu trời (phần đầu màn hình). */
export const gradients = {
  sunrise: ["#FF8A00", "#FF6B00", "#FF2E6E"] as const,
  sunriseStops: [0, 0.35, 1] as const,
  skyline: ["#0B1F66", "#1B4FB8", "#6EC1F5"] as const,
  skylineStops: [0, 0.55, 1] as const,
};

/** Tông màu của icon khối gradient (kiểu A). */
export const tones = {
  orange: ["#FF9A3C", "#FF2E6E"],
  sky: ["#7FD0FF", "#1B4FB8"],
  rose: ["#FF85A8", "#E0144F"],
  navy: ["#3D6BE0", "#0B1F66"],
} as const;
export type Tone = keyof typeof tones;

/**
 * Lưới 8 điểm (8pt grid): mọi khoảng cách, kích thước, bo góc là bội số của 8,
 * bước nhỏ 4 cho chi tiết (khoảng cách chữ, viền). Cỡ chữ theo thang 12 / 14 / 16 / 20 / 24 / 32.
 */
export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 40 };
export const size = { control: 48, controlSm: 40, icon: 40, iconSm: 32, iconLg: 48, tabBar: 64 };
export const text = { caption: 12, small: 14, body: 16, title: 20, headline: 24, display: 32 };
export const radius = { control: 12, card: 16, sheet: 24, pill: 999 };

export const fonts = {
  regular: "BeVietnamPro_400Regular",
  medium: "BeVietnamPro_500Medium",
  semibold: "BeVietnamPro_600SemiBold",
  bold: "BeVietnamPro_700Bold",
  black: "BeVietnamPro_800ExtraBold",
};

export const shadow = {
  card: { shadowColor: "#0B1F66", shadowOpacity: 0.14, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 6 },
  button: { shadowColor: "#FF2E6E", shadowOpacity: 0.32, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
};
