import { assertPdf, PdfConvertFailure, XLSX_TYPE, type Fetch, type PdfConverter } from "./types";

export const COMPDF_DEFAULT_URL = "https://api-server.compdf.com";

export type ComPdfEnv = {
  /** Public Key trong mục API Keys của ComPDF (không phải Secret Key). */
  apiKey?: string | undefined;
  /** Đổi máy chủ API khi ComPDF đổi địa chỉ; bỏ trống dùng mặc định. */
  url?: string | undefined;
};

type ComPdfFile = { downloadUrl?: string | null; status?: string | null; failureCode?: string | null; failureReason?: string | null };
type ComPdfResult = { code?: string | number; message?: string; msg?: string; data?: (ComPdfFile & { fileInfoDTOList?: ComPdfFile[] | null }) | null };

/**
 * ComPDF (compdf.com): gửi file lên /server/v2/process/xlsx/pdf (xử lý xong mới trả lời), lấy downloadUrl của
 * file kết quả rồi tải PDF về. Mỗi lần gọi trừ 1 lượt "Conversion & Editor"; file trên máy chủ ComPDF tự xóa sau 2 ngày.
 * Trả về null khi chưa có khóa API.
 */
export function createComPdfConverter(env: ComPdfEnv, fetcher: Fetch = fetch): PdfConverter | null {
  if (!env.apiKey) return null;
  const apiKey = env.apiKey;
  const baseUrl = (env.url || COMPDF_DEFAULT_URL).replace(/\/$/, "");
  return {
    name: "ComPDF",
    async convert(xlsx) {
      const form = new FormData();
      form.append("file", new Blob([xlsx.slice().buffer], { type: XLSX_TYPE }), "hoso.xlsx");
      form.append("password", "");
      form.append("language", "1");
      let result: ComPdfResult | null;
      try {
        const response = await fetcher(`${baseUrl}/server/v2/process/xlsx/pdf`, { method: "POST", body: form, headers: { "x-api-key": apiKey } });
        result = await response.json().catch(() => null) as ComPdfResult | null;
        if (response.status === 401 || response.status === 403) throw new PdfConvertFailure("PDF_CONVERTER_KEY", "ComPDF từ chối khóa API (COMPDF_API_KEY sai hoặc đã bị thu hồi).");
        if (!response.ok && !result) throw new PdfConvertFailure("PDF_CONVERTER_FAILED", `ComPDF báo lỗi (${response.status}).`);
      } catch (error) {
        if (error instanceof PdfConvertFailure) throw error;
        throw new PdfConvertFailure("PDF_CONVERTER_DOWN", "Không kết nối được ComPDF, hãy thử lại sau ít giây.");
      }
      // Thực tế v2 trả thông tin file thẳng trong data; tài liệu lại mô tả danh sách data.fileInfoDTOList → đọc cả hai
      const file = result?.data?.fileInfoDTOList?.[0] ?? result?.data;
      if (String(result?.code) !== "200" || !file?.downloadUrl) {
        const reason = file?.failureReason || result?.message || result?.msg || "không rõ lý do";
        throw new PdfConvertFailure("PDF_CONVERTER_FAILED", `ComPDF không chuyển được file: ${reason}.`);
      }
      let download: Response;
      try {
        download = await fetcher(file.downloadUrl);
      } catch {
        throw new PdfConvertFailure("PDF_CONVERTER_DOWN", "Không tải được PDF từ ComPDF, hãy thử lại sau ít giây.");
      }
      if (!download.ok) throw new PdfConvertFailure("PDF_CONVERTER_FAILED", `Không tải được PDF từ ComPDF (${download.status}).`);
      return assertPdf(new Uint8Array(await download.arrayBuffer()), "ComPDF");
    },
  };
}
