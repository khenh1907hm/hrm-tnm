import { describe, expect, it, vi } from "vitest";
import { handleConvertRequest, MAX_XLSX_BYTES } from "./officeToPdf";

const XLSX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const request = (body: Uint8Array, headers: Record<string, string> = {}) => new Request("http://localhost/api/convert-pdf", { method: "POST", body: body.slice().buffer, headers });
const env = { gotenbergUrl: "https://pdf.example.test/" };

describe("handleConvertRequest", () => {
  it("forwards the workbook to Gotenberg and returns the PDF", async () => {
    const fetcher = vi.fn(async () => new Response(PDF, { status: 200 }));
    const response = await handleConvertRequest(request(XLSX), { ...env, gotenbergUsername: "u", gotenbergPassword: "p" }, fetcher);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://pdf.example.test/forms/libreoffice/convert");
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa("u:p")}`);
    expect((init.body as FormData).get("files")).toBeInstanceOf(Blob);
    // Ảnh giữ nguyên chất lượng như trong Excel
    expect((init.body as FormData).get("losslessImageCompression")).toBe("true");
    expect((init.body as FormData).get("reduceImageResolution")).toBe("false");
  });

  it("sends no basic auth when credentials are not configured", async () => {
    const fetcher = vi.fn(async () => new Response(PDF));
    await handleConvertRequest(request(XLSX), env, fetcher);
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({});
  });

  it("rejects when the converter is missing, the body is invalid or the converter fails", async () => {
    const ok = vi.fn(async () => new Response(PDF));
    expect((await handleConvertRequest(request(XLSX), {}, ok)).status).toBe(503);
    expect((await handleConvertRequest(request(new Uint8Array()), env, ok)).status).toBe(400);
    const tooLarge = await handleConvertRequest(request(new Uint8Array(Math.round(5.2 * 1024 * 1024))), env, ok);
    expect(tooLarge.status).toBe(413);
    // Nói rõ file nặng bao nhiêu để người dùng biết cần làm nhẹ ảnh
    expect((await tooLarge.json()).message).toContain("nặng 5.2 MB");
    expect((await handleConvertRequest(request(new Uint8Array(MAX_XLSX_BYTES + 1)), env, ok)).status).toBe(413);
    expect((await handleConvertRequest(request(new Uint8Array([1, 2, 3, 4])), env, ok)).status).toBe(415);
    const down = vi.fn(async () => { throw new Error("offline"); });
    expect((await handleConvertRequest(request(XLSX), env, down)).status).toBe(502);
    const failed = await handleConvertRequest(request(XLSX), env, vi.fn(async () => new Response("x", { status: 500 })));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ code: "PDF_CONVERTER_FAILED", message: "Máy chủ chuyển PDF báo lỗi (500)." });
  });

  it("uses ComPDF when an API key is set: uploads the workbook, then downloads the converted PDF", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const fetcher = vi.fn(async (url: string) => url.endsWith("/server/v2/process/xlsx/pdf")
      ? Response.json({ code: "200", message: "success", data: { fileInfoDTOList: [{ downloadUrl: "https://files.compdf.test/hoso.pdf", status: "success" }] } })
      : new Response(pdf));
    const response = await handleConvertRequest(request(XLSX), { compdfApiKey: "public_key", gotenbergUrl: "https://ignored.test" }, fetcher);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-server.compdf.com/server/v2/process/xlsx/pdf");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("public_key");
    expect((init.body as FormData).get("file")).toBeInstanceOf(Blob);
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://files.compdf.test/hoso.pdf");
  });

  it("reads the file info ComPDF actually returns directly under data", async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith("/server/v2/process/xlsx/pdf")
      ? Response.json({ code: "200", msg: "success", data: { taskId: "t", fileName: "hoso.xlsx", downloadUrl: "https://storage.test/hoso.pdf", status: "success", failureCode: null, failureReason: null } })
      : new Response(PDF));
    const response = await handleConvertRequest(request(XLSX), { compdfApiKey: "k" }, fetcher);
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://storage.test/hoso.pdf");
  });

  it("reports ComPDF failures with the reason ComPDF gives", async () => {
    const env = { compdfApiKey: "k" };
    const failedTask = vi.fn(async () => Response.json({ code: "200", data: { fileInfoDTOList: [{ downloadUrl: null, status: "failed", failureReason: "File is encrypted" }] } }));
    const failed = await handleConvertRequest(request(XLSX), env, failedTask);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ code: "PDF_CONVERTER_FAILED", message: "ComPDF không chuyển được file: File is encrypted." });
    const quota = vi.fn(async () => Response.json({ code: "06001", message: "Insufficient balance" }));
    expect((await (await handleConvertRequest(request(XLSX), env, quota)).json()).message).toBe("ComPDF không chuyển được file: Insufficient balance.");
    const badKey = vi.fn(async () => new Response("{}", { status: 401 }));
    expect((await (await handleConvertRequest(request(XLSX), env, badKey)).json()).code).toBe("PDF_CONVERTER_KEY");
    const notPdf = vi.fn(async (url: string) => url.includes("/process/") ? Response.json({ code: "200", data: { fileInfoDTOList: [{ downloadUrl: "https://x.test/a" }] } }) : new Response("<html>"));
    expect((await (await handleConvertRequest(request(XLSX), env, notPdf)).json()).message).toBe("ComPDF trả về tệp không phải PDF.");
    const offline = vi.fn(async () => { throw new Error("offline"); });
    expect((await (await handleConvertRequest(request(XLSX), env, offline)).json()).code).toBe("PDF_CONVERTER_DOWN");
  });

  it("requires a valid Supabase session when Supabase is configured", async () => {
    const live = { ...env, supabaseUrl: "https://abc.supabase.co/", supabaseKey: "pk" };
    const fetcher = vi.fn(async (url: string) => url.endsWith("/auth/v1/user") ? new Response("{}", { status: 200 }) : new Response(PDF));
    expect((await handleConvertRequest(request(XLSX), live, fetcher)).status).toBe(401);
    expect((await handleConvertRequest(request(XLSX, { authorization: "Bearer good" }), live, fetcher)).status).toBe(200);
    expect(fetcher.mock.calls[0]).toEqual(["https://abc.supabase.co/auth/v1/user", { headers: { apikey: "pk", authorization: "Bearer good" } }]);
    const denied = vi.fn(async () => new Response("{}", { status: 401 }));
    expect((await handleConvertRequest(request(XLSX, { authorization: "Bearer bad" }), live, denied)).status).toBe(401);
  });
});
