import { describe, expect, it, vi } from "vitest";
import { handlePhotoAiRequest, MAX_PHOTO_AI_BYTES, PHOTO_AI_FALLBACK_MODEL, PHOTO_AI_MODEL } from "./photoAi";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const env = { cloudflareAccountId: "acc", cloudflareApiToken: "tok" };
const request = (file: File | null, headers: Record<string, string> = {}) => {
  const body = new FormData();
  if (file) body.set("image", file);
  return new Request("http://localhost/api/photo-3x4", { method: "POST", body, headers });
};
const photo = (bytes: Uint8Array = JPEG, type = "image/jpeg") => new File([bytes.slice()], "anh.jpg", { type });
const cloudflareOk = () => vi.fn(async () => Response.json({ success: true, result: { image: btoa(String.fromCharCode(...JPEG)) } }));

describe("handlePhotoAiRequest", () => {
  it("sends the photo to Workers AI and returns the edited JPEG", async () => {
    const fetcher = cloudflareOk();
    const response = await handlePhotoAiRequest(request(photo()), env, fetcher);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/acc/ai/run/${PHOTO_AI_MODEL}`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const body = init.body as FormData;
    expect(body.get("input_image_0")).toBeInstanceOf(Blob);
    expect([body.get("width"), body.get("height")]).toEqual(["768", "1024"]);
    expect(String(body.get("prompt"))).toContain("3:4");
  });

  it("retries with the smaller fallback model when Workers AI has an internal error", async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith(PHOTO_AI_MODEL)
      ? Response.json({ success: false, errors: [{ code: 3043, message: "AiError: Internal server error" }] }, { status: 500 })
      : Response.json({ success: true, result: { image: btoa(String.fromCharCode(...JPEG)) } }));
    const response = await handlePhotoAiRequest(request(photo()), env, fetcher);
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls.map((call) => (call as unknown as [string])[0].split("/run/")[1])).toEqual([PHOTO_AI_MODEL, PHOTO_AI_FALLBACK_MODEL]);
  });

  it("rejects when not configured or the upload is invalid", async () => {
    const ok = cloudflareOk();
    expect((await handlePhotoAiRequest(request(photo()), {}, ok)).status).toBe(503);
    expect((await handlePhotoAiRequest(request(null), env, ok)).status).toBe(400);
    expect((await handlePhotoAiRequest(request(photo(JPEG, "image/gif")), env, ok)).status).toBe(415);
    expect((await handlePhotoAiRequest(request(photo(new Uint8Array(MAX_PHOTO_AI_BYTES + 1))), env, ok)).status).toBe(413);
    expect(ok).not.toHaveBeenCalled();
  });

  it("reports Workers AI failures, with a clear message when the daily free quota is used up", async () => {
    const quota = vi.fn(async () => Response.json({ success: false, errors: [{ code: 4006, message: "you have used up your daily free allocation of 10,000 neurons" }] }, { status: 429 }));
    const quotaResponse = await handlePhotoAiRequest(request(photo()), env, quota);
    expect(quotaResponse.status).toBe(429);
    expect((await quotaResponse.json()).code).toBe("PHOTO_AI_QUOTA");
    const broken = vi.fn(async () => Response.json({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }, { status: 401 }));
    expect((await (await handlePhotoAiRequest(request(photo()), env, broken)).json()).code).toBe("PHOTO_AI_FAILED");
    const offline = vi.fn(async () => { throw new Error("offline"); });
    expect((await handlePhotoAiRequest(request(photo()), env, offline)).status).toBe(502);
  });

  it("requires a valid Supabase session when Supabase is configured", async () => {
    const live = { ...env, supabaseUrl: "https://abc.supabase.co", supabaseKey: "pk" };
    const fetcher = vi.fn(async (url: string) => url.endsWith("/auth/v1/user") ? new Response("{}") : Response.json({ result: { image: btoa("x") } }));
    expect((await handlePhotoAiRequest(request(photo()), live, fetcher)).status).toBe(401);
    expect((await handlePhotoAiRequest(request(photo(), { authorization: "Bearer good" }), live, fetcher)).status).toBe(200);
  });
});
