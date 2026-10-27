/** Màu nhạt cho từng chứng chỉ ở danh sách đính kèm (nền + viền trái đậm hơn một chút). */
export const CERT_TONES = [
  { background: "#eff6ff", border: "#93c5fd" }, { background: "#f0fdf4", border: "#86efac" }, { background: "#fff7ed", border: "#fdba74" },
  { background: "#f5f3ff", border: "#c4b5fd" }, { background: "#fdf2f8", border: "#f9a8d4" }, { background: "#ecfeff", border: "#67e8f9" },
  { background: "#fefce8", border: "#fde047" }, { background: "#f1f5f9", border: "#cbd5e1" },
] as const;

/** Màu theo chỉ số cố định của chứng chỉ (không theo vị trí hiện tại), để khi kéo dễ thấy dòng nào đang đi. */
export const certTone = (stableIndex: number) => CERT_TONES[Math.max(0, stableIndex) % CERT_TONES.length]!;
