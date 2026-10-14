import { useEffect, useState } from "react";
import type { ExcelReportTemplate } from "../../modules/excel-template/types";
import { createDefaultDemoTemplate, loadTemplates, saveTemplates } from "../../modules/excel-template/templateStorage";

/** Mẫu báo cáo lưu trong localStorage; lần đầu tạo sẵn một mẫu demo. */
export function useReportTemplates() {
  const [templates, setTemplates] = useState<ExcelReportTemplate[]>([]);
  useEffect(() => {
    let active = true;
    const saved = loadTemplates();
    const ready = saved.length > 0
      ? Promise.resolve(saved)
      : createDefaultDemoTemplate().then((demoTpl) => { saveTemplates([demoTpl]); return [demoTpl]; });
    void ready.then((list) => { if (active) setTemplates(list); });
    return () => { active = false; };
  }, []);
  return [templates, setTemplates] as const;
}
