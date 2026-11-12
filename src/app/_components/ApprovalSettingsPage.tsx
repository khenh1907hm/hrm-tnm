"use client";
import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { DEPARTMENTS, ROLE_LABELS, type Department } from "../../modules/purchases/approval";
import { approvalSettings, saveApprovalSettings, type ApprovalModes } from "./accountApi";
import { EmployeePicker } from "./projects/ProjectsPage";
import { ModePicker, OrderedPeople, ROLE_HINTS } from "./projects/ProjectApproversPanel";
import { errorMessage, type EmployeeSource } from "./projects/projectShared";
import type { Notify } from "./Toast";
import "./projects/projects.css";

/** Thứ tự khối theo chuỗi ký của đơn đặt hàng. */
const ORDER: readonly Department[] = ["technical", "material", "accounting", "leader", "admin_office"];

/**
 * Trang Admin "Quy trình duyệt": ai thuộc từng khối ký duyệt (dùng chung cho mọi dự án chưa đặt người riêng),
 * và khối nhiều người thì một người duyệt là đủ hay lần lượt từng cấp.
 */
export function ApprovalSettingsPage(props: { live: boolean; employees: EmployeeSource; setNotice: Notify }) {
  const [departments, setDepartments] = useState<Record<Department, string[]> | null>(null);
  const [modes, setModes] = useState<ApprovalModes>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);

  const { live, setNotice } = props;
  useEffect(() => {
    if (!live) return;
    let active = true;
    void approvalSettings().then((value) => {
      if (!active) return;
      const next = Object.fromEntries(DEPARTMENTS.map((key) => [key, [...(value.departments[key] ?? [])]])) as Record<Department, string[]>;
      setDepartments(next);
      setModes(value.modes);
      setNames(value.names);
      setSaved(JSON.stringify([next, value.modes]));
    }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setDepartments(Object.fromEntries(DEPARTMENTS.map((key) => [key, []])) as unknown as Record<Department, string[]>); } });
    return () => { active = false; };
  }, [live, setNotice]);

  if (!props.live) return <section className="pj-page"><div className="panel empty-state"><p>Quy trình duyệt chỉ cấu hình được ở chế độ thật (đã đăng nhập).</p></div></section>;
  if (!departments) return <div className="loading">Đang tải quy trình duyệt…</div>;
  const dirty = JSON.stringify([departments, modes]) !== saved;
  const setList = (key: Department, list: string[]) => setDepartments({ ...departments, [key]: list });
  const save = async () => {
    setBusy(true);
    try {
      const cleanModes = Object.fromEntries(Object.entries(modes).filter(([, value]) => value === "sequence")) as ApprovalModes;
      await saveApprovalSettings(departments, cleanModes);
      setModes(cleanModes);
      setSaved(JSON.stringify([departments, cleanModes]));
      props.setNotice("Đã lưu quy trình duyệt. Phiếu gửi từ bây giờ sẽ đi theo cấu hình mới.", "success");
    } catch (error) { props.setNotice(errorMessage(error), "error"); } finally { setBusy(false); }
  };

  return (
    <section className="pj-page">
      <div className="page-head">
        <div>
          <h1><GitBranch className="ico" size={22} aria-hidden="true" /> Quy trình duyệt</h1>
          <p>Ai được duyệt ở từng khối, áp dụng cho mọi dự án (dự án nào đặt người riêng ở mục “Phân quyền & duyệt” thì dùng người của dự án).</p>
        </div>
        <div className="button-row">
          {dirty && <button type="button" className="button" disabled={busy} onClick={() => { const [d, m] = JSON.parse(saved) as [Record<Department, string[]>, ApprovalModes]; setDepartments(d); setModes(m); }}>Hoàn tác</button>}
          <button type="button" className="button primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Đang lưu…" : "Lưu quy trình"}</button>
        </div>
      </div>
      <div className="panel pj-section">
        <p className="muted">Chuỗi ký đơn đặt hàng dự án: <b>Phụ trách (PM)</b> → P. Kỹ thuật → P. Vật tư → Kế toán → <b>Lãnh đạo</b> (ký là duyệt) → Hành chánh.
          Khối chưa có ai thì bước đó được bỏ qua. Khối có từ 2 người: chọn <b>một người duyệt là đủ</b>, hoặc <b>lần lượt từng cấp</b> (cấp 1 ký xong mới tới cấp 2; khối Lãnh đạo thì người cuối ký mới là duyệt).
          Giám đốc luôn duyệt ngay được. Mỗi người cần tài khoản đã liên kết hồ sơ nhân sự.</p>
        <div className="ap-editor">
          {ORDER.map((key) => {
            const list = departments[key];
            const mode = modes[key] ?? "any";
            return (
              <div key={key} className="ap-editor-row">
                <div className="ap-editor-role"><b>{ROLE_LABELS[key]}</b><small className="muted">{ROLE_HINTS[key]}</small></div>
                <div className="ap-editor-people">
                  {list.length ? (
                    <OrderedPeople roleLabel={ROLE_LABELS[key]} sequence={mode === "sequence"} people={list.map((id) => ({ id, label: names[id] ?? id }))}
                      onMove={(index, delta) => { const next = [...list]; const [moved] = next.splice(index, 1); next.splice(index + delta, 0, moved!); setList(key, next); }}
                      onRemove={(index) => setList(key, list.filter((_, i) => i !== index))} />
                  ) : <small className="muted">Chưa có ai (bỏ qua bước này)</small>}
                  {list.length > 1 && <ModePicker name={`gmode-${key}`} value={mode} onChange={(next) => setModes({ ...modes, [key]: next })} />}
                  <EmployeePicker key={`${key}-${pickerKey}`} label="" source={props.employees} exclude={new Set(list)} onPick={(option) => {
                    if (!option) return;
                    setNames((current) => ({ ...current, [option.id]: option.name }));
                    setList(key, [...list, option.id]);
                    setPickerKey((value) => value + 1);
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
