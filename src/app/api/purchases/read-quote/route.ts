import { createClient } from "@supabase/supabase-js";

/**
 * Dự phòng khi máy không tự dò được báo giá (bảng lạ, bản scan, ảnh chụp): nhờ Gemini đọc và trả JSON đúng các ô của đơn hàng.
 * Nhận { text } (chữ lấy từ PDF) hoặc { images: [base64 PNG/JPEG] } (tối đa 3 trang). Cần đăng nhập (Bearer token Supabase).
 */
export const maxDuration = 90;

const PROMPT = `Bạn đọc báo giá / đơn đặt hàng (quotation / PO) của NHÀ CUNG CẤP gửi cho Công ty TNHH Thiên Nhật Minh (TNM, bên mua, MST 0303590774).
Trả về DUY NHẤT một JSON theo đúng khuôn sau (không thêm chữ nào khác):
{"supplier": "tên công ty nhà cung cấp (KHÔNG phải Thiên Nhật Minh)", "taxCode": "MST nhà cung cấp", "contact": "người liên hệ / điện thoại / email bên bán",
 "quoteNo": "số báo giá hoặc số PO", "quoteDate": "YYYY-MM-DD hoặc null",
 "items": [{"name": "tên hàng", "spec": "quy cách / mã hàng / model", "unit": "đơn vị tính", "quantity": số, "unitPrice": số, "amount": số}],
 "subtotal": số hoặc null, "vat": số tiền thuế hoặc null, "total": tổng thanh toán hoặc null,
 "vatIncluded": true nếu đơn giá đã gồm VAT, false nếu chưa, null nếu không rõ,
 "paymentTerms": "điều khoản thanh toán nguyên văn ngắn gọn", "advancePct": phần trăm tạm ứng/đặt cọc (<100) hoặc null,
 "prepay": true nếu phải thanh toán toàn bộ trước khi giao hàng / ngay khi đặt hàng, "deliveryText": "thời gian giao hàng nguyên văn ngắn gọn"}
Quy tắc: số là số thuần (không dấu chấm/phẩy phân cách nghìn, đơn vị VNĐ). Không bịa: không thấy thì để "" hoặc null. Giữ nguyên tiếng Việt có dấu.`;

const CONTRACT_PROMPT = `Bạn đọc chứng từ của KHÁCH HÀNG cho Công ty TNHH Thiên Nhật Minh (TNM, MST 0303590774): có thể là báo giá TNM gửi khách (quotation),
đơn đặt hàng / PO khách gửi TNM, hoặc hợp đồng. Trả về DUY NHẤT một JSON:
{"kind": "quote" nếu là báo giá TNM gửi khách, "po" nếu là PO / đơn đặt hàng / hợp đồng khách gửi TNM,
 "number": "số báo giá hoặc số PO / hợp đồng", "date": "YYYY-MM-DD hoặc null",
 "customerName": "tên công ty KHÁCH HÀNG (không phải Thiên Nhật Minh)", "ownerName": "chủ đầu tư / dự án của khách nếu có, không thì \"\"",
 "description": "tóm tắt ngắn phạm vi công việc / tên gói thầu", "total": tổng giá trị (số, VNĐ) hoặc null,
 "vatIncluded": true | false | null, "paymentTerms": "điều khoản thanh toán nguyên văn ngắn gọn",
 "startOn": "YYYY-MM-DD hoặc null", "endOn": "YYYY-MM-DD hoặc null"}
Số là số thuần (không dấu phân cách nghìn). Không bịa: không thấy thì "" hoặc null. Giữ nguyên tiếng Việt có dấu.`;

async function authorized(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !token) return false;
  const { data, error } = await createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth.getUser(token);
  return !error && Boolean(data.user);
}

export async function POST(request: Request) {
  if (!(await authorized(request))) return Response.json({ ok: false, error: "Cần đăng nhập." }, { status: 401 });
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return Response.json({ ok: false, error: "Máy chủ chưa cấu hình Gemini (GEMINI_API_KEY)." }, { status: 503 });
  let body: { text?: unknown; images?: unknown; purpose?: unknown };
  try { body = await request.json() as typeof body; } catch { return Response.json({ ok: false, error: "Dữ liệu gửi lên không hợp lệ." }, { status: 400 }); }
  const text = typeof body.text === "string" ? body.text.slice(0, 60_000) : "";
  const images = Array.isArray(body.images) ? body.images.filter((item): item is string => typeof item === "string").slice(0, 3) : [];
  if (!text.trim() && !images.length) return Response.json({ ok: false, error: "Không có nội dung để đọc." }, { status: 400 });
  if (images.some((item) => item.length > 6_000_000)) return Response.json({ ok: false, error: "Ảnh quá lớn." }, { status: 413 });

  const parts: Record<string, unknown>[] = [{ text: body.purpose === "contract" ? CONTRACT_PROMPT : PROMPT }];
  if (text.trim()) parts.push({ text: `NỘI DUNG BÁO GIÁ (chữ lấy từ PDF, mỗi dòng các ô cách nhau bởi " | "):\n${text}` });
  for (const image of images) {
    const match = image.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/);
    if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
  }
  const model = process.env.GEMINI_QUOTE_MODEL?.trim() || process.env.GEMINI_VISION_MODEL?.trim() || "gemini-flash-lite-latest";
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 8192 } }),
      signal: AbortSignal.timeout(80_000),
    });
  } catch {
    return Response.json({ ok: false, error: "Không kết nối được Gemini để đọc báo giá." }, { status: 502 });
  }
  if (response.status === 429) return Response.json({ ok: false, error: "Gemini đã hết lượt miễn phí (hoặc gọi quá nhanh). Thử lại sau ít phút hoặc nhập tay." }, { status: 429 });
  if (!response.ok) return Response.json({ ok: false, error: `Gemini báo lỗi ${response.status} khi đọc báo giá.` }, { status: 502 });
  const result = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const raw = (result.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
  try {
    const data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as unknown;
    return Response.json({ ok: true, data, model });
  } catch {
    return Response.json({ ok: false, error: "Gemini trả về nội dung không đọc được, thử lại hoặc nhập tay." }, { status: 502 });
  }
}
