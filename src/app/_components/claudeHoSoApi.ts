import { getSupabaseClient } from "../../lib/supabase/client";
import type { HoSoChangeField, HoSoOverrides } from "../../modules/claude-ho-so/hoSo";
import type { EmployeeInput } from "../../modules/employees/types";

/** Lỗi/cảnh báo do Edge Function `ho-so` trả về (đã kèm câu tiếng Việt). */
export type HoSoIssue = { code: string; field?: string; severity: "error" | "warning"; message: string };
export type HoSoPreview = {
  ok: boolean; kind: "new" | "existing"; code: string; input: EmployeeInput; errors: HoSoIssue[]; warnings: HoSoIssue[];
  notes?: string[]; today?: string;
  existing?: { id: string; code: string; name: string; version: number; status: string; archivedAt: string | null; hasPhoto: boolean };
  changes?: { field: HoSoChangeField; label: string; old: string | null; new: string | null }[];
};
export type HoSoSaved = { ok: true; id: string; code: string; name: string; unchanged?: boolean; changed?: string[]; warnings?: HoSoIssue[] };
export type HoSoFailure = { ok: false; error: string; errors?: HoSoIssue[] };

type Request =
  | { mode: "preview"; file: unknown; overrides: HoSoOverrides; replacePhoto: boolean }
  | { mode: "create"; file: unknown; overrides: HoSoOverrides; replacePhoto: boolean }
  | { mode: "update"; file: unknown; overrides: HoSoOverrides; replacePhoto: boolean; employeeId: string; expectedVersion: number };

/**
 * Gọi Edge Function `ho-so` bằng phiên đăng nhập hiện tại. Máy chủ kiểm tra lại toàn bộ quy tắc
 * (src/modules/claude-ho-so được đóng gói vào function) và chỉ nhận tài khoản admin/hr.
 */
export async function callHoSo(request: Request): Promise<HoSoPreview | HoSoSaved | HoSoFailure> {
  const client = getSupabaseClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!client || !url || !key) return { ok: false, error: "Chỉ dùng được khi đã kết nối cơ sở dữ liệu (không có ở chế độ demo)." };
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "Phiên đăng nhập đã hết hạn, hãy đăng nhập lại." };
  const body = {
    mode: request.mode, file: request.file, overrides: request.overrides, replace_photo: request.replacePhoto,
    ...(request.mode === "update" ? { employee_id: request.employeeId, expected_version: request.expectedVersion } : {}),
  };
  try {
    const response = await fetch(`${url}/functions/v1/ho-so`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: key },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null) as (HoSoPreview & { error?: string }) | HoSoSaved | HoSoFailure | null;
    if (!result) return { ok: false, error: `Máy chủ trả lỗi ${response.status}.` };
    // Xem trước trả về kế hoạch cả khi có lỗi dữ liệu (để hiện từng lỗi); các mode khác lỗi là thất bại
    if (request.mode === "preview" && "kind" in result) return result;
    if (!result.ok) return { ok: false, error: ("error" in result && result.error) || "Không lưu được hồ sơ.", ...("errors" in result && result.errors ? { errors: result.errors } : {}) };
    return result;
  } catch {
    return { ok: false, error: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại." };
  }
}
