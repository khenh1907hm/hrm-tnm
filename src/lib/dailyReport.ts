/**
 * Máy chủ cho báo cáo ngày: gọi Python (scripts/daily_report) để đọc ảnh bảng phân công và điền mẫu Excel,
 * rồi gửi file vào nhóm Telegram. Ảnh chỉ nằm trong thư mục tạm của một yêu cầu và bị xóa ngay sau đó.
 *
 * Biến môi trường: DAILY_REPORT_PYTHON (mặc định python3, Windows: python), DAILY_REPORT_TELEGRAM_BOT_TOKEN (không có thì dùng TELEGRAM_BOT_TOKEN),
 * DAILY_REPORT_TELEGRAM_CHAT_ID, cùng biến của read_board.py (DAILY_REPORT_VISION_*, CLOUDFLARE_*, GEMINI_API_KEY / GEMINI_VISION_MODEL, ANTHROPIC_API_KEY).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DAILY_MAX_PHOTOS } from "../modules/projects/dailyReport";

type Env = { supabaseUrl?: string | undefined; supabaseKey?: string | undefined };
const SCRIPTS = path.join(process.cwd(), "scripts", "daily_report");
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (status: number, message: string) => json(status, { ok: false, message });

function python(): string {
  return process.env.DAILY_REPORT_PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3");
}

function runPython(script: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(python(), [path.join(SCRIPTS, script), ...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }, (error, stdout, stderr) => {
      // read_board.py trả mã 2 kèm JSON báo lỗi cho người dùng: vẫn đọc stdout
      if (stdout.trim()) { resolve(stdout); return; }
      if (error) {
        console.error(`[daily-report] ${script} lỗi: ${stderr.slice(-500)}`);
        reject(new Error((error as NodeJS.ErrnoException).code === "ENOENT" ? "Máy chủ chưa cài Python." : "Xử lý báo cáo trên máy chủ bị lỗi."));
        return;
      }
      resolve(stdout);
    });
  });
}

/** Người gửi phải là PM / CHT của dự án hoặc có quyền quản lý dự án (hàm daily_report_can_send). Chế độ demo (không Supabase) bỏ qua. */
async function canSend(request: Request, env: Env, projectId: string): Promise<boolean> {
  if (!env.supabaseUrl || !env.supabaseKey) return true;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || !/^[0-9a-f-]{36}$/i.test(projectId)) return false;
  const response = await fetch(`${env.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/daily_report_can_send`, {
    method: "POST", headers: { apikey: env.supabaseKey, authorization: header, "content-type": "application/json" }, body: JSON.stringify({ p_project: projectId }),
  }).catch(() => null);
  return Boolean(response?.ok && (await response.json().catch(() => false)) === true);
}

async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "tnm-bcn-"));
  try { return await work(dir); } finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined); }
}

const extension = (file: File) => file.type === "image/png" ? ".png" : file.type === "image/webp" ? ".webp" : ".jpg";

/** POST /api/daily-report/read: form {project, image, roster(JSON)} → dữ liệu đọc được từ ảnh bảng phân công. */
export async function handleDailyRead(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, "Yêu cầu không hợp lệ.");
  const projectId = String(form.get("project") ?? "");
  const image = form.get("image");
  if (!(image instanceof File) || !image.size) return fail(400, "Chưa có ảnh bảng phân công.");
  if (image.size > MAX_IMAGE_BYTES) return fail(413, "Ảnh quá lớn (tối đa 15 MB).");
  if (!(await canSend(request, env, projectId))) return fail(403, "Chỉ PM hoặc Chỉ huy trưởng của dự án mới lập báo cáo ngày.");
  return withTempDir(async (dir) => {
    const imagePath = path.join(dir, `bang${extension(image)}`);
    const rosterPath = path.join(dir, "roster.json");
    await writeFile(imagePath, Buffer.from(await image.arrayBuffer()));
    await writeFile(rosterPath, String(form.get("roster") ?? "[]"), "utf-8");
    try {
      const out = JSON.parse(await runPython("read_board.py", ["--image", imagePath, "--roster", rosterPath], 150_000)) as { ok: boolean; message?: string; data?: unknown };
      return out.ok ? json(200, out) : fail(422, out.message ?? "Không đọc được ảnh.");
    } catch (error) {
      return fail(500, error instanceof Error ? error.message : "Không đọc được ảnh.");
    }
  });
}

async function sendTelegram(file: Uint8Array, fileName: string, caption: string): Promise<{ sent: boolean; error: string }> {
  // Bot riêng cho báo cáo ngày; không khai báo thì dùng chung bot thông báo nhân sự
  const token = process.env.DAILY_REPORT_TELEGRAM_BOT_TOKEN?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.DAILY_REPORT_TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return { sent: false, error: "Chưa cấu hình nhóm Telegram nhận báo cáo ngày (DAILY_REPORT_TELEGRAM_CHAT_ID)." };
  const body = new FormData();
  body.set("chat_id", chatId);
  body.set("caption", caption);
  body.set("document", new Blob([file.slice().buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body, signal: AbortSignal.timeout(60_000) });
    const reply = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
    if (response.ok && reply?.ok) return { sent: true, error: "" };
    // Mô tả lỗi của Telegram không chứa token
    return { sent: false, error: reply?.description ?? "Telegram từ chối file báo cáo." };
  } catch {
    return { sent: false, error: "Không kết nối được Telegram." };
  }
}

/**
 * POST /api/daily-report/send: form {project, data(JSON đã lưu + lũy kế + caption), photos[] ≤ 12, không bắt buộc}
 * → điền mẫu "BC ngày" kèm ảnh, gửi Telegram, trả file (base64) để tải nếu cần.
 */
export async function handleDailySend(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, "Yêu cầu không hợp lệ.");
  const projectId = String(form.get("project") ?? "");
  if (!(await canSend(request, env, projectId))) return fail(403, "Chỉ PM hoặc Chỉ huy trưởng của dự án mới gửi báo cáo ngày.");
  let data: Record<string, unknown>;
  try { data = JSON.parse(String(form.get("data") ?? "")) as Record<string, unknown>; } catch { return fail(400, "Dữ liệu báo cáo không hợp lệ."); }
  const photos = form.getAll("photos").filter((item): item is File => item instanceof File && item.size > 0).slice(0, DAILY_MAX_PHOTOS);
  if (photos.some((photo) => photo.size > MAX_IMAGE_BYTES || (photo.type && !PHOTO_TYPES.has(photo.type)))) return fail(413, "Ảnh thi công phải là JPG/PNG/WebP, tối đa 15 MB mỗi ảnh.");
  return withTempDir(async (dir) => {
    const dataPath = path.join(dir, "report.json");
    const outPath = path.join(dir, "bao-cao.xlsx");
    await writeFile(dataPath, JSON.stringify(data), "utf-8");
    const photoArgs: string[] = [];
    for (const [index, photo] of photos.entries()) {
      const photoPath = path.join(dir, `anh-${index + 1}${extension(photo)}`);
      await writeFile(photoPath, Buffer.from(await photo.arrayBuffer()));
      photoArgs.push("--photo", photoPath);
    }
    try {
      await runPython("fill_report.py", ["--data", dataPath, "--out", outPath, ...photoArgs], 90_000);
    } catch (error) {
      return fail(500, error instanceof Error ? error.message : "Không tạo được file báo cáo.");
    }
    const file = new Uint8Array(await readFile(outPath));
    const fileName = `BC-ngay-${String(data.projectCode ?? "du-an").replace(/[^\w.-]+/g, "-")}-${String(data.date ?? "")}.xlsx`;
    const telegram = await sendTelegram(file, fileName, String(data.caption ?? "Báo cáo ngày"));
    return json(200, { ok: true, sent: telegram.sent, telegramError: telegram.error, fileName, file: Buffer.from(file).toString("base64") });
  });
}
