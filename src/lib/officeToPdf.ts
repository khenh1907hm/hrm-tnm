/**
 * Chuyển file Excel → PDF qua máy chủ LibreOffice riêng (Gotenberg).
 * Chạy phía máy chủ (route /api/convert-pdf): kiểm tra đăng nhập, giới hạn kích thước rồi chuyển tiếp.
 */
export const MAX_XLSX_BYTES = 4 * 1024 * 1024;
const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export type ConvertEnv = {
  gotenbergUrl?: string | undefined;
  gotenbergUsername?: string | undefined;
  gotenbergPassword?: string | undefined;
  supabaseUrl?: string | undefined;
  supabaseKey?: string | undefined;
};

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const fail = (status: number, code: string, message: string) => Response.json({ code, message }, { status });

/** Có cấu hình Supabase → bắt buộc phiên đăng nhập hợp lệ (tránh người lạ dùng máy chủ chuyển đổi). */
async function authorized(request: Request, env: ConvertEnv, fetcher: Fetch): Promise<boolean> {
  if (!env.supabaseUrl || !env.supabaseKey) return true;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const response = await fetcher(`${env.supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, { headers: { apikey: env.supabaseKey, authorization: header } });
  return response.ok;
}

export async function handleConvertRequest(request: Request, env: ConvertEnv, fetcher: Fetch = fetch): Promise<Response> {
  if (!env.gotenbergUrl) return fail(503, "PDF_CONVERTER_MISSING", "Chưa cấu hình máy chủ chuyển PDF (GOTENBERG_URL).");
  if (!(await authorized(request, env, fetcher))) return fail(401, "PDF_UNAUTHORIZED", "Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_XLSX_BYTES) return fail(413, "PDF_TOO_LARGE", "File Excel trống hoặc lớn hơn 4 MB.");
  if (!XLSX_MAGIC.every((value, index) => bytes[index] === value)) return fail(415, "PDF_NOT_XLSX", "Chỉ nhận file Excel (.xlsx).");

  const form = new FormData();
  form.append("files", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "hoso.xlsx");
  const headers: Record<string, string> = {};
  if (env.gotenbergUsername && env.gotenbergPassword) headers.authorization = `Basic ${btoa(`${env.gotenbergUsername}:${env.gotenbergPassword}`)}`;
  let response: Response;
  try {
    response = await fetcher(`${env.gotenbergUrl.replace(/\/$/, "")}/forms/libreoffice/convert`, { method: "POST", body: form, headers });
  } catch {
    return fail(502, "PDF_CONVERTER_DOWN", "Không kết nối được máy chủ chuyển PDF. Máy chủ có thể đang khởi động, hãy thử lại sau ít giây.");
  }
  if (!response.ok) return fail(502, "PDF_CONVERTER_FAILED", `Máy chủ chuyển PDF báo lỗi (${response.status}).`);
  return new Response(await response.arrayBuffer(), { status: 200, headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}
