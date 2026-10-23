import { describe, expect, it, vi } from "vitest";
import { pickPdfConverter } from "./index";

const fetcher = vi.fn(async () => new Response());

describe("pickPdfConverter", () => {
  it("uses the first configured provider when PDF_CONVERTER is not set (ComPDF before Gotenberg)", () => {
    expect(pickPdfConverter({ compdfApiKey: "k", gotenbergUrl: "https://g.test" }, fetcher).converter?.name).toBe("ComPDF");
    expect(pickPdfConverter({ gotenbergUrl: "https://g.test" }, fetcher).converter?.name).toBe("Gotenberg");
  });

  it("follows PDF_CONVERTER when set, case-insensitive", () => {
    expect(pickPdfConverter({ provider: " Gotenberg ", compdfApiKey: "k", gotenbergUrl: "https://g.test" }, fetcher).converter?.name).toBe("Gotenberg");
    expect(pickPdfConverter({ provider: "compdf", compdfApiKey: "k" }, fetcher).converter?.name).toBe("ComPDF");
  });

  it("says exactly what is missing", () => {
    expect(pickPdfConverter({}, fetcher)).toEqual({ converter: null, problem: "Chưa cấu hình máy chuyển PDF (COMPDF_API_KEY hoặc GOTENBERG_URL)." });
    expect(pickPdfConverter({ provider: "compdf", gotenbergUrl: "https://g.test" }, fetcher)).toEqual({ converter: null, problem: "Đã chọn PDF_CONVERTER=compdf nhưng chưa đặt COMPDF_API_KEY." });
    expect(pickPdfConverter({ provider: "ilovepdf", compdfApiKey: "k" }, fetcher)).toEqual({ converter: null, problem: "PDF_CONVERTER=\"ilovepdf\" không hợp lệ, chỉ nhận: compdf, gotenberg." });
  });
});
