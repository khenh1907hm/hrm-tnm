import { decode } from "base64-arraybuffer";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as Location from "expo-location";
import { supabase } from "./supabase";

/**
 * Điểm danh (chấm công) theo dự án, dùng chung database với web:
 *  - Nơi làm việc = dự án đang thi công mà mình là thành viên (hàm my_attendance_context).
 *  - Chấm Vào / Ra: lấy GPS + chụp ảnh tại chỗ, tải ảnh lên kho attendance-photos, rồi gọi check_in / check_out.
 *    Máy chủ kiểm tra thành viên, bán kính công trường và ghi giờ (không lấy giờ điện thoại).
 */
export type Workplace = {
  projectId: string;
  code: string;
  name: string;
  team: string;
  hasSite: boolean;
  siteLat: number | null;
  siteLng: number | null;
  radiusM: number;
  workStart: string;
  workEnd: string;
  today: { checkInAt: string; checkOutAt: string | null; inDistanceM: number; outDistanceM: number | null } | null;
};

export type DayRecord = { workDate: string; projectId: string; code: string; projectName: string; checkInAt: string | null; checkOutAt: string | null };

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const hhmm = (v: unknown, fallback: string) => (v ? String(v).slice(0, 5) : fallback);
const PHOTO_BUCKET = "attendance-photos";

export async function loadWorkplaces(): Promise<Workplace[]> {
  const { data, error } = await supabase.rpc("my_attendance_context");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({
    projectId: str(row.project_id),
    code: str(row.code),
    name: str(row.name),
    team: str(row.team),
    hasSite: row.site_lat !== null && row.site_lng !== null,
    siteLat: row.site_lat === null ? null : Number(row.site_lat),
    siteLng: row.site_lng === null ? null : Number(row.site_lng),
    radiusM: Number(row.site_radius_m ?? 0),
    workStart: hhmm(row.work_start, "08:00"),
    workEnd: hhmm(row.work_end, "17:00"),
    today: row.check_id ? {
      checkInAt: str(row.check_in_at),
      checkOutAt: row.check_out_at ? str(row.check_out_at) : null,
      inDistanceM: Number(row.in_distance_m ?? 0),
      outDistanceM: row.out_distance_m === null || row.out_distance_m === undefined ? null : Number(row.out_distance_m),
    } : null,
  }));
}

/**
 * Công trường để chọn khi điểm danh: mọi dự án đang thi công (chấm tự do, không cần là thành viên),
 * kèm vị trí, giờ làm và lượt chấm hôm nay của mình. Công trường mình đang tham gia xếp lên đầu.
 */
export type Site = Workplace & { address: string; isMember: boolean };

export async function loadSites(): Promise<Site[]> {
  const { data, error } = await supabase.rpc("attendance_sites");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({
    projectId: str(row.project_id), code: str(row.code), name: str(row.name), address: str(row.site), team: str(row.team),
    isMember: Boolean(row.is_member),
    hasSite: row.site_lat !== null && row.site_lng !== null,
    siteLat: row.site_lat === null ? null : Number(row.site_lat),
    siteLng: row.site_lng === null ? null : Number(row.site_lng),
    radiusM: Number(row.site_radius_m ?? 0),
    workStart: hhmm(row.work_start, "08:00"),
    workEnd: hhmm(row.work_end, "17:00"),
    today: row.check_in_at ? {
      checkInAt: str(row.check_in_at),
      checkOutAt: row.check_out_at ? str(row.check_out_at) : null,
      inDistanceM: Number(row.in_distance_m ?? 0),
      outDistanceM: row.out_distance_m === null || row.out_distance_m === undefined ? null : Number(row.out_distance_m),
    } : null,
  }));
}

export async function loadMonth(month: string): Promise<DayRecord[]> {
  const { data, error } = await supabase.rpc("my_attendance_month", { p_month: month });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[])
    .filter((row) => row.check_in_at)
    .map((row) => ({
      workDate: str(row.work_date), projectId: str(row.project_id), code: str(row.code), projectName: str(row.project_name),
      checkInAt: row.check_in_at ? str(row.check_in_at) : null, checkOutAt: row.check_out_at ? str(row.check_out_at) : null,
    }))
    .sort((a, b) => b.workDate.localeCompare(a.workDate));
}

export type GpsFix = { lat: number; lng: number; accuracy: number };

/** Khoảng cách (mét, làm tròn) giữa hai tọa độ — để báo trước khi chụp ảnh; máy chủ vẫn kiểm tra lại. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Trạng thái hôm nay của một nơi làm việc. */
export const nextPunch = (place: Workplace): "in" | "out" | null => (!place.today ? "in" : !place.today.checkOutAt ? "out" : null);

let lastFix: { fix: GpsFix; at: number } | null = null;
const remember = (coords: { latitude: number; longitude: number; accuracy: number | null }): GpsFix => {
  const fix = { lat: coords.latitude, lng: coords.longitude, accuracy: Math.round(coords.accuracy ?? 0) };
  lastFix = { fix, at: Date.now() };
  return fix;
};

/** Vị trí vừa đo (nếu còn mới) — để hiện "GPS sẵn sàng" trên màn hình. */
export const freshGps = (maxAgeMs = 60_000): GpsFix | null => (lastFix && Date.now() - lastFix.at <= maxAgeMs ? lastFix.fix : null);

/**
 * Lấy vị trí GPS.
 *  - fast: dùng lại vị trí vừa đo trong 1 phút (hoặc vị trí hệ điều hành vừa có), đo độ chính xác vừa phải → nhanh.
 *  - không fast: chỉ dùng lại vị trí trong 1 phút nếu sai số ≤ 50 m, còn lại đo chính xác cao.
 *  - fresh: bỏ qua bộ nhớ, đo mới (dùng khi lấy sẵn lúc mở màn hình).
 *  - ask: false thì không hỏi quyền (chưa cho phép thì trả null), để lấy sẵn không bật hộp thoại ngay khi mở app.
 * Máy chủ vẫn tự kiểm tra bán kính công trường.
 */
export async function readGps(options: { fast?: boolean; fresh?: boolean; ask?: boolean } = {}): Promise<GpsFix> {
  const { fast = true, fresh = false, ask = true } = options;
  const permission = ask ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
  if (permission.status !== "granted") throw new Error("CHECKIN_NO_GPS");
  if (!fresh) {
    const cached = freshGps();
    if (cached && (fast || cached.accuracy <= 50)) return cached;
    if (fast) {
      const known = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 100 }).catch(() => null);
      if (known) return remember(known.coords);
    }
  }
  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: fast ? Location.Accuracy.Balanced : Location.Accuracy.High });
    return remember(position.coords);
  } catch {
    throw new Error("CHECKIN_NO_GPS");
  }
}

/** Thu nhỏ ảnh chụp cạnh dài 640 px, JPEG ~60%, kèm base64 để tải lên. */
export async function preparePhoto(asset: { uri: string; width: number; height: number }): Promise<{ uri: string; base64: string }> {
  const longSide = Math.max(asset.width || 640, asset.height || 640);
  const context = ImageManipulator.manipulate(asset.uri);
  if (longSide > 640) context.resize(asset.width >= asset.height ? { width: 640 } : { height: 640 });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
  if (!saved.base64) throw new Error("CHECKIN_NO_PHOTO");
  return { uri: saved.uri, base64: saved.base64 };
}

/** Gửi chấm Vào / Ra: tải ảnh lên rồi gọi máy chủ. Lỗi ném mã (vd CHECKIN_OUT_OF_RANGE:350). */
export async function punch(kind: "in" | "out", projectId: string, fix: GpsFix, photoBase64: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("FORBIDDEN");
  const path = `${projectId}/${auth.user.id}/${new Date().toISOString().replace(/[:.]/g, "-")}-${kind}.jpg`;
  const uploaded = await supabase.storage.from(PHOTO_BUCKET).upload(path, decode(photoBase64), { contentType: "image/jpeg", upsert: false });
  if (uploaded.error) throw new Error(uploaded.error.message);
  const { error } = await supabase.rpc(kind === "in" ? "check_in" : "check_out", { p_project: projectId, p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy, p_photo: path });
  if (error) throw new Error(error.message);
}
