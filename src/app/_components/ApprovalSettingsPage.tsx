"use client";
import { SkeletonPage } from "./Skeleton";
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, FileStack, GitBranch } from "lucide-react";
import { COMPANY_ROLES, DEFAULT_PROJECT_ROLES, type CompanyRole } from "../../modules/purchases/companyRoles";
import type { AssignableStage } from "../../modules/purchases/flow";
import { approvalSettings, companyApprovalSettings, saveApprovalSettings, saveStageDepartments, stageDepartmentsSettings, type ApprovalBlock, type ApprovalModes, type CompanyApprovalSettings, type TreeDocType } from "./accountApi";
import { CompanyTreeEditor } from "./CompanyTreeEditor";
import { EmployeePicker } from "./projects/ProjectsPage";
import { ModePicker, OrderedPeople } from "./projects/ProjectApproversPanel";
import { errorMessage, type EmployeeSource } from "./projects/projectShared";
import { StageDepartmentsEditor } from "./purchases/StageDepartmentsEditor";
import type { Notify } from "./Toast";
import "./projects/projects.css";
import "./purchases/purchases.css";

type Roles = Record<CompanyRole, string[]>;
const emptyRoles = (): Roles => Object.fromEntries(COMPANY_ROLES.map((role) => [role.key, []])) as unknown as Roles;

/** Giai đoạn mua hàng nào dùng cây duyệt nào (bấm vào giai đoạn để sắp xếp người duyệt). */
const STAGE_TREE: Partial<Record<AssignableStage, { docType: TreeDocType; title: string }>> = {
  draft: { docType: "purchase", title: "Đơn hàng (P-CC-07)" },
  submitted: { docType: "purchase", title: "Đơn hàng (P-CC-07)" },
  approved: { docType: "purchase", title: "Đơn hàng (P-CC-07)" },
  advance: { docType: "payment", title: "Yêu cầu thanh toán RFP (P-CF-03)" },
  prepayment: { docType: "payment", title: "Yêu cầu thanh toán RFP (P-CF-03)" },
  final: { docType: "payment", title: "Yêu cầu thanh toán RFP (P-CF-03)" },
};
const OTHER_FORMS: readonly { docType: TreeDocType; title: string; hint: string }[] = [
  { docType: "contract", title: "Confirm Contract (P-COST-01)", hint: "Xác nhận dự án" },
  { docType: "budget", title: "Ngân sách (P-COST-03)", hint: "Báo cáo giải thích chưa cài riêng cũng đi theo cây này" },
  { docType: "explanatory", title: "Báo cáo giải thích (P-COST-05)", hint: "" },
  { docType: "material", title: "Yêu cầu vật tư (P-COST-08)", hint: "Chưa cài riêng thì đi theo cây Đơn hàng" },
];

/**
 * Trang Admin "Quy trình duyệt": (1) chức danh của công ty (ai giữ chức danh nào, ai không có là nhân viên thường);
 * (2) giai đoạn mua hàng, bấm vào giai đoạn để xem và sắp xếp cây duyệt mặc định cho mọi dự án; (3) cây duyệt các phiếu khác.
 */
export function ApprovalSettingsPage(props: { live: boolean; employees: EmployeeSource; setNotice: Notify }) {
  const [roles, setRoles] = useState<Roles | null>(null);
  const [allDepartments, setAllDepartments] = useState<Record<string, string[]>>({});
  const [modes, setModes] = useState<ApprovalModes>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [company, setCompany] = useState<CompanyApprovalSettings | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const [openForm, setOpenForm] = useState<TreeDocType | null>(null);

  const { live, setNotice } = props;
  useEffect(() => {
    if (!live) return;
    let active = true;
    void Promise.all([approvalSettings(), companyApprovalSettings().catch(() => null)]).then(([value, tree]) => {
      if (!active) return;
      const next = emptyRoles();
      for (const role of COMPANY_ROLES) next[role.key] = [...(value.departments[role.key] ?? [])];
      setRoles(next);
      setAllDepartments(value.departments);
      setModes(value.modes);
      setNames({ ...(tree?.names ?? {}), ...value.names });
      setCompany(tree ?? { trees: {}, departments: value.departments, names: {} });
      setSaved(JSON.stringify([next, value.modes]));
    }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setRoles(emptyRoles()); setCompany({ trees: {}, departments: {}, names: {} }); } });
    return () => { active = false; };
  }, [live, setNotice]);
  const loadStages = useCallback(() => stageDepartmentsSettings(), []);

  if (!props.live) return <section className="pj-page"><div className="panel empty-state"><p>Quy trình duyệt chỉ cấu hình được ở chế độ thật (đã đăng nhập).</p></div></section>;
  if (!roles || !company) return <SkeletonPage kind="detail" label="Đang tải quy trình duyệt…" />;
  const dirty = JSON.stringify([roles, modes]) !== saved;
  const setList = (key: CompanyRole, list: string[]) => setRoles({ ...roles, [key]: list });
  const save = async () => {
    setBusy(true);
    try {
      const cleanModes = Object.fromEntries(Object.entries(modes).filter(([, value]) => value === "sequence")) as ApprovalModes;
      // Giữ các khối cũ không còn trên màn hình; Kho kiêm Vật tư nên khối Vật tư để trống (máy chủ lấy người của Kho)
      const departments = { ...allDepartments, ...roles, material: [] as string[] };
      await saveApprovalSettings(departments, cleanModes);
      setAllDepartments(departments);
      setCompany({ ...company, departments });
      setModes(cleanModes);
      setSaved(JSON.stringify([roles, cleanModes]));
      props.setNotice("Đã lưu chức danh. Phiếu gửi từ bây giờ lấy người theo chức danh mới.", "success");
    } catch (error) { props.setNotice(errorMessage(error), "error"); } finally { setBusy(false); }
  };
  const treeEditor = (docType: TreeDocType, title: string) => (
    <CompanyTreeEditor key={docType} docType={docType} title={title} initial={company.trees[docType] ?? []} names={names} departments={{ ...company.departments, ...roles }}
      employees={props.employees} canEdit setNotice={props.setNotice}
      onSaved={(blocks: ApprovalBlock[]) => setCompany({ ...company, trees: { ...company.trees, [docType]: blocks } })} />
  );
  const defaultPeople = DEFAULT_PROJECT_ROLES.flatMap((key) => roles[key].map((id) => names[id] ?? id));

  return (
    <section className="pj-page">
      <div className="page-head">
        <div>
          <h1><GitBranch className="ico" size={22} aria-hidden="true" /> Quy trình duyệt</h1>
          <p>Chức danh của công ty và cây duyệt mặc định cho mọi dự án. Dự án nào cần khác thì sửa riêng ở tab “Quy trình duyệt” của dự án.</p>
        </div>
      </div>

      <section className="panel pj-section" aria-labelledby="roles-title">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h2 id="roles-title"><BadgeCheck className="ico" size={18} aria-hidden="true" /> Chức danh</h2>
          <div className="button-row">
            {dirty && <button type="button" className="button" disabled={busy} onClick={() => { const [r, m] = JSON.parse(saved) as [Roles, ApprovalModes]; setRoles(r); setModes(m); }}>Hoàn tác</button>}
            <button type="button" className="button primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Đang lưu…" : "Lưu chức danh"}</button>
          </div>
        </div>
        <p className="muted">Ai không có chức danh nào là <b>nhân viên</b> thường. <b>Sếp, Kế toán, Kiểm soát đầu vào</b> mặc định có trong mọi dự án (thấy và ký phiếu của mọi dự án, không cần thêm vào dự án)
          {defaultPeople.length ? <>: {defaultPeople.join(", ")}</> : null}. Mỗi người cần tài khoản đã liên kết hồ sơ nhân sự.</p>
        <div className="ap-editor">
          {COMPANY_ROLES.map((role) => {
            const list = roles[role.key];
            const mode = modes[role.key as keyof ApprovalModes] ?? "any";
            return (
              <div key={role.key} className="ap-editor-row">
                <div className="ap-editor-role"><b>{role.label}</b><small className="muted">{role.hint}</small></div>
                <div className="ap-editor-people">
                  {list.length ? (
                    <OrderedPeople roleLabel={role.label} sequence={mode === "sequence"} people={list.map((id) => ({ id, label: names[id] ?? id }))}
                      onMove={(index, delta) => { const next = [...list]; const [moved] = next.splice(index, 1); next.splice(index + delta, 0, moved!); setList(role.key, next); }}
                      onRemove={(index) => setList(role.key, list.filter((_, i) => i !== index))} />
                  ) : <small className="muted">Chưa có ai</small>}
                  {list.length > 1 && <ModePicker name={`gmode-${role.key}`} value={mode} onChange={(next) => setModes({ ...modes, [role.key]: next })} />}
                  {role.max && list.length >= role.max ? <small className="muted">Chỉ {role.max} người: bỏ người hiện tại để đổi.</small> : <EmployeePicker key={`${role.key}-${pickerKey}`} label="" source={props.employees} exclude={new Set(list)} onPick={(option) => {
                    if (!option) return;
                    setNames((current) => ({ ...current, [option.id]: option.name }));
                    setList(role.key, [...list, option.id]);
                    setPickerKey((value) => value + 1);
                  }} />}
                </div>
              </div>
            );
          })}
          <div className="ap-editor-row"><div className="ap-editor-role"><b>Nhân viên</b><small className="muted">Mặc định</small></div><div className="ap-editor-people"><small className="muted">Mọi người còn lại (không có chức danh ở trên).</small></div></div>
        </div>
      </section>

      <StageDepartmentsEditor canEdit load={loadStages} save={saveStageDepartments} setNotice={props.setNotice}
        tree={(stage) => { const item = STAGE_TREE[stage]; return item ? { title: item.title, render: () => treeEditor(item.docType, item.title) } : null; }} />

      <section className="panel pj-section" aria-labelledby="forms-title">
        <h2 id="forms-title"><FileStack className="ico" size={18} aria-hidden="true" /> Cây duyệt các phiếu khác</h2>
        <ol className="po-stage-editor">
          {OTHER_FORMS.map((form) => (
            <li key={form.docType} className={`has-tree${openForm === form.docType ? " is-open" : ""}`} style={{ gridTemplateColumns: "1fr" }}>
              <button type="button" className="po-stage-toggle" aria-expanded={openForm === form.docType} onClick={() => setOpenForm(openForm === form.docType ? null : form.docType)}>
                {openForm === form.docType ? "▾" : "▸"} {form.title} <small className="muted">{company.trees[form.docType]?.length ? "đã cài" : "chưa cài (theo quy trình chung)"}{form.hint ? ` · ${form.hint}` : ""}</small>
              </button>
              {openForm === form.docType && <div className="po-stage-tree" style={{ display: "block" }}>{treeEditor(form.docType, form.title)}</div>}
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
