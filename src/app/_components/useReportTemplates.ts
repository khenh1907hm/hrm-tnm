import { useEffect, useState } from "react";
import { profileConfigFromScan } from "../../modules/excel-template/engine/profileConfig";
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

/** Mẫu báo cáo lưu trong localStorage; lần đầu tạo sẵn một mẫu demo và nạp các mẫu hồ sơ đặt sẵn. */
export function useReportTemplates() {
  const [templates, setTemplates] = useState<ExcelReportTemplate[]>([]);
  useEffect(() => {
    let active = true;
    const saved = loadTemplates();
    const ready = (saved.length > 0 ? Promise.resolve(saved) : createDefaultDemoTemplate().then((demoTpl) => [demoTpl]))
      .then(async (list) => {
        const seeds = await loadSeedTemplates(new Set(list.map((item) => item.id)));
        const merged = [...seeds, ...list];
        if (seeds.length || !saved.length) saveTemplates(merged);
        return merged;
      });
    void ready.then((list) => { if (active) setTemplates(list); });
    return () => { active = false; };
  }, []);
  return [templates, setTemplates] as const;
}
