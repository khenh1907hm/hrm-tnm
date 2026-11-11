"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Printer, RotateCcw, Save, Trash2, Users, Wand2, X } from "lucide-react";
import {
  blankPerson, defaultOrgChart, toCompanyTemplate, fillFromMembers, layoutOrgChart, orgChartIssue, ORG_CANVAS, ORG_MAX_GROUPS, renumberGroups, signDateText, suggestEmail,
  type OrgBox, type OrgChart, type OrgChartHeader, type OrgPerson, type OrgSection,
} from "../../../modules/projects/orgChart";
import type { TabProps } from "./ProjectDetail";
import { EmployeePicker } from "./ProjectsPage";
import { errorMessage } from "./projectShared";
import { hasAccess } from "../../../modules/auth/permissions";
import "./orgchart.css";

const newId = () => crypto.randomUUID();

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
  context.drawImage(bitmap, (bitmap.width - sw) / 2, ratio > target ? 0 : 0, sw, sh, 0, 0, 180, 240);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

type Slot = { section: OrgSection | null; branch: OrgPerson["branch"]; label: string; hint: string; titleEn: string; titleVi: string };
const SLOTS: Slot[] = [
  { section: "office", branch: "main", label: "Văn phòng · trục giữa", hint: "Giám đốc, quản lý… xếp từ trên xuống", titleEn: "Manager", titleVi: "Quản lý" },
  { section: "office", branch: "right", label: "Văn phòng · nhánh phải", hint: "Hỗ trợ kỹ thuật, kế toán…", titleEn: "Technical Support", titleVi: "Kỹ thuật" },
  { section: "site", branch: "main", label: "Công trường · trục giữa", hint: "Quản lý công trường (dưới vạch Head Office)", titleEn: "Site Manager", titleVi: "Quản lý công trường" },
  { section: "site", branch: "left", label: "Công trường · nhánh trái", hint: "Nhân viên an toàn…", titleEn: "Safety Staff", titleVi: "Nhân viên an toàn" },
  { section: "site", branch: "right", label: "Công trường · nhánh phải", hint: "Giám sát, QA/QC…", titleEn: "Supervisor", titleVi: "Giám sát" },
  { section: "site", branch: "group", label: "Quản lý nhóm", hint: `Hàng dưới cùng, tối đa ${ORG_MAX_GROUPS} nhóm`, titleEn: "", titleVi: "" },
];
const slotOf = (person: OrgPerson) => SLOTS.find((slot) => (slot.branch === "group" ? person.branch === "group" : slot.section === person.section && slot.branch === person.branch)) ?? SLOTS[0]!;

export function OrgChartTab({ store, data, viewer, actor, employees, setNotice }: TabProps) {
  const { project, today, members } = data;
  const canEdit = viewer.isLead || viewer.canEditProject;
  const canSetTemplate = actor.role === "admin" || hasAccess(actor, "projects.manage");
  const [saved, setSaved] = useState<OrgChart | null | undefined>(undefined);
  const [chart, setChart] = useState<OrgChart | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Máy chủ chưa có bảng sơ đồ (migration chưa chạy): vẫn lập và in được, chỉ chưa lưu được
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    // Chưa có sơ đồ: dựng từ mẫu chung của công ty (lỗi đọc mẫu thì dùng mặc định)
    void Promise.all([store.getOrgChart(project.id), store.getOrgTemplate().catch(() => null)]).then(([found, template]) => {
      if (!active) return;
      setSaved(found);
      setChart(found ?? defaultOrgChart(newId, project, today, template));
    }, () => { if (active) { setUnavailable(true); setSaved(null); setChart(defaultOrgChart(newId, project, today)); } });
    return () => { active = false; };
  }, [store, project, today, setNotice]);

  const dirty = useMemo(() => chart !== null && JSON.stringify(chart) !== JSON.stringify(saved ?? null), [chart, saved]);
  if (!chart) return <div className="loading">Đang tải sơ đồ tổ chức…</div>;

  const setHeader = (patch: Partial<OrgChartHeader>) => setChart({ ...chart, header: { ...chart.header, ...patch } });
  const setPerson = (id: string, patch: Partial<OrgPerson>) => setChart({ ...chart, people: chart.people.map((person) => person.id === id ? { ...person, ...patch } : person) });
  const add = (slot: Slot) => {
    const groups = chart.people.filter((person) => person.branch === "group").length;
    if (slot.branch === "group" && groups >= ORG_MAX_GROUPS) { setNotice(`Tối đa ${ORG_MAX_GROUPS} quản lý nhóm trên một trang.`, "error"); return; }
    const created = blankPerson(newId(), slot.section ?? "site", slot.branch, slot.titleEn, slot.titleVi);
    // Chỉ ô đầu của văn phòng (Giám đốc) màu xanh dương như mẫu
    const person = created.color === "blue" && chart.people.some((item) => item.section === "office" && item.branch === "main") ? { ...created, color: "green" as const } : created;
    setChart({ ...chart, people: renumberGroups([...chart.people, person]) });
    setSelected(person.id);
  };
  const remove = (id: string) => { setChart({ ...chart, people: renumberGroups(chart.people.filter((person) => person.id !== id)) }); setSelected(null); };
  const move = (id: string, step: -1 | 1) => {
    const person = chart.people.find((item) => item.id === id);
    if (!person) return;
    const same = chart.people.filter((item) => slotOf(item) === slotOf(person));
    const index = same.indexOf(person);
    const other = same[index + step];
    if (!other) return;
    const people = [...chart.people];
    const a = people.indexOf(person); const b = people.indexOf(other);
    [people[a], people[b]] = [other, person];
    setChart({ ...chart, people: renumberGroups(people) });
  };
  const save = async () => {
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
  const print = () => {
    document.body.classList.add("oc-printing");
    const done = () => { document.body.classList.remove("oc-printing"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
  };
  const current = chart.people.find((person) => person.id === selected) ?? null;

  return (
    <div className="pj-page oc-page">
      <section className="panel pj-section">
        <div className="pj-section-head">
          <h2><Users className="ico" size={18} aria-hidden="true" /> Sơ đồ tổ chức nhà thầu phụ <small className="muted">(mẫu BH-02-F02)</small></h2>
          <div className="button-row">
            {canEdit && <button type="button" className="button" onClick={() => { setChart(fillFromMembers(chart, members, newId, today)); setNotice("Đã điền quản lý nhóm và số công nhân từ thành viên dự án.", "success"); }}><Wand2 className="ico" size={16} aria-hidden="true" /> Điền từ thành viên</button>}
            {canEdit && dirty && saved && <button type="button" className="button" onClick={() => setChart(structuredClone(saved))}><RotateCcw className="ico" size={16} aria-hidden="true" /> Bỏ thay đổi</button>}
            {canSetTemplate && <button type="button" className="button" disabled={busy} onClick={() => void saveTemplate()} title="Tiêu đề và khối Văn phòng dùng cho sơ đồ mới của mọi dự án"><Save className="ico" size={16} aria-hidden="true" /> Lưu làm mẫu chung</button>}
            <button type="button" className="button" onClick={print}><Printer className="ico" size={16} aria-hidden="true" /> In / Lưu PDF</button>
            {canEdit && <button type="button" className="button primary" disabled={busy || !dirty} onClick={() => void save()}><Save className="ico" size={16} aria-hidden="true" /> {busy ? "Đang lưu…" : dirty ? "Lưu sơ đồ" : "Đã lưu"}</button>}
          </div>
        </div>
        <p className="muted oc-tip">{canEdit ? "Bấm vào một ô trên sơ đồ để sửa. Chọn nhân viên thì tên, số điện thoại, ảnh và email tự điền." : "Bạn chỉ xem được sơ đồ; PM hoặc Chỉ huy trưởng mới sửa được."}{saved === null && canEdit && !unavailable ? " Sơ đồ chưa lưu lần nào." : ""}</p>
        {unavailable && <p className="oc-alert">Máy chủ chưa bật chức năng lưu sơ đồ. Bạn vẫn lập và in PDF được, nhưng chưa lưu lại được.</p>}
        <OrgSheet chart={chart} selected={selected} onSelect={canEdit ? setSelected : undefined} />
      </section>

      {canEdit && (
        <div className="oc-editor">
          <section className="panel pj-section">
            <h2>Các ô trên sơ đồ</h2>
            {SLOTS.map((slot) => {
              const list = chart.people.filter((person) => slotOf(person) === slot);
              return (
                <div key={slot.label} className="oc-slot">
                  <div className="oc-slot-head"><b>{slot.label}</b><small className="muted">{slot.hint}</small></div>
                  <div className="oc-chips">
                    {list.map((person) => (
                      <button key={person.id} type="button" className={`oc-chip${person.id === selected ? " on" : ""}`} onClick={() => setSelected(person.id)}>
                        <span>{person.titleEn || "(chưa có chức vụ)"}</span><b>{person.name || "—"}</b>
                      </button>
                    ))}
                    <button type="button" className="oc-chip add" onClick={() => add(slot)}><Plus className="ico" size={14} aria-hidden="true" /> Thêm</button>
                  </div>
                </div>
              );
            })}
          </section>

          {current ? <PersonForm key={current.id} person={current} header={chart.header} employees={employees}
            onChange={(patch) => setPerson(current.id, patch)} onRemove={() => remove(current.id)} onMove={(step) => move(current.id, step)} onClose={() => setSelected(null)} setNotice={setNotice} />
            : <HeaderForm header={chart.header} onChange={setHeader} />}
        </div>
      )}
    </div>
  );
}

function HeaderForm(props: { header: OrgChartHeader; onChange: (patch: Partial<OrgChartHeader>) => void }) {
  const { header, onChange } = props;
  const text = (key: keyof OrgChartHeader, label: string, extra: { placeholder?: string; area?: boolean; type?: string } = {}) => (
    <label className="field">
      <span>{label}</span>
      {extra.area
        ? <textarea rows={2} value={String(header[key])} onChange={(event) => onChange({ [key]: event.target.value })} />
        : <input type={extra.type ?? "text"} placeholder={extra.placeholder} value={String(header[key])} onChange={(event) => onChange({ [key]: event.target.value })} />}
    </label>
  );
  return (
    <section className="panel pj-section">
      <h2>Thông tin chung</h2>
      <p className="muted" style={{ marginTop: 0 }}>Bấm một ô trên sơ đồ (hoặc trong danh sách) để sửa người đó.</p>
      <div className="oc-grid">
        {text("contractor", "Nhà thầu phụ (dòng đỏ)")}
        {text("client", "Nhà máy / khách hàng", { placeholder: "QBB ASIA CO.,LTD. FACTORY" })}
        {text("item", "Hạng mục (ITEM)", { placeholder: "HVAC CONTROL SYSTEM" })}
        {text("signDate", "Ngày ký", { type: "date" })}
        {text("companyName", "Tên công ty (khung cam)")}
        {text("companyPhone", "Điện thoại công ty")}
        {text("companyAddress", "Địa chỉ", { area: true })}
        {text("signerTitle", "Chức danh người ký")}
        {text("signerName", "Người ký")}
        {text("formCode", "Mã biểu mẫu (chân trang)")}
        {text("emailDomain", "Tên miền email gợi ý")}
        <label className="field oc-check"><input type="checkbox" checked={header.showLogos} onChange={(event) => onChange({ showLogos: event.target.checked })} /> <span>In logo Taikisha và chứng nhận BSI</span></label>
      </div>
    </section>
  );
}

function PersonForm(props: { person: OrgPerson; header: OrgChartHeader; employees: TabProps["employees"]; onChange: (patch: Partial<OrgPerson>) => void; onRemove: () => void; onMove: (step: -1 | 1) => void; onClose: () => void; setNotice: TabProps["setNotice"] }) {
  const { person, onChange } = props;
  const [loading, setLoading] = useState(false);
  const pickPhoto = async (blob: Blob) => {
    try { onChange({ photo: await toPortrait(blob) }); } catch (error) { props.setNotice(errorMessage(error), "error"); }
  };
  const isGroup = person.branch === "group";
  const position = `${person.section}:${person.branch}`;
  return (
    <section className="panel pj-section">
      <div className="pj-section-head">
        <h2>{person.titleEn || "Ô sơ đồ"}{person.name ? ` · ${person.name}` : ""}</h2>
        <div className="button-row">
          <button type="button" className="button icon" title="Lên trước" onClick={() => props.onMove(-1)}><ArrowUp size={16} aria-label="Lên trước" /></button>
          <button type="button" className="button icon" title="Xuống sau" onClick={() => props.onMove(1)}><ArrowDown size={16} aria-label="Xuống sau" /></button>
          <button type="button" className="button danger" onClick={() => { if (window.confirm("Xóa ô này khỏi sơ đồ?")) props.onRemove(); }}><Trash2 className="ico" size={16} aria-hidden="true" /> Xóa</button>
          <button type="button" className="button" onClick={props.onClose}><X className="ico" size={16} aria-hidden="true" /> Xong</button>
        </div>
      </div>
      <EmployeePicker label="Chọn nhân viên để tự điền" source={props.employees} onPick={(option) => {
        if (!option) return;
        onChange({ employeeId: option.id, name: option.name.toUpperCase(), phone: option.phone ?? person.phone, email: suggestEmail(option.name, props.header.emailDomain) || person.email });
        if (option.hasPhoto && props.employees?.photo) {
          setLoading(true);
          void props.employees.photo(option.id).then((blob) => blob ? pickPhoto(blob) : undefined).catch(() => props.setNotice("Không tải được ảnh của nhân viên, hãy chọn ảnh thủ công.", "error")).finally(() => setLoading(false));
        }
      }} />
      <div className="oc-person">
        <div className="oc-photo-edit">
          <img src={person.photo ?? "/org-chart/avatar.png"} alt="" />
          <label className="button"><ImagePlus className="ico" size={16} aria-hidden="true" /> {loading ? "Đang tải…" : "Chọn ảnh"}
            <input type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void pickPhoto(file); event.target.value = ""; }} />
          </label>
          {person.photo && <button type="button" className="link-button" onClick={() => onChange({ photo: null })}>Bỏ ảnh</button>}
        </div>
        <div className="oc-grid">
          <label className="field"><span>Vị trí trên sơ đồ</span>
            <select value={position} onChange={(event) => { const [section, branch] = event.target.value.split(":") as [OrgSection, OrgPerson["branch"]]; onChange({ section, branch, workerCount: branch === "group" ? person.workerCount ?? 0 : null }); }}>
              {SLOTS.map((slot) => <option key={slot.label} value={`${slot.section ?? "site"}:${slot.branch}`}>{slot.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Màu ô</span>
            <select value={person.color} onChange={(event) => onChange({ color: event.target.value as OrgPerson["color"] })}><option value="blue">Xanh dương (giám đốc)</option><option value="green">Xanh lá viền xanh</option></select>
          </label>
          <label className="field"><span>Chức vụ (tiếng Anh)</span><input value={person.titleEn} placeholder="Site Manager" onChange={(event) => onChange({ titleEn: event.target.value })} /></label>
          <label className="field"><span>Chức vụ (tiếng Việt)</span><input value={person.titleVi} placeholder="Quản lý công trường" onChange={(event) => onChange({ titleVi: event.target.value })} /></label>
          <label className="field"><span>Họ tên</span><input value={person.name} onChange={(event) => onChange({ name: event.target.value.toUpperCase() })} /></label>
          <label className="field"><span>Số điện thoại</span><input inputMode="tel" value={person.phone} onChange={(event) => onChange({ phone: event.target.value })} /></label>
          <label className="field"><span>Email</span>
            <div className="oc-inline"><input type="email" value={person.email} onChange={(event) => onChange({ email: event.target.value.trim() })} />
              <button type="button" className="button" disabled={!person.name.trim()} onClick={() => onChange({ email: suggestEmail(person.name, props.header.emailDomain) })}>Gợi ý</button></div>
          </label>
          {isGroup && <label className="field"><span>Số lượng công nhân</span><input type="number" min={0} step={1} value={person.workerCount ?? 0} onChange={(event) => onChange({ workerCount: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} /></label>}
        </div>
      </div>
    </section>
  );
}

const pct = (value: number, of: number) => `${(value / of) * 100}%`;

/** Trang sơ đồ đúng tỷ lệ A4 ngang, dùng chung cho màn hình và bản in. */
export function OrgSheet(props: { chart: OrgChart; selected?: string | null; onSelect?: ((id: string) => void) | undefined }) {
  const { header, people } = props.chart;
  const layout = useMemo(() => layoutOrgChart(people), [people]);
  const [printedAt] = useState(() => new Date());
  const s = layout.scale;
  const cx = 505;
  const top = 132;
  const tx = (x: number) => cx + (x - cx) * s;
  const ty = (y: number) => top + (y - top) * s;
  const { width: W, height: H } = ORG_CANVAS;
  const box = (item: OrgBox) => {
    const { person } = item;
    const style = { left: pct(tx(item.x), W), top: pct(ty(item.y), H), width: pct(item.w * s, W), height: pct(item.h * s, H), "--s": s } as React.CSSProperties;
    const content = (
      <>
        <img className="oc-face" src={person.photo ?? "/org-chart/avatar.png"} alt="" />
        <div className="oc-text">
          <span className="oc-en">{person.titleEn}</span>
          {person.titleVi && <i className="oc-vi">{person.titleVi}</i>}
          <b className="oc-name">{person.name || " "}</b>
          <span>Phone: {person.phone}</span>
          {person.workerCount === null || person.email ? <span className="oc-mail">Email: {person.email}</span> : null}
          {person.workerCount !== null && <span>Số lượng công nhân: <b>{person.workerCount}</b></span>}
        </div>
      </>
    );
    const className = `oc-box ${person.color}${props.selected === person.id ? " on" : ""}`;
    return props.onSelect
      ? <button key={person.id} type="button" className={className} style={style} onClick={() => props.onSelect!(person.id)} aria-label={`Sửa ${person.titleEn} ${person.name}`}>{content}</button>
      : <div key={person.id} className={className} style={style}>{content}</div>;
  };
  const hoY = ty(layout.headOfficeY);
  return (
    <div className="oc-frame">
      <div className="oc-sheet">
        {header.showLogos && <img className="oc-logo-left" src="/org-chart/taikisha.png" alt="Taikisha" />}
        {header.showLogos && <img className="oc-logo-right" src="/org-chart/bsi.png" alt="BSI ISO 9001, 14001, 45001" />}
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
          {layout.lines.map((line, index) => <line key={index} x1={tx(line.x1)} y1={ty(line.y1)} x2={tx(line.x2)} y2={ty(line.y2)} />)}
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
