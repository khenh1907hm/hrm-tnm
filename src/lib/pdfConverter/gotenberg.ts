import { assertPdf, PdfConvertFailure, XLSX_TYPE, type Fetch, type PdfConverter } from "./types";

export type GotenbergEnv = { url?: string | undefined; username?: string | undefined; password?: string | undefined };

/**
 * Gotenberg: máy chủ LibreOffice tự dựng (xem docker/gotenberg/README.md). Không giới hạn lượt, dữ liệu không ra ngoài.
 * Trả về null khi chưa có địa chỉ máy chủ.
 */
export function createGotenbergConverter(env: GotenbergEnv, fetcher: Fetch = fetch): PdfConverter | null {
  if (!env.url) return null;
  const endpoint = `${env.url.replace(/\/$/, "")}/forms/libreoffice/convert`;
  const headers: Record<string, string> = {};
  if (env.username && env.password) headers.authorization = `Basic ${btoa(`${env.username}:${env.password}`)}`;
  return {
    name: "Gotenberg",
    async convert(xlsx) {
      const form = new FormData();
      form.append("files", new Blob([xlsx.slice().buffer], { type: XLSX_TYPE }), "hoso.xlsx");
      // Giữ nét ảnh như trong Excel (chữ ký, logo, ảnh 3×4): không nén JPEG, không hạ độ phân giải
      form.append("losslessImageCompression", "true");
      form.append("reduceImageResolution", "false");
      let response: Response;
      try {
        response = await fetcher(endpoint, { method: "POST", body: form, headers });
      } catch {
        throw new PdfConvertFailure("PDF_CONVERTER_DOWN", "Không kết nối được máy chủ chuyển PDF. Máy chủ có thể đang khởi động, hãy thử lại sau ít giây.");
      }
      if (response.status === 401) throw new PdfConvertFailure("PDF_CONVERTER_KEY", "Máy chủ chuyển PDF từ chối tài khoản (GOTENBERG_USERNAME / GOTENBERG_PASSWORD).");
      if (!response.ok) throw new PdfConvertFailure("PDF_CONVERTER_FAILED", `Máy chủ chuyển PDF báo lỗi (${response.status}).`);
      return assertPdf(new Uint8Array(await response.arrayBuffer()), "Máy chủ chuyển PDF");
    },
  };
}
