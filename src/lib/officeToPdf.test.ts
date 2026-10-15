import { describe, expect, it, vi } from "vitest";
import { handleConvertRequest, MAX_XLSX_BYTES } from "./officeToPdf";

const XLSX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
const request = (body: Uint8Array, headers: Record<string, string> = {}) => new Request("http://localhost/api/convert-pdf", { method: "POST", body: body.slice().buffer, headers });
const env = { gotenbergUrl: "https://pdf.example.test/" };

describe("handleConvertRequest", () => {
  it("forwards the workbook to Gotenberg and returns the PDF", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([0x25, 0x50]), { status: 200 }));
    const response = await handleConvertRequest(request(XLSX), { ...env, gotenbergUsername: "u", gotenbergPassword: "p" }, fetcher);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50]));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://pdf.example.test/forms/libreoffice/convert");
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa("u:p")}`);
    expect((init.body as FormData).get("files")).toBeInstanceOf(Blob);
  });

  it("sends no basic auth when credentials are not configured", async () => {
    const fetcher = vi.fn(async () => new Response("%PDF"));
    await handleConvertRequest(request(XLSX), env, fetcher);
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({});
  });

  it("rejects when the converter is missing, the body is invalid or the converter fails", async () => {
    const ok = vi.fn(async () => new Response("%PDF"));
    expect((await handleConvertRequest(request(XLSX), {}, ok)).status).toBe(503);
    expect((await handleConvertRequest(request(new Uint8Array()), env, ok)).status).toBe(413);
    expect((await handleConvertRequest(request(new Uint8Array(MAX_XLSX_BYTES + 1)), env, ok)).status).toBe(413);
    expect((await handleConvertRequest(request(new Uint8Array([1, 2, 3, 4])), env, ok)).status).toBe(415);
    const down = vi.fn(async () => { throw new Error("offline"); });
    expect((await handleConvertRequest(request(XLSX), env, down)).status).toBe(502);
    const failed = await handleConvertRequest(request(XLSX), env, vi.fn(async () => new Response("x", { status: 500 })));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ code: "PDF_CONVERTER_FAILED", message: "Máy chủ chuyển PDF báo lỗi (500)." });
  });

  it("requires a valid Supabase session when Supabase is configured", async () => {
    const live = { ...env, supabaseUrl: "https://abc.supabase.co/", supabaseKey: "pk" };
    const fetcher = vi.fn(async (url: string) => url.endsWith("/auth/v1/user") ? new Response("{}", { status: 200 }) : new Response("%PDF"));
    expect((await handleConvertRequest(request(XLSX), live, fetcher)).status).toBe(401);
    expect((await handleConvertRequest(request(XLSX, { authorization: "Bearer good" }), live, fetcher)).status).toBe(200);
    expect(fetcher.mock.calls[0]).toEqual(["https://abc.supabase.co/auth/v1/user", { headers: { apikey: "pk", authorization: "Bearer good" } }]);
    const denied = vi.fn(async () => new Response("{}", { status: 401 }));
    expect((await handleConvertRequest(request(XLSX, { authorization: "Bearer bad" }), live, denied)).status).toBe(401);
  });
});
