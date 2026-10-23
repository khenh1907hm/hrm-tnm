/**
 * Máy chuyển Excel → PDF. Mỗi nhà cung cấp (ComPDF, Gotenberg…) là một file trong thư mục này, cùng một giao diện,
 * để đổi gói / đổi bên chỉ cần đổi biến môi trường, không đụng tới route hay giao diện.
 */
export type PdfConverter = {
  /** Tên hiển thị trong thông báo lỗi, vd "ComPDF". */
  readonly name: string;
  /** Nhận file .xlsx, trả về PDF. Lỗi thì ném PdfConvertFailure. */
  convert(xlsx: Uint8Array): Promise<Uint8Array>;
};

export type PdfConvertFailureCode =
  /** Không kết nối được (mạng, máy chủ đang khởi động). */
  | "PDF_CONVERTER_DOWN"
  /** Khóa API sai hoặc bị thu hồi. */
  | "PDF_CONVERTER_KEY"
  /** Nhà cung cấp báo lỗi (hết lượt, file lỗi…) hoặc trả về thứ không phải PDF. */
  | "PDF_CONVERTER_FAILED";

export class PdfConvertFailure extends Error {
  constructor(readonly code: PdfConvertFailureCode, message: string) { super(message); }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

/** Kiểm tra kết quả đúng là PDF (%PDF) trước khi trả về, tránh tải về trang lỗi HTML đội lốt PDF. */
export function assertPdf(bytes: Uint8Array, provider: string): Uint8Array {
  if (!PDF_MAGIC.every((value, index) => bytes[index] === value)) throw new PdfConvertFailure("PDF_CONVERTER_FAILED", `${provider} trả về tệp không phải PDF.`);
  return bytes;
}
