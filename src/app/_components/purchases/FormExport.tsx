"use client";
import { useState } from "react";
import { FileDown, FileSpreadsheet } from "lucide-react";
import type { FormCode } from "../../../modules/procurement-forms/forms";
import type { Notify } from "../Toast";
import { errorMessage } from "../projects/projectShared";

export type FormsModule = typeof import("../../../modules/procurement-forms/forms");

/** Tải file mẫu Excel của công ty (public/templates/quy-trinh). P-COST-08 không có mẫu (dựng trong code). */
async function loadTemplate(code: FormCode): Promise<ArrayBuffer | null> {
  if (code === "P-COST-08") return null;
  const response = await fetch(`/templates/quy-trinh/${code}.xlsx`, { cache: "no-cache" });
  if (!response.ok) throw new Error("FORM_TEMPLATE_MISSING");
  return response.arrayBuffer();
}

export function downloadBytes(bytes: Uint8Array, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const safeName = (text: string) => text.normalize("NFC").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);

/**
 * Hai nút "Excel <mã mẫu>" và "PDF": điền dữ liệu đang xem vào đúng mẫu công ty rồi tải về.
 * PDF chuyển từ chính file Excel đó trên máy chủ (cần máy chuyển PDF đã cài; chưa có thì báo rõ).
 */
export function FormExportButtons(props: { code: FormCode; fileBase: string; build: (forms: FormsModule, template: ArrayBuffer | null) => Promise<Uint8Array>; setNotice: Notify; compact?: boolean }) {
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const run = async (format: "xlsx" | "pdf") => {
    setBusy(format);
    try {
      const [forms, template] = await Promise.all([import("../../../modules/procurement-forms/forms"), loadTemplate(props.code)]);
      const bytes = await props.build(forms, template);
      const name = safeName(`${props.code} ${props.fileBase}`);
      if (format === "xlsx") downloadBytes(bytes, `${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      else {
        const { convertXlsxToPdf } = await import("../profileExport");
        downloadBytes(await convertXlsxToPdf(bytes), `${name}.pdf`, "application/pdf");
      }
    } catch (error) {
      props.setNotice(error instanceof Error && !/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : errorMessage(error), "error");
    } finally { setBusy(null); }
  };
  return (
    <span className="button-row form-export">
      <button type="button" className="button" disabled={busy !== null} onClick={() => void run("xlsx")} title={`Tải ${props.code} theo mẫu Excel của công ty`}>
        <FileSpreadsheet className="ico" size={16} aria-hidden="true" /> {busy === "xlsx" ? "Đang tạo…" : props.compact ? "Excel" : `Excel ${props.code}`}
      </button>
      <button type="button" className="button" disabled={busy !== null} onClick={() => void run("pdf")} title="Tải bản PDF (chuyển từ file Excel theo mẫu)">
        <FileDown className="ico" size={16} aria-hidden="true" /> {busy === "pdf" ? "Đang tạo…" : "PDF"}
      </button>
    </span>
  );
}
