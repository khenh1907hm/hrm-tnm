import { pickPdfConverter, PdfConvertFailure, type PdfConverterEnv } from "./pdfConverter";

/**
 * Chuyển file Excel → PDF phía máy chủ (route /api/convert-pdf): kiểm tra đăng nhập, giới hạn kích thước rồi chuyển
 * cho máy chuyển PDF đang cấu hình (ComPDF, Gotenberg… xem lib/pdfConverter).
 */
export const MAX_XLSX_BYTES = 4 * 1024 * 1024;
const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export type ConvertEnv = PdfConverterEnv & {
  supabaseUrl?: string | undefined;
  supabaseKey?: string | undefined;
};

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const fail = (status: number, code: string, message: string) => Response.json({ code, message }, { status });

/** Có cấu hình Supabase → bắt buộc phiên đăng nhập hợp lệ (tránh người lạ dùng hết lượt / máy chủ chuyển đổi). */
export async function authorized(request: Request, env: Pick<ConvertEnv, "supabaseUrl" | "supabaseKey">, fetcher: Fetch): Promise<boolean> {
  if (!env.supabaseUrl || !env.supabaseKey) return true;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const response = await fetcher(`${env.supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, { headers: { apikey: env.supabaseKey, authorization: header } });
  return response.ok;
}

export async function handleConvertRequest(request: Request, env: ConvertEnv, fetcher: Fetch = fetch): Promise<Response> {
  const picked = pickPdfConverter(env, fetcher);
  if (!picked.converter) return fail(503, "PDF_CONVERTER_MISSING", picked.problem);
  if (!(await authorized(request, env, fetcher))) return fail(401, "PDF_UNAUTHORIZED", "Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return fail(400, "PDF_EMPTY", "File Excel gửi lên bị trống.");
  if (bytes.length > MAX_XLSX_BYTES) return fail(413, "PDF_TOO_LARGE", `File Excel nặng ${(bytes.length / 1024 / 1024).toFixed(1)} MB, vượt giới hạn 4 MB của máy chủ. Hãy dùng ảnh 3×4, CCCD, chữ ký nhẹ hơn.`);
  if (!XLSX_MAGIC.every((value, index) => bytes[index] === value)) return fail(415, "PDF_NOT_XLSX", "Chỉ nhận file Excel (.xlsx).");
  try {
    const pdf = await picked.converter.convert(bytes);
    return new Response(pdf.slice().buffer, { status: 200, headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof PdfConvertFailure) return fail(502, error.code, error.message);
    return fail(502, "PDF_CONVERTER_FAILED", `${picked.converter.name} gặp lỗi không xác định khi chuyển PDF.`);
  }
}
