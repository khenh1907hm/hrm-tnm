/**
 * Đọc tọa độ (vĩ độ, kinh độ) từ link hoặc chữ dán từ Google Maps / Apple Maps / OpenStreetMap.
 * Hỗ trợ: ".../@11.1047,106.6926,17z", "?q=11.1047,106.6926", "!3d11.1047!4d106.6926", "ll=…", "query=…", "mlat=…&mlon=…",
 * và chữ thường "11.1047, 106.6926" hoặc "11,1047 106,6926". Link rút gọn (maps.app.goo.gl) phải mở ra link đầy đủ trước (API /api/maps-link).
 */
export type LatLng = { lat: number; lng: number };

const valid = (lat: number, lng: number): LatLng | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) } : null;

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;

/** MAPS-01: lấy tọa độ từ link hoặc chữ; không đọc được thì null. Ưu tiên điểm ghim (!3d…!4d…) hơn tâm bản đồ (@…). */
export function parseCoordinates(input: string): LatLng | null {
  let text = input.trim();
  try { text = decodeURIComponent(text); } catch { /* giữ nguyên */ }
  const patterns = [
    new RegExp(String.raw`!3d${NUM}!4d${NUM}`),
    new RegExp(String.raw`[?&](?:q|query|ll|destination|daddr|center|sll)=(?:loc:)?${NUM}\s*,\s*${NUM}`),
    new RegExp(String.raw`mlat=${NUM}&mlon=${NUM}`),
    new RegExp(String.raw`@${NUM},${NUM}`),
    new RegExp(String.raw`/place/${NUM},${NUM}`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) { const found = valid(Number(match[1]), Number(match[2])); if (found) return found; }
  }
  // Chữ thường: "11.1047, 106.6926" hoặc kiểu Việt "11,1047 106,6926"
  const plain = /^\s*(-?\d{1,3}[.,]\d+)\s*[,;\s]\s*(-?\d{1,3}[.,]\d+)\s*$/.exec(text);
  if (plain) return valid(Number(plain[1]!.replace(",", ".")), Number(plain[2]!.replace(",", ".")));
  return null;
}

/** MAPS-01: link rút gọn cần mở qua máy chủ (chỉ các tên miền chia sẻ của Google Maps). */
export function isShortMapsLink(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" && ["maps.app.goo.gl", "goo.gl", "g.co"].includes(url.hostname) && (url.hostname !== "goo.gl" || url.pathname.startsWith("/maps"));
  } catch { return false; }
}

export const mapsEmbedUrl = (point: LatLng, zoom = 17) => `https://maps.google.com/maps?q=${point.lat},${point.lng}&z=${zoom}&output=embed`;
export const mapsOpenUrl = (point: LatLng) => `https://www.google.com/maps?q=${point.lat},${point.lng}`;
