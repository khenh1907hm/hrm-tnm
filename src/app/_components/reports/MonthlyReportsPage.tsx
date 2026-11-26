"use client";
import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, HardHat, Presentation, Trash2, UserCheck, Wrench } from "lucide-react";
import { getSupabaseClient } from "../../../lib/supabase/client";
import type { Actor } from "../../../modules/auth/permissions";
import type { ProjectStore } from "../../../modules/projects/store";
import { EmployeePicker } from "../projects/ProjectsPage";
import type { EmployeeSource } from "../projects/projectShared";
import { myAccount } from "../accountApi";
import { projectPath } from "../routes";
import { SkeletonTable } from "../Skeleton";
import type { Notify } from "../Toast";
import * as api from "./inspectionApi";
import { SiteInspections, type InspectionViewer } from "./SiteInspections";
import "../projects/projects.css";
import "../purchases/purchases.css";
import "./reports.css";

type Tab = "site" | "tools" | "monthly";
const tabFromUrl = (): Tab => { if (typeof window === "undefined") return "site"; const value = new URLSearchParams(window.location.search).get("muc"); return value === "thiet-bi" ? "tools" : value === "bao-cao-thang" ? "monthly" : "site"; };
const openFromUrl = () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("phieu"));
const dmy = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Báo cáo thiết bị (Kiểm tra dụng cụ điện) của mọi dự án, mỗi tháng một phiếu; bấm để mở trong dự án. */
function ToolReports(props: { setNotice: Notify }) {
  const [rows, setRows] = useState<{ id: string; projectId: string; code: string; name: string; date: string; by: string; total: number; ng: number }[] | null>(() => getSupabaseClient() ? null : []);
  const { setNotice } = props;
  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;
    let active = true;
    void client.from("tool_checks").select("id, project_id, check_date, checked_by, rows, projects(code, name)").order("check_date", { ascending: false }).limit(200).then(({ data, error }) => {
      if (!active) return;
      if (error) { setNotice(error.message, "error"); setRows([]); return; }
      setRows(((data ?? []) as Record<string, unknown>[]).map((row) => {
        const list = Array.isArray(row.rows) ? row.rows as Record<string, unknown>[] : [];
        const project = (row.projects ?? {}) as Record<string, unknown>;
        return { id: String(row.id), projectId: String(row.project_id), code: String(project.code ?? ""), name: String(project.name ?? ""), date: String(row.check_date), by: String(row.checked_by ?? ""), total: list.length, ng: list.filter((item) => item.result === "NG").length };
      }));
    });
    return () => { active = false; };
  }, [setNotice]);
  if (!rows) return <SkeletonTable rows={4} />;
  return (
    <section className="panel pj-section">
      <div className="pj-section-head"><h2>Báo cáo thiết bị <small className="muted">(Tool &amp; machine check)</small></h2></div>
      <p className="muted">Kiểm tra dụng cụ, máy điện hằng tháng của từng dự án. Lập phiếu trên app điện thoại (nút + → Kiểm tra dụng cụ điện) hoặc tab Kiểm tra dụng cụ trong dự án; chọn thiết bị từ danh sách có sẵn, cùng loại tự đánh số 1, 2, 3.</p>
      {!rows.length ? <p className="muted">Chưa có phiếu kiểm tra thiết bị nào.</p> : (
        <div className="table-scroll"><table className="pj-table">
          <thead><tr><th>Tháng</th><th>Dự án</th><th>Ngày kiểm tra</th><th>Người kiểm tra</th><th className="pj-num">Thiết bị</th><th className="pj-num">NG</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.id}><td>{row.date.slice(5, 7)}/{row.date.slice(0, 4)}</td>
              <td><a className="link-button" href={`${projectPath(row.projectId)}?muc=kiem-tra-dung-cu`}>{row.code} {row.name}</a></td>
              <td>{dmy(row.date)}</td><td>{row.by || "—"}</td><td className="pj-num">{row.total}</td><td className={`pj-num${row.ng ? " warn-text" : ""}`}>{row.ng}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

/** Người được lập Báo cáo công trình: Sếp (Giám đốc) hoặc Admin chỉ định. */
function InspectorSettings(props: { employees: EmployeeSource; setNotice: Notify }) {
  const [list, setList] = useState<{ employeeId: string; code: string; name: string }[] | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const load = useCallback(() => api.listInspectors().then(setList, () => setList([])), []);
  useEffect(() => {
    let active = true;
    void api.listInspectors().then((value) => { if (active) setList(value); }, () => { if (active) setList([]); });
    return () => { active = false; };
  }, []);
  return (
    <section className="panel pj-section">
      <h2><UserCheck className="ico" size={18} aria-hidden="true" /> Người lập Báo cáo công trình</h2>
      <p className="muted">Những người này (và Giám đốc, Admin) được đi công trường lập báo cáo lỗi. Chỉ Giám đốc hoặc Admin chỉnh được danh sách.</p>
      {!list ? <SkeletonTable rows={2} /> : <ul className="file-chips">{list.map((item) => <li key={item.employeeId} className="file-chip">{item.name || item.employeeId}{item.code ? ` · ${item.code}` : ""} <button type="button" className="link-button" aria-label={`Bỏ ${item.name}`} onClick={() => void api.removeInspector(item.employeeId).then(load, (error: unknown) => props.setNotice(error instanceof Error ? error.message : "Không bỏ được.", "error"))}><Trash2 size={13} aria-hidden="true" /></button></li>)}
        {!list.length && <li><small className="muted">Chưa có ai (chỉ Giám đốc, Admin lập được).</small></li>}</ul>}
      <EmployeePicker key={pickerKey} label="Thêm người lập báo cáo" source={props.employees} exclude={new Set((list ?? []).map((item) => item.employeeId))} onPick={(option) => {
        if (!option) return;
        void api.addInspector(option.id).then(() => { setPickerKey((value) => value + 1); void load(); props.setNotice(`Đã thêm ${option.name}.`, "success"); }, (error: unknown) => props.setNotice(error instanceof Error ? error.message : "Không thêm được.", "error"));
      }} />
    </section>
  );
}

/**
 * BÁO CÁO HẰNG THÁNG: Báo cáo công trình (Sếp kiểm tra công trường), Báo cáo thiết bị (kiểm tra dụng cụ điện),
 * và Báo cáo tháng (gộp các mục thành một file PowerPoint, đang chuẩn bị).
 */
export function MonthlyReportsPage(props: { actor: Actor; projectStore: ProjectStore; employees: EmployeeSource; setNotice: Notify }) {
  const { setNotice } = props;
  const [tab, setTab] = useState<Tab>(tabFromUrl);
  const [openId, setOpenId] = useState<string | null>(openFromUrl);
  const [viewer, setViewer] = useState<InspectionViewer | null>(null);
  const [isDirector, setIsDirector] = useState(false);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([myAccount(), props.projectStore.myEmployeeId().catch(() => null), getSupabaseClient()?.auth.getUser()]).then(([account, employeeId, auth]) => {
      if (!active) return;
      setViewer({ userId: auth?.data.user?.id ?? "", employeeId: employeeId ?? account?.employeeId ?? null, isAdmin: props.actor.role === "admin", name: account?.fullName || account?.loginEmail || "" });
      setIsDirector(Boolean(account?.isDirector));
    });
    return () => { active = false; };
  }, [props.actor.role, props.projectStore]);
  useEffect(() => {
    const sync = () => { setTab(tabFromUrl()); setOpenId(openFromUrl()); };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const go = (next: Tab, id: string | null = null) => {
    const params = new URLSearchParams();
    if (next !== "site") params.set("muc", next === "tools" ? "thiet-bi" : "bao-cao-thang");
    if (id) params.set("phieu", id);
    window.history.pushState(null, "", `/bao-cao-hang-thang${params.size ? `?${params}` : ""}`);
    setTab(next); setOpenId(id);
  };
  const live = getSupabaseClient() !== null;
  return (
    <section className="pj-page">
      {!openId && <div className="page-head">
        <div><h1>Báo cáo hằng tháng</h1><p>Báo cáo công trình, báo cáo thiết bị của các dự án; sau này gộp lại thành file PowerPoint báo cáo tháng.</p></div>
        {(isDirector || props.actor.role === "admin") && <button type="button" className="button" onClick={() => setSettings((value) => !value)}><UserCheck className="ico" size={16} aria-hidden="true" /> Người lập báo cáo</button>}
      </div>}
      {settings && !openId && <InspectorSettings employees={props.employees} setNotice={setNotice} />}
      {!openId && <nav aria-label="Loại báo cáo"><ol className="op-track op-nav">
        {([["site", "Báo cáo công trình", "QHSE photo report", HardHat], ["tools", "Báo cáo thiết bị", "Tool & machine check", Wrench], ["monthly", "Báo cáo tháng", "Gộp PowerPoint", Presentation]] as const).map(([key, label, sub, Icon], index) => (
          <li key={key} className={`op-step ${tab === key ? "is-current" : "is-todo"}`}>
            <button type="button" className="op-nav-btn" aria-current={tab === key ? "page" : undefined} onClick={() => go(key)}>
              <span className="op-num" aria-hidden="true">{index + 1}</span>
              <span className="op-text"><span className="op-label"><Icon size={13} aria-hidden="true" /> {label}</span><small className="op-dept">{sub}</small></span>
            </button>
          </li>
        ))}
      </ol></nav>}
      {!live ? <p className="muted">Báo cáo hằng tháng cần đăng nhập (chế độ thật).</p>
        : tab === "site" ? (viewer ? <SiteInspections viewer={viewer} openId={openId} onOpen={(id) => go("site", id)} setNotice={setNotice} /> : <SkeletonTable rows={4} />)
          : tab === "tools" ? <ToolReports setNotice={setNotice} />
            : (
              <section className="panel pj-section">
                <h2><ClipboardCheck className="ico" size={18} aria-hidden="true" /> Báo cáo tháng (PowerPoint)</h2>
                <p className="muted">Mục này sẽ gộp Báo cáo công trình, Báo cáo thiết bị và các mục báo cáo khác của tháng thành một file PowerPoint. Đang chuẩn bị: cho biết các mục cần có (an toàn, chất lượng, tiến độ…) để làm tiếp.</p>
              </section>
            )}
    </section>
  );
}
