import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CERTIFICATE_FOLDER_PRESET, parseCertificateFolderPresets, type CertificateFolderPreset } from "../../modules/excel-template/certificateFolderPresets";

/** Dòng riêng trong bảng settings giữ cấu hình "Tải thư mục chứng chỉ" dùng chung cho mọi người, mọi máy. */
export const PRESET_ROW_ID = "certificate-folder-presets";
const LOCAL_KEY = "tnm-hrm:certificate-folder-presets";

const isDefaultOnly = (presets: readonly CertificateFolderPreset[]) => presets.length === 1 && JSON.stringify(presets[0]) === JSON.stringify(DEFAULT_CERTIFICATE_FOLDER_PRESET);

/** Cấu hình còn lưu trên trình duyệt (bản cũ trước khi chuyển lên máy chủ, hoặc chế độ demo). */
export function readLocalPresets(): CertificateFolderPreset[] {
  try { return parseCertificateFolderPresets(window.localStorage.getItem(LOCAL_KEY)); } catch { return [DEFAULT_CERTIFICATE_FOLDER_PRESET]; }
}
function writeLocalPresets(presets: readonly CertificateFolderPreset[]) {
  try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(presets)); } catch { /* chế độ riêng tư / bị chặn: chỉ dùng trong lần này */ }
}

export type PresetLoad = { presets: CertificateFolderPreset[]; shared: boolean; warning?: string; copied?: number };

/**
 * Đọc cấu hình: chế độ thật lấy từ máy chủ (dùng chung); máy chủ chưa có mà trình duyệt này còn cấu hình cũ thì chép lên.
 * Không đọc / ghi được máy chủ thì dùng tạm cấu hình trên trình duyệt và báo lại.
 */
export async function loadPresets(client: SupabaseClient | null): Promise<PresetLoad> {
  const local = readLocalPresets();
  if (!client) return { presets: local, shared: false };
  const { data, error } = await client.from("settings").select("version, doc").eq("id", PRESET_ROW_ID).maybeSingle();
  if (error || !data) return { presets: local, shared: false, warning: "Máy chủ chưa có chỗ lưu cấu hình dùng chung: đang dùng cấu hình trên trình duyệt này." };
  const raw = (data.doc as { presets?: unknown } | null)?.presets;
  if (Array.isArray(raw) && raw.length) {
    const server = parseCertificateFolderPresets(JSON.stringify(raw));
    // Máy chủ đã có cấu hình (vd lưu từ máy khác) mà trình duyệt này còn cấu hình riêng: gộp thêm, không bỏ công cài trước đó
    const missing = isDefaultOnly(local) ? [] : local.filter((item) => !server.some((existing) => existing.id === item.id));
    if (!missing.length) return { presets: server, shared: true };
    const merged = [...server, ...missing];
    const saved = await savePresets(client, merged);
    return saved ? { presets: merged, shared: false, warning: saved } : { presets: merged, shared: true, copied: missing.length };
  }
  if (!isDefaultOnly(local)) {
    const saved = await savePresets(client, local);
    return saved ? { presets: local, shared: false, warning: saved } : { presets: local, shared: true, copied: local.length };
  }
  return { presets: [DEFAULT_CERTIFICATE_FOLDER_PRESET], shared: true };
}

/** Lưu cấu hình (máy chủ ở chế độ thật, trình duyệt ở chế độ demo); trả lỗi tiếng Việt hoặc null. */
export async function savePresets(client: SupabaseClient | null, presets: readonly CertificateFolderPreset[]): Promise<string | null> {
  writeLocalPresets(presets);
  if (!client) return null;
  const { data, error } = await client.from("settings").update({ doc: { presets } }).eq("id", PRESET_ROW_ID).select("id");
  if (error) return `Không lưu được cấu hình lên máy chủ: ${error.message}`;
  if (!data?.length) return "Tài khoản này chưa được lưu cấu hình dùng chung; cấu hình chỉ lưu trên trình duyệt này.";
  return null;
}
