import AsyncStorage from "@react-native-async-storage/async-storage";
import { decode } from "base64-arraybuffer";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { supabase } from "./supabase";

/**
 * Kiểm tra dụng cụ, máy điện (mẫu "TOOL & MACHINE CHECK PHOTO REPORT", dùng chung với web src/modules/projects/toolCheck.ts).
 * Mỗi dụng cụ một dòng: Serial/Code, nhà thầu (Sub con.), loại, ảnh từng mục kiểm tra, Kết quả OK / NG (mặc định OK).
 * "Out look check" luôn có; các mục khác tùy loại (người quản lý đặt trước).
 */
export const ITEM_KEYS = ["outlook", "earthing", "resistance", "function"] as const;
export type ItemKey = (typeof ITEM_KEYS)[number];
export const ITEM_LABEL: Record<ItemKey, { en: string; vi: string }> = {
  outlook: { en: "Out look check", vi: "Bên ngoài" },
  earthing: { en: "Earthing connection (<0.3Ω)", vi: "Tiếp địa" },
  resistance: { en: "Resistance (≥2MΩ @ 500V)", vi: "Cách điện" },
  function: { en: "Functions test", vi: "Chạy thử" },
};
export const OPTIONAL_ITEMS: ItemKey[] = ["earthing", "resistance", "function"];
const BUCKET = "tool-check-photos";

export type ToolType = { id: string; name: string; items: ItemKey[] };
/** status: active (đang thi công), paused, done — dự án đã xong vẫn chọn được để nhập bù các tháng trước. */
export type ToolProject = { projectId: string; code: string; name: string; site: string; hasTemplate: boolean; status: string };
/** Ảnh của một ô: đã tải lên (path) hoặc mới chụp trên máy (uri), chưa tải. */
export type PhotoRef = { path?: string; uri?: string; width?: number; height?: number };
export type ToolRow = {
  key: string;
  serial: string;
  subcon: string;
  typeId: string | null;
  typeName?: string;
  result: "OK" | "NG";
  note: string;
  photos: Partial<Record<ItemKey, PhotoRef>>;
};
export type TemplateRow = { serial: string; subcon: string; typeId: string | null };

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export const newKey = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const emptyRow = (subcon = "TNM", typeId: string | null = null): ToolRow => ({ key: newKey(), serial: "", subcon, typeId, result: "OK", note: "", photos: {} });

/** Các mục cần chụp của một dòng: Out look check + mục của loại. */
/** Số ảnh cần chụp của một loại (Out look check + các mục thêm). */
export const photoCountOf = (type: Pick<ToolType, "items">) => 1 + type.items.length;

export function itemsOf(row: Pick<ToolRow, "typeId">, types: readonly ToolType[]): ItemKey[] {
  const type = types.find((t) => t.id === row.typeId);
  return ["outlook", ...OPTIONAL_ITEMS.filter((key) => type?.items.includes(key))];
}

export async function loadToolProjects(): Promise<ToolProject[]> {
  const { data, error } = await supabase.rpc("my_tool_check_projects");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({ projectId: str(row.project_id), code: str(row.code), name: str(row.name), site: str(row.site), hasTemplate: Boolean(row.has_template), status: str(row.status) || "active" }));
}

export async function canManageTypes(): Promise<boolean> {
  const { data } = await supabase.rpc("tool_check_can_manage");
  return data === true;
}

export async function loadTypes(): Promise<ToolType[]> {
  const { data, error } = await supabase.from("tool_check_types").select("id, name, items, position").order("position").order("name");
  if (error) throw new Error(error.message);
  const list = ((data ?? []) as Row[]).map((row) => ({ id: str(row.id), name: str(row.name), items: ((row.items ?? []) as string[]).filter((k): k is ItemKey => (OPTIONAL_ITEMS as string[]).includes(k)) }));
  // Xếp theo số ảnh cần chụp: loại ít ảnh lên trước (1 ảnh, 2 ảnh…)
  return list.map((t, i) => ({ t, i })).sort((a, b) => a.t.items.length - b.t.items.length || a.i - b.i).map(({ t }) => t);
}

export async function saveType(type: { id?: string; name: string; items: ItemKey[]; position: number }): Promise<void> {
  const body = { name: type.name.trim(), items: type.items.filter((k) => k !== "outlook"), position: type.position };
  const { error } = type.id ? await supabase.from("tool_check_types").update(body).eq("id", type.id) : await supabase.from("tool_check_types").insert(body);
  if (error) throw new Error(error.message.includes("duplicate") ? "Đã có loại trùng tên." : error.message);
}

export async function deleteType(id: string): Promise<void> {
  const { error } = await supabase.from("tool_check_types").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function loadTemplate(projectId: string): Promise<TemplateRow[]> {
  const { data, error } = await supabase.from("tool_check_templates").select("rows").eq("project_id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  return ((data?.rows ?? []) as Row[]).map((row) => ({ serial: str(row.serial), subcon: str(row.subcon), typeId: row.typeId ? str(row.typeId) : null }));
}

/** Lưu danh sách dụng cụ hiện tại làm dữ liệu mẫu của dự án (không lưu ảnh, kết quả). */
export async function saveTemplate(projectId: string, rows: readonly ToolRow[]): Promise<void> {
  const list = rows.filter((r) => r.serial.trim()).map((r) => ({ serial: r.serial.trim(), subcon: r.subcon.trim(), typeId: r.typeId }));
  const { error } = await supabase.from("tool_check_templates").upsert({ project_id: projectId, rows: list }, { onConflict: "project_id" });
  if (error) throw new Error(error.message);
}

export const fromTemplate = (rows: readonly TemplateRow[]): ToolRow[] => rows.map((r) => ({ ...emptyRow(r.subcon || "TNM", r.typeId), serial: r.serial }));

export type SavedCheck = { id: string; date: string; checkedBy: string; rows: ToolRow[] };

const parseRows = (rows: unknown): ToolRow[] => (Array.isArray(rows) ? (rows as Row[]) : []).map((r) => {
  const photos: Partial<Record<ItemKey, PhotoRef>> = {};
  const raw = (r.photos ?? {}) as Row;
  for (const key of ITEM_KEYS) if (raw[key]) photos[key] = { path: str(raw[key]) };
  const typeName = str(r.typeName).trim();
  return { key: newKey(), serial: str(r.serial), subcon: str(r.subcon), typeId: r.typeId ? str(r.typeId) : null, ...(typeName ? { typeName } : {}), result: r.result === "NG" ? "NG" : "OK", note: str(r.note), photos };
});

/** Tạo danh sách mới từ phiếu trước: giữ Serial/Code và Loại (1–4), bỏ toàn bộ ảnh và đưa kết quả về OK. */
export function cloneRowsWithoutPhotos(source: readonly ToolRow[], types: readonly ToolType[] = [], subcon = "TNM"): ToolRow[] {
  return source
    .filter((r) => r.serial.trim())
    .map((r) => {
      const matchedById = r.typeId && types.some((t) => t.id === r.typeId) ? r.typeId : null;
      const matchedByName = !matchedById && r.typeName
        ? types.find((t) => t.name.trim().toLowerCase() === r.typeName!.trim().toLowerCase())?.id ?? null
        : null;
      return {
        key: newKey(),
        serial: r.serial.trim(),
        subcon,
        typeId: matchedById ?? matchedByName ?? r.typeId ?? null,
        result: "OK",
        note: "",
        photos: {},
      };
    });
}

/** Các tháng để chọn nhập phiếu: tháng này lùi về 36 tháng (mới nhất trước). */
export function recentMonths(thisMonth: string, count = 36): string[] {
  return Array.from({ length: count }, (_, index) => shiftMonth(thisMonth, -index));
}

/** Tháng kế tiếp của "YYYY-MM". */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Kiểm tra định kỳ mỗi tháng một phiếu: lấy phiếu của tháng (YYYY-MM), nếu có. */
export async function loadCheck(projectId: string, month: string): Promise<SavedCheck | null> {
  const { data, error } = await supabase.from("tool_checks").select("id, check_date, checked_by, rows").eq("project_id", projectId)
    .gte("check_date", `${month}-01`).lt("check_date", `${shiftMonth(month, 1)}-01`).order("check_date", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { id: str(data.id), date: str(data.check_date), checkedBy: str(data.checked_by), rows: parseRows(data.rows) } : null;
}

/** Phiếu gần nhất trước tháng này (ưu tiên phiếu đã lưu có dụng cụ; nếu tháng liền trước mới lưu nháp trên máy thì lấy bản nháp): chỉ lấy Serial + Loại, bỏ ảnh. */
export async function loadPreviousCheck(projectId: string, month: string): Promise<SavedCheck | null> {
  const prevMonth = shiftMonth(month, -1);
  const [{ data, error }, prevDraft] = await Promise.all([
    supabase.from("tool_checks").select("id, check_date, checked_by, rows").eq("project_id", projectId)
      .lt("check_date", `${month}-01`).order("check_date", { ascending: false }).limit(12),
    readDraft(projectId, prevMonth),
  ]);
  if (error) throw new Error(error.message);
  let savedPrev: SavedCheck | null = null;
  for (const row of data ?? []) {
    const rows = cloneRowsWithoutPhotos(parseRows(row.rows));
    if (rows.length) { savedPrev = { id: str(row.id), date: str(row.check_date), checkedBy: str(row.checked_by), rows }; break; }
  }
  const draftRows = prevDraft ? cloneRowsWithoutPhotos(prevDraft.rows) : [];
  if (draftRows.length && (!savedPrev || savedPrev.date.slice(0, 7) < prevMonth)) {
    return { id: "", date: `${prevMonth}-01`, checkedBy: prevDraft!.checkedBy, rows: draftRows };
  }
  return savedPrev;
}

/** Link xem tạm (1 giờ) cho các ảnh đã tải lên. */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  const map: Record<string, string> = {};
  for (const item of data ?? []) if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
  return map;
}

/** Thu nhỏ cạnh dài 1280 px, JPEG ~75% (đủ nét để xem số trên đồng hồ đo). */
async function prepare(photo: PhotoRef): Promise<string> {
  const context = ImageManipulator.manipulate(photo.uri!);
  const w = photo.width ?? 0, h = photo.height ?? 0;
  if (Math.max(w, h) > 1280 || !w) context.resize(w >= h ? { width: 1280 } : { height: 1280 });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.75, base64: true });
  if (!saved.base64) throw new Error("Không đọc được ảnh.");
  return saved.base64;
}

const slug = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "tool";

/** Tải ảnh mới lên rồi lưu phiếu (ghi đè theo ngày). onProgress báo số ảnh đã tải. */
export async function saveCheck(projectId: string, date: string, checkedBy: string, rows: readonly ToolRow[], types: readonly ToolType[], existingId: string | null, onProgress?: (done: number, total: number) => void): Promise<{ id: string; rows: ToolRow[] }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("FORBIDDEN");
  const pending = rows.flatMap((row) => itemsOf(row, types).filter((key) => row.photos[key]?.uri && !row.photos[key]?.path).map((key) => ({ row, key })));
  let done = 0;
  onProgress?.(0, pending.length);
  const uploaded = new Map<string, string>();
  for (const { row, key } of pending) {
    const base64 = await prepare(row.photos[key]!);
    const path = `${projectId}/${auth.user.id}/${date}-${slug(row.serial)}-${key}-${newKey()}.jpg`;
    const result = await supabase.storage.from(BUCKET).upload(path, decode(base64), { contentType: "image/jpeg", upsert: false });
    if (result.error) throw new Error(`Chưa tải được ảnh: ${result.error.message}`);
    uploaded.set(`${row.key}:${key}`, path);
    onProgress?.(++done, pending.length);
  }
  const saved: ToolRow[] = rows.map((row) => {
    const photos: Partial<Record<ItemKey, PhotoRef>> = {};
    for (const key of itemsOf(row, types)) {
      const path = uploaded.get(`${row.key}:${key}`) ?? row.photos[key]?.path;
      if (path) photos[key] = { path, uri: row.photos[key]?.uri };
    }
    return { ...row, photos };
  });
  const body = saved.filter((r) => r.serial.trim()).map((r) => ({
    serial: r.serial.trim(), subcon: r.subcon.trim(), typeId: r.typeId, typeName: types.find((t) => t.id === r.typeId)?.name ?? "",
    items: itemsOf(r, types), photos: Object.fromEntries(Object.entries(r.photos).map(([k, v]) => [k, v?.path ?? null])), result: r.result, note: r.note.trim(),
  }));
  const record = { project_id: projectId, check_date: date, checked_by: checkedBy.trim(), rows: body };
  const { data, error } = existingId
    ? await supabase.from("tool_checks").update(record).eq("id", existingId).select("id").single()
    : await supabase.from("tool_checks").upsert(record, { onConflict: "project_id,check_date" }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: str(data.id), rows: saved };
}

/** Bản nháp trên máy (giữ ảnh chưa tải) để thoát app không mất. */
const draftKey = (projectId: string, date: string) => `tnm.toolCheckDraft:${projectId}:${date}`;
export async function readDraft(projectId: string, date: string): Promise<{ checkedBy: string; rows: ToolRow[] } | null> {
  try { const raw = await AsyncStorage.getItem(draftKey(projectId, date)); return raw ? JSON.parse(raw) as { checkedBy: string; rows: ToolRow[] } : null; } catch { return null; }
}
export async function writeDraft(projectId: string, date: string, value: { checkedBy: string; rows: ToolRow[] } | null): Promise<void> {
  try { if (value) await AsyncStorage.setItem(draftKey(projectId, date), JSON.stringify(value)); else await AsyncStorage.removeItem(draftKey(projectId, date)); } catch { /* bỏ qua */ }
}
