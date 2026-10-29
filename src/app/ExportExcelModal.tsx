"use client";
import type { SignatureFileLoader } from "./_components/SignerPicker";
import { Download, FileText, Settings } from "lucide-react";
import { useState } from "react";
import type { Employee } from "../modules/employees/types";
import type { ExcelReportTemplate, ProfileTemplateConfig } from "../modules/excel-template/types";
import { mapEmployeeToExcelData } from "../modules/excel-template/types";
import { base64ToUint8Array } from "../modules/excel-template/templateStorage";
import { populateExcelTemplate } from "../modules/excel-template/populateTemplate";
import type { Actor } from "../modules/auth/permissions";
import type { Certificate } from "../modules/certificates/types";
import { ProfileExportForm } from "./_components/ProfileExportForm";
import type { App } from "./_components/shared";

interface ExportExcelModalProps {
  employee: Employee;
  templates: ExcelReportTemplate[];
  onClose: () => void;
  setNotice: (msg: string) => void;
  onGoToTemplatesConfig: () => void;
  app: App;
  actor: Actor;
  certificates: readonly Certificate[];
  sessionFiles: Readonly<Record<string, File>>;
  /** Tải ảnh chữ ký của người ký (cho vùng IMG_signature). */
  loadSignatureFile?: SignatureFileLoader;
  /** Nút "Xuất hồ sơ PDF": chỉ mẫu hồ sơ, chỉ tải PDF gộp (phiếu + chứng chỉ). */
  pdfOnly?: boolean;
  /** Lưu quy tắc đặt tên (tệp hồ sơ, xuất riêng chứng chỉ) vào mẫu khi đổi ở hộp thoại xuất. */
  onSaveNaming?: (templateId: string, patch: Pick<ProfileTemplateConfig, "fileNamePattern" | "certificateExport">) => void;
}

export function ExportExcelModal({
  employee,
  templates: allTemplates,
  onClose,
  setNotice,
  onGoToTemplatesConfig,
  app,
  actor,
  certificates,
  sessionFiles,
  loadSignatureFile,
  pdfOnly = false,
  onSaveNaming,
}: ExportExcelModalProps) {
  const templates = pdfOnly ? allTemplates.filter((template) => template.profile) : allTemplates;
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  const activeTemplate = templates.find((t) => t.id === selectedTemplateId) ?? templates[0];
  const employeeData = mapEmployeeToExcelData(employee);

  const handleExport = async () => {
    if (!activeTemplate) {
      setNotice("Vui lòng chọn mẫu báo cáo.");
      return;
    }
    setBusy(true);
    try {
      const templateBytes = base64ToUint8Array(activeTemplate.fileBase64);
      const outputBytes = await populateExcelTemplate({
        templateBuffer: templateBytes,
        mappings: activeTemplate.mappings,
        data: employeeData,
        sheetName: activeTemplate.sheetName,
      });

      const blob = new Blob([outputBytes as unknown as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cleanName = employee.name.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, "_");
      a.download = `${activeTemplate.name}_${cleanName}_${employee.code}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);

      setNotice(`Đã xuất báo cáo Excel cho nhân sự ${employee.name}!`);
      onClose();
    } catch {
      setNotice("Có lỗi khi xuất file Excel. Vui lòng kiểm tra lại tệp mẫu.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" style={{ maxWidth: activeTemplate?.profile ? "820px" : "600px" }}>
        <header>
          <h2>{pdfOnly ? "Xuất hồ sơ PDF (.zip: phiếu Excel + PDF gộp chứng chỉ)" : "Xuất hồ sơ theo mẫu (Excel / PDF gộp)"}</h2>
          <button type="button" className="close" onClick={onClose}>
            ×
          </button>
        </header>

        <div style={{ padding: "18px" }}>
          <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "6px", border: "1px solid #e2e8f0", marginBottom: "16px" }}>
            <div style={{ fontSize: "14px", fontWeight: "bold", color: "#0f172a" }}>
              Nhân sự: {employee.name} ({employee.code})
            </div>
            <div style={{ fontSize: "13px", color: "#64748b", marginTop: "4px" }}>
              Chức vụ: {employee.position} · CCCD: {employee.cccd}
            </div>
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label className="field">
              <span>{pdfOnly ? "Chọn mẫu hồ sơ:" : "Chọn mẫu báo cáo Excel:"}</span>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
              >
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.profile ? `${tpl.name} (mẫu hồ sơ)` : `${tpl.name} (${tpl.mappings.length} ô quy định)`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {activeTemplate?.profile ? (
            <ProfileExportForm key={activeTemplate.id} app={app} actor={actor} template={{ ...activeTemplate, profile: activeTemplate.profile }} employee={employee} certificates={certificates} sessionFiles={sessionFiles} setNotice={setNotice} loadSignatureFile={loadSignatureFile} pdfOnly={pdfOnly} onSaveNaming={onSaveNaming ? (patch) => onSaveNaming(activeTemplate.id, patch) : undefined} />
          ) : activeTemplate ? (
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "12px", borderRadius: "6px", fontSize: "13px", marginBottom: "16px" }}>
              <div style={{ fontWeight: "bold", color: "#166534", marginBottom: "6px" }}>
                <FileText className="ico" size={16} aria-hidden="true" /> {activeTemplate.name}
              </div>
              <div style={{ color: "#15803d", marginBottom: "8px" }}>
                {activeTemplate.description || "Mẫu báo cáo tự động điền dữ liệu."}
              </div>
              <div style={{ fontSize: "12px", color: "#166534" }}>
                <b>Tệp mẫu:</b> {activeTemplate.fileName} · <b>Số ô sẽ được điền:</b> {activeTemplate.mappings.length} ô
              </div>
            </div>
          ) : (
            <div style={{ color: "#b91c1c", fontSize: "13px", marginBottom: "16px" }}>
              Chưa có mẫu nào được tạo. Bạn có thể vào mục &quot;FORM Báo cáo&quot; để tạo mẫu mới.
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button
              type="button"
              className="button"
              style={{ fontSize: "12px", color: "#3b82f6" }}
              onClick={() => {
                onClose();
                onGoToTemplatesConfig();
              }}
            >
              <Settings className="ico" size={16} aria-hidden="true" /> Quản lý &amp; Cài đặt mẫu khác
            </button>
          </div>
        </div>

        <footer>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Đóng
          </button>
          <button
            type="button"
            className="button primary"
           
            onClick={() => void handleExport()}
            disabled={busy || !activeTemplate}
            hidden={Boolean(activeTemplate?.profile)}
          >
            {busy ? "Đang tạo tệp Excel…" : <><Download className="ico" size={16} aria-hidden="true" /> Tải tệp Excel (.xlsx)</>}
          </button>
        </footer>
      </div>
    </div>
  );
}
