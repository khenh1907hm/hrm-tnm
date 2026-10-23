import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanProfileConfig, profileConfigFromScan } from "../../modules/excel-template/engine/profileConfig";
import { scanTemplate } from "../../modules/excel-template/engine/scanTemplate";
import type { ExcelReportTemplate, ProfileCustomField } from "../../modules/excel-template/types";
import { createDefaultDemoTemplate, loadTemplates, saveTemplates, uint8ArrayToBase64 } from "../../modules/excel-template/templateStorage";

type SeedEntry = { id: string; name: string; description?: string; file: string; customFields?: ProfileCustomField[]; attachments?: string[] };

/**
 * Mẫu hồ sơ đặt sẵn trên máy trong public/templates (không đưa lên git vì có logo, chữ ký, con dấu).
 * Không có thư mục này thì bỏ qua.
 */
async function loadSeedTemplates(existingIds: ReadonlySet<string>): Promise<ExcelReportTemplate[]> {
  try {
    const response = await fetch("/templates/index.json", { cache: "no-store" });
    if (!response.ok) return [];
    const entries = (await response.json()) as SeedEntry[];
    const seeds: ExcelReportTemplate[] = [];
    for (const entry of entries.filter((item) => !existingIds.has(item.id))) {
      const file = await fetch(`/templates/${entry.file}`, { cache: "no-store" });
      if (!file.ok) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const scanned = profileConfigFromScan(await scanTemplate(bytes));
      const profile = {
        ...scanned,
        customFields: scanned.customFields.map((field) => entry.customFields?.find((item) => item.key === field.key) ?? field),
        attachments: entry.attachments ?? scanned.attachments,
      };
      const now = new Date().toISOString();
      seeds.push({ id: entry.id, name: entry.name, description: entry.description ?? "", fileName: entry.file, fileBase64: uint8ArrayToBase64(bytes), sheetName: profile.sheetName, mappings: [], profile, createdAt: now, updatedAt: now });
    }
    return seeds;
  } catch {
    return [];
  }
}

/** Nơi lưu mẫu: bảng report_templates (chế độ thật) hoặc localStorage (chế độ demo). */
function templateStore(client: SupabaseClient | null) {
  return {
    async load(): Promise<ExcelReportTemplate[]> {
      const clean = (template: ExcelReportTemplate) => (template.profile ? { ...template, profile: cleanProfileConfig(template.profile) } : template);
      if (!client) return loadTemplates().map(clean);
      const { data, error } = await client.from("report_templates").select("doc").order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row: { doc: unknown }) => clean(row.doc as ExcelReportTemplate));
    },
    async save(next: ExcelReportTemplate[], previous: readonly ExcelReportTemplate[]): Promise<void> {
      if (!client) { saveTemplates(next); return; }
      const removed = previous.filter((item) => !next.some((candidate) => candidate.id === item.id)).map((item) => item.id);
      const changed = next.filter((item) => previous.find((candidate) => candidate.id === item.id)?.updatedAt !== item.updatedAt);
      if (changed.length) {
        const { error } = await client.from("report_templates").upsert(changed.map((item) => ({ id: item.id, doc: item })));
        if (error) throw new Error(error.message);
      }
      if (removed.length) {
        const { error } = await client.from("report_templates").delete().in("id", removed);
        if (error) throw new Error(error.message);
      }
    },
  };
}

/** Mẫu báo cáo; lần đầu tạo sẵn mẫu demo (chế độ demo) và nạp các mẫu hồ sơ đặt sẵn trên máy. */
export function useReportTemplates(client: SupabaseClient | null = null, onError: (message: string) => void = () => undefined) {
  const [templates, setTemplates] = useState<ExcelReportTemplate[]>([]);
  const current = useRef<ExcelReportTemplate[]>([]);
  const store = useRef(templateStore(client));

  useEffect(() => {
    let active = true;
    const run = async () => {
      const saved = await store.current.load();
      const base = saved.length > 0 || client ? saved : [await createDefaultDemoTemplate()];
      const seeds = await loadSeedTemplates(new Set(base.map((item) => item.id)));
      const merged = [...seeds, ...base];
      if (seeds.length || (!saved.length && !client)) await store.current.save(merged, saved);
      return merged;
    };
    void run().then((list) => { if (active) { current.current = list; setTemplates(list); } }).catch((error: unknown) => onError(error instanceof Error ? `Không tải được mẫu báo cáo: ${error.message}` : "Không tải được mẫu báo cáo."));
    return () => { active = false; };
  }, [client, onError]);

  const update = useCallback((next: ExcelReportTemplate[]) => {
    const previous = current.current;
    current.current = next;
    setTemplates(next);
    void store.current.save(next, previous).catch((error: unknown) => onError(error instanceof Error ? `Không lưu được mẫu báo cáo: ${error.message}` : "Không lưu được mẫu báo cáo."));
  }, [onError]);

  return [templates, update] as const;
}
