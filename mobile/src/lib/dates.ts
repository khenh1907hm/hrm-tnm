/** Ngày giờ theo giờ Việt Nam (máy chủ cũng tính ngày theo Asia/Ho_Chi_Minh). */
const TZ = "Asia/Ho_Chi_Minh";
const WEEKDAY = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

/** Các phần ngày giờ ở VN, không phụ thuộc múi giờ của máy. */
function parts(date: Date) {
  const vn = new Date(date.getTime() + 7 * 3600_000);
  return { y: vn.getUTCFullYear(), m: vn.getUTCMonth() + 1, d: vn.getUTCDate(), w: vn.getUTCDay(), hh: vn.getUTCHours(), mm: vn.getUTCMinutes() };
}
const pad = (n: number) => String(n).padStart(2, "0");

export const todayISO = (now = new Date()) => { const p = parts(now); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
export const monthISO = (now = new Date()) => todayISO(now).slice(0, 7);

/** "07:58" theo giờ VN từ thời điểm ISO. */
export const clockVN = (iso: string | null | undefined) => { if (!iso) return "--:--"; const p = parts(new Date(iso)); return `${pad(p.hh)}:${pad(p.mm)}`; };

/** "Thứ năm, 19/11" từ ngày YYYY-MM-DD. */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return `${WEEKDAY[date.getUTCDay()]}, ${pad(d!)}/${pad(m!)}`;
}
export const dmy = (iso: string) => iso.split("-").reverse().join("/");

/** Cộng / trừ ngày cho YYYY-MM-DD. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function greeting(now = new Date()) {
  const h = parts(now).hh;
  if (h < 11) return "Chào buổi sáng";
  if (h < 14) return "Chào buổi trưa";
  if (h < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

export const nowClock = (now = new Date()) => { const p = parts(now); return `${pad(p.hh)}:${pad(p.mm)}`; };
export const TIME_ZONE = TZ;
