"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createHrApp } from "../app-core/createHrApp";
import { fixedClock, systemClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import type { Actor } from "../modules/auth/permissions";
import type { CertificateChecklistRow, CertificateChecklistSummary } from "../modules/certificates/checklist";
import type { Certificate, FileRef } from "../modules/certificates/types";
import type { CertificateTypeRecord } from "../modules/certificate-types/types";
import type { Employee, EmployeeInput } from "../modules/employees/types";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import { ExportExcelModal } from "./ExportExcelModal";
import { ReportTemplatesPanel } from "./ReportTemplatesPanel";
import { AlertsView } from "./_components/AlertsView";
import { CertificateFormModal, type CertificateFormMode } from "./_components/CertificateFormModal";
import { EmployeeDetailView } from "./_components/EmployeeDetailView";
import { EmployeeFormModal } from "./_components/EmployeeFormModal";
import { EmployeeListView, type EmployeeFilters } from "./_components/EmployeeListView";
import { ExportPdfDialog, prepareExportDialog, type ExportDialogInit } from "./_components/ExportPdfDialog";
import { FilePreviewModal, type PreviewFile } from "./_components/FilePreviewModal";
import { SettingsPanel } from "./_components/SettingsPanel";
import { SideNav } from "./_components/SideNav";
import { SignatureFormModal } from "./_components/SignatureFormModal";
import { SignaturesView } from "./_components/SignaturesView";
import { emptyEmployee, issueText, type App, type ExpiringCertificateRow, type PageView, type SignatureRow } from "./_components/shared";
import { useReportTemplates } from "./_components/useReportTemplates";

const DEMO_NOW = "2026-10-12T09:00:00+07:00";

export default function HrmClient() {
  const [app, setApp] = useState<App | null>(null);
  const [actor, setActor] = useState<Actor>({ id: "demo-admin", role: "admin" });
  const [view, setView] = useState<PageView>("employees");
  const [rows, setRows] = useState<Employee[]>([]);
  const [employeeCertificateHealth, setEmployeeCertificateHealth] = useState<Record<string, CertificateChecklistSummary>>({});
  const [filters, setFilters] = useState<EmployeeFilters>({ query: "", positionFilter: "", missingRequiredCertificate: false, includeArchived: false });
  const [selected, setSelected] = useState<Employee | null>(null);
  const [notice, setNotice] = useState("");
  const [certRows, setCertRows] = useState<ExpiringCertificateRow[]>([]);
  const [signatureRows, setSignatureRows] = useState<SignatureRow[]>([]);
  const [employeeCertificates, setEmployeeCertificates] = useState<Certificate[]>([]);
  const [checklistRows, setChecklistRows] = useState<CertificateChecklistRow[]>([]);
  const [checklistSummary, setChecklistSummary] = useState<CertificateChecklistSummary>({ missing: 0, expiring: 0, expired: 0 });
  const [certificateTypes, setCertificateTypes] = useState<CertificateTypeRecord[]>([]);
  const [sessionFiles, setSessionFiles] = useState<Record<string, File>>({});
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [employeeForm, setEmployeeForm] = useState<{ editing: Employee | null; initial: EmployeeInput } | null>(null);
  const [certificateForm, setCertificateForm] = useState<CertificateFormMode | null>(null);
  const [exportInit, setExportInit] = useState<ExportDialogInit | null>(null);
  const [showSignatureForm, setShowSignatureForm] = useState(false);
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [templates, setTemplates] = useReportTemplates();
  const { query, includeArchived, missingRequiredCertificate, positionFilter } = filters;

  const refresh = useCallback(async (instance: App, currentActor: Actor) => {
    const listed = await instance.employees.list(currentActor, { query, includeArchived, missingRequiredCertificate, ...(positionFilter ? { position: positionFilter } : {}) });
    if (listed.ok) setRows(listed.value.items);
    const certs = await instance.certificates.listExpiring(currentActor);
    if (certs.ok) setCertRows(certs.value);
    const signatures = await instance.signatures.list(currentActor);
    if (signatures.ok) setSignatureRows(signatures.value);
  }, [query, includeArchived, missingRequiredCertificate, positionFilter]);

  useEffect(() => {
    let active = true;
    void createDemoRepositories(fixedClock(DEMO_NOW), sequentialIds("demo")).then((repositories) => {
      if (!active) return;
      const mailLog: string[] = [];
      const instance = createHrApp({ clock: systemClock, ids: sequentialIds("new"), repositories, mailer: { send: async (message) => { mailLog.push(message.subject); } } });
      setApp(instance);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!app) return;
    let current = true;
    void app.employees.list(actor, { query, includeArchived, missingRequiredCertificate, ...(positionFilter ? { position: positionFilter } : {}) }).then(async (result) => {
      if (!current || !result.ok) return;
      setRows(result.value.items);
      const health = await Promise.all(result.value.items.map(async (employee) => {
        const checklist = await app.certificates.checklist(actor, employee.id);
        return checklist.ok ? [employee.id, checklist.value.summary] as const : null;
      }));
      if (current) setEmployeeCertificateHealth(Object.fromEntries(health.filter((item): item is readonly [string, CertificateChecklistSummary] => item !== null)));
    });
    void app.certificates.listExpiring(actor).then((result) => { if (current && result.ok) setCertRows(result.value); });
    void app.signatures.list(actor).then((result) => { if (current && result.ok) setSignatureRows(result.value); });
    return () => { current = false; };
  }, [app, actor, query, includeArchived, missingRequiredCertificate, positionFilter]);

  useEffect(() => () => { if (previewFile) URL.revokeObjectURL(previewFile.url); }, [previewFile]);

  const reloadEmployeeCertificates = async (instance: App, employeeId: string) => {
    const certificates = await instance.certificates.listByEmployee(actor, employeeId);
    if (certificates.ok) setEmployeeCertificates(certificates.value);
    const checklist = await instance.certificates.checklist(actor, employeeId);
    if (checklist.ok) { setChecklistRows(checklist.value.rows); setChecklistSummary(checklist.value.summary); }
  };

  const openCreate = () => { setSelected(null); setEmployeeForm({ editing: null, initial: emptyEmployee }); };

  const openDetail = async (employee: Employee) => {
    if (!app) return;
    const full = await app.employees.get(actor, employee.id);
    if (full.ok) setSelected(full.value);
    const [certificates, checklist, types] = await Promise.all([app.certificates.listByEmployee(actor, employee.id), app.certificates.checklist(actor, employee.id), app.certificateTypes.list(actor, actor.role === "admin")]);
    if (certificates.ok) setEmployeeCertificates(certificates.value);
    if (checklist.ok) { setChecklistRows(checklist.value.rows); setChecklistSummary(checklist.value.summary); }
    if (types.ok) setCertificateTypes(types.value);
  };

  const openEmployeeById = async (employeeId: string) => {
    if (!app) return;
    const employee = rows.find((entry) => entry.id === employeeId);
    setView("employees");
    if (employee) { await openDetail(employee); return; }
    const result = await app.employees.get(actor, employeeId);
    if (result.ok) await openDetail(result.value);
  };

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

  const archiveCertificate = async (certificate: Certificate) => {
    if (!app || !selected) return;
    const reason = window.prompt("Nhập lý do ẩn chứng chỉ:");
    if (reason === null) return;
    const result = await app.certificates.archive(actor, { id: certificate.id, expectedVersion: certificate.version, reason });
    setNotice(result.ok ? "Đã lưu trữ chứng chỉ." : issueText(result.errors[0]?.code ?? "CERT_ARCHIVE_REASON"));
    await reloadEmployeeCertificates(app, selected.id);
    await refresh(app, actor);
  };

  const restoreCertificate = async (certificate: Certificate) => {
    if (!app || !selected) return;
    const result = await app.certificates.restore(actor, { id: certificate.id, expectedVersion: certificate.version });
    setNotice(result.ok ? "Đã khôi phục chứng chỉ." : issueText(result.errors[0]?.code ?? "CERT_RESTORE_CONFLICT"));
    await reloadEmployeeCertificates(app, selected.id);
    await refresh(app, actor);
  };

  const showFile = (file: FileRef) => {
    const binary = sessionFiles[file.id];
    if (!binary) { setNotice("Tệp mẫu không có dữ liệu xem trước trong phiên này."); return; }
    if (previewFile) URL.revokeObjectURL(previewFile.url);
    setPreviewFile({ name: file.name, mime: file.mime, url: URL.createObjectURL(binary) });
  };

  const archiveSelected = async () => {
    if (!app || !selected) return;
    const reason = window.prompt("Nhập lý do lưu trữ (tối thiểu 3 ký tự):");
    if (reason === null) return;
    const result = await app.employees.archive(actor, { id: selected.id, expectedVersion: selected.version, reason });
    if (!result.ok) { setNotice(issueText(result.errors[0]?.code ?? "EMP_ARCHIVE_REASON")); return; }
    setSelected(null); await refresh(app, actor); setNotice("Đã lưu trữ hồ sơ.");
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
    const prepared = await prepareExportDialog(app, actor, selected, employeeCertificates);
    if (!prepared.ok) { setNotice(prepared.message); return; }
    setCertificateTypes(prepared.init.certificateTypes);
    setExportInit(prepared.init);
  };

  const activeRows = useMemo(() => includeArchived ? rows : rows.filter((employee) => employee.archivedAt === null), [includeArchived, rows]);
  if (!app) return <div className="loading">Đang nạp dữ liệu mẫu…</div>;

  return (
    <div className="app-shell">
      <SideNav view={view} onNavigate={(key) => { setView(key); setSelected(null); }} alertCount={certRows.length} actor={actor} onActorChange={setActor} />
      <main className="main-content">
        {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}
        {view === "employees" && !selected && <EmployeeListView actor={actor} rows={activeRows} certificateHealth={employeeCertificateHealth} alertCount={certRows.length} signatureCount={signatureRows.length} filters={filters} onFiltersChange={setFilters} onCreate={openCreate} onOpen={(employee) => void openDetail(employee)} onRestore={(employee) => void restoreEmployee(employee)} />}
        {view === "employees" && selected && <EmployeeDetailView
          app={app}
          actor={actor}
          employee={selected}
          checklistRows={checklistRows}
          checklistSummary={checklistSummary}
          employeeCertificates={employeeCertificates}
          certificateTypes={certificateTypes}
          setNotice={setNotice}
          onBack={() => setSelected(null)}
          onEdit={() => void openEdit()}
          onArchive={() => void archiveSelected()}
          onRestore={() => void restoreSelected()}
          onExportExcel={() => setShowExcelModal(true)}
          onExportPdf={() => void openExportDialog()}
          onShowFile={showFile}
          onCertificateForm={(type, certificate) => setCertificateForm({ type, editing: certificate ?? null, renewing: null })}
          onRenewCertificate={(certificate) => setCertificateForm({ type: certificate.type, editing: null, renewing: certificate })}
          onArchiveCertificate={(certificate) => void archiveCertificate(certificate)}
          onRestoreCertificate={(certificate) => void restoreCertificate(certificate)}
        />}
        {view === "alerts" && <AlertsView app={app} actor={actor} certRows={certRows} onCertRowsChange={setCertRows} onOpenEmployee={(employeeId) => void openEmployeeById(employeeId)} setNotice={setNotice} />}
        {view === "signatures" && <SignaturesView app={app} actor={actor} signatureRows={signatureRows} onSignatureRowsChange={setSignatureRows} onAdd={() => setShowSignatureForm(true)} setNotice={setNotice} />}
        {view === "reports" && <ReportTemplatesPanel templates={templates} onTemplatesChange={setTemplates} employees={rows} setNotice={setNotice} />}
        {view === "settings" && <SettingsPanel app={app} actor={actor} setNotice={setNotice} onAddSignature={() => setShowSignatureForm(true)} sessionFiles={sessionFiles} />}
      </main>
      {employeeForm && <EmployeeFormModal
        app={app}
        actor={actor}
        editing={employeeForm.editing}
        initial={employeeForm.initial}
        setNotice={setNotice}
        onClose={() => setEmployeeForm(null)}
        onSaved={(employee) => { setEmployeeForm(null); setSelected(employee); setNotice("Đã lưu hồ sơ nhân sự."); void refresh(app, actor); }}
      />}
      {certificateForm && selected && <CertificateFormModal
        app={app}
        actor={actor}
        employee={selected}
        certificateTypes={certificateTypes}
        mode={certificateForm}
        setNotice={setNotice}
        onClose={() => setCertificateForm(null)}
        onSaved={(files, message) => {
          setSessionFiles((current) => ({ ...current, ...files }));
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
      {showSignatureForm && <SignatureFormModal
        app={app}
        actor={actor}
        setNotice={setNotice}
        onClose={() => setShowSignatureForm(false)}
        onSaved={(fileId, file) => {
          setSessionFiles((current) => ({ ...current, [fileId]: file }));
          setShowSignatureForm(false); setNotice("Đã thêm chữ ký với nền đã được tách.");
          void app.signatures.list(actor).then((signatures) => { if (signatures.ok) setSignatureRows(signatures.value); });
        }}
      />}
      {previewFile && <FilePreviewModal file={previewFile} onClose={() => { URL.revokeObjectURL(previewFile.url); setPreviewFile(null); }} />}
      {showExcelModal && selected && (
        <ExportExcelModal
          employee={selected}
          templates={templates}
          onClose={() => setShowExcelModal(false)}
          setNotice={setNotice}
          onGoToTemplatesConfig={() => {
            setShowExcelModal(false);
            setView("reports");
          }}
        />
      )}
    </div>
  );
}
