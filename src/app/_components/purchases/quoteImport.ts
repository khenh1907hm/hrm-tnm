"use client";
import { getSupabaseClient } from "../../../lib/supabase/client";
import { parseQuoteRows, type QuoteData } from "../../../modules/purchases/quoteParse";

/**
 * Đọc báo giá NCC: (1) PDF có chữ → dò ngay trên máy, không tốn gì; (2) không chắc / bản scan / ảnh → nhờ Gemini ở máy chủ.
 */
export type QuoteReadResult = { data: QuoteData; source: "text" | "ai"; problems: string[] };

const MAX_PAGES = 3;

type TextItem = { str: string; transform: number[] };

/** Chữ của PDF xếp thành dòng (cùng tung độ), mỗi dòng các ô theo hoành độ. */
async function pdfRows(file: Blob): Promise<{ rows: string[][]; images: string[] }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  try {
    const rows: string[][] = [];
    const images: string[] = [];
    for (let number = 1; number <= Math.min(pdf.numPages, MAX_PAGES); number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const lines: { y: number; parts: { x: number; s: string }[] }[] = [];
      for (const raw of content.items) {
        const item = raw as unknown as TextItem;
        if (typeof item.str !== "string" || !item.str.trim()) continue;
        const y = Math.round(item.transform[5] ?? 0), x = item.transform[4] ?? 0;
        let line = lines.find((entry) => Math.abs(entry.y - y) <= 3);
        if (!line) { line = { y, parts: [] }; lines.push(line); }
        line.parts.push({ x, s: item.str.trim() });
      }
      lines.sort((a, b) => b.y - a.y);
      for (const line of lines) rows.push(line.parts.sort((a, b) => a.x - b.x).map((part) => part.s));
      // Trang gần như không có chữ (bản scan): vẽ ra ảnh để AI đọc
      if (lines.length < 5) {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2.5, 1600 / base.width) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
        await page.render({ canvas, viewport, intent: "print" }).promise;
        images.push(canvas.toDataURL("image/jpeg", 0.85));
      }
    }
    return { rows, images };
  } finally {
    await task.destroy();
  }
}

async function imageData(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Chuẩn hóa JSON Gemini trả về thành QuoteData. */
export function normalizeAi(raw: unknown): QuoteData {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const items = (Array.isArray(data.items) ? data.items : []).map((entry) => {
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const quantity = num(item.quantity) ?? 0, unitPrice = num(item.unitPrice) ?? 0;
    return { name: text(item.name), spec: text(item.spec), unit: text(item.unit), quantity, unitPrice, amount: num(item.amount) ?? Math.round(quantity * unitPrice) };
  }).filter((item) => item.name || item.unitPrice > 0);
  const date = text(data.quoteDate);
  const pct = num(data.advancePct);
  return {
    supplier: text(data.supplier), taxCode: text(data.taxCode), contact: text(data.contact), quoteNo: text(data.quoteNo),
    quoteDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, items,
    subtotal: num(data.subtotal), vat: num(data.vat), total: num(data.total),
    vatIncluded: typeof data.vatIncluded === "boolean" ? data.vatIncluded : null,
    paymentTerms: text(data.paymentTerms), advancePct: pct !== null && pct > 0 && pct < 100 ? pct : null, prepay: data.prepay === true, deliveryText: text(data.deliveryText),
  };
}

async function askAi(payload: { text?: string; images?: string[] }): Promise<QuoteData> {
  const client = getSupabaseClient();
  const token = client ? (await client.auth.getSession()).data.session?.access_token : null;
  if (!token) throw new Error("Cần đăng nhập để nhờ AI đọc báo giá.");
  const response = await fetch("/api/purchases/read-quote", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json().catch(() => null) as { ok?: boolean; data?: unknown; error?: string } | null;
  if (!response.ok || !result?.ok) throw new Error(result?.error ?? "AI chưa đọc được báo giá.");
  return normalizeAi(result.data);
}

/** Đọc một báo giá (PDF hoặc ảnh). */
export async function readQuote(file: File): Promise<QuoteReadResult> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return { data: await askAi({ images: [await imageData(file)] }), source: "ai", problems: [] };
  const { rows, images } = await pdfRows(file);
  const parsed = parseQuoteRows(rows);
  if (parsed.confident) return { data: parsed, source: "text", problems: [] };
  try {
    const textPayload = rows.map((cells) => cells.join(" | ")).join("\n");
    const data = await askAi(textPayload.trim().length > 200 ? { text: textPayload, ...(images.length ? { images } : {}) } : { images });
    return { data, source: "ai", problems: [] };
  } catch (error) {
    // AI không dùng được: trả phần dò được, kèm lý do để người dùng tự kiểm tra
    if (parsed.items.length || parsed.supplier) return { data: parsed, source: "text", problems: [...parsed.problems, error instanceof Error ? error.message : "AI chưa đọc được."] };
    throw error;
  }
}
