"use client";
import { Download, FileText, Lightbulb, Pencil, Play, Plus, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Actor } from "../modules/auth/permissions";
import { profileConfigFromScan } from "../modules/excel-template/engine/profileConfig";
import { parseRange } from "../modules/excel-template/engine/fillWorkbook";
import { scanTemplate } from "../modules/excel-template/engine/scanTemplate";
import { ProfileTemplateEditor } from "./_components/ProfileTemplateEditor";
import { PartnersPanel } from "./_components/PartnersPanel";
import type { PartnerStore } from "./_components/usePartners";
import type { SignatureFileLoader } from "./_components/SignerPicker";
import type { Signature } from "../modules/signatures/types";
import type { App } from "./_components/shared";
import type { Employee } from "../modules/employees/types";
import {
  AVAILABLE_REPORT_FIELDS,
  isValidCellAddress,
  mapEmployeeToExcelData,
  normalizeCellAddress,
  type ExcelCellMapping,
  type ExcelFieldKey,
  type ExcelReportTemplate,
  type ProfileTemplateConfig,
} from "../modules/excel-template/types";
import {
  base64ToUint8Array,
  saveTemplates,
  uint8ArrayToBase64,
} from "../modules/excel-template/templateStorage";
import {
  createDefaultStarterTemplate,
  populateExcelTemplate,
} from "../modules/excel-template/populateTemplate";

interface ReportTemplatesPanelProps {
  templates: ExcelReportTemplate[];
  onTemplatesChange: (updated: ExcelReportTemplate[]) => void;
  employees: Employee[];
  setNotice: (msg: string) => void;
  app: App;
  actor: Actor;
  /** Đối tác (tên + ảnh) để chọn nhanh làm ảnh dự án. */
  partners: PartnerStore;
  /** Tải ảnh chữ ký để xem trước ở mục Người ký. */
  loadSignatureFile?: SignatureFileLoader | undefined;
}

export function ReportTemplatesPanel({
  templates,
  onTemplatesChange,
  employees,
  setNotice,
  app,
  actor,
  partners,
  loadSignatureFile,
}: ReportTemplatesPanelProps) {
  const [editingTemplate, setEditingTemplate] = useState<ExcelReportTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formFileName, setFormFileName] = useState("");
  const [formFileBase64, setFormFileBase64] = useState("");
  const [formMappings, setFormMappings] = useState<ExcelCellMapping[]>([]);
  const [formError, setFormError] = useState("");
  /** Có giá trị khi file tải lên chứa ô {{trường}} → "Mẫu hồ sơ". */
  const [formProfile, setFormProfile] = useState<ProfileTemplateConfig | null>(null);
  const [certificateTypes, setCertificateTypes] = useState<{ key: string; name: string }[]>([]);
  const [signatures, setSignatures] = useState<Signature[] | null>(null);

  useEffect(() => {
    let active = true;
    void app.certificateTypes.list(actor).then((result) => { if (active && result.ok) setCertificateTypes(result.value.map((type) => ({ key: type.key, name: type.name }))); });
    // Thư viện chữ ký: chọn người ký mặc định cho mẫu
    void app.signatures.list(actor).then((result) => { if (active) setSignatures(result.ok ? result.value : []); });
    return () => { active = false; };
  }, [app, actor]);

  // Test export state
  const [testingTemplateId, setTestingTemplateId] = useState<string | null>(null);
  const [testEmployeeId, setTestEmployeeId] = useState<string>(employees[0]?.id ?? "");

  const openCreate = async () => {
    setIsCreating(true);
    setEditingTemplate(null);
    setFormName("");
    setFormDesc("");
    setFormFileName("");
    setFormFileBase64("");
    setFormProfile(null);
    setFormMappings([
      { cell: "C5", field: "code" },
      { cell: "E5", field: "position" },
      { cell: "C6", field: "name" },
      { cell: "E6", field: "gender" },
      { cell: "C7", field: "dob" },
      { cell: "E7", field: "phone" },
      { cell: "C8", field: "cccd" },
      { cell: "E8", field: "group" },
      { cell: "C9", field: "home" },
      { cell: "E9", field: "startDate" },
      { cell: "C10", field: "address" },
      { cell: "E10", field: "status" },
      { cell: "C11", field: "currentAddress" },
    ]);
    setFormError("");
  };

  const openEdit = (tpl: ExcelReportTemplate) => {
    setIsCreating(false);
    setEditingTemplate(tpl);
    setFormName(tpl.name);
    setFormDesc(tpl.description ?? "");
    setFormFileName(tpl.fileName);
    setFormFileBase64(tpl.fileBase64);
    setFormMappings(tpl.mappings.map((m) => ({ ...m })));
    setFormProfile(tpl.profile ?? null);
    setFormError("");
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || !files[0]) return;
    const file = files[0];
    if (!file.name.endsWith(".xlsx")) {
      setFormError("Vui lòng chọn tệp định dạng Excel (.xlsx).");
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const scan = await scanTemplate(bytes);
      const profile = scan.placeholders.length ? profileConfigFromScan(scan, formProfile ?? undefined) : null;
      setFormFileName(file.name);
      setFormFileBase64(uint8ArrayToBase64(bytes));
      setFormProfile(profile);
      if (profile && !formName.trim()) setFormName(file.name.replace(/\.xlsx$/i, ""));
      setFormError("");
      setNotice(profile ? `Đã nhận diện "${file.name}" là mẫu hồ sơ: ${scan.placeholders.length} trường, ${scan.imageSlots.length} vùng ảnh.` : `Đã nạp tệp mẫu "${file.name}".`);
    } catch {
      setFormError("Không đọc được tệp Excel. Vui lòng thử lại.");
    }
  };

  const handleUseDefaultTemplateFile = async () => {
    try {
      const bytes = await createDefaultStarterTemplate();
      const b64 = uint8ArrayToBase64(bytes);
      setFormFileName("phieu-nhan-su-chuan.xlsx");
      setFormFileBase64(b64);
      setNotice("Đã nạp tệp Excel mẫu chuẩn của hệ thống.");
    } catch {
      setFormError("Không thể tạo tệp mẫu mặc định.");
    }
  };

  const addMappingRow = () => {
    setFormMappings([...formMappings, { cell: "", field: "name" }]);
  };

  const removeMappingRow = (index: number) => {
    setFormMappings(formMappings.filter((_, idx) => idx !== index));
  };

  const updateMappingCell = (index: number, cellVal: string) => {
    const next = [...formMappings];
    const current = next[index];
    if (current) {
      current.cell = cellVal.toUpperCase();
      setFormMappings(next);
    }
  };

  const updateMappingField = (index: number, fieldVal: ExcelFieldKey) => {
    const next = [...formMappings];
    const current = next[index];
    if (current) {
      current.field = fieldVal;
      setFormMappings(next);
    }
  };

  const saveForm = () => {
    if (!formName.trim()) {
      setFormError("Vui lòng nhập tên mẫu báo cáo.");
      return;
    }
    if (!formFileBase64) {
      setFormError("Vui lòng tải lên tệp Excel mẫu (.xlsx) hoặc bấm sử dụng mẫu mặc định.");
      return;
    }

    if (formProfile) {
      for (const slot of formProfile.imageSlots) {
        try { parseRange(slot.range); } catch { setFormError(`Vùng ảnh "${slot.range || "(trống)"}" không hợp lệ. Ví dụ đúng: E8:K16.`); return; }
      }
      try { parseRange(formProfile.printArea); } catch { setFormError(`Vùng in "${formProfile.printArea}" không hợp lệ. Ví dụ đúng: B1:AZ73.`); return; }
    }

    // Validate cell addresses
    for (const mapping of formProfile ? [] : formMappings) {
      if (mapping.cell && !isValidCellAddress(mapping.cell)) {
        setFormError(`Tọa độ ô "${mapping.cell}" không hợp lệ. Ví dụ đúng: C5, E10, B2.`);
        return;
      }
    }

    const cleanMappings = (formProfile ? [] : formMappings)
      .filter((m) => m.cell.trim() !== "")
      .map((m) => ({ cell: normalizeCellAddress(m.cell), field: m.field }));

    const now = new Date().toISOString();
    let updatedList: ExcelReportTemplate[];

    if (editingTemplate) {
      updatedList = templates.map((tpl) =>
        tpl.id === editingTemplate.id
          ? {
              ...tpl,
              name: formName.trim(),
              description: formDesc.trim(),
              fileName: formFileName || tpl.fileName,
              fileBase64: formFileBase64 || tpl.fileBase64,
              mappings: cleanMappings,
              ...(formProfile ? { profile: formProfile, sheetName: formProfile.sheetName } : {}),
              updatedAt: now,
            }
          : tpl,
      );
      setNotice(`Đã cập nhật mẫu báo cáo "${formName.trim()}".`);
    } else {
      const newTpl: ExcelReportTemplate = {
        id: `tpl-${Date.now()}`,
        name: formName.trim(),
        description: formDesc.trim(),
        fileName: formFileName || "template.xlsx",
        fileBase64: formFileBase64,
        mappings: cleanMappings,
        ...(formProfile ? { profile: formProfile, sheetName: formProfile.sheetName } : {}),
        createdAt: now,
        updatedAt: now,
      };
      updatedList = [...templates, newTpl];
      setNotice(`Đã thêm mẫu báo cáo mới "${formName.trim()}".`);
    }

    onTemplatesChange(updatedList);
    saveTemplates(updatedList);
    setIsCreating(false);
    setEditingTemplate(null);
  };

  const deleteTemplate = (id: string, name: string) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa mẫu báo cáo "${name}"?`)) return;
    const next = templates.filter((tpl) => tpl.id !== id);
    onTemplatesChange(next);
    saveTemplates(next);
    setNotice(`Đã xóa mẫu báo cáo "${name}".`);
  };

  const downloadRawTemplate = (tpl: ExcelReportTemplate) => {
    try {
      const bytes = base64ToUint8Array(tpl.fileBase64);
      const blob = new Blob([bytes as unknown as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = tpl.fileName || `${tpl.name}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setNotice("Không thể tải tệp mẫu.");
    }
  };

  const executeTestExport = async (tpl: ExcelReportTemplate) => {
    const emp = employees.find((e) => e.id === testEmployeeId) ?? employees[0];
    if (!emp) {
      setNotice("Không tìm thấy nhân viên nào để xuất thử.");
      return;
    }
    try {
      const rawBytes = base64ToUint8Array(tpl.fileBase64);
      const data = mapEmployeeToExcelData(emp);
      const outBytes = await populateExcelTemplate({
        templateBuffer: rawBytes,
        mappings: tpl.mappings,
        data,
      });

      const blob = new Blob([outBytes as unknown as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `[XUAT-THU]_${tpl.name}_${emp.name}_${emp.code}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice(`Đã xuất thử thành công báo cáo cho ${emp.name}!`);
      setTestingTemplateId(null);
    } catch {
      setNotice("Lỗi khi điền dữ liệu vào tệp Excel.");
    }
  };

  const downloadStarterSystemFile = async () => {
    try {
      const bytes = await createDefaultStarterTemplate();
      const blob = new Blob([bytes as unknown as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "phieu-thong-tin-nhan-su-mau-chuan.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      setNotice("Đã tải xuống tệp mẫu Excel chuẩn.");
    } catch {
      setNotice("Không thể tạo tệp mẫu.");
    }
  };

  return (
    <div className="reports-manager">
      <div className="page-head">
        <div>
          <h1>FORM Báo cáo (Tự động hóa Excel)</h1>
          <p>
            Định nghĩa vị trí các ô cần điền dữ liệu theo từng mẫu Excel. Giữ nguyên 100% font chữ,
            viền và format gốc.
          </p>
        </div>
        <div className="button-row">
          <button className="button" onClick={() => void downloadStarterSystemFile()}>
            <Download className="ico" size={16} aria-hidden="true" /> Tải file mẫu chuẩn (.xlsx)
          </button>
          <button className="button primary" onClick={() => void openCreate()}>
            <Plus className="ico" size={16} aria-hidden="true" /> Thêm mẫu báo cáo mới
          </button>
        </div>
      </div>

      <PartnersPanel store={partners} setNotice={setNotice} />

      {/* Danh sách các templates */}
      <div className="template-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "16px", marginBottom: "24px" }}>
        {templates.map((tpl) => (
          <div key={tpl.id} className="panel" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "18px" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                <h3 style={{ margin: 0, fontSize: "17px", color: "var(--foreground, #0f172a)" }}>{tpl.name}</h3>
                <span className="pill ok" style={{ fontSize: "11px" }}>{tpl.profile ? "Mẫu hồ sơ" : `${tpl.mappings.length} ô map`}</span>
              </div>
              <p style={{ margin: "4px 0 12px", color: "var(--muted, #64748b)", fontSize: "13px" }}>
                {tpl.description || "Chưa có mô tả cho mẫu này."}
              </p>
              <div style={{ background: "#f8fafc", padding: "10px", borderRadius: "6px", fontSize: "12px", border: "1px solid #e2e8f0", marginBottom: "14px" }}>
                <div><b>Tệp mẫu:</b> <FileText className="ico" size={14} aria-hidden="true" /> {tpl.fileName}</div>
                {tpl.profile ? (
                  <div style={{ marginTop: "4px", color: "#64748b" }}>
                    <b>{tpl.profile.placeholders.length}</b> trường · <b>{tpl.profile.imageSlots.length}</b> vùng ảnh · <b>{tpl.profile.attachments.length}</b> loại chứng chỉ đính kèm
                    <div style={{ marginTop: "4px" }}>Xuất tại hồ sơ nhân sự → “Xuất hồ sơ theo mẫu”.</div>
                  </div>
                ) : <div style={{ marginTop: "4px", color: "#64748b" }}>
                  <b>Các ô cấu hình:</b>{" "}
                  {tpl.mappings.slice(0, 5).map((m) => `${m.cell} (${m.field})`).join(", ")}
                  {tpl.mappings.length > 5 ? ` và ${tpl.mappings.length - 5} ô khác...` : ""}
                </div>}
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", borderTop: "1px solid #e2e8f0", paddingTop: "12px" }}>
              <button className="button" style={{ fontSize: "12px", padding: "6px 10px" }} onClick={() => downloadRawTemplate(tpl)}>
                <Download className="ico" size={16} aria-hidden="true" /> Tải file mẫu
              </button>
              {!tpl.profile && <button
                className="button primary"
                style={{ fontSize: "12px", padding: "6px 10px" }}
                onClick={() => setTestingTemplateId(tpl.id)}
              >
                <Play className="ico" size={16} aria-hidden="true" /> Thử xuất với nhân viên
              </button>}
              <button className="button" style={{ fontSize: "12px", padding: "6px 10px" }} onClick={() => openEdit(tpl)}>
                {tpl.profile ? <><Settings className="ico" size={16} aria-hidden="true" /> Cài đặt mẫu</> : <><Pencil className="ico" size={16} aria-hidden="true" /> Sửa ô</>}
              </button>
              <button className="button danger" style={{ fontSize: "12px", padding: "6px 10px" }} onClick={() => deleteTemplate(tpl.id, tpl.name)}>
                Xóa
              </button>
            </div>

            {/* Test export selector inline */}
            {testingTemplateId === tpl.id && (
              <div style={{ marginTop: "12px", padding: "12px", background: "#ecfdf5", borderRadius: "6px", border: "1px solid #a7f3d0" }}>
                <div style={{ fontSize: "12px", fontWeight: "bold", color: "#065f46", marginBottom: "6px" }}>
                  Chọn nhân sự để xuất thử nghiệm:
                </div>
                <select
                  value={testEmployeeId}
                  onChange={(e) => setTestEmployeeId(e.target.value)}
                  style={{ width: "100%", padding: "6px", borderRadius: "4px", border: "1px solid #cbd5e1", marginBottom: "8px" }}
                >
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.code} - {emp.name} ({emp.position})
                    </option>
                  ))}
                </select>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button className="button primary" style={{ fontSize: "12px" }} onClick={() => void executeTestExport(tpl)}>
                    Tải file kết quả ngay
                  </button>
                  <button className="button" style={{ fontSize: "12px" }} onClick={() => setTestingTemplateId(null)}>
                    Đóng
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {!templates.length && (
          <div className="panel empty" style={{ gridColumn: "1 / -1", padding: "32px", textAlign: "center" }}>
            <p>Chưa có mẫu báo cáo nào được tạo.</p>
            <button className="button primary" onClick={() => void openCreate()}>
              <Plus className="ico" size={16} aria-hidden="true" /> Tạo mẫu báo cáo đầu tiên
            </button>
          </div>
        )}
      </div>

      {/* Modal / Form thêm & sửa template */}
      {(isCreating || editingTemplate) && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" style={{ maxWidth: formProfile ? "920px" : "780px", maxHeight: "90vh", overflowY: "auto" }}>
            <header>
              <h2>{editingTemplate ? `Sửa mẫu: ${editingTemplate.name}` : "Tạo mẫu báo cáo Excel mới"}</h2>
              <button
                type="button"
                className="close"
                onClick={() => {
                  setIsCreating(false);
                  setEditingTemplate(null);
                }}
              >
                ×
              </button>
            </header>

            {formError && (
              <div style={{ margin: "12px 18px 0", padding: "10px", background: "#fef2f2", color: "#b91c1c", borderRadius: "6px", fontSize: "13px" }}>
                {formError}
              </div>
            )}

            <div style={{ padding: "18px" }}>
              {/* Thông tin chung */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>
                <label className="field">
                  <span>Tên mẫu báo cáo *</span>
                  <input
                    type="text"
                    placeholder="VD: Phiếu thông tin nhân sự, Báo cáo ATLĐ..."
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Mô tả</span>
                  <input
                    type="text"
                    placeholder="Ghi chú mục đích sử dụng mẫu này"
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                  />
                </label>
              </div>

              {/* Tải tệp Excel mẫu */}
              <div style={{ marginBottom: "20px" }}>
                <span style={{ fontSize: "13px", fontWeight: "bold", display: "block", marginBottom: "6px" }}>
                  Tệp Excel mẫu (.xlsx) *
                </span>
                <div
                  style={{
                    border: "2px dashed #3b82f6",
                    background: "#eff6ff",
                    borderRadius: "8px",
                    padding: "16px",
                    textAlign: "center",
                  }}
                >
                  {formFileName ? (
                    <div>
                      <div style={{ fontWeight: "bold", color: "#1d4ed8" }}><FileText className="ico" size={16} aria-hidden="true" /> Đã chọn: {formFileName}</div>
                      <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                        Bạn có thể chọn tệp khác để thay thế nếu muốn
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: "#3b82f6" }}>Kéo thả hoặc chọn tệp Excel mẫu (.xlsx) từ máy tính</div>
                  )}

                  <div style={{ marginTop: "10px", display: "flex", justifyContent: "center", gap: "10px" }}>
                    <label className="button primary" style={{ cursor: "pointer", fontSize: "13px" }}>
                      Chọn tệp .xlsx từ máy
                      <input
                        type="file"
                        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        style={{ display: "none" }}
                        onChange={(e) => void handleFileUpload(e.target.files)}
                      />
                    </label>
                    <button
                      type="button"
                      className="button"
                      style={{ fontSize: "13px" }}
                      onClick={() => void handleUseDefaultTemplateFile()}
                    >
                      Dùng mẫu chuẩn có sẵn
                    </button>
                  </div>
                </div>
              </div>

              {formProfile && <ProfileTemplateEditor value={formProfile} onChange={setFormProfile} fileBase64={formFileBase64} certificateTypes={certificateTypes} partners={partners.partners} signatures={signatures} loadSignatureFile={loadSignatureFile} />}

              {/* Bảng định nghĩa ô nào thêm trường nào */}
              {!formProfile && <><div style={{ marginBottom: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "15px" }}>Định nghĩa vị trí ô cần thêm dữ liệu (Cell Mapping)</h3>
                    <small style={{ color: "#64748b" }}>
                      Quy định ô nào trong Excel (ví dụ C5, D10) sẽ được điền thông tin tương ứng của nhân viên.
                    </small>
                  </div>
                  <button type="button" className="button" style={{ fontSize: "12px" }} onClick={addMappingRow}>
                    <Plus className="ico" size={16} aria-hidden="true" /> Thêm ô khác
                  </button>
                </div>

                <div style={{ maxHeight: "280px", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
                      <tr>
                        <th style={{ padding: "8px 12px", textAlign: "left", width: "120px" }}>Ô trong Excel</th>
                        <th style={{ padding: "8px 12px", textAlign: "left" }}>Trường thông tin nhân sự</th>
                        <th style={{ padding: "8px 12px", textAlign: "left", width: "180px" }}>Dữ liệu mẫu</th>
                        <th style={{ padding: "8px 12px", textAlign: "center", width: "50px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {formMappings.map((mapping, idx) => {
                        const fieldDef = AVAILABLE_REPORT_FIELDS.find((f) => f.key === mapping.field);
                        return (
                          <tr key={idx} style={{ borderTop: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "6px 12px" }}>
                              <input
                                type="text"
                                placeholder="VD: C5"
                                value={mapping.cell}
                                style={{
                                  width: "90px",
                                  padding: "6px 8px",
                                  border: "1px solid #cbd5e1",
                                  borderRadius: "4px",
                                  fontWeight: "bold",
                                  textTransform: "uppercase",
                                }}
                                onChange={(e) => updateMappingCell(idx, e.target.value)}
                              />
                            </td>
                            <td style={{ padding: "6px 12px" }}>
                              <select
                                value={mapping.field}
                                style={{ width: "100%", padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: "4px" }}
                                onChange={(e) => updateMappingField(idx, e.target.value as ExcelFieldKey)}
                              >
                                {AVAILABLE_REPORT_FIELDS.map((f) => (
                                  <option key={f.key} value={f.key}>
                                    {f.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={{ padding: "6px 12px", color: "#64748b", fontStyle: "italic" }}>
                              {fieldDef?.example ?? ""}
                            </td>
                            <td style={{ padding: "6px 12px", textAlign: "center" }}>
                              <button
                                type="button"
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: "#ef4444",
                                  cursor: "pointer",
                                  fontWeight: "bold",
                                }}
                                onClick={() => removeMappingRow(idx)}
                                title="Xóa ô này"
                              >
                                <X size={16} aria-hidden="true" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {!formMappings.length && (
                        <tr>
                          <td colSpan={4} style={{ padding: "16px", textAlign: "center", color: "#94a3b8" }}>
                            Chưa có ô nào được định nghĩa. Hãy bấm &quot;Thêm ô khác&quot; để gán trường.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Hướng dẫn nâng cao: Dùng thẻ trực tiếp trong Excel */}
              <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "6px", border: "1px solid #e2e8f0", fontSize: "12px" }}>
                <b><Lightbulb className="ico" size={16} aria-hidden="true" /> Mẹo tiện lợi:</b> Ngoài việc gán ô C5, D10 ở trên, bạn cũng có thể mở file Excel và gõ trực tiếp
                các mã sau vào bất kỳ ô nào:{" "}
                <code style={{ background: "#e2e8f0", padding: "2px 4px", borderRadius: "3px" }}>{"{{name}}"}</code> (Họ tên),{" "}
                <code style={{ background: "#e2e8f0", padding: "2px 4px", borderRadius: "3px" }}>{"{{cccd}}"}</code> (CCCD),{" "}
                <code style={{ background: "#e2e8f0", padding: "2px 4px", borderRadius: "3px" }}>{"{{dob}}"}</code> (Ngày sinh),{" "}
                <code style={{ background: "#e2e8f0", padding: "2px 4px", borderRadius: "3px" }}>{"{{phone}}"}</code> (Điện thoại),{" "}
                <code style={{ background: "#e2e8f0", padding: "2px 4px", borderRadius: "3px" }}>{"{{currentAddress}}"}</code> (Địa chỉ hiện tại)... Hệ thống sẽ tự động tìm và thay thế giá trị tương ứng!
              </div></>}
            </div>

            <footer>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setIsCreating(false);
                  setEditingTemplate(null);
                }}
              >
                Hủy
              </button>
              <button type="button" className="button primary" onClick={saveForm}>
                {editingTemplate ? "Cập nhật mẫu báo cáo" : "Lưu mẫu báo cáo mới"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
