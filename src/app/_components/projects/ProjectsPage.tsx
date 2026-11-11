"use client";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { FolderKanban, Plus, Search } from "lucide-react";
import { systemClock, todayVN } from "../../../lib/clock";
import { normalizeText } from "../../../lib/text";
import type { Actor } from "../../../modules/auth/permissions";
import { budgetSummary, formatPct } from "../../../modules/projects/budget";
import { formatVnd } from "../../../modules/projects/cost";
import type { ProjectStore } from "../../../modules/projects/store";
import { DEFAULT_SITE_SETTINGS, PROJECT_STATUS_LABELS, type Project, type ProjectBudget, type ProjectInput, type ProjectStatus } from "../../../modules/projects/types";
import type { Notify } from "../Toast";
import { ProjectDetail } from "./ProjectDetail";
import { canCreateProject, errorMessage, type EmployeeOption, type EmployeeSource } from "./projectShared";
import "./projects.css";
import { SiteFields } from "./SiteFields";

type Props = {
  store: ProjectStore;
  ready: boolean;
  actor: Actor;
  employees: EmployeeSource;
  projectId: string | null;
  onOpen: (projectId: string | null) => void;
  setNotice: Notify;
};

const STATUS_TONE: Record<ProjectStatus, string> = { planning: "", active: "ok", paused: "warn", done: "", archived: "" };

/** Trang Dự án: danh sách (thẻ) hoặc chi tiết một dự án theo URL /du-an/<id>. */
export function ProjectsPage(props: Props) {
  const { store, ready, actor, setNotice } = props;
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [usage, setUsage] = useState<Record<string, { used: number; budget: number }>>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "open">("open");
  const [form, setForm] = useState<Project | "new" | null>(null);

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchProjectList>>) => { setProjects(result.list); setUsage(result.usage); }, []);
  const fail = useCallback((error: unknown) => { setNotice(errorMessage(error), "error"); setProjects([]); }, [setNotice]);
  const load = useCallback(async () => { try { apply(await fetchProjectList(store)); } catch (error) { fail(error); } }, [store, apply, fail]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    void fetchProjectList(store).then((result) => { if (active) apply(result); }, (error: unknown) => { if (active) fail(error); });
    return () => { active = false; };
  }, [ready, store, apply, fail]);

  const shown = useMemo(() => {
    const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
    return (projects ?? []).filter((project) => (status === "open" ? project.status !== "archived" && project.status !== "done" : project.status === status)
      && tokens.every((token) => normalizeText(`${project.code} ${project.name} ${project.customerName} ${project.site}`).includes(token)));
  }, [projects, query, status]);

  const current = props.projectId ? projects?.find((project) => project.id === props.projectId) ?? null : null;
  if (props.projectId) {
    if (!projects) return <div className="loading">Đang tải dự án…</div>;
    if (!current) return <section className="pj-page"><div className="panel empty-state"><p>Không tìm thấy dự án, hoặc bạn không có quyền xem dự án này.</p><button type="button" className="button" onClick={() => props.onOpen(null)}>Về danh sách dự án</button></div></section>;
    return <ProjectDetail key={current.id} {...props} project={current} onBack={() => props.onOpen(null)} onEdit={() => setForm(current)} onChanged={() => void load()}>
      {form && <ProjectFormModal store={store} employees={props.employees} initial={form === "new" ? null : form} onClose={() => setForm(null)} onSaved={(saved) => { setForm(null); setNotice("Đã lưu dự án.", "success"); void load(); if (form === "new") props.onOpen(saved.id); }} />}
    </ProjectDetail>;
  }

  return (
    <section className="pj-page">
      <div className="page-head">
        <div><h1>Dự án</h1><p>Ngày bắt đầu, kết thúc, sơ đồ nhân sự, chấm công và ngân sách của từng dự án.</p></div>
        {canCreateProject(actor) && <button type="button" className="button primary" onClick={() => setForm("new")}><Plus className="ico" size={16} aria-hidden="true" /> Tạo dự án</button>}
      </div>
      <div className="pj-toolbar">
        <label className="sr-only" htmlFor="pj-search">Tìm dự án</label>
        <input id="pj-search" type="search" placeholder="Tìm theo mã, tên, khách hàng, địa điểm" value={query} onChange={(event) => setQuery(event.target.value)} />
        <label className="sr-only" htmlFor="pj-status">Trạng thái</label>
        <select id="pj-status" value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus | "open")}>
          <option value="open">Đang mở (kế hoạch, thi công, tạm dừng)</option>
          {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((key) => <option key={key} value={key}>{PROJECT_STATUS_LABELS[key]}</option>)}
        </select>
      </div>
      {!projects ? <div className="loading">Đang tải dự án…</div> : !shown.length ? (
        <div className="panel empty-state">
          <Search size={28} aria-hidden="true" />
          <p>{projects.length ? "Không có dự án khớp bộ lọc." : canCreateProject(actor) ? "Chưa có dự án nào. Bấm “Tạo dự án” để bắt đầu." : "Bạn chưa được giao dự án nào."}</p>
        </div>
      ) : (
        <div className="pj-cards">
          {shown.map((project) => {
            const money = usage[project.id];
            const pct = money ? money.used / money.budget : 0;
            const level = pct >= 1 ? "over" : pct >= 0.8 ? "warn" : "";
            return (
              <button type="button" key={project.id} className="pj-card" onClick={() => props.onOpen(project.id)}>
                <span className="pj-code">{project.code}</span>
                <h3>{project.name}</h3>
                <div className="pj-meta">
                  <span className={`pill ${STATUS_TONE[project.status]}`}>{PROJECT_STATUS_LABELS[project.status]}</span>
                  {project.customerName && <span>{project.customerName}</span>}
                  <span>{formatDateVn(project.plannedStart)} – {formatDateVn(project.plannedEnd)}</span>
                </div>
                {money && <>
                  <div className={`pj-bar ${level}`} role="img" aria-label={`Đã dùng ${formatPct(pct)} ngân sách`}><span style={{ width: `${Math.min(100, pct * 100)}%` }} /></div>
                  <small className="muted">Đã dùng {formatVnd(money.used)} / {formatVnd(money.budget)} ({formatPct(pct)})</small>
                </>}
              </button>
            );
          })}
        </div>
      )}
      {form && <ProjectFormModal store={store} employees={props.employees} initial={form === "new" ? null : form} onClose={() => setForm(null)} onSaved={(saved) => { setForm(null); setNotice("Đã tạo dự án.", "success"); void load(); props.onOpen(saved.id); }} />}
    </section>
  );
}

/** Danh sách dự án kèm % ngân sách cho thẻ (chỉ dự án người xem được xem tiền: RLS trả rỗng với người khác). */
async function fetchProjectList(store: ProjectStore) {
  const list = await store.listProjects();
  const today = todayVN(systemClock);
  const entries = await Promise.all(list.filter((project) => project.status !== "archived").map(async (project) => {
    const [budgets, costs, expenses, subcontracts, payments] = await Promise.all([store.getBudgets(project.id), store.listCosts(project.id, "0001-01-01", "9999-12-31"), store.listExpenses(project.id), store.listSubcontracts(project.id), store.listPayments(project.id)]);
    // Cùng công thức với trang chi tiết (PRJ-09) để số trên thẻ khớp số ở Tổng quan
    const { total } = budgetSummary({ budgets: budgets ?? [], costs: costs ?? [], expenses: expenses ?? [], subcontracts, payments: payments ?? [], today, remainingWorkdays: 0 });
    return [project.id, { used: total.used, budget: total.budget }] as const;
  }));
  return { list, usage: Object.fromEntries(entries.filter(([, value]) => value.budget > 0)) as Record<string, { used: number; budget: number }> };
}

export const formatDateVn = (date: string | null) => date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : "—";

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** Tạo, sửa dự án (spec 3.1) kèm ngân sách 4 khoản khi tạo mới. */
export function ProjectFormModal(props: { store: ProjectStore; employees: EmployeeSource; initial: Project | null; onClose: () => void; onSaved: (project: Project) => void }) {
  const today = todayVN(systemClock);
  const [draft, setDraft] = useState<ProjectInput>(() => props.initial ?? {
    code: "", name: "", customerId: null, customerName: "", site: "", pmEmployeeId: null, plannedStart: today, plannedEnd: today, actualStart: null, actualEnd: null,
    stdHours: 8, weeklyOff: [0], status: "planning", note: "", ...DEFAULT_SITE_SETTINGS,
  });
  const [pmName, setPmName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (!draft.code.trim() || !draft.name.trim()) { setError("Nhập mã và tên dự án."); return; }
    if (draft.plannedEnd < draft.plannedStart) { setError("Ngày kết thúc dự kiến phải sau hoặc bằng ngày bắt đầu."); return; }
    if (draft.actualStart && draft.actualEnd && draft.actualEnd < draft.actualStart) { setError("Ngày kết thúc thực tế phải sau ngày bắt đầu thực tế."); return; }
    if (!(draft.workEnd > draft.workStart) || draft.lunchEnd < draft.lunchStart) { setError("Giờ kết thúc phải sau giờ bắt đầu; giờ hết nghỉ trưa không trước giờ bắt đầu nghỉ."); return; }
    if ((draft.siteLat === null) !== (draft.siteLng === null)) { setError("Nhập đủ cả vĩ độ và kinh độ của công trường, hoặc để trống cả hai."); return; }
    setBusy(true); setError("");
    try {
      const saved = await props.store.saveProject({ ...draft, ...(props.initial ? { id: props.initial.id } : {}) });
      if (!props.initial) {
        const empty: ProjectBudget[] = (["labor", "subcontract", "material", "other"] as const).map((category) => ({ category, amount: 0, warnPct: 80, plannedHours: null }));
        await props.store.saveBudgets(saved.id, empty, "Tạo dự án");
        if (saved.pmEmployeeId && pmName) {
          await props.store.saveMember({ projectId: saved.id, employeeId: saved.pmEmployeeId, displayName: pmName.split(" · ")[1] ?? pmName, employeeCode: pmName.split(" · ")[0] ?? "", role: "pm", parentId: null, team: "", subcontractId: null, joinedOn: saved.plannedStart, leftOn: null });
        }
      }
      props.onSaved(saved);
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") props.onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="pj-form-title">
        <header><h2 id="pj-form-title"><FolderKanban className="ico" size={18} aria-hidden="true" /> {props.initial ? "Sửa dự án" : "Tạo dự án"}</h2><button type="button" className="close" aria-label="Đóng" onClick={props.onClose}>×</button></header>
        <div className="form-grid">
          <label className="field"><span>Mã dự án *</span><input value={draft.code} maxLength={40} placeholder="DA-2026-001" onChange={(event) => set("code", event.target.value)} autoFocus /></label>
          <label className="field"><span>Trạng thái</span><select value={draft.status} onChange={(event) => set("status", event.target.value as ProjectStatus)}>{(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((key) => <option key={key} value={key}>{PROJECT_STATUS_LABELS[key]}</option>)}</select></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>Tên dự án *</span><input value={draft.name} maxLength={300} onChange={(event) => set("name", event.target.value)} /></label>
          <label className="field"><span>Khách hàng</span><input value={draft.customerName} maxLength={200} onChange={(event) => set("customerName", event.target.value)} /></label>
          <label className="field"><span>Địa điểm công trường</span><input value={draft.site} maxLength={300} onChange={(event) => set("site", event.target.value)} /></label>
          {!props.initial && <EmployeePicker label="PM (quản lý dự án)" source={props.employees} onPick={(option) => { set("pmEmployeeId", option?.id ?? null); setPmName(option ? `${option.code} · ${option.name}` : ""); }} />}
          <label className="field"><span>Giờ chuẩn mỗi ngày</span><input type="number" min={1} max={12} step={0.5} value={draft.stdHours} onChange={(event) => set("stdHours", Number(event.target.value) || 8)} /></label>
          <label className="field"><span>Bắt đầu dự kiến *</span><input type="date" value={draft.plannedStart} onChange={(event) => set("plannedStart", event.target.value)} /></label>
          <label className="field"><span>Kết thúc dự kiến *</span><input type="date" value={draft.plannedEnd} onChange={(event) => set("plannedEnd", event.target.value)} /></label>
          <label className="field"><span>Bắt đầu thực tế</span><input type="date" value={draft.actualStart ?? ""} onChange={(event) => set("actualStart", event.target.value || null)} /></label>
          <label className="field"><span>Kết thúc thực tế</span><input type="date" value={draft.actualEnd ?? ""} onChange={(event) => set("actualEnd", event.target.value || null)} /></label>
          <fieldset className="field" style={{ gridColumn: "1 / -1", border: 0, padding: 0 }}>
            <span>Ngày nghỉ trong tuần</span>
            <div className="button-row">
              {WEEKDAYS.map((label, day) => (
                <label key={label} className="toolbar-check"><input type="checkbox" checked={draft.weeklyOff.includes(day)} onChange={(event) => set("weeklyOff", event.target.checked ? [...draft.weeklyOff, day].sort() : draft.weeklyOff.filter((item) => item !== day))} /> {label}</label>
              ))}
            </div>
          </fieldset>
          <SiteFields draft={draft} set={set} />
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>Ghi chú</span><input value={draft.note} onChange={(event) => set("note", event.target.value)} /></label>
          {error && <p className="form-error" role="alert" style={{ gridColumn: "1 / -1" }}>{error}</p>}
        </div>
        <footer><button type="button" className="button" onClick={props.onClose}>Hủy</button><button type="button" className="button primary" disabled={busy} onClick={() => void submit()}>{busy ? "Đang lưu…" : "Lưu dự án"}</button></footer>
      </section>
    </div>
  );
}

/** Ô chọn một nhân sự: bấm vào là xổ danh sách từ dữ liệu nhân sự, gõ mã hoặc tên để lọc. */
export function EmployeePicker(props: { label: string; source: EmployeeSource; onPick: (option: EmployeeOption | null) => void; exclude?: ReadonlySet<string> }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<EmployeeOption[] | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<EmployeeOption | null>(null);
  const listId = useId();
  useEffect(() => {
    if (!props.source || picked || !open) return;
    let active = true;
    const timer = window.setTimeout(() => void props.source!.search(query).then((list) => { if (active) setOptions(list.filter((item) => !props.exclude?.has(item.id)).slice(0, 50)); }, () => { if (active) setOptions([]); }), query ? 200 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, props.source, picked, props.exclude, open]);
  if (!props.source) return <p className="field"><span>{props.label}</span><small className="field-hint">Cần quyền xem nhân sự để chọn người.</small></p>;
  const choose = (option: EmployeeOption) => { setPicked(option); setOpen(false); props.onPick(option); };
  return (
    <div className="field emp-picker">
      <span>{props.label}</span>
      {picked ? (
        <div className="button-row"><span className="pill">{picked.code} · {picked.name}</span><button type="button" className="link-button" onClick={() => { setPicked(null); setQuery(""); setOpen(true); props.onPick(null); }}>Đổi</button></div>
      ) : (
        <div className="emp-picker-box" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
          <input type="search" role="combobox" aria-expanded={open} aria-controls={listId} placeholder="Bấm để chọn, hoặc gõ mã / tên" value={query}
            onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
            onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); if (event.key === "Enter" && options?.[0]) { event.preventDefault(); choose(options[0]); } }} />
          {open && <ul id={listId} className="filter-dd-menu emp-picker-menu" role="listbox">
            {options === null ? <li className="muted emp-picker-note">Đang tải danh sách…</li>
              : !options.length ? <li className="muted emp-picker-note">{query ? "Không tìm thấy nhân sự." : "Chưa có nhân sự."}</li>
              : options.map((option) => <li key={option.id}><button type="button" role="option" aria-selected={false} className="filter-dd-item" style={{ width: "100%", textAlign: "left" }} onClick={() => choose(option)}>{option.code} · {option.name} <small className="muted">{option.position}</small></button></li>)}
          </ul>}
        </div>
      )}
    </div>
  );
}
