import { createComPdfConverter } from "./compdf";
import { createGotenbergConverter } from "./gotenberg";
import type { Fetch, PdfConverter } from "./types";

export { PdfConvertFailure, type PdfConverter, type PdfConvertFailureCode } from "./types";

/** Cấu hình lấy từ biến môi trường (xem docs/chuyen-pdf.md). */
export type PdfConverterEnv = {
  /** PDF_CONVERTER: "compdf" | "gotenberg". Bỏ trống: dùng nhà cung cấp đầu tiên trong PROVIDERS đã có cấu hình. */
  provider?: string | undefined;
  compdfApiKey?: string | undefined;
  compdfUrl?: string | undefined;
  gotenbergUrl?: string | undefined;
  gotenbergUsername?: string | undefined;
  gotenbergPassword?: string | undefined;
};

/**
 * Danh sách nhà cung cấp, theo thứ tự ưu tiên khi không đặt PDF_CONVERTER.
 * Thêm bên mới: viết file createXxxConverter như compdf.ts rồi thêm một dòng ở đây.
 */
const PROVIDERS: Readonly<Record<string, { env: string; create: (env: PdfConverterEnv, fetcher: Fetch) => PdfConverter | null }>> = {
  compdf: { env: "COMPDF_API_KEY", create: (env, fetcher) => createComPdfConverter({ apiKey: env.compdfApiKey, url: env.compdfUrl }, fetcher) },
  gotenberg: { env: "GOTENBERG_URL", create: (env, fetcher) => createGotenbergConverter({ url: env.gotenbergUrl, username: env.gotenbergUsername, password: env.gotenbergPassword }, fetcher) },
};

export type PickedConverter = { converter: PdfConverter } | { converter: null; problem: string };

/** Chọn máy chuyển PDF theo PDF_CONVERTER, hoặc bên đầu tiên đã có cấu hình; không có thì nói rõ thiếu biến nào. */
export function pickPdfConverter(env: PdfConverterEnv, fetcher: Fetch = fetch): PickedConverter {
  const chosen = env.provider?.trim().toLowerCase();
  if (chosen) {
    const provider = PROVIDERS[chosen];
    if (!provider) return { converter: null, problem: `PDF_CONVERTER="${env.provider}" không hợp lệ, chỉ nhận: ${Object.keys(PROVIDERS).join(", ")}.` };
    const converter = provider.create(env, fetcher);
    return converter ? { converter } : { converter: null, problem: `Đã chọn PDF_CONVERTER=${chosen} nhưng chưa đặt ${provider.env}.` };
  }
  for (const provider of Object.values(PROVIDERS)) {
    const converter = provider.create(env, fetcher);
    if (converter) return { converter };
  }
  return { converter: null, problem: `Chưa cấu hình máy chuyển PDF (${Object.values(PROVIDERS).map((provider) => provider.env).join(" hoặc ")}).` };
}
