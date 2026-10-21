"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { Actor } from "../modules/auth/permissions";
import type { CertificateChecklistRow, CertificateChecklistSummary } from "../modules/certificates/checklist";
import type { Certificate, FileRef } from "../modules/certificates/types";
import type { CertificateTypeRecord } from "../modules/certificate-types/types";
import type { Employee } from "../modules/employees/types";
import { ExportExcelModal } from "./ExportExcelModal";
import { ReportTemplatesPanel } from "./ReportTemplatesPanel";
import { AlertsView } from "./_components/AlertsView";
import { CertificateFormModal, type CertificateFormMode } from "./_components/CertificateFormModal";
import { EmployeeDetailView } from "./_components/EmployeeDetailView";
import { EmployeeFormModal, type EmployeeFormInitial } from "./_components/EmployeeFormModal";
import { DEFAULT_EMPLOYEE_FILTERS, EMPTY_PAGE_INFO, EmployeeListView, toListInput, type EmployeeFilters, type EmployeePageInfo } from "./_components/EmployeeListView";
import { BatchExportModal } from "./_components/BatchExportModal";
import { ExportPdfDialog, prepareExportDialog, type ExportDialogInit } from "./_components/ExportPdfDialog";
import { FilePreviewModal, type PreviewFile } from "./_components/FilePreviewModal";
import { SettingsPanel } from "./_components/SettingsPanel";
import { SideNav } from "./_components/SideNav";
import { SignaturesView } from "./_components/SignaturesView";
import { emptyEmployee, issueText, type App, type ExpiringCertificateRow, type PageView, type SignatureRow } from "./_components/shared";
import { useReportTemplates } from "./_components/useReportTemplates";
import { useToast } from "./_components/Toast";
import { EmployeeExtraPanel } from "./_components/EmployeeExtraPanel";
import { ReasonDialog } from "./_components/ReasonDialog";
import { ImportEmployeesModal } from "./_components/ImportEmployeesModal";
import { ClaudeHoSoImportModal } from "./_components/ClaudeHoSoImportModal";
import { downloadXlsx } from "./_components/profileExport";
import { buildEmployeeRosterWorkbook } from "../modules/exports/employeeRoster";
import { useBackend, type Backend } from "./_components/useBackend";
import { getSupabaseClient } from "../lib/supabase/client";
import { LoginScreen, PendingAccessScreen } from "./_components/LoginScreen";
import type { FileFolder } from "./_components/fileStore";
import { photoRef } from "../modules/employees/photo";
import { parseRoute, routePath, VIEW_TITLES } from "./_components/routes";
import SkillsClient from "./skills/SkillsClient";

/** Chọn màn hình theo trạng thái: đang tải, đăng nhập (chế độ thật) hoặc vào app. */
export default function HrmClient() {
  const backend = useBackend();
  const pathname = usePathname();
  if (backend.status === "loading") return <div className="loading">Đang tải dữ liệu…</div>;
  // Kho Skill xem công khai được, không bắt đăng nhập
  if (backend.status === "signedOut") return parseRoute(pathname)?.view === "skills" ? <SkillsClient /> : <LoginScreen onSignIn={backend.signIn} />;
  if (backend.status === "pending") return <PendingAccessScreen email={backend.email} onSignOut={() => void backend.signOut()} />;
  return <HrmWorkspace backend={backend} />;
}

function HrmWorkspace({ backend }: { backend: Extract<Backend, { status: "ready" }> }) {
  const { app, actor, setActor, fileStore } = backend;
  // Màn hình đang mở lấy từ URL: mỗi mục có đường dẫn riêng, tải lại trang hay mở link vẫn đúng chỗ
  const route = parseRoute(usePathname()) ?? { view: "employees" as const, employeeId: null };
  const view = route.view;
  const navigate = useCallback((next: PageView, employeeId: string | null = null) => {
    const path = routePath(next, employeeId);
    if (path !== window.location.pathname) window.history.pushState(null, "", path);
  }, []);
  const [rows, setRows] = useState<Employee[]>([]);
  const [employeeCertificateHealth, setEmployeeCertificateHealth] = useState<Record<string, CertificateChecklistSummary>>({});
  const [filters, setFilters] = useState<EmployeeFilters>(DEFAULT_EMPLOYEE_FILTERS);
  const [pageInfo, setPageInfo] = useState<EmployeePageInfo>(EMPTY_PAGE_INFO);
  const [loadedListKey, setLoadedListKey] = useState("");
  const [rosterBusy, setRosterBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchEmployees, setBatchEmployees] = useState<Employee[] | null>(null);
  const [listTypes, setListTypes] = useState<{ key: string; name: string }[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const setNotice = useToast();
  const [certRows, setCertRows] = useState<ExpiringCertificateRow[]>([]);
  const [signatureRows, setSignatureRows] = useState<SignatureRow[]>([]);
  const [employeeCertificates, setEmployeeCertificates] = useState<Certificate[]>([]);
  const [checklistRows, setChecklistRows] = useState<CertificateChecklistRow[]>([]);
  const [checklistSummary, setChecklistSummary] = useState<CertificateChecklistSummary>({ missing: 0, expiring: 0, expired: 0 });
  const [certificateTypes, setCertificateTypes] = useState<CertificateTypeRecord[]>([]);
  const [sessionFiles, setSessionFiles] = useState<Record<string, File>>({});
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [employeeForm, setEmployeeForm] = useState<{ editing: Employee | null; initial: EmployeeFormInitial } | null>(null);
  const [certificateForm, setCertificateForm] = useState<CertificateFormMode | null>(null);
  const [exportInit, setExportInit] = useState<ExportDialogInit | null>(null);
  const [reasonDialog, setReasonDialog] = useState<{ kind: "employee" } | { kind: "certificate"; certificate: Certificate } | null>(null);
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showClaudeImport, setShowClaudeImport] = useState(false);
  const templateError = useCallback((message: string) => setNotice(message, "error"), [setNotice]);
  const [templates, setTemplates] = useReportTemplates(backend.mode === "live" ? getSupabaseClient() : null, templateError);
  const listInput = useMemo(() => toListInput(filters), [filters]);

  /** Chế độ thật: đẩy tệp vừa chọn lên kho lưu trữ (lỗi thì báo, tệp vẫn dùng được trong phiên). */
  const storeFiles = useCallback(async (folder: FileFolder, files: Record<string, File>) => {
    if (!fileStore) return;
    try { await Promise.all(Object.entries(files).map(([id, file]) => fileStore.put(folder, id, file))); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Không tải được tệp lên kho lưu trữ.", "error"); }
  }, [fileStore, setNotice]);

  /** Đẩy tệp lên kho trước khi lưu bản ghi trỏ tới nó; lỗi thì báo và trả false để không lưu bản ghi. */
  const uploadFiles = useCallback(async (folder: FileFolder, files: Record<string, File>) => {
    if (fileStore) {
      try { await Promise.all(Object.entries(files).map(([id, file]) => fileStore.put(folder, id, file))); }
      catch (error) { setNotice(error instanceof Error ? error.message : "Không tải được tệp lên kho lưu trữ.", "error"); return false; }
    }
    setSessionFiles((current) => ({ ...current, ...files }));
    return true;
  }, [fileStore, setNotice]);

  /** Tải về những tệp chưa có trong phiên; trả về bộ tệp đầy đủ để dùng ngay. */
  const ensureFiles = useCallback(async (refs: readonly { id: string; name: string; folder: FileFolder }[]) => {
    const missing = refs.filter((ref) => !sessionFiles[ref.id]);
    if (!fileStore || !missing.length) return sessionFiles;
    const loaded = await Promise.all(missing.map(async (ref) => [ref.id, await fileStore.get(ref.folder, ref.id, ref.name)] as const));
    const found = Object.fromEntries(loaded.filter((entry): entry is readonly [string, File] => entry[1] !== null));
    // Gộp theo state mới nhất: nhiều lượt tải chạy song song (ảnh chân dung, ảnh trường tùy chỉnh) không ghi đè nhau
    setSessionFiles((current) => ({ ...current, ...found }));
    return { ...sessionFiles, ...found };
  }, [fileStore, sessionFiles]);

  const certificateFileRefs = (certificates: readonly Certificate[]) => certificates.flatMap((certificate) => [certificate.document, ...certificate.supplementaryFiles.map((item) => item.file)]).map((file) => ({ id: file.id, name: file.name, folder: "certificates" as const }));
  /** Tệp theo nhân sự (ảnh chân dung + ảnh trường tùy chỉnh), cần có trong phiên trước khi xuất hồ sơ. */
  const extraFileRefs = (employee: Employee) => [...Object.values(employee.extraFiles ?? {}), ...[photoRef(employee.photo)].filter((file) => file !== null)].map((file) => ({ id: file.id, name: file.name, folder: "employees" as const }));
  const loadPhoto = async (file: FileRef) => (await ensureFiles([{ id: file.id, name: file.name, folder: "employees" }]))[file.id] ?? null;
  const signatureFileRefs = async () => { const listed = await app.signatures.list(actor); return listed.ok ? listed.value.map((signature) => ({ id: signature.file.id, name: signature.file.name, folder: "signatures" as const })) : []; };

  const refresh = useCallback(async (instance: App, currentActor: Actor) => {
    const listed = await instance.employees.list(currentActor, listInput);
    if (listed.ok) { setRows(listed.value.items); setPageInfo(listed.value); }
    const certs = await instance.certificates.listExpiring(currentActor);
    if (certs.ok) setCertRows(certs.value);
    const signatures = await instance.signatures.list(currentActor);
    if (signatures.ok) setSignatureRows(signatures.value);
  }, [listInput]);


  useEffect(() => {
    if (!app) return;
    let current = true;
    const key = JSON.stringify(listInput);
    void app.employees.list(actor, listInput).then(async (result) => {
      if (!current) return;
      setLoadedListKey(key);
      if (!result.ok) return;
      setRows(result.value.items);
      setPageInfo(result.value);
      const health = await Promise.all(result.value.items.map(async (employee) => {
        const checklist = await app.certificates.checklist(actor, employee.id);
        return checklist.ok ? [employee.id, checklist.value.summary] as const : null;
      }));
      if (current) setEmployeeCertificateHealth(Object.fromEntries(health.filter((item): item is readonly [string, CertificateChecklistSummary] => item !== null)));
    });
    void app.certificates.listExpiring(actor).then((result) => { if (current && result.ok) setCertRows(result.value); });
    void app.signatures.list(actor).then((result) => { if (current && result.ok) setSignatureRows(result.value); });
    return () => { current = false; };
  }, [app, actor, listInput]);

  useEffect(() => {
    if (!app) return;
    let current = true;
    void app.certificateTypes.list(actor).then((result) => { if (current && result.ok) setListTypes(result.value.map((type) => ({ key: type.key, name: type.name }))); });
    return () => { current = false; };
  }, [app, actor]);

  useEffect(() => () => { if (previewFile) URL.revokeObjectURL(previewFile.url); }, [previewFile]);

  const reloadEmployeeCertificates = async (instance: App, employeeId: string) => {
    const certificates = await instance.certificates.listByEmployee(actor, employeeId);
    if (certificates.ok) setEmployeeCertificates(certificates.value);
    const checklist = await instance.certificates.checklist(actor, employeeId);
    if (checklist.ok) { setChecklistRows(checklist.value.rows); setChecklistSummary(checklist.value.summary); }
  };

  const openCreate = () => { setSelected(null); setEmployeeForm({ editing: null, initial: emptyEmployee }); };

  /** Tải hồ sơ + chứng chỉ của một người (chưa đụng tới state). */
  const fetchDetail = async (employeeId: string) => {
    const full = await app.employees.get(actor, employeeId);
    if (!full.ok) return null;
    const [certificates, checklist, types] = await Promise.all([app.certificates.listByEmployee(actor, employeeId), app.certificates.checklist(actor, employeeId), app.certificateTypes.list(actor, actor.role === "admin")]);
    return { employee: full.value, certificates, checklist, types };
  };
  /** Đưa dữ liệu vào state cùng lúc, để không hiện chứng chỉ của người trước. */
  const applyDetail = (data: Awaited<ReturnType<typeof fetchDetail>>) => {
    if (!data) { setNotice("Không tìm thấy hồ sơ nhân sự này.", "error"); navigate("employees"); return; }
    const { employee, certificates, checklist, types } = data;
    if (certificates.ok) setEmployeeCertificates(certificates.value);
    if (checklist.ok) { setChecklistRows(checklist.value.rows); setChecklistSummary(checklist.value.summary); }
    if (types.ok) setCertificateTypes(types.value);
    setSelected(employee);
  };
  const loadDetail = async (employeeId: string) => applyDetail(await fetchDetail(employeeId));

  /** Mở hồ sơ: đổi URL sang /nhan-su/<id>; đang ở đúng hồ sơ đó thì chỉ tải lại dữ liệu. */
  const openDetail = (employee: Employee) => {
    if (route.employeeId === employee.id) void loadDetail(employee.id);
    else navigate("employees", employee.id);
  };

  const routeEmployeeId = route.employeeId;
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (!routeEmployeeId || routeEmployeeId === selectedId) return;
    let current = true;
    // Bấm qua lại nhanh giữa các hồ sơ: bỏ kết quả của lần tải cũ
    void fetchDetail(routeEmployeeId).then((data) => { if (current) applyDetail(data); });
    return () => { current = false; };
    // Chỉ chạy khi URL đổi sang hồ sơ khác
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeEmployeeId]);
  /** Hồ sơ đang hiển thị: chỉ khi URL trỏ đúng người đã tải xong. */
  const detail = view === "employees" && routeEmployeeId && selected?.id === routeEmployeeId ? selected : null;
  const pageTitle = `${detail ? detail.name : VIEW_TITLES[view]} · Thiên Nhật Minh`;
  useEffect(() => { document.title = pageTitle; }, [pageTitle]);

  const openEdit = async () => {
    if (!selected || !app) return;
    const revealed = await app.employees.revealCccd(actor, selected.id);
    if (!revealed.ok) { setNotice(issueText(revealed.errors[0]?.code ?? "FORBIDDEN")); return; }
    setEmployeeForm({
      editing: selected,
      initial: {
        code: selected.code,
        name: selected.name,
        dob: selected.dob,
        gender: selected.gender,
        cccd: revealed.value,
        phone: selected.phone,
        home: selected.home,
        address: selected.address,
        currentAddress: selected.currentAddress ?? "",
        position: selected.position,
        group: selected.group,
        startDate: selected.startDate,
        emergencyContactId: selected.emergencyContactId,
        status: selected.status,
        endDate: selected.endDate,
        photo: selected.photo ?? null,
        mismatchOverrideReason: selected.cccdMismatchOverrideReason ?? "",
      },
    });
  };

  const archiveCertificate = (certificate: Certificate) => setReasonDialog({ kind: "certificate", certificate });
  const confirmArchiveCertificate = async (certificate: Certificate, reason: string): Promise<string | null> => {
    if (!selected) return null;
    const result = await app.certificates.archive(actor, { id: certificate.id, expectedVersion: certificate.version, reason });
    if (!result.ok) return issueText(result.errors[0]?.code ?? "CERT_ARCHIVE_REASON");
    setReasonDialog(null);
    setNotice("Đã ẩn chứng chỉ.");
    await reloadEmployeeCertificates(app, selected.id);
    await refresh(app, actor);
    return null;
  };

  const restoreCertificate = async (certificate: Certificate) => {
    if (!app || !selected) return;
    const result = await app.certificates.restore(actor, { id: certificate.id, expectedVersion: certificate.version });
    setNotice(result.ok ? "Đã khôi phục chứng chỉ." : issueText(result.errors[0]?.code ?? "CERT_RESTORE_CONFLICT"));
    await reloadEmployeeCertificates(app, selected.id);
    await refresh(app, actor);
  };

  const showFile = async (file: FileRef) => {
    const binary = (await ensureFiles([{ id: file.id, name: file.name, folder: "certificates" }]))[file.id];
    if (!binary) { setNotice("Tệp mẫu không có dữ liệu xem trước trong phiên này."); return; }
    if (previewFile) URL.revokeObjectURL(previewFile.url);
    setPreviewFile({ name: file.name, mime: file.mime, url: URL.createObjectURL(binary) });
  };

  const archiveSelected = () => setReasonDialog({ kind: "employee" });
  const confirmArchiveSelected = async (reason: string): Promise<string | null> => {
    if (!selected) return null;
    const result = await app.employees.archive(actor, { id: selected.id, expectedVersion: selected.version, reason });
    if (!result.ok) return issueText(result.errors[0]?.code ?? "EMP_ARCHIVE_REASON");
    setReasonDialog(null);
    setSelectedIds((current) => current.filter((id) => id !== selected.id));
    setSelected(null); navigate("employees"); await refresh(app, actor); setNotice("Đã lưu trữ hồ sơ. Admin có thể khôi phục bằng bộ lọc “Hiện hồ sơ đã lưu trữ”.");
    return null;
  };

  const restoreSelected = async () => {
    if (!app || !selected) return;
    const result = await app.employees.restore(actor, { id: selected.id, expectedVersion: selected.version });
    if (!result.ok) { setNotice(issueText(result.errors[0]?.code ?? "EMP_NOT_FOUND")); return; }
    setSelected(result.value); setNotice("Đã khôi phục hồ sơ."); await refresh(app, actor);
  };

  const restoreEmployee = async (employee: Employee) => {
    if (!app) return;
    const result = await app.employees.restore(actor, { id: employee.id, expectedVersion: employee.version });
    setNotice(result.ok ? "Đã khôi phục hồ sơ." : issueText(result.errors[0]?.code ?? "EMP_NOT_FOUND"));
    await refresh(app, actor);
  };

  const openExportDialog = async () => {
    if (!app || !selected) return;
    await ensureFiles([...certificateFileRefs(employeeCertificates), ...await signatureFileRefs()]);
    const prepared = await prepareExportDialog(app, actor, selected, employeeCertificates);
    if (!prepared.ok) { setNotice(prepared.message); return; }
    setCertificateTypes(prepared.init.certificateTypes);
    setExportInit(prepared.init);
  };

  /** Xuất Excel toàn bộ thông tin các nhân sự đã chọn (mỗi người một dòng + sheet chứng chỉ). */
  const exportRoster = async () => {
    setRosterBusy(true);
    try {
      const result = await app.exports.employeeRoster(actor, { employeeIds: selectedIds });
      if (!result.ok) { setNotice(issueText(result.errors[0]?.code ?? "EXPORT_SELECTION_INVALID"), "error"); return; }
      const bytes = await buildEmployeeRosterWorkbook(result.value);
      downloadXlsx(bytes, `DanhSachNhanSu_${result.value.employees.length}nguoi_${result.value.today.replaceAll("-", "")}.xlsx`);
      setNotice(`Đã xuất Excel thông tin ${result.value.employees.length} nhân sự.`, "success");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không tạo được file Excel.", "error");
    } finally { setRosterBusy(false); }
  };

  /** Chọn mọi nhân sự khớp bộ lọc (qua tất cả các trang). */
  const selectAllMatching = async () => {
    const ids: string[] = [];
    for (let page = 1; ; page++) {
      const result = await app.employees.list(actor, { ...listInput, page, pageSize: 100 });
      if (!result.ok) break;
      ids.push(...result.value.items.filter((employee) => !employee.archivedAt).map((employee) => employee.id));
      if (page >= result.value.pageCount) break;
    }
    setSelectedIds((current) => Array.from(new Set([...current, ...ids])));
  };
  if (!app) return <div className="loading">Đang nạp dữ liệu mẫu…</div>;

  return (
    <div className="app-shell">
      <SideNav mode={backend.mode} email={backend.email} onSignOut={() => void backend.signOut()} view={view} onNavigate={(key) => navigate(key)} alertCount={certRows.length} actor={actor} onActorChange={setActor} />
      <main className="main-content">
        {view === "employees" && !routeEmployeeId && <EmployeeListView actor={actor} rows={rows} pageInfo={pageInfo} loading={loadedListKey !== JSON.stringify(listInput)} onSelectAllMatching={() => void selectAllMatching()} onExportRoster={() => void exportRoster()} rosterBusy={rosterBusy} certificateHealth={employeeCertificateHealth} alertCount={certRows.length} signatureCount={signatureRows.length} filters={filters} onFiltersChange={setFilters} certificateTypes={listTypes} selectedIds={selectedIds} onSelectedIdsChange={setSelectedIds} onExportSelected={() => void Promise.all(selectedIds.map((id) => app.employees.get(actor, id))).then((results) => setBatchEmployees(results.flatMap((result) => result.ok && !result.value.archivedAt ? [result.value] : []).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }))))} onCreate={openCreate} onImport={() => setShowImport(true)} {...(backend.mode === "live" ? { onImportClaude: () => setShowClaudeImport(true) } : {})} onOpen={openDetail} onRestore={(employee) => void restoreEmployee(employee)} />}
        {view === "employees" && routeEmployeeId && !detail && <div className="loading">Đang tải hồ sơ…</div>}
        {detail && <EmployeeDetailView
          app={app}
          actor={actor}
          employee={detail}
          checklistRows={checklistRows}
          checklistSummary={checklistSummary}
          employeeCertificates={employeeCertificates}
          certificateTypes={certificateTypes}
          setNotice={setNotice}
          onBack={() => navigate("employees")}
          onEdit={() => void openEdit()}
          onArchive={archiveSelected}
          onRestore={() => void restoreSelected()}
          loadPhoto={loadPhoto}
          onExportExcel={() => void ensureFiles([...certificateFileRefs(employeeCertificates), ...extraFileRefs(detail)]).then(() => setShowExcelModal(true))}
          onExportPdf={() => void openExportDialog()}
          onShowFile={(file) => void showFile(file)}
          onCertificateForm={(type, certificate) => setCertificateForm({ type, editing: certificate ?? null, renewing: null })}
          onRenewCertificate={(certificate) => setCertificateForm({ type: certificate.type, editing: null, renewing: certificate })}
          onArchiveCertificate={archiveCertificate}
          onRestoreCertificate={(certificate) => void restoreCertificate(certificate)}
        />}
        {detail && <EmployeeExtraPanel
          key={`${detail.id}:${detail.version}`}
          app={app}
          actor={actor}
          employee={detail}
          templates={templates}
          sessionFiles={sessionFiles}
          ensureFiles={(refs) => ensureFiles(refs.map((ref) => ({ ...ref, folder: "employees" as const })))}
          setNotice={setNotice}
          onSaved={(employee, files) => { setSelected(employee); setSessionFiles((current) => ({ ...current, ...files })); void storeFiles("employees", files); setNotice("Đã lưu thông tin bổ sung."); }}
        />}
        {view === "alerts" && <AlertsView app={app} actor={actor} certRows={certRows} onCertRowsChange={setCertRows} onOpenEmployee={(employeeId) => navigate("employees", employeeId)} setNotice={setNotice} />}
        {view === "signatures" && <SignaturesView app={app} actor={actor} signatureRows={signatureRows} onSignatureRowsChange={setSignatureRows} sessionFiles={sessionFiles} ensureFiles={(refs) => ensureFiles(refs.map((ref) => ({ ...ref, folder: "signatures" as const })))} onFilesAdded={(files) => { setSessionFiles((current) => ({ ...current, ...files })); void storeFiles("signatures", files); }} setNotice={setNotice} />}
        {view === "reports" && <ReportTemplatesPanel templates={templates} onTemplatesChange={setTemplates} employees={rows} setNotice={setNotice} app={app} actor={actor} />}
        {view === "skills" && <SkillsClient embedded />}
        {view === "settings" && <SettingsPanel app={app} actor={actor} setNotice={setNotice} onAddSignature={() => navigate("signatures")} sessionFiles={sessionFiles} />}
      </main>
      {employeeForm && <EmployeeFormModal
        app={app}
        actor={actor}
        editing={employeeForm.editing}
        initial={employeeForm.initial}
        loadPhoto={loadPhoto}
        uploadPhoto={(files) => uploadFiles("employees", files)}
        setNotice={setNotice}
        onClose={() => setEmployeeForm(null)}
        onSaved={(employee) => { setEmployeeForm(null); setNotice("Đã lưu hồ sơ nhân sự."); void openDetail(employee); void refresh(app, actor); }}
      />}
      {certificateForm && selected && <CertificateFormModal
        app={app}
        actor={actor}
        employee={selected}
        certificateTypes={certificateTypes}
        existingCertificates={employeeCertificates}
        mode={certificateForm}
        setNotice={setNotice}
        onClose={() => setCertificateForm(null)}
        onSaved={(files, message) => {
          setSessionFiles((current) => ({ ...current, ...files }));
          void storeFiles("certificates", files);
          setCertificateForm(null); setNotice(message);
          void reloadEmployeeCertificates(app, selected.id).then(() => refresh(app, actor));
        }}
      />}
      {exportInit && selected && <ExportPdfDialog
        app={app}
        actor={actor}
        employee={selected}
        employeeCertificates={employeeCertificates}
        certificateTypes={certificateTypes}
        sessionFiles={sessionFiles}
        init={exportInit}
        setNotice={setNotice}
        onClose={() => setExportInit(null)}
        onEditProfile={() => { setExportInit(null); void openEdit(); }}
      />}
      {reasonDialog?.kind === "employee" && selected && <ReasonDialog
        title={`Lưu trữ hồ sơ ${selected.name}`}
        description="Hồ sơ sẽ bị ẩn khỏi danh sách và không xuất được nữa. Dữ liệu vẫn được giữ lại, admin có thể khôi phục bất cứ lúc nào."
        confirmLabel="Lưu trữ hồ sơ"
        onConfirm={confirmArchiveSelected}
        onClose={() => setReasonDialog(null)}
      />}
      {reasonDialog?.kind === "certificate" && <ReasonDialog
        title="Ẩn chứng chỉ"
        description={`Chứng chỉ số ${reasonDialog.certificate.number} sẽ không còn tính là hiện hành. Có thể khôi phục sau.`}
        confirmLabel="Ẩn chứng chỉ"
        onConfirm={(reason) => confirmArchiveCertificate(reasonDialog.certificate, reason)}
        onClose={() => setReasonDialog(null)}
      />}

      {showClaudeImport && <ClaudeHoSoImportModal setNotice={setNotice} onClose={() => setShowClaudeImport(false)} onSaved={() => void refresh(app, actor)} />}
      {showImport && <ImportEmployeesModal app={app} actor={actor} setNotice={setNotice} onClose={() => setShowImport(false)} onImported={() => void refresh(app, actor)} />}
      {previewFile && <FilePreviewModal file={previewFile} onClose={() => { URL.revokeObjectURL(previewFile.url); setPreviewFile(null); }} />}
      {batchEmployees && <BatchExportModal app={app} actor={actor} employees={batchEmployees} ensureFiles={(certificates, employee) => ensureFiles([...certificateFileRefs(certificates), ...extraFileRefs(employee)])} templates={templates} sessionFiles={sessionFiles} setNotice={setNotice} onClose={() => setBatchEmployees(null)} onGoToTemplates={() => { setBatchEmployees(null); navigate("reports"); }} />}
      {showExcelModal && selected && (
        <ExportExcelModal
          employee={selected}
          templates={templates}
          app={app}
          actor={actor}
          certificates={employeeCertificates}
          sessionFiles={sessionFiles}
          onClose={() => setShowExcelModal(false)}
          setNotice={setNotice}
          onGoToTemplatesConfig={() => {
            setShowExcelModal(false);
            navigate("reports");
          }}
        />
      )}
    </div>
  );
}
