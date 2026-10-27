import { authorized } from "./officeToPdf";

/**
 * Chỉnh ảnh chân dung thành ảnh thẻ 3×4 bằng AI phía máy chủ (route /api/photo-3x4): kiểm tra đăng nhập, giới hạn
 * kích thước rồi gửi ảnh cho Cloudflare Workers AI (FLUX.2 klein) và trả lại ảnh JPEG 768×1024.
 */
export const MAX_PHOTO_AI_BYTES = 4 * 1024 * 1024;
export const PHOTO_AI_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";
const PHOTO_AI_MIMES = ["image/jpeg", "image/png", "image/webp"];

export const PHOTO_AI_PROMPT = `Turn this photo into a standard professional 3:4 ID portrait of the same person.
- Keep the face, facial features, skin texture, eyes and hair exactly as they are; do not beautify or regenerate the face.
- Face looking straight at the camera, head upright, neutral expression with mouth closed.
- Head and upper shoulders only, centered; the head fills about 70-80% of the frame height.
- Plain solid pure white background, no shadows. Soft, even studio lighting.
- Keep the person's clothing; if it is very casual, replace it with a plain white collared shirt.`;

export type PhotoAiEnv = {
  cloudflareAccountId?: string | undefined;
  cloudflareApiToken?: string | undefined;
  supabaseUrl?: string | undefined;
  supabaseKey?: string | undefined;
};

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const fail = (status: number, code: string, message: string) => Response.json({ code, message }, { status });

export async function handlePhotoAiRequest(request: Request, env: PhotoAiEnv, fetcher: Fetch = fetch): Promise<Response> {
  if (!env.cloudflareAccountId || !env.cloudflareApiToken) return fail(503, "PHOTO_AI_MISSING", "Máy chủ chưa cấu hình AI chỉnh ảnh (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN).");
  if (!(await authorized(request, env, fetcher))) return fail(401, "PHOTO_AI_UNAUTHORIZED", "Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.");
  const form = await request.formData().catch(() => null);
  const image = form?.get("image");
  if (!(image instanceof File) || !image.size) return fail(400, "PHOTO_AI_EMPTY", "Chưa có ảnh để chỉnh.");
  if (!PHOTO_AI_MIMES.includes(image.type)) return fail(415, "PHOTO_AI_TYPE", "Chỉ nhận ảnh JPG, PNG hoặc WebP.");
  if (image.size > MAX_PHOTO_AI_BYTES) return fail(413, "PHOTO_AI_TOO_LARGE", "Ảnh vượt quá 4 MB.");

  const body = new FormData();
  body.set("prompt", PHOTO_AI_PROMPT);
  body.set("input_image_0", image, image.name || "photo");
  body.set("width", "768");
  body.set("height", "1024");
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.cloudflareAccountId}/ai/run/${PHOTO_AI_MODEL}`;
  const response = await fetcher(url, { method: "POST", body, headers: { authorization: `Bearer ${env.cloudflareApiToken}` } }).catch(() => null);
  const payload = await response?.json().catch(() => null) as { success?: boolean; result?: { image?: string }; errors?: { code?: number; message?: string }[] } | null;
  const output = payload?.result?.image;
  if (!response?.ok || !output) {
    // Workers AI báo hết 10.000 neurons miễn phí trong ngày (làm mới lúc 0h UTC)
    if (payload?.errors?.some((item) => /neuron|allocation/i.test(item.message ?? ""))) return fail(429, "PHOTO_AI_QUOTA", "Đã hết lượt AI chỉnh ảnh miễn phí hôm nay, hãy thử lại sau 7 giờ sáng.");
    return fail(502, "PHOTO_AI_FAILED", "AI chỉnh ảnh đang gặp lỗi, hãy thử lại sau ít phút.");
  }
  const bytes = Uint8Array.from(atob(output), (char) => char.charCodeAt(0));
  return new Response(bytes.buffer, { status: 200, headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
}
