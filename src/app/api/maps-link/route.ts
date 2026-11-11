import { isShortMapsLink, parseCoordinates } from "../../../lib/mapsLink";

const GOOGLE_HOSTS = /^(?:[a-z0-9-]+\.)*(?:google\.[a-z.]+|goo\.gl|g\.co)$/i;

/**
 * Mở link chia sẻ rút gọn của Google Maps (maps.app.goo.gl/…) để lấy link đầy đủ có tọa độ.
 * Chỉ nhận link rút gọn của Google và chỉ đi theo chuyển hướng tới tên miền Google (không mở địa chỉ tùy ý).
 */
export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("url") ?? "";
  if (!isShortMapsLink(input)) return Response.json({ ok: false, message: "Chỉ nhận link chia sẻ của Google Maps (maps.app.goo.gl)." }, { status: 400 });
  let current = input;
  try {
    for (let hop = 0; hop < 5; hop++) {
      const found = parseCoordinates(current);
      if (found) return Response.json({ ok: true, ...found });
      const response = await fetch(current, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; TNM-HRM)" }, signal: AbortSignal.timeout(8000) });
      const next = response.headers.get("location");
      if (!next) break;
      const target = new URL(next, current);
      if (target.protocol !== "https:" || !GOOGLE_HOSTS.test(target.hostname)) break;
      current = target.toString();
    }
    const found = parseCoordinates(current);
    if (found) return Response.json({ ok: true, ...found });
  } catch { /* lỗi mạng: báo chung bên dưới */ }
  return Response.json({ ok: false, message: "Không đọc được tọa độ từ link này. Trên Google Maps hãy nhấn giữ vào điểm công trường rồi sao chép 2 con số tọa độ." }, { status: 422 });
}
