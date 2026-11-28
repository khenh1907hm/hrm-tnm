"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Camera, Check, FileSpreadsheet, Plus, Save, Send, Trash2, Undo2 } from "lucide-react";
import { systemClock, todayVN } from "../../../lib/clock";
import { fixIssue, INSPECTION_STATUS_LABELS, inspectionTitle, submitIssue, type Inspection, type InspectionItem, type InspectionProject, type PhotoMark } from "../../../modules/inspections/types";
import type { Notify } from "../Toast";
import { downloadBytes } from "../purchases/FormExport";
import { SkeletonTable } from "../Skeleton";
import * as api from "./inspectionApi";
import { MarkedPhoto, PhotoMarker, burnMarks } from "./PhotoMarker";

const TONE: Record<Inspection["status"], string> = { draft: "", open: "warn", fixed: "info", closed: "ok" };
const dmy = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const nowTime = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(11, 16);

export type InspectionViewer = { userId: string; employeeId: string | null; isAdmin: boolean; name: string };

/** Mở chọn ảnh (máy tính: chọn tệp; điện thoại: chụp ảnh). */
function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*"; input.setAttribute("capture", "environment");
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Khung vẽ khoanh trên ảnh đã chụp, bấm Xong để giữ nét. */
function MarkDialog(props: { url: string; marks: PhotoMark[]; onDone: (marks: PhotoMark[]) => void; onClose: () => void }) {
  const [marks, setMarks] = useState(props.marks);
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card pm-dialog" role="dialog" aria-modal="true" aria-label="Khoanh điểm lỗi">
        <header><h2>Khoanh điểm cần nhấn mạnh</h2><button type="button" className="close" aria-label="Đóng" onClick={props.onClose}>×</button></header>
        <PhotoMarker url={props.url} marks={marks} onChange={setMarks} />
        <div className="button-row"><button type="button" className="button" onClick={props.onClose}>Hủy</button><button type="button" className="button primary" onClick={() => props.onDone(marks)}><Check size={15} aria-hidden="true" /> Xong</button></div>
      </section>
    </div>
  );
}

/** Ảnh một phía (Trước / Sau): chụp / chọn ảnh, khoanh, xem. */
function PhotoSide(props: { label: string; url: string | null; marks: PhotoMark[]; editable: boolean; busy: boolean; onPick: (file: File) => void; onMarks: (marks: PhotoMark[]) => void }) {
  const [marking, setMarking] = useState(false);
  return (
    <div className="si-photo">
      <MarkedPhoto url={props.url} marks={props.marks} alt={props.label} onClick={props.editable && props.url ? () => setMarking(true) : undefined} />
      {props.editable && <div className="button-row">
        <button type="button" className="button" disabled={props.busy} onClick={() => void pickImage().then((file) => file && props.onPick(file))}><Camera size={15} aria-hidden="true" /> {props.url ? "Đổi ảnh" : "Chụp / chọn ảnh"}</button>
        {props.url && <button type="button" className="button" onClick={() => setMarking(true)}>Khoanh tròn / ô vuông</button>}
      </div>}
      {marking && props.url && <MarkDialog url={props.url} marks={props.marks} onClose={() => setMarking(false)} onDone={(marks) => { props.onMarks(marks); setMarking(false); }} />}
    </div>
  );
}

type Draft = InspectionItem & { localBefore?: string; localAfter?: string };

/** Một lỗi: bên trái Before (người kiểm tra), bên phải After (người khắc phục). */
function ItemCard(props: { inspection: Inspection; item: Draft | null; index: number; urls: Record<string, string>; canEdit: boolean; canFix: boolean; viewer: InspectionViewer; onSaved: () => void; onRemoved: () => void; setNotice: Notify }) {
  const { inspection, viewer, setNotice } = props;
  const [draft, setDraft] = useState<Draft>(() => props.item ?? { id: "", seq: props.index + 1, location: "", foundTime: nowTime(), problem: "", countermeasure: "", targetDate: null, beforePhoto: null, beforeMarks: [], afterPhoto: null, afterMarks: [], comment: "", finishDate: null, fixedByName: "", fixedAt: null });
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(!props.item);
  const set = (patch: Partial<Draft>) => { setDraft((current) => ({ ...current, ...patch })); setDirty(true); };
  const upload = async (side: "before" | "after", file: File) => {
    setBusy(true);
    try {
      const path = await api.uploadPhoto(inspection.id, file);
      const local = URL.createObjectURL(file);
      set(side === "before" ? { beforePhoto: path, beforeMarks: [], localBefore: local } : { afterPhoto: path, afterMarks: [], localAfter: local, finishDate: draft.finishDate ?? todayVN(systemClock) });
    } catch (error) { setNotice(error instanceof Error ? error.message : "Không tải được ảnh.", "error"); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try {
      if (props.canEdit) {
        if (!draft.beforePhoto || draft.problem.trim().length < 2) throw new Error("Cần ảnh lỗi và nội dung Vấn đề.");
        await api.saveBefore(inspection.id, draft.id || null, draft.seq, draft);
      }
      if (props.canFix && draft.id && (draft.afterPhoto || draft.comment.trim())) await api.saveAfter(draft.id, draft, viewer.name);
      setDirty(false);
      setNotice("Đã lưu lỗi.", "success");
      props.onSaved();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Không lưu được.", "error"); } finally { setBusy(false); }
  };
  const beforeUrl = draft.localBefore ?? (draft.beforePhoto ? props.urls[draft.beforePhoto] ?? null : null);
  const afterUrl = draft.localAfter ?? (draft.afterPhoto ? props.urls[draft.afterPhoto] ?? null : null);
  return (
    <article className="panel si-item">
      <header className="si-item-head"><b>Defect number: {props.index + 1}</b>
        {props.canEdit && draft.id && <button type="button" className="icon-link" aria-label="Xóa lỗi" onClick={() => { if (window.confirm("Xóa lỗi này?")) void api.deleteItem(draft.id).then(props.onRemoved, (error: unknown) => setNotice(error instanceof Error ? error.message : "Không xóa được.", "error")); }}><Trash2 size={15} aria-hidden="true" /></button>}
      </header>
      <div className="si-grid">
        <section className="si-side is-before">
          <h4>Before</h4>
          <PhotoSide label={`Ảnh lỗi ${props.index + 1}`} url={beforeUrl} marks={draft.beforeMarks} editable={props.canEdit} busy={busy} onPick={(file) => void upload("before", file)} onMarks={(marks) => set({ beforeMarks: marks })} />
          <div className="si-fields">
            <label className="field"><span>Vị trí (Location)</span><input value={draft.location} disabled={!props.canEdit} placeholder="vd Factory 2FL" onChange={(event) => set({ location: event.target.value })} /></label>
            <label className="field"><span>Giờ</span><input type="time" value={draft.foundTime} disabled={!props.canEdit} onChange={(event) => set({ foundTime: event.target.value })} /></label>
            <label className="field wide"><span>Vấn đề (Problem) *</span><textarea rows={2} value={draft.problem} disabled={!props.canEdit} onChange={(event) => set({ problem: event.target.value })} /></label>
            <label className="field wide"><span>Cách giải quyết (Countermeasure)</span><textarea rows={2} value={draft.countermeasure} disabled={!props.canEdit} onChange={(event) => set({ countermeasure: event.target.value })} /></label>
            <label className="field"><span>Thời gian hoàn thiện mong muốn</span><input type="date" value={draft.targetDate ?? ""} disabled={!props.canEdit} onChange={(event) => set({ targetDate: event.target.value || null })} /></label>
          </div>
        </section>
        <section className="si-side is-after">
          <h4>After</h4>
          {inspection.status === "draft" ? <p className="muted">Trưởng dự án chụp ảnh sau khi sửa (sau khi gửi báo cáo).</p> : <>
            <PhotoSide label={`Ảnh sau khi sửa ${props.index + 1}`} url={afterUrl} marks={draft.afterMarks} editable={props.canFix && Boolean(draft.id)} busy={busy} onPick={(file) => void upload("after", file)} onMarks={(marks) => set({ afterMarks: marks })} />
            <div className="si-fields">
              <p className="field wide"><span>Người phụ trách</span><b>{draft.fixedByName || inspection.attentionName || "—"}</b></p>
              <label className="field wide"><span>Comment</span><textarea rows={2} value={draft.comment} disabled={!props.canFix} placeholder="vd Đã xiết ốc, marking" onChange={(event) => set({ comment: event.target.value })} /></label>
              <label className="field"><span>Ngày hoàn thành (Finish time)</span><input type="date" value={draft.finishDate ?? ""} disabled={!props.canFix} onChange={(event) => set({ finishDate: event.target.value || null })} /></label>
            </div>
          </>}
        </section>
      </div>
      {(props.canEdit || props.canFix) && dirty && <div className="button-row"><button type="button" className="button primary" disabled={busy} onClick={() => void save()}><Save size={15} aria-hidden="true" /> Lưu lỗi {props.index + 1}</button></div>}
    </article>
  );
}

/** Chi tiết một báo cáo: đầu phiếu, các lỗi, gửi / báo đã sửa / đóng, xuất Excel theo mẫu QHSE PHOTO REPORT. */
function InspectionDetail(props: { id: string; projects: readonly InspectionProject[]; viewer: InspectionViewer; onBack: () => void; onChanged: () => void; setNotice: Notify }) {
  const { viewer, setNotice } = props;
  const [inspection, setInspection] = useState<Inspection | null | undefined>(undefined);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(0);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const next = await api.getInspection(props.id);
      setInspection(next);
      if (next) setUrls(await api.photoUrls(next.items.flatMap((item) => [item.beforePhoto ?? "", item.afterPhoto ?? ""])));
    } catch (error) { setNotice(error instanceof Error ? error.message : "Không tải được báo cáo.", "error"); setInspection(null); }
  }, [props.id, setNotice]);
  useEffect(() => {
    let active = true;
    void api.getInspection(props.id).then(async (next) => {
      if (!active) return;
      setInspection(next);
      if (next) { const map = await api.photoUrls(next.items.flatMap((item) => [item.beforePhoto ?? "", item.afterPhoto ?? ""])); if (active) setUrls(map); }
    }, (error: unknown) => { if (active) { setNotice(error instanceof Error ? error.message : "Không tải được báo cáo.", "error"); setInspection(null); } });
    return () => { active = false; };
  }, [props.id, setNotice]);
  if (inspection === undefined) return <SkeletonTable rows={4} />;
  if (inspection === null) return <div className="panel empty-state"><p>Không tìm thấy báo cáo, hoặc bạn không có quyền xem.</p><button type="button" className="button" onClick={props.onBack}>Về danh sách</button></div>;
  const project = props.projects.find((item) => item.projectId === inspection.projectId) ?? null;
  const isReporter = inspection.reporterId === viewer.userId;
  const canEdit = (isReporter || viewer.isAdmin) && inspection.status !== "closed";
  const isAssignee = Boolean(viewer.employeeId) && viewer.employeeId === inspection.attentionEmployeeId;
  const canFix = (isAssignee || viewer.isAdmin || (project?.pmEmployeeId ?? null) === viewer.employeeId) && (inspection.status === "open" || inspection.status === "fixed");
  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await action(); setNotice(done, "success"); await load(); props.onChanged(); } catch (error) { setNotice(error instanceof Error ? error.message : "Không thực hiện được.", "error"); } finally { setBusy(false); }
  };
  const exportExcel = () => run(async () => {
    const photos: Record<string, { before?: { bytes: Uint8Array; width: number; height: number }; after?: { bytes: Uint8Array; width: number; height: number } }> = {};
    for (const item of inspection.items) {
      photos[item.id] = {
        ...(item.beforePhoto ? { before: await burnMarks(await api.photoBytes(item.beforePhoto), item.beforeMarks) } : {}),
        ...(item.afterPhoto ? { after: await burnMarks(await api.photoBytes(item.afterPhoto), item.afterMarks) } : {}),
      };
    }
    const { buildInspectionWorkbook } = await import("../../../modules/inspections/export");
    const bytes = await buildInspectionWorkbook({ inspection, project: { code: project?.code ?? "", name: project?.name ?? "" }, photos });
    downloadBytes(bytes, `${inspection.number} ${project?.name ?? ""} ${inspection.checkDate}.xlsx`.replace(/[\\/:*?"<>|]+/g, "-"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }, "Đã tạo file Excel QHSE PHOTO REPORT.");
  const blockSubmit = submitIssue(inspection);
  const blockFix = fixIssue(inspection.items);
  return (
    <section className="pj-page">
      <button type="button" className="back-button" onClick={props.onBack}><ArrowLeft className="ico" size={16} aria-hidden="true" /> Danh sách báo cáo</button>
      <div className="page-head">
        <div>
          <span className="pj-code">{inspection.number}</span>
          <h1>{inspectionTitle(project)}</h1>
          <p>Kiểm tra ngày {dmy(inspection.checkDate)} · Người báo cáo: {inspection.reporterName || "—"} · Gửi tới: <b>{inspection.attentionName || "—"}</b>{inspection.cc ? ` · CC: ${inspection.cc}` : ""}</p>
        </div>
        <span className={`pill ${TONE[inspection.status]}`} style={{ fontSize: 14 }}>{INSPECTION_STATUS_LABELS[inspection.status]}</span>
      </div>
      <div className="po-actions">
        {canEdit && (inspection.status === "draft") && <button type="button" className="button primary" disabled={busy || Boolean(blockSubmit)} title={blockSubmit ?? ""} onClick={() => void run(() => api.submitInspection(inspection.id), `Đã gửi báo cáo cho ${inspection.attentionName || "trưởng dự án"}.`)}><Send size={15} aria-hidden="true" /> Gửi cho {inspection.attentionName || "người khắc phục"}</button>}
        {canFix && inspection.status === "open" && <button type="button" className="button primary" disabled={busy || Boolean(blockFix)} title={blockFix ?? ""} onClick={() => void run(() => api.markFixed(inspection.id), "Đã báo khắc phục xong cho người kiểm tra.")}><Check size={15} aria-hidden="true" /> Báo đã khắc phục xong</button>}
        {(isReporter || viewer.isAdmin) && inspection.status === "fixed" && <>
          <button type="button" className="button primary" disabled={busy} onClick={() => void run(() => api.closeInspection(inspection.id), "Đã đóng báo cáo.")}><Check size={15} aria-hidden="true" /> Đồng ý, đóng báo cáo</button>
          <button type="button" className="button" disabled={busy} onClick={() => void run(() => api.closeInspection(inspection.id, true), "Đã trả lại cho trưởng dự án sửa tiếp.")}><Undo2 size={15} aria-hidden="true" /> Chưa đạt, trả lại</button>
        </>}
        <button type="button" className="button" disabled={busy || !inspection.items.length} onClick={() => void exportExcel()}><FileSpreadsheet size={15} aria-hidden="true" /> Excel QHSE PHOTO REPORT</button>
        {canEdit && inspection.status === "draft" && <button type="button" className="button danger" disabled={busy} onClick={() => { if (window.confirm(`Xóa báo cáo nháp ${inspection.number}?`)) void run(async () => { await api.deleteInspection(inspection.id); props.onBack(); }, "Đã xóa báo cáo nháp."); }}><Trash2 size={15} aria-hidden="true" /> Xóa nháp</button>}
      </div>
      {inspection.status === "draft" && blockSubmit && <p className="muted">{blockSubmit}</p>}
      {canFix && inspection.status === "open" && <p className="list-notice is-warn">Bạn là người khắc phục: với mỗi lỗi chụp ảnh sau khi sửa (khoanh được), ghi Comment; ngày hoàn thành mặc định hôm nay. Xong hết thì bấm “Báo đã khắc phục xong”.</p>}
      {inspection.items.map((item, index) => <ItemCard key={item.id} inspection={inspection} item={item} index={index} urls={urls} canEdit={canEdit} canFix={canFix} viewer={viewer} onSaved={() => void load()} onRemoved={() => void load()} setNotice={setNotice} />)}
      {Array.from({ length: adding }, (_, index) => <ItemCard key={`new-${index}`} inspection={inspection} item={null} index={inspection.items.length + index} urls={urls} canEdit={canEdit} canFix={false} viewer={viewer} onSaved={() => { setAdding(0); void load(); }} onRemoved={() => undefined} setNotice={setNotice} />)}
      {canEdit && inspection.status !== "fixed" && <button type="button" className="button" onClick={() => setAdding((value) => value + 1)}><Plus size={15} aria-hidden="true" /> Thêm lỗi</button>}
    </section>
  );
}

/** Lập báo cáo mới: chọn dự án → người nhận mặc định là trưởng dự án (PM). */
function NewInspection(props: { projects: readonly InspectionProject[]; lockedProjectId?: string | undefined; onCreated: (id: string) => void; onCancel: () => void; setNotice: Notify }) {
  const creatable = props.projects.filter((item) => item.canCreate);
  const [projectId, setProjectId] = useState(props.lockedProjectId ?? creatable[0]?.projectId ?? "");
  const [checkDate, setCheckDate] = useState(() => todayVN(systemClock));
  const [cc, setCc] = useState("");
  const [busy, setBusy] = useState(false);
  const project = props.projects.find((item) => item.projectId === projectId) ?? null;
  return (
    <div className="mr-form">
      <div className="bs-head">
        <label className="field wide"><span>Dự án *</span><select value={projectId} disabled={Boolean(props.lockedProjectId)} onChange={(event) => setProjectId(event.target.value)}>{creatable.map((item) => <option key={item.projectId} value={item.projectId}>{item.code} · {item.name}</option>)}</select></label>
        <label className="field"><span>Ngày kiểm tra</span><input type="date" value={checkDate} onChange={(event) => setCheckDate(event.target.value || checkDate)} /></label>
        <p className="field"><span>Giao cho ({project?.assigneeIsCommander || (project && project.pmEmployeeId && !project.assigneeEmployeeId) ? "chỉ huy trưởng" : "trưởng dự án"})</span><b>{project?.assigneeName || <span className="warn-text">{project?.pmEmployeeId ? "Dự án chưa có chỉ huy trưởng (thêm ở Org Chart & Members)" : "Dự án chưa có PM"}</span>}</b></p>
        <label className="field"><span>CC</span><input value={cc} placeholder="vd MR. AI & MR. DAN" onChange={(event) => setCc(event.target.value)} /></label>
      </div>
      <div className="button-row">
        <button type="button" className="button" onClick={props.onCancel}>Hủy</button>
        <button type="button" className="button primary" disabled={busy || !project?.assigneeEmployeeId} onClick={() => { if (!project) return; setBusy(true); void api.createInspection({ projectId, checkDate, attentionEmployeeId: project.assigneeEmployeeId, attentionName: project.assigneeName, cc }).then(props.onCreated, (error: unknown) => { props.setNotice(error instanceof Error ? error.message : "Không tạo được.", "error"); setBusy(false); }); }}><Plus size={15} aria-hidden="true" /> Tạo báo cáo, thêm lỗi</button>
      </div>
    </div>
  );
}

/** Tab Báo cáo công trình: danh sách theo dự án / tình trạng, lập mới (người được Sếp / Admin chỉ định), mở chi tiết. */
export function SiteInspections(props: { viewer: InspectionViewer; openId: string | null; onOpen: (id: string | null) => void; setNotice: Notify; /** Chỉ một dự án (tab Monthly Report trong dự án). */ projectId?: string }) {
  const { setNotice } = props;
  const [list, setList] = useState<Inspection[] | null>(null);
  const [projects, setProjects] = useState<InspectionProject[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [projectFilter, setProjectFilter] = useState(props.projectId ?? "");
  const [status, setStatus] = useState<"" | Inspection["status"]>("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([api.listInspections(props.projectId), api.inspectionProjects(), api.canCreateInspection()]).then(([items, projectList, can]) => {
      if (active) { setList(items); setProjects(projectList); setCanCreate(can); }
    }, (error: unknown) => { if (active) { setNotice(error instanceof Error ? error.message : "Không tải được báo cáo.", "error"); setList([]); } });
    return () => { active = false; };
  }, [refresh, setNotice, props.projectId]);
  const byProject = useMemo(() => new Map(projects.map((item) => [item.projectId, item])), [projects]);
  if (props.openId) return <InspectionDetail id={props.openId} projects={projects} viewer={props.viewer} onBack={() => { props.onOpen(null); setRefresh((value) => value + 1); }} onChanged={() => setRefresh((value) => value + 1)} setNotice={setNotice} />;
  if (!list) return <SkeletonTable rows={5} />;
  const shown = list.filter((item) => (!projectFilter || item.projectId === projectFilter) && (!status || item.status === status));
  const mine = list.filter((item) => item.status === "open" && props.viewer.employeeId && item.attentionEmployeeId === props.viewer.employeeId).length;
  return (
    <section className="panel pj-section">
      <div className="pj-section-head">
        <h2>Báo cáo công trình <small className="muted">(QHSE PHOTO REPORT)</small></h2>
        {canCreate && !creating && (props.projectId ? byProject.get(props.projectId)?.canCreate : projects.some((item) => item.canCreate)) && <button type="button" className="button primary" onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" /> Báo cáo mới</button>}
      </div>
      <p className="muted">Sếp kiểm tra công trường chụp lỗi, khoanh điểm cần sửa, ghi vấn đề, cách giải quyết, hạn hoàn thiện; báo cáo giao cho trưởng dự án. Trưởng dự án nhận thông báo, sửa xong chụp ảnh sau, ghi comment, ngày hoàn thành.{mine ? <> <b className="warn-text">Có {mine} báo cáo chờ bạn khắc phục.</b></> : null}</p>
      {creating && <NewInspection projects={projects} lockedProjectId={props.projectId} onCancel={() => setCreating(false)} onCreated={(id) => { setCreating(false); props.onOpen(id); }} setNotice={setNotice} />}
      <div className="pj-toolbar">
        {!props.projectId && <select aria-label="Dự án" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="">Mọi dự án</option>{projects.map((item) => <option key={item.projectId} value={item.projectId}>{item.code} · {item.name}</option>)}</select>}
        <select aria-label="Tình trạng" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="">Mọi tình trạng</option>{(Object.keys(INSPECTION_STATUS_LABELS) as Inspection["status"][]).map((key) => <option key={key} value={key}>{INSPECTION_STATUS_LABELS[key]}</option>)}</select>
      </div>
      {!shown.length ? <p className="muted">Chưa có báo cáo nào.</p> : (
        <div className="table-scroll">
          <table className="pj-table">
            <thead><tr><th>Số phiếu</th><th>Dự án</th><th>Ngày kiểm tra</th><th>Người báo cáo</th><th>Giao cho</th><th className="pj-num">Lỗi</th><th>Tình trạng</th></tr></thead>
            <tbody>{shown.map((item) => {
              const project = byProject.get(item.projectId);
              const fixed = item.items.filter((line) => line.afterPhoto).length;
              return (
                <tr key={item.id} style={{ cursor: "pointer" }} onClick={() => props.onOpen(item.id)}>
                  <td><button type="button" className="link-button" onClick={(event) => { event.stopPropagation(); props.onOpen(item.id); }}>{item.number}</button></td>
                  <td>{project ? `${project.code} ${project.name}` : "—"}</td>
                  <td>{dmy(item.checkDate)}</td><td>{item.reporterName}</td><td>{item.attentionName || "—"}</td>
                  <td className="pj-num">{fixed}/{item.items.length}</td>
                  <td><span className={`pill ${TONE[item.status]}`}>{INSPECTION_STATUS_LABELS[item.status]}</span></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
