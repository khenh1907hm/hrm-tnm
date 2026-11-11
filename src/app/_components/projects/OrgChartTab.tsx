"use client";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, ImagePlus, Printer, RefreshCw, RotateCcw, Save, Trash2, Users, X } from "lucide-react";
import {
  applyEmployeeFacts, DEFAULT_ORG_HEADER, blankPerson, buildFromProject, defaultOrgChart, ghostSlots, isGhost, layoutOrgChart, mergeMembers, orgChartIssue, ORG_CANVAS, ORG_MAX_GROUPS,
  renumberGroups, signDateText, suggestEmail, toCompanyTemplate, type OrgBox, type OrgChart, type OrgChartHeader, type OrgPerson, type OrgSection,
} from "../../../modules/projects/orgChart";
import type { ProjectStore } from "../../../modules/projects/store";
import type { Project, ProjectMember } from "../../../modules/projects/types";
import { systemClock, todayVN } from "../../../lib/clock";
import { hasAccess, type Actor } from "../../../modules/auth/permissions";
import type { TabProps } from "./ProjectDetail";
import { MembersTab } from "./MembersTab";
import { EmployeePicker } from "./ProjectsPage";
import { errorMessage, viewerFor, type EmployeeSource } from "./projectShared";
import "./orgchart.css";

type Notify = TabProps["setNotice"];
const newId = () => crypto.randomUUID();
/** Ngoài khách hàng, hạng mục, ngày ký thì mọi thông tin đầu trang luôn theo mặc định công ty. */
const withFixedHeader = (header: OrgChartHeader): OrgChartHeader => ({ ...DEFAULT_ORG_HEADER, client: header.client, item: header.item, signDate: header.signDate });

/** Thu ảnh về khung 3×4 (180 × 240) JPEG để lưu gọn trong sơ đồ. */
async function toPortrait(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = 180; canvas.height = 240;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Trình duyệt không xử lý được ảnh.");
  const target = 3 / 4;
  const ratio = bitmap.width / bitmap.height;
  const sw = ratio > target ? bitmap.height * target : bitmap.width;
  const sh = ratio > target ? bitmap.height : bitmap.width / target;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 180, 240);
  context.drawImage(bitmap, (bitmap.width - sw) / 2, 0, sw, sh, 0, 0, 180, 240);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** Tên chức vụ mặc định khi thêm ô vào từng vị trí. */
const SLOT_TITLES: Record<string, { label: string; titleEn: string; titleVi: string }> = {
  "office:main": { label: "Thêm người văn phòng", titleEn: "Manager", titleVi: "Quản lý" },
  "office:right": { label: "Thêm nhánh phải", titleEn: "Technical Support", titleVi: "Kỹ thuật" },
  "site:main": { label: "Thêm quản lý công trường", titleEn: "Site Manager", titleVi: "Quản lý công trường" },
  "site:left": { label: "Thêm nhánh trái", titleEn: "Safety Staff", titleVi: "Nhân viên an toàn" },
  "site:right": { label: "Thêm nhánh phải", titleEn: "Supervisor", titleVi: "Giám sát" },
  "site:group": { label: "Thêm quản lý nhóm", titleEn: "", titleVi: "" },
};
const POSITIONS: [string, string][] = [
  ["office:main", "Văn phòng · trục giữa"], ["office:right", "Văn phòng · nhánh phải"], ["site:main", "Công trường · trục giữa"],
  ["site:left", "Công trường · nhánh trái"], ["site:right", "Công trường · nhánh phải"], ["site:group", "Quản lý nhóm (hàng dưới)"],
];

/** Điền tên, số điện thoại, ảnh từ hồ sơ nhân sự cho các ô đã gắn nhân sự. */
async function factsFor(employees: EmployeeSource, employeeId: string) {
  if (!employees) return null;
  const [option, blob] = await Promise.all([employees.get?.(employeeId).catch(() => null) ?? null, employees.photo?.(employeeId).catch(() => null) ?? null]);
  const photo = blob ? await toPortrait(blob).catch(() => null) : null;
  return option || photo ? { name: option?.name, phone: option?.phone, photo } : null;
}

export type OrgChartEditorProps = {
  store: ProjectStore;
  /** null = không theo dự án (chỉ lập và in, không lưu). */
  project: Project | null;
  members: readonly ProjectMember[];
  today: string;
  canEdit: boolean;
  canSetTemplate: boolean;
  employees: EmployeeSource;
  setNotice: Notify;
};

/**
 * Sơ đồ tổ chức nhà thầu phụ (BH-02-F02), sửa trực tiếp trên sơ đồ: bấm ô để sửa người đó, bấm ô "+" để thêm,
 * nút × để bỏ ô. Lần đầu dựng từ dữ liệu (mẫu chung của công ty + thành viên dự án + hồ sơ nhân sự).
 */
export function OrgChartEditor(props: OrgChartEditorProps) {
  const { store, project, members, today, canEdit, employees, setNotice } = props;
  const [saved, setSaved] = useState<OrgChart | null | undefined>(undefined);
  const [chart, setChart] = useState<OrgChart | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ghosts, setGhosts] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  /** Bổ sung số điện thoại, ảnh (và tên khi overwrite) từ hồ sơ nhân sự. */
  const enrich = useCallback(async (base: OrgChart, overwrite: boolean) => {
    const linked = base.people.filter((person) => person.employeeId && (overwrite || !person.phone.trim() || !person.photo));
    const facts = await Promise.all(linked.map(async (person) => [person.id, await factsFor(employees, person.employeeId!)] as const));
    const byId = new Map(facts.filter(([, value]) => value));
    if (!byId.size) return;
    setChart((current) => current && { ...current, people: current.people.map((person) => byId.has(person.id) ? applyEmployeeFacts(person, byId.get(person.id)!, overwrite) : person) });
  }, [employees]);

  useEffect(() => {
    let active = true;
    const shell = project ?? { customerName: "", name: "" };
    // Chưa có sơ đồ: dựng từ dữ liệu (mẫu chung + thành viên dự án), rồi lấy số điện thoại, ảnh từ hồ sơ
    void Promise.all([project ? store.getOrgChart(project.id) : Promise.resolve(null), store.getOrgTemplate().catch(() => null)]).then(([found, template]) => {
      if (!active) return;
      const fixed = found ? { ...found, header: withFixedHeader(found.header) } : null;
      setSaved(fixed);
      const built = fixed ?? (project ? buildFromProject(newId, shell, today, template, members) : defaultOrgChart(newId, shell, today, template));
      const next = { ...built, header: withFixedHeader(built.header) };
      setChart(next);
      if (!found) void enrich(next, false);
    }, () => {
      if (!active) return;
      setUnavailable(true); setSaved(null);
      const next = buildFromProject(newId, shell, today, null, members);
      setChart(next); void enrich(next, false);
    });
    return () => { active = false; };
  }, [store, project, today, members, enrich]);

  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("oc-printing");
    const done = () => { document.body.classList.remove("oc-printing"); setPrinting(false); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    const timer = window.setTimeout(() => window.print(), 50);
    return () => window.clearTimeout(timer);
  }, [printing]);

  const dirty = useMemo(() => chart !== null && JSON.stringify(chart) !== JSON.stringify(saved ?? null), [chart, saved]);
  if (!chart) return <div className="loading">Đang dựng sơ đồ từ dữ liệu…</div>;

  const setHeader = (patch: Partial<OrgChartHeader>) => setChart({ ...chart, header: { ...chart.header, ...patch } });
  const setPerson = (id: string, patch: Partial<OrgPerson>) => setChart({ ...chart, people: chart.people.map((person) => person.id === id ? { ...person, ...patch } : person) });
  const addAt = (ghost: OrgPerson) => {
    const key = `${ghost.section}:${ghost.branch}`;
    if (ghost.branch === "group" && chart.people.filter((person) => person.branch === "group").length >= ORG_MAX_GROUPS) { setNotice(`Tối đa ${ORG_MAX_GROUPS} quản lý nhóm trên một trang.`, "error"); return; }
    const titles = SLOT_TITLES[key] ?? { titleEn: "", titleVi: "" };
    const person = blankPerson(newId(), ghost.section, ghost.branch, titles.titleEn, titles.titleVi);
    setChart({ ...chart, people: renumberGroups([...chart.people, person]) });
    setEditing(person.id);
  };
  const remove = (id: string) => { setChart({ ...chart, people: renumberGroups(chart.people.filter((person) => person.id !== id)) }); setEditing(null); };
  const move = (id: string, step: -1 | 1) => {
    const person = chart.people.find((item) => item.id === id);
    if (!person) return;
    const same = chart.people.filter((item) => item.section === person.section && item.branch === person.branch);
    const other = same[same.indexOf(person) + step];
    if (!other) return;
    const people = [...chart.people];
    const a = people.indexOf(person); const b = people.indexOf(other);
    [people[a], people[b]] = [other, person];
    setChart({ ...chart, people: renumberGroups(people) });
  };
  const save = async () => {
    if (!project) return;
    const issue = orgChartIssue(chart);
    if (issue) { setNotice(issue, "error"); return; }
    setBusy(true);
    try { await store.saveOrgChart(project.id, chart); setSaved(structuredClone(chart)); setNotice("Đã lưu sơ đồ tổ chức.", "success"); }
    catch (error) { setNotice(errorMessage(error), "error"); }
    finally { setBusy(false); }
  };
  const saveTemplate = async () => {
    if (!window.confirm("Lưu tiêu đề (tên nhà thầu, công ty, người ký…) và khối Văn phòng làm MẪU CHUNG? Sơ đồ mới của mọi dự án sẽ bắt đầu từ mẫu này.")) return;
    setBusy(true);
    try { await store.saveOrgTemplate(toCompanyTemplate(chart)); setNotice("Đã lưu mẫu chung, mọi người lập sơ đồ mới sẽ dùng mẫu này.", "success"); }
    catch (error) { setNotice(errorMessage(error), "error"); }
    finally { setBusy(false); }
  };
  const sync = () => {
    const next = mergeMembers(chart, members, newId, today);
    setChart(next);
    void enrich(next, false);
    setNotice("Đã cập nhật theo thành viên dự án và hồ sơ nhân sự.", "success");
  };
  const current = chart.people.find((person) => person.id === editing) ?? null;
  const showGhosts = canEdit && ghosts && !printing;

  return (
    <div className="oc-page">
      {canEdit && (
        <section className="panel pj-section oc-header">
          <h2 className="oc-header-title">Thông tin chung <small className="muted">Nhà thầu, công ty, người ký… luôn theo mặc định.</small></h2>
          <HeaderForm header={chart.header} onChange={setHeader} />
        </section>
      )}
      <section className="panel pj-section">
        <div className="pj-section-head">
          <h2><Users className="ico" size={18} aria-hidden="true" /> Sơ đồ tổ chức dự án <small className="muted">(mẫu BH-02-F02)</small></h2>
          <div className="button-row">
            {canEdit && <button type="button" className="button" onClick={() => setGhosts(!ghosts)} title="Bật / tắt các ô + Thêm trên sơ đồ">{ghosts ? <EyeOff className="ico" size={16} aria-hidden="true" /> : <Eye className="ico" size={16} aria-hidden="true" />} {ghosts ? "Ẩn ô thêm" : "Hiện ô thêm"}</button>}
            {canEdit && project && <button type="button" className="button" onClick={sync} title="Thêm thành viên mới, cập nhật số công nhân, lấy số điện thoại và ảnh từ hồ sơ"><RefreshCw className="ico" size={16} aria-hidden="true" /> Cập nhật từ dữ liệu</button>}
            {canEdit && dirty && saved && <button type="button" className="button" onClick={() => setChart(structuredClone(saved))}><RotateCcw className="ico" size={16} aria-hidden="true" /> Bỏ thay đổi</button>}
            {props.canSetTemplate && <button type="button" className="button" disabled={busy} onClick={() => void saveTemplate()} title="Tiêu đề và khối Văn phòng dùng cho sơ đồ mới của mọi dự án"><Save className="ico" size={16} aria-hidden="true" /> Lưu làm mẫu chung</button>}
            <button type="button" className="button" onClick={() => setPrinting(true)}><Printer className="ico" size={16} aria-hidden="true" /> In / Lưu PDF</button>
            {canEdit && project && <button type="button" className="button primary" disabled={busy || !dirty || unavailable} onClick={() => void save()}><Save className="ico" size={16} aria-hidden="true" /> {busy ? "Đang lưu…" : dirty ? "Lưu sơ đồ" : "Đã lưu"}</button>}
          </div>
        </div>
        <p className="muted oc-tip">
          {canEdit ? "Bấm vào ô để sửa người đó, bấm ô “+” để thêm, nút × để bỏ ô. Thông tin lấy sẵn từ dữ liệu, sửa lại tùy ý." : "Bạn chỉ xem và in được sơ đồ; PM hoặc Chỉ huy trưởng mới sửa được."}
          {project && saved === null && canEdit && !unavailable ? " Sơ đồ đang dựng từ dữ liệu, chưa lưu." : ""}
          {!project ? " Bản này không gắn dự án: lập và in, không lưu lại." : ""}
        </p>
        {unavailable && <p className="oc-alert">Máy chủ chưa bật chức năng lưu sơ đồ. Bạn vẫn lập và in PDF được, nhưng chưa lưu lại được.</p>}
        <OrgSheet chart={chart} ghosts={showGhosts} selected={editing}
          onSelect={canEdit ? setEditing : undefined} onAdd={canEdit ? addAt : undefined} onRemove={canEdit ? (id) => { if (window.confirm("Bỏ ô này khỏi sơ đồ?")) remove(id); } : undefined} />
      </section>
      {current && canEdit && (
        <PersonModal key={current.id} person={current} header={chart.header} employees={employees} setNotice={setNotice}
          onChange={(patch) => setPerson(current.id, patch)} onRemove={() => remove(current.id)} onMove={(step) => move(current.id, step)} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** Tab "Sơ đồ & thành viên" của dự án: sơ đồ tổ chức ở trên, danh sách thành viên (dùng cho chấm công) ở dưới. */
export function OrgChartTab(props: TabProps) {
  const { store, data, viewer, actor, employees, setNotice } = props;
  const [listOpen, setListOpen] = useState(false);
  return (
    <div className="pj-page">
      <OrgChartEditor store={store} project={data.project} members={data.members} today={data.today} canEdit={viewer.isLead || viewer.canEditProject}
        canSetTemplate={actor.role === "admin" || hasAccess(actor, "projects.manage")} employees={employees} setNotice={setNotice} />
      <section className="panel pj-section">
        <button type="button" className="oc-header-toggle" aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>
          {listOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />} <b>Thành viên dự án ({data.members.length})</b>
          <small className="muted">Vai trò, tổ, ngày vào / rời: dùng cho chấm công và quyền. Thêm người ở đây rồi bấm “Cập nhật từ dữ liệu”.</small>
        </button>
      </section>
      {listOpen && <MembersTab {...props} />}
    </div>
  );
}

/** Bản trong mục Công cụ: chọn dự án để lấy dữ liệu (hoặc không theo dự án) rồi in. */
export function OrgChartTool(props: { store: ProjectStore; ready: boolean; actor: Actor; employees: EmployeeSource; setNotice: Notify }) {
  const { store, ready, actor, employees, setNotice } = props;
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string>("");
  const [loaded, setLoaded] = useState<{ project: Project; members: ProjectMember[]; canEdit: boolean } | null>(null);
  const [today] = useState(() => todayVN(systemClock));
  const noMembers = useMemo<ProjectMember[]>(() => [], []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void store.listProjects().then((list) => { if (active) setProjects(list.filter((item) => item.status !== "archived")); }, () => { if (active) setProjects([]); });
    return () => { active = false; };
  }, [store, ready]);
  useEffect(() => {
    const project = projects?.find((item) => item.id === projectId);
    if (!project) return;
    let active = true;
    void Promise.all([store.listMembers(project.id).catch(() => []), store.myEmployeeId().catch(() => null)]).then(([members, me]) => {
      if (!active) return;
      const viewer = viewerFor(actor, me, project, members);
      setLoaded({ project, members, canEdit: viewer.isLead || viewer.canEditProject });
    });
    return () => { active = false; };
  }, [store, projects, projectId, actor]);
  const [open, setOpen] = useState(false);
  const current = projectId ? (loaded?.project.id === projectId ? loaded : null) : { project: null, members: noMembers, canEdit: true };
  // Ngoài trang Công cụ chỉ hiện tên; bấm vào mới mở form
  if (!open) return (
    <button type="button" className="panel tool-card oc-tool-card" onClick={() => setOpen(true)}>
      <Users className="ico" size={20} aria-hidden="true" /> <b>Sơ đồ tổ chức dự án</b> <ChevronRight size={18} aria-hidden="true" />
    </button>
  );
  return (
    <section className="panel tool-card oc-tool">
      <div className="pj-section-head">
        <h2><Users className="ico" size={18} aria-hidden="true" /> Sơ đồ tổ chức dự án</h2>
        <button type="button" className="button" onClick={() => setOpen(false)}><X className="ico" size={16} aria-hidden="true" /> Đóng</button>
      </div>
      <label className="field oc-project-pick"><span>Lấy dữ liệu từ dự án</span>
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          <option value="">Không theo dự án (chỉ lập và in)</option>
          {(projects ?? []).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
        </select>
      </label>
      {!current ? <div className="loading">Đang tải dữ liệu dự án…</div> : (
        <OrgChartEditor key={current.project?.id ?? "free"} store={store} project={current.project} members={current.members} today={today} canEdit={current.canEdit}
          canSetTemplate={actor.role === "admin" || hasAccess(actor, "projects.manage")} employees={employees} setNotice={setNotice} />
      )}
    </section>
  );
}

/** Chỉ 3 ô cần nhập: dòng chữ xanh ở giữa (nhà máy / khách hàng, hạng mục) và ngày ký. Phần còn lại luôn theo mặc định. */
function HeaderForm(props: { header: OrgChartHeader; onChange: (patch: Partial<OrgChartHeader>) => void }) {
  const { header, onChange } = props;
  return (
    <div className="oc-grid oc-header-grid">
      <label className="field"><span>Nhà máy / Khách hàng</span><input placeholder="QBB ASIA CO.,LTD. FACTORY" value={header.client} onChange={(event) => onChange({ client: event.target.value.toUpperCase() })} /></label>
      <label className="field"><span>Hạng mục (ITEM)</span><input placeholder="HVAC CONTROL SYSTEM" value={header.item} onChange={(event) => onChange({ item: event.target.value.toUpperCase() })} /></label>
      <label className="field"><span>Ngày ký</span><input type="date" value={header.signDate} onChange={(event) => onChange({ signDate: event.target.value })} /></label>
    </div>
  );
}

function PersonModal(props: { person: OrgPerson; header: OrgChartHeader; employees: EmployeeSource; onChange: (patch: Partial<OrgPerson>) => void; onRemove: () => void; onMove: (step: -1 | 1) => void; onClose: () => void; setNotice: Notify }) {
  const { person, onChange } = props;
  const [loading, setLoading] = useState(false);
  const pickPhoto = async (blob: Blob) => {
    try { onChange({ photo: await toPortrait(blob) }); } catch (error) { props.setNotice(errorMessage(error), "error"); }
  };
  const isGroup = person.branch === "group";
  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") props.onClose(); }}>
      <section className="modal-card oc-modal" role="dialog" aria-modal="true" aria-labelledby="oc-person-title">
        <header><h2 id="oc-person-title">{person.titleEn || "Ô sơ đồ"}{person.name ? ` · ${person.name}` : ""}</h2><button type="button" className="close" aria-label="Đóng" onClick={props.onClose}>×</button></header>
        <EmployeePicker label="Chọn nhân viên (lấy tên, số điện thoại, ảnh từ hồ sơ)" source={props.employees} onPick={(option) => {
          if (!option) return;
          onChange({ employeeId: option.id, name: option.name.toUpperCase(), phone: option.phone ?? "", photo: null });
          if (option.hasPhoto && props.employees?.photo) {
            setLoading(true);
            void props.employees.photo(option.id).then((blob) => blob ? pickPhoto(blob) : undefined).catch(() => props.setNotice("Không tải được ảnh của nhân viên, hãy chọn ảnh thủ công.", "error")).finally(() => setLoading(false));
          }
        }} />
        <div className="oc-person">
          <div className="oc-photo-edit">
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh data URL trong sơ đồ */}
            {person.photo ? <img src={person.photo} alt="" /> : <span className="oc-photo-empty">Chưa có ảnh</span>}
            <label className="button"><ImagePlus className="ico" size={16} aria-hidden="true" /> {loading ? "Đang tải…" : "Chọn ảnh"}
              <input type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void pickPhoto(file); event.target.value = ""; }} />
            </label>
            {person.photo && <button type="button" className="link-button" onClick={() => onChange({ photo: null })}>Bỏ ảnh</button>}
          </div>
          <div className="oc-grid">
            <label className="field"><span>Họ tên</span><input value={person.name} autoFocus onChange={(event) => onChange({ name: event.target.value.toUpperCase() })} /></label>
            <label className="field"><span>Số điện thoại</span><input inputMode="tel" value={person.phone} onChange={(event) => onChange({ phone: event.target.value })} /></label>
            <label className="field"><span>Chức vụ (tiếng Anh)</span><input value={person.titleEn} placeholder="Site Manager" onChange={(event) => onChange({ titleEn: event.target.value })} /></label>
            <label className="field"><span>Chức vụ (tiếng Việt)</span><input value={person.titleVi} placeholder="Quản lý công trường" onChange={(event) => onChange({ titleVi: event.target.value })} /></label>
            <label className="field"><span>Email</span>
              <div className="oc-inline"><input type="email" value={person.email} onChange={(event) => onChange({ email: event.target.value.trim() })} />
                <button type="button" className="button" disabled={!person.name.trim()} onClick={() => onChange({ email: suggestEmail(person.name, props.header.emailDomain) })}>Gợi ý</button></div>
            </label>
            {isGroup && <label className="field"><span>Số lượng công nhân</span><input type="number" min={0} step={1} value={person.workerCount ?? 0} onChange={(event) => onChange({ workerCount: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} /></label>}
            <label className="field"><span>Vị trí trên sơ đồ</span>
              <select value={`${person.section}:${person.branch}`} onChange={(event) => { const [section, branch] = event.target.value.split(":") as [OrgSection, OrgPerson["branch"]]; onChange({ section, branch, workerCount: branch === "group" ? person.workerCount ?? 0 : null }); }}>
                {POSITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
        </div>
        <footer>
          <button type="button" className="button danger" onClick={() => { if (window.confirm("Bỏ ô này khỏi sơ đồ?")) props.onRemove(); }}><Trash2 className="ico" size={16} aria-hidden="true" /> Bỏ ô</button>
          <button type="button" className="button" onClick={() => props.onMove(-1)}>{person.branch === "group" ? "← Sang trái" : "↑ Lên trên"}</button>
          <button type="button" className="button" onClick={() => props.onMove(1)}>{person.branch === "group" ? "Sang phải →" : "↓ Xuống dưới"}</button>
          <button type="button" className="button primary" onClick={props.onClose}><X className="ico" size={16} aria-hidden="true" /> Xong</button>
        </footer>
      </section>
    </div>
  );
}

const pct = (value: number, of: number) => `${(value / of) * 100}%`;

/** Trang sơ đồ đúng tỷ lệ A4 ngang, dùng chung cho màn hình và bản in. */
export function OrgSheet(props: { chart: OrgChart; ghosts?: boolean; selected?: string | null; onSelect?: ((id: string) => void) | undefined; onAdd?: ((ghost: OrgPerson) => void) | undefined; onRemove?: ((id: string) => void) | undefined; children?: ReactNode }) {
  const { header, people } = props.chart;
  const withGhosts = useMemo(() => props.ghosts ? [...people, ...ghostSlots(people)] : people, [people, props.ghosts]);
  const layout = useMemo(() => layoutOrgChart(withGhosts), [withGhosts]);
  const [printedAt] = useState(() => new Date());
  const s = layout.scale;
  const cx = 505;
  const top = 132;
  const tx = (x: number) => cx + (x - cx) * s;
  const ty = (y: number) => top + (y - top) * s;
  const { width: W, height: H } = ORG_CANVAS;
  const box = (item: OrgBox) => {
    const { person } = item;
    const style = { left: pct(tx(item.x), W), top: pct(ty(item.y), H), width: pct(item.w * s, W), height: pct(item.h * s, H), "--s": s } as CSSProperties;
    if (isGhost(person)) {
      const label = SLOT_TITLES[`${person.section}:${person.branch}`]?.label ?? "Thêm";
      return <button key={person.id} type="button" className="oc-ghost" style={style} onClick={() => props.onAdd?.(person)}>+ {label}</button>;
    }
    // Mọi ô cùng màu xanh dương như mẫu
    const className = `oc-box blue${props.selected === person.id ? " on" : ""}${props.onSelect ? " editable" : ""}`;
    const open = () => props.onSelect?.(person.id);
    return (
      <div key={person.id} className={className} style={style} role={props.onSelect ? "button" : undefined} tabIndex={props.onSelect ? 0 : undefined}
        aria-label={props.onSelect ? `Sửa ${person.titleEn} ${person.name}` : undefined} onClick={open}
        onKeyDown={(event) => { if (props.onSelect && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); open(); } }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ảnh data URL / ảnh mẫu, in kèm trang */}
        {person.photo ? <img className="oc-face" src={person.photo} alt="" /> : <span className="oc-face empty" aria-hidden="true" />}
        <div className="oc-text">
          <span className="oc-en">{person.titleEn}</span>
          {person.titleVi && <i className="oc-vi">{person.titleVi}</i>}
          <b className="oc-name">{person.name || " "}</b>
          <span>Phone: {person.phone}</span>
          {person.workerCount === null || person.email ? <span className="oc-mail">Email: {person.email}</span> : null}
          {person.workerCount !== null && <span>Số lượng công nhân: <b>{person.workerCount}</b></span>}
        </div>
        {props.onRemove && <button type="button" className="oc-remove" aria-label={`Bỏ ô ${person.titleEn}`} onClick={(event) => { event.stopPropagation(); props.onRemove!(person.id); }}>×</button>}
      </div>
    );
  };
  const hoY = ty(layout.headOfficeY);
  return (
    <div className="oc-frame">
      <div className="oc-sheet">
        {/* eslint-disable @next/next/no-img-element -- logo in kèm trang */}
        {header.showLogos && <img className="oc-logo-left" src="/org-chart/taikisha.png" alt="Taikisha" />}
        {header.showLogos && <img className="oc-logo-right" src="/org-chart/bsi.png" alt="BSI ISO 9001, 14001, 45001" />}
        {/* eslint-enable @next/next/no-img-element */}
        <div className="oc-title">
          <span>SUBCONTRACTOR ORGANIZATION CHART</span>
          <b className="oc-contractor">{header.contractor}</b>
          {header.client && <i className="oc-client">{header.client}</i>}
          {header.item && <i className="oc-client">ITEM: {header.item}</i>}
        </div>
        <div className="oc-company">
          <b>{header.companyName}</b>
          <span className="oc-address">{header.companyAddress}</span>
          <span>Điện thoại: {header.companyPhone}</span>
          <span className="oc-sign">{signDateText(header.signDate)}<br />{header.signerTitle}</span>
          <b className="oc-signer">{header.signerName}</b>
        </div>
        <svg className="oc-lines" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {layout.lines.map((line, index) => <line key={index} className={line.ghost ? "ghost" : undefined} x1={tx(line.x1)} y1={ty(line.y1)} x2={tx(line.x2)} y2={ty(line.y2)} />)}
          <line className="oc-ho" x1={24} y1={hoY} x2={W - 24} y2={hoY} />
        </svg>
        <span className="oc-ho-label" style={{ top: pct(hoY - 15, H) }}>Head Office</span>
        {layout.boxes.map(box)}
        <footer className="oc-foot">
          <span>{header.formCode}</span>
          <span>{printedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} {printedAt.toLocaleDateString("en-US")}</span>
          <span>Page: 1/1</span>
        </footer>
      </div>
    </div>
  );
}
