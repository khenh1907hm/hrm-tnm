"use client";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, FileDown, FileSpreadsheet, Plus, Trash2, X } from "lucide-react";
import type { ProjectStore } from "../../../modules/projects/store";
import type { Project, ProjectMember } from "../../../modules/projects/types";
import type { OrgChart } from "../../../modules/projects/orgChart";
import { BCH_TEMPLATE, BCH_TITLES, type BchMember } from "../../../modules/projects/bchDecision";
import { directorPeople } from "../accountApi";
import { downloadBytes } from "../purchases/FormExport";
import type { Notify } from "../Toast";
import { errorMessage, type EmployeeSource } from "./projectShared";

type Row = BchMember & { key: string; include: boolean };
const ROLE_ORDER = ["pm", "commander", "supervisor", "engineer", "leader", "member", "worker"];
const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").replace(/\s+/g, " ").trim().toLowerCase();
/** "LÊ VĂN THẠCH" → "Lê Văn Thạch" (sơ đồ ghi tên in hoa). */
const titleCase = (text: string) => text.trim().toLocaleLowerCase("vi").replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => space + letter.toLocaleUpperCase("vi"));
const safeName = (text: string) => text.normalize("NFC").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);

/**
 * Xuất "Quyết định thành lập Ban chỉ huy công trường" theo mẫu công ty, lấy thành viên dự án (bỏ tổ viên) và thông tin dự án.
 * Sửa được số quyết định, ngày, gói thầu, công trình, chức vụ, số điện thoại, thứ tự trước khi tải Excel / PDF.
 */
export function BchDecisionDialog(props: { store: ProjectStore; project: Project; members: readonly ProjectMember[]; chart: OrgChart | null; today: string; employees: EmployeeSource; setNotice: Notify; onClose: () => void }) {
  const { project } = props;
  const [number, setNumber] = useState(1);
  const [signedOn, setSignedOn] = useState(props.today);
  const [packageName, setPackageName] = useState(project.name);
  const [worksName, setWorksName] = useState([project.customerName, project.site].filter(Boolean).join(" – "));
  const [responsibleTo, setResponsibleTo] = useState("Chủ đầu tư");
  const [directorName, setDirectorName] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const boss = await directorPeople().catch(() => []);
      // Sơ đồ đang hiển thị (kể cả chưa lưu); chưa có thì đọc bản đã lưu
      const chart = props.chart ?? await props.store.getOrgChart(project.id).catch(() => null);
      const bossNames = new Set(boss.map((item) => plain(item.name)));
      const active_ = props.members.filter((member) => !member.leftOn || member.leftOn >= props.today);
      const unique = new Map<string, ProjectMember>();
      for (const member of [...active_].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))) if (!unique.has(member.employeeId)) unique.set(member.employeeId, member);
      const list = await Promise.all([...unique.values()].map(async (member): Promise<Row> => {
        const option = await props.employees?.get?.(member.employeeId).catch(() => null);
        // Người này trên sơ đồ tổ chức: gắn theo hồ sơ, không thì khớp theo tên
        const onChart = chart?.people.find((person) => person.employeeId === member.employeeId)
          ?? chart?.people.find((person) => person.name.trim() && plain(person.name) === plain(member.displayName));
        const title = BCH_TITLES[member.role] || onChart?.titleVi?.trim() || option?.position?.trim() || "";
        const phone = option?.phone?.trim() || onChart?.phone?.trim() || "";
        return { key: member.id, name: member.displayName, title, phone, include: member.role !== "worker" && member.role !== "leader" };
      }));
      // Người trên sơ đồ tổ chức (theo thứ tự sơ đồ: công trường rồi văn phòng), bỏ Giám đốc
      const onChartRows: Row[] = (chart?.people ?? [])
        .filter((person) => person.name.trim() && !bossNames.has(plain(person.name)) && !/gi[aá]m\s*đ[oố]c|director/i.test(`${person.titleVi} ${person.titleEn}`))
        .sort((a, b) => (a.section === b.section ? 0 : a.section === "site" ? -1 : 1))
        .map((person) => {
          const member = list.find((row) => row.key === props.members.find((item) => item.employeeId === person.employeeId)?.id)
            ?? list.find((row) => plain(row.name) === plain(person.name));
          return {
            key: `chart-${person.id}`, name: member?.name || titleCase(person.name), title: person.titleVi.trim() || member?.title || "", phone: person.phone.trim() || member?.phone || "",
            include: person.branch !== "group",
          };
        });
      // Chỉ lấy người có trên sơ đồ (thành viên dự án khác như hành chính không vào); sơ đồ chưa có ai thì mới lấy thành viên dự án
      const merged = onChartRows.length ? onChartRows : list;
      if (!active) return;
      setRows(merged);
      if (boss[0]) setDirectorName(boss[0].name);
    })();
    return () => { active = false; };
    // Chỉ nạp một lần khi mở hộp thoại (sửa tay trong bảng không bị ghi đè)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (key: string, patch: Partial<Row>) => setRows((list) => list?.map((row) => row.key === key ? { ...row, ...patch } : row) ?? null);
  const move = (index: number, delta: -1 | 1) => setRows((list) => { if (!list) return list; const next = [...list]; const [item] = next.splice(index, 1); next.splice(index + delta, 0, item!); return next; });
  const chosen = (rows ?? []).filter((row) => row.include && row.name.trim());

  const build = async () => {
    const response = await fetch(BCH_TEMPLATE, { cache: "no-cache" });
    if (!response.ok) throw new Error("FORM_TEMPLATE_MISSING");
    const { fillBchDecision } = await import("../../../modules/projects/bchDecision");
    return fillBchDecision(await response.arrayBuffer(), { number, signedOn, packageName, worksName, responsibleTo, directorName, members: chosen });
  };
  const run = async (format: "xlsx" | "pdf") => {
    if (!chosen.length) { props.setNotice("Chọn ít nhất một thành viên.", "error"); return; }
    if (!packageName.trim() || !worksName.trim()) { props.setNotice("Nhập tên gói thầu và tên công trình.", "error"); return; }
    setBusy(format);
    try {
      const bytes = await build();
      const name = safeName(`QD thanh lap BCH ${project.code} so ${String(number).padStart(2, "0")}`);
      if (format === "xlsx") downloadBytes(bytes, `${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      else {
        const { convertXlsxToPdf } = await import("../profileExport");
        downloadBytes(await convertXlsxToPdf(bytes), `${name}.pdf`, "application/pdf");
      }
    } catch (error) {
      props.setNotice(error instanceof Error && !/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : errorMessage(error), "error");
    } finally { setBusy(null); }
  };

  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") props.onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="bch-title" style={{ maxWidth: 900 }}>
        <header><h2 id="bch-title">Quyết định thành lập Ban chỉ huy công trường</h2><button type="button" className="close" aria-label="Đóng" onClick={props.onClose}>×</button></header>
        <div className="form-grid">
          <label className="field"><span>Số quyết định</span><input type="number" min={1} value={number} onChange={(event) => setNumber(Math.max(1, Number(event.target.value) || 1))} /><small className="field-hint">Số tiếp theo trong sổ văn bản đi → {`${String(number).padStart(2, "0")}/${signedOn.slice(0, 4)}/QĐ-TNM`}</small></label>
          <label className="field"><span>Ngày ký</span><input type="date" value={signedOn} onChange={(event) => setSignedOn(event.target.value || props.today)} /></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>Tên gói thầu</span><input value={packageName} maxLength={300} onChange={(event) => setPackageName(event.target.value)} /></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>Tên công trình</span><input value={worksName} maxLength={300} placeholder="vd: Nhà xưởng ABC – KCN Tân Tạo" onChange={(event) => setWorksName(event.target.value)} /></label>
          <label className="field"><span>Chịu trách nhiệm trước</span><select value={responsibleTo} onChange={(event) => setResponsibleTo(event.target.value)}>
            <option value="Chủ đầu tư">Chủ đầu tư (TNM là thầu chính)</option><option value="Tổng thầu">Tổng thầu (TNM là thầu phụ)</option>
          </select></label>
          <label className="field"><span>Giám đốc ký</span><input value={directorName} placeholder="Để trống = dòng chấm" onChange={(event) => setDirectorName(event.target.value)} /></label>
          <div style={{ gridColumn: "1 / -1" }}>
            <b>Thành viên Ban chỉ huy</b> <small className="muted">Chỉ lấy người trên sơ đồ tổ chức (bỏ Giám đốc; Quản lý nhóm mặc định không chọn), chức vụ tiếng Việt và số điện thoại theo sơ đồ. Ô viền đỏ là còn trống, điền tay rồi tải.</small>
            {!rows ? <div className="loading">Đang tải thành viên…</div> : (
              <div className="table-scroll">
                <table className="pj-table bch-table">
                  <thead><tr><th /><th>Họ và tên</th><th>Chức vụ</th><th>Số điện thoại</th><th /></tr></thead>
                  <tbody>{rows.map((row, index) => (
                    <tr key={row.key} className={row.include ? undefined : "muted"}>
                      <td><input type="checkbox" aria-label={`Chọn ${row.name}`} checked={row.include} onChange={(event) => update(row.key, { include: event.target.checked })} /></td>
                      <td><input value={row.name} aria-label="Họ và tên" onChange={(event) => update(row.key, { name: event.target.value })} /></td>
                      <td><input className={row.include && !row.title.trim() ? "bch-missing" : undefined} placeholder="Chưa có chức vụ" value={row.title} aria-label="Chức vụ" list="bch-titles" onChange={(event) => update(row.key, { title: event.target.value })} /></td>
                      <td><input className={row.include && !row.phone.trim() ? "bch-missing" : undefined} placeholder="Chưa có SĐT" value={row.phone} aria-label="Số điện thoại" inputMode="tel" onChange={(event) => update(row.key, { phone: event.target.value })} /></td>
                      <td className="bch-tools">
                        <button type="button" className="icon-link" aria-label="Lên" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} aria-hidden="true" /></button>
                        <button type="button" className="icon-link" aria-label="Xuống" disabled={index === rows.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} aria-hidden="true" /></button>
                        <button type="button" className="icon-link" aria-label="Xóa dòng" onClick={() => setRows((list) => list?.filter((item) => item.key !== row.key) ?? null)}><Trash2 size={14} aria-hidden="true" /></button>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
                <datalist id="bch-titles">{["Quản lý dự án", "Chỉ huy trưởng", "Chỉ huy phó", "Giám sát Cơ", "Giám sát Điện", "Giám sát an toàn", "Kỹ sư", "Thủ kho"].map((title) => <option key={title} value={title} />)}</datalist>
              </div>
            )}
            <button type="button" className="button" style={{ marginTop: 8 }} onClick={() => setRows((list) => [...(list ?? []), { key: `new-${Date.now()}`, name: "", title: "", phone: "", include: true }])}><Plus className="ico" size={15} aria-hidden="true" /> Thêm người ngoài danh sách</button>
          </div>
        </div>
        <footer>
          <span className="muted" style={{ marginRight: "auto" }}>{chosen.length} người</span>
          <button type="button" className="button" onClick={props.onClose}><X className="ico" size={15} aria-hidden="true" /> Đóng</button>
          <button type="button" className="button" disabled={busy !== null} onClick={() => void run("xlsx")}><FileSpreadsheet className="ico" size={16} aria-hidden="true" /> {busy === "xlsx" ? "Đang tạo…" : "Tải Excel"}</button>
          <button type="button" className="button primary" disabled={busy !== null} onClick={() => void run("pdf")}><FileDown className="ico" size={16} aria-hidden="true" /> {busy === "pdf" ? "Đang tạo…" : "Tải PDF"}</button>
        </footer>
      </section>
    </div>
  );
}
