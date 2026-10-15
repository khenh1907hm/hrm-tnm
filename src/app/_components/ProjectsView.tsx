import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, Briefcase, CalendarDays, FileDown, FileSpreadsheet, HardHat, MapPin, PenLine, Plus, RotateCcw, Search, Users, X } from "lucide-react";
import type { Actor } from "../../modules/auth/permissions";
import { DEFAULT_CONTACT_RELATION } from "../../modules/commanders/fromEmployee";
import { POSITIONS, type Employee } from "../../modules/employees/types";
import type { ExcelReportTemplate } from "../../modules/excel-template/types";
import { PROJECT_STATUS_LABELS, type Project, type ProjectInput, type ProjectStatus } from "../../modules/projects/types";
import { useActiveEmployees } from "./ContactPicker";
import { issueText, type App, type SetNotice } from "./shared";

const vnDate = (iso: string | null) => iso ? iso.split("-").reverse().join("/") : "";
const STATUS_TONE: Record<ProjectStatus, string> = { planning: "info", active: "ok", closed: "none" };
const emptyProject = (memberIds: string[] = []): ProjectInput => ({ name: "", customer: "", location: "", startDate: null, endDate: null, status: "planning", templateId: null, memberIds, commanderId: null, commanderRelation: DEFAULT_CONTACT_RELATION, exportValues: {}, note: "" });

/** Trang Dự án: danh sách → chi tiết → xuất hồ sơ theo FORM với chỉ huy trưởng đã chọn sẵn. */
export function ProjectsView(props: {
  app: App; actor: Actor; templates: readonly ExcelReportTemplate[]; setNotice: SetNotice;
  /** Mở sẵn form tạo dự án với những nhân sự này (từ màn Nhân sự). */
  draftMemberIds: string[] | null; onDraftConsumed: () => void;
  onExport: (project: Project) => void; onExportRoster: (employeeIds: string[]) => void;
}) {
  const { app, actor } = props;
  const employees = useActiveEmployees(app, actor);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // Đến từ màn Nhân sự với danh sách đã chọn → mở sẵn form tạo dự án
  const [editor, setEditor] = useState<{ project: Project | null; initial: ProjectInput } | null>(() => props.draftMemberIds ? { project: null, initial: emptyProject(props.draftMemberIds) } : null);
  const profileTemplates = useMemo(() => props.templates.filter((template) => template.profile), [props.templates]);
  const templateName = (id: string | null) => props.templates.find((template) => template.id === id)?.name;
  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);

  const reload = async () => { const result = await app.projects.list(actor, showArchived); if (result.ok) setProjects(result.value); };
  useEffect(() => {
    let active = true;
    void app.projects.list(actor, showArchived).then((result) => { if (active && result.ok) setProjects(result.value); });
    return () => { active = false; };
  }, [app, actor, showArchived]);
  useEffect(() => { if (props.draftMemberIds) props.onDraftConsumed(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = projects.find((project) => project.id === openId) ?? null;
  const shown = projects.filter((project) => !query.trim() || `${project.name} ${project.customer} ${project.location}`.toLowerCase().includes(query.trim().toLowerCase()));

  const toggleArchive = async (project: Project) => {
    const result = project.archivedAt ? await app.projects.restore(actor, { id: project.id, expectedVersion: project.version }) : await app.projects.archive(actor, { id: project.id, expectedVersion: project.version });
    props.setNotice(result.ok ? (project.archivedAt ? "Đã khôi phục dự án." : "Đã lưu trữ dự án.") : issueText(result.errors[0]?.code ?? "PROJECT_NOT_FOUND"), result.ok ? "success" : "error");
    if (result.ok && !project.archivedAt && !showArchived) setOpenId(null);
    await reload();
  };

  const editorModal = editor && <ProjectEditor app={app} actor={actor} employees={employees} templates={profileTemplates} project={editor.project} initial={editor.initial}
    onClose={() => setEditor(null)}
    onSaved={(saved) => { setEditor(null); props.setNotice(editor.project ? "Đã lưu dự án." : "Đã tạo dự án.", "success"); setOpenId(saved.id); void reload(); }} />;

  // ===== Chi tiết dự án =====
  if (open) {
    const members = open.memberIds.map((id) => employeeById.get(id)).filter((employee): employee is Employee => Boolean(employee));
    const commander = open.commanderId ? employeeById.get(open.commanderId) : undefined;
    const missing = open.memberIds.length - members.length;
    return <>
      <button type="button" className="link-button back-link" onClick={() => setOpenId(null)}><ArrowLeft size={16} aria-hidden="true" /> Danh sách dự án</button>
      <div className="page-head project-head">
        <div>
          <h1>{open.name} <span className={`pill ${STATUS_TONE[open.status]}`}>{open.archivedAt ? "Đã lưu trữ" : PROJECT_STATUS_LABELS[open.status]}</span></h1>
          <p>{[open.customer, open.location].filter(Boolean).join(" · ") || "Chưa nhập khách hàng/địa điểm"}</p>
        </div>
        <div className="button-row">
          <button type="button" className="button" onClick={() => setEditor({ project: open, initial: open })}><PenLine className="ico" size={16} aria-hidden="true" /> Sửa dự án</button>
          <button type="button" className="button" onClick={() => void toggleArchive(open)}>{open.archivedAt ? <><RotateCcw className="ico" size={16} aria-hidden="true" /> Khôi phục</> : <><Archive className="ico" size={16} aria-hidden="true" /> Lưu trữ</>}</button>
        </div>
      </div>

      <div className="project-summary">
        <div className="project-fact"><span><FileSpreadsheet size={15} aria-hidden="true" /> FORM hồ sơ</span><b>{templateName(open.templateId) ?? <em className="muted">Chưa chọn</em>}</b></div>
        <div className="project-fact tone-accent"><span><HardHat size={15} aria-hidden="true" /> Chỉ huy trưởng</span><b>{commander ? `${commander.name} · ${commander.phone}` : <em className="muted">Chưa chọn</em>}</b>{commander && <small>{open.commanderRelation}</small>}</div>
        <div className="project-fact"><span><Users size={15} aria-hidden="true" /> Nhân sự tham gia</span><b>{members.length} người</b>{missing > 0 && <small className="warn-text">{missing} người đã lưu trữ</small>}</div>
        <div className="project-fact"><span><CalendarDays size={15} aria-hidden="true" /> Thời gian</span><b>{open.startDate ? `${vnDate(open.startDate)}${open.endDate ? ` → ${vnDate(open.endDate)}` : ""}` : <em className="muted">Chưa nhập</em>}</b></div>
      </div>

      <div className="project-actions panel">
        <div><b>Xuất hồ sơ cho dự án</b><p className="muted">Dùng FORM, chỉ huy trưởng và giá trị đã lưu của dự án; xuất được Excel hoặc PDF gộp cho {members.length} người.</p></div>
        <div className="button-row">
          <button type="button" className="button primary" disabled={!members.length} onClick={() => props.onExport(open)}><FileDown className="ico" size={16} aria-hidden="true" /> Xuất hồ sơ theo FORM</button>
          <button type="button" className="button success" disabled={!members.length} onClick={() => props.onExportRoster(members.map((member) => member.id))}><FileSpreadsheet className="ico" size={16} aria-hidden="true" /> Xuất Excel thông tin</button>
        </div>
      </div>

      <section className="panel list-card">
        <div className="table-scroll employee-table"><table>
          <thead><tr><th>Mã NV</th><th>Họ và tên</th><th>Chức danh</th><th>Điện thoại</th><th>Vai trò trong dự án</th></tr></thead>
          <tbody>
            {members.map((member) => <tr key={member.id} className={member.id === open.commanderId ? "row-selected" : undefined}>
              <td><span className="code-tag">{member.code}</span></td><td><b>{member.name}</b></td><td>{member.position}</td><td>{member.phone}</td>
              <td>{member.id === open.commanderId ? <span className="pill warn"><HardHat size={12} aria-hidden="true" /> Chỉ huy trưởng</span> : <span className="muted">Thành viên</span>}</td>
            </tr>)}
            {!members.length && <tr><td colSpan={5} className="empty">Dự án chưa có nhân sự. Bấm “Sửa dự án” để thêm.</td></tr>}
          </tbody>
        </table></div>
      </section>
      {open.note && <p className="muted project-note">Ghi chú: {open.note}</p>}
      {editorModal}
    </>;
  }

  // ===== Danh sách dự án =====
  return <>
    <div className="page-head">
      <div><h1>Dự án</h1><p>Thiết lập đoàn nhân sự đi công trình: FORM hồ sơ, người tham gia và chỉ huy trưởng</p></div>
      <button className="button primary" onClick={() => setEditor({ project: null, initial: emptyProject() })}><Plus className="ico" size={16} aria-hidden="true" /> Tạo dự án</button>
    </div>
    <div className="project-toolbar">
      <label className="search-box"><Search size={16} aria-hidden="true" /><input aria-label="Tìm dự án" placeholder="Tìm tên dự án, khách hàng, địa điểm" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="toolbar-check"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Hiện dự án đã lưu trữ</label>
    </div>
    <div className="project-grid">
      {shown.map((project) => {
        const commander = project.commanderId ? employeeById.get(project.commanderId) : undefined;
        return (
          <button type="button" className={`panel project-card${project.archivedAt ? " is-archived" : ""}`} key={project.id} onClick={() => setOpenId(project.id)}>
            <div className="project-card-top"><Briefcase size={18} aria-hidden="true" /><span className={`pill ${STATUS_TONE[project.status]}`}>{project.archivedAt ? "Đã lưu trữ" : PROJECT_STATUS_LABELS[project.status]}</span></div>
            <b className="project-card-name">{project.name}</b>
            <span className="project-card-sub">{project.customer || "—"}{project.location && <> · <MapPin size={12} aria-hidden="true" /> {project.location}</>}</span>
            <dl>
              <div><dt>FORM</dt><dd>{templateName(project.templateId) ?? "Chưa chọn"}</dd></div>
              <div><dt>Nhân sự</dt><dd>{project.memberIds.length} người</dd></div>
              <div><dt>Chỉ huy trưởng</dt><dd>{commander?.name ?? "Chưa chọn"}</dd></div>
              <div><dt>Bắt đầu</dt><dd>{vnDate(project.startDate) || "—"}</dd></div>
            </dl>
          </button>
        );
      })}
      {!shown.length && (
        <div className="panel empty signature-empty">
          <Briefcase size={28} aria-hidden="true" />
          <p>{query ? "Không có dự án phù hợp." : "Chưa có dự án. Tạo dự án để chọn FORM, nhân sự tham gia và chỉ huy trưởng một lần, xuất hồ sơ cả đoàn bằng một nút."}</p>
          {!query && <button className="button primary" onClick={() => setEditor({ project: null, initial: emptyProject() })}><Plus className="ico" size={16} aria-hidden="true" /> Tạo dự án đầu tiên</button>}
        </div>
      )}
    </div>
    {editorModal}
  </>;
}

/** Form tạo/sửa dự án: thông tin chung, FORM, chọn người tham gia và chỉ huy trưởng. */
function ProjectEditor(props: { app: App; actor: Actor; employees: readonly Employee[]; templates: readonly ExcelReportTemplate[]; project: Project | null; initial: ProjectInput; onClose: () => void; onSaved: (project: Project) => void }) {
  const [form, setForm] = useState<ProjectInput>(props.initial);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ProjectInput>) => setForm((current) => ({ ...current, ...patch }));
  const template = props.templates.find((item) => item.id === form.templateId);
  const exportFields = (template?.profile?.customFields ?? []).filter((field) => field.kind !== "image" && field.scope !== "employee");

  const byId = useMemo(() => new Map(props.employees.map((employee) => [employee.id, employee])), [props.employees]);
  const candidates = props.employees.filter((employee) => (!position || employee.position === position) && (!search.trim() || `${employee.code} ${employee.name} ${employee.phone}`.toLowerCase().includes(search.trim().toLowerCase())));
  const toggleMember = (id: string) => {
    const has = form.memberIds.includes(id);
    set({ memberIds: has ? form.memberIds.filter((item) => item !== id) : [...form.memberIds, id], commanderId: has && form.commanderId === id ? null : form.commanderId });
  };
  const addAllShown = () => set({ memberIds: [...new Set([...form.memberIds, ...candidates.map((employee) => employee.id)])] });

  const save = async () => {
    setBusy(true);
    const result = props.project ? await props.app.projects.update(props.actor, { ...form, id: props.project.id, expectedVersion: props.project.version }) : await props.app.projects.create(props.actor, form);
    setBusy(false);
    if (!result.ok) { setErrors(result.errors.map((item) => issueText(item.code))); return; }
    props.onSaved(result.value);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card project-editor" role="dialog" aria-modal="true" aria-labelledby="project-editor-title">
        <header><h2 id="project-editor-title">{props.project ? "Sửa dự án" : "Tạo dự án"}</h2><button type="button" className="close" aria-label="Đóng" onClick={props.onClose}><X size={20} aria-hidden="true" /></button></header>
        <div className="project-editor-body">
          <section className="editor-section">
            <h3><span className="step">1</span> Thông tin dự án</h3>
            <div className="form-grid project-info-grid">
              <label className="field span-2"><span>Tên dự án *</span><input value={form.name} onChange={(event) => set({ name: event.target.value })} placeholder="vd: Taikisha – Nhà máy ABC" autoFocus /></label>
              <label className="field"><span>Khách hàng</span><input value={form.customer} onChange={(event) => set({ customer: event.target.value })} placeholder="vd: Taikisha Việt Nam" /></label>
              <label className="field"><span>Địa điểm</span><input value={form.location} onChange={(event) => set({ location: event.target.value })} /></label>
              <label className="field"><span>Ngày bắt đầu</span><input type="date" value={form.startDate ?? ""} onChange={(event) => set({ startDate: event.target.value || null })} /></label>
              <label className="field"><span>Ngày kết thúc</span><input type="date" value={form.endDate ?? ""} onChange={(event) => set({ endDate: event.target.value || null })} /></label>
              <label className="field"><span>Trạng thái</span><select value={form.status} onChange={(event) => set({ status: event.target.value as ProjectStatus })}>{(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((status) => <option key={status} value={status}>{PROJECT_STATUS_LABELS[status]}</option>)}</select></label>
            </div>
          </section>

          <section className="editor-section">
            <h3><span className="step">2</span> FORM hồ sơ</h3>
            <label className="field"><span>Mẫu hồ sơ dùng khi xuất</span>
              <select value={form.templateId ?? ""} onChange={(event) => set({ templateId: event.target.value || null })}>
                <option value="">— Chưa chọn —</option>
                {props.templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            {exportFields.length > 0 && (
              <div className="form-grid">
                {exportFields.map((field) => field.kind === "checkbox"
                  ? <label className="check-field" key={field.key}><input type="checkbox" checked={(form.exportValues[field.key] ?? field.defaultValue) === "true"} onChange={(event) => set({ exportValues: { ...form.exportValues, [field.key]: event.target.checked ? "true" : "" } })} /> {field.label}</label>
                  : <label className="field" key={field.key}><span>{field.label}</span><input type={field.kind === "date" ? "date" : "text"} value={form.exportValues[field.key] ?? field.defaultValue} onChange={(event) => set({ exportValues: { ...form.exportValues, [field.key]: event.target.value } })} /></label>)}
              </div>
            )}
          </section>

          <section className="editor-section">
            <h3><span className="step">3</span> Nhân sự tham gia và chỉ huy trưởng</h3>
            <div className="member-picker">
              <div className="member-pool">
                <div className="member-pool-tools">
                  <label className="search-box"><Search size={15} aria-hidden="true" /><input aria-label="Tìm nhân sự" placeholder="Tìm tên, mã, SĐT" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
                  <select aria-label="Lọc chức danh" value={position} onChange={(event) => setPosition(event.target.value)}><option value="">Mọi chức danh</option>{POSITIONS.map((item) => <option key={item}>{item}</option>)}</select>
                </div>
                <div className="member-pool-head"><span>{candidates.length} nhân sự</span><button type="button" className="link-button" disabled={!candidates.length} onClick={addAllShown}>Chọn tất cả đang hiển thị</button></div>
                <ul className="member-list">
                  {candidates.map((employee) => {
                    const checked = form.memberIds.includes(employee.id);
                    return <li key={employee.id}><label className={checked ? "is-on" : undefined}><input type="checkbox" checked={checked} onChange={() => toggleMember(employee.id)} /><span className="code-tag">{employee.code}</span><span className="member-name">{employee.name}</span><small>{employee.position}</small></label></li>;
                  })}
                  {!candidates.length && <li className="muted member-empty">Không có nhân sự phù hợp.</li>}
                </ul>
              </div>
              <div className="member-chosen">
                <div className="member-pool-head"><b>Đã chọn {form.memberIds.length} người</b>{form.memberIds.length > 0 && <button type="button" className="link-button" onClick={() => set({ memberIds: [], commanderId: null })}>Bỏ chọn hết</button>}</div>
                <p className="muted member-hint">Bấm <HardHat size={13} aria-hidden="true" /> để chọn chỉ huy trưởng (người liên hệ khẩn cấp của cả đoàn).</p>
                <ul className="member-list chosen">
                  {form.memberIds.map((id) => {
                    const employee = byId.get(id);
                    const isCommander = form.commanderId === id;
                    return <li key={id} className={isCommander ? "is-commander" : undefined}>
                      <button type="button" className={`cht-toggle${isCommander ? " is-on" : ""}`} aria-pressed={isCommander} title={isCommander ? "Đang là chỉ huy trưởng" : "Chọn làm chỉ huy trưởng"} onClick={() => set({ commanderId: isCommander ? null : id })}><HardHat size={15} aria-hidden="true" /></button>
                      <span className="member-name">{employee ? employee.name : "(nhân sự đã lưu trữ)"}</span>
                      {employee && <small>{employee.code}</small>}
                      {isCommander && <span className="pill warn">Chỉ huy trưởng</span>}
                      <button type="button" className="icon-x" aria-label={`Bỏ ${employee?.name ?? id}`} onClick={() => toggleMember(id)}><X size={14} aria-hidden="true" /></button>
                    </li>;
                  })}
                  {!form.memberIds.length && <li className="muted member-empty">Chưa chọn ai. Tick ở danh sách bên trái.</li>}
                </ul>
                <label className="field"><span>Quan hệ ghi trên hồ sơ</span><input value={form.commanderRelation} onChange={(event) => set({ commanderRelation: event.target.value })} /></label>
              </div>
            </div>
          </section>

          <label className="field"><span>Ghi chú</span><textarea rows={2} value={form.note} onChange={(event) => set({ note: event.target.value })} /></label>
          {errors.length > 0 && <div className="readiness-errors" role="alert">{errors.map((message) => <p key={message}>{message}</p>)}</div>}
        </div>
        <footer>
          <span className="muted footer-summary">{form.memberIds.length} người · {form.commanderId ? `CHT: ${byId.get(form.commanderId)?.name ?? ""}` : "chưa chọn chỉ huy trưởng"}</span>
          <button type="button" className="button" onClick={props.onClose}>Hủy</button>
          <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>{busy ? "Đang lưu…" : props.project ? "Lưu dự án" : "Tạo dự án"}</button>
        </footer>
      </section>
    </div>
  );
}
