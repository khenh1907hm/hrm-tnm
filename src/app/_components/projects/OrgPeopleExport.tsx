"use client";
import { useMemo, useState } from "react";
import { FileArchive, FileDown } from "lucide-react";
import type { OrgChart } from "../../../modules/projects/orgChart";
import type { Notify } from "../Toast";
import type { EmployeeSource } from "./projectShared";

/**
 * Trước Quyết định BCH: xuất hồ sơ / chứng chỉ của người trên sơ đồ tổ chức (đang hiển thị, kể cả chưa lưu)
 * bằng đúng hộp xuất bên Nhân sự. Kèm hồ sơ chung → mẫu hồ sơ (Excel/PDF, đính kèm chứng chỉ);
 * không kèm → thư mục chứng chỉ (.zip), mỗi người một thư mục.
 */
export function OrgPeopleExport(props: { chart: OrgChart | null; employees: EmployeeSource; setNotice: Notify }) {
  const exportPeople = props.employees?.exportPeople;
  // Người trên sơ đồ có gắn hồ sơ nhân sự, bỏ trùng, giữ thứ tự trên sơ đồ
  const people = useMemo(() => {
    const seen = new Set<string>();
    return (props.chart?.people ?? []).filter((person) => person.employeeId && !seen.has(person.employeeId) && seen.add(person.employeeId));
  }, [props.chart]);
  const unlinked = (props.chart?.people ?? []).filter((person) => !person.employeeId && person.name.trim()).length;
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [withProfile, setWithProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!exportPeople) return null;

  const chosen = people.filter((person) => !skipped.has(person.employeeId!));
  const toggle = (id: string, on: boolean) => setSkipped((current) => { const next = new Set(current); if (on) next.delete(id); else next.add(id); return next; });
  const run = async () => {
    setBusy(true);
    try {
      const opened = await exportPeople(chosen.map((person) => person.employeeId!), withProfile);
      if (!opened) props.setNotice("Không tìm thấy hồ sơ nhân sự của những người đã chọn (có thể đã lưu trữ).", "error");
      else if (opened < chosen.length) props.setNotice(`${chosen.length - opened} người không còn hồ sơ đang dùng nên bị bỏ qua.`);
    } catch { props.setNotice("Không mở được hộp xuất hồ sơ.", "error"); } finally { setBusy(false); }
  };

  return (
    <section className="panel pj-section ope-bar" aria-label="Xuất hồ sơ, chứng chỉ người trên sơ đồ">
      <div className="ope-head">
        <div>
          <b>Hồ sơ, chứng chỉ người trên sơ đồ</b><br />
          <small className="muted">Chọn người trên sơ đồ tổ chức ở trên rồi xuất như bên Nhân sự.{unlinked ? ` ${unlinked} người chưa gắn hồ sơ nhân sự nên không có trong danh sách.` : ""}</small>
        </div>
        <div className="button-row">
          <label className="check-field" title="Bật: xuất theo mẫu hồ sơ (phiếu + chứng chỉ). Tắt: chỉ tải thư mục chứng chỉ dạng .zip">
            <input type="checkbox" checked={withProfile} onChange={(event) => setWithProfile(event.target.checked)} /> Kèm hồ sơ chung
          </label>
          <button type="button" className="button primary" disabled={busy || !chosen.length} onClick={() => void run()}>
            {withProfile ? <FileDown className="ico" size={16} aria-hidden="true" /> : <FileArchive className="ico" size={16} aria-hidden="true" />}
            {busy ? "Đang mở…" : withProfile ? `Xuất hồ sơ · ${chosen.length} người` : `Tải chứng chỉ (.zip) · ${chosen.length} người`}
          </button>
        </div>
      </div>
      {people.length ? (
        <div className="ope-people">
          {people.map((person) => (
            <label key={person.id} className={`ope-chip${skipped.has(person.employeeId!) ? " off" : ""}`}>
              <input type="checkbox" checked={!skipped.has(person.employeeId!)} onChange={(event) => toggle(person.employeeId!, event.target.checked)} />
              {person.name || "(chưa có tên)"}{person.titleVi && <small className="muted"> · {person.titleVi}</small>}
            </label>
          ))}
          {people.length > 1 && <button type="button" className="link-button" onClick={() => setSkipped(skipped.size ? new Set() : new Set(people.map((person) => person.employeeId!)))}>{skipped.size ? "Chọn tất cả" : "Bỏ chọn tất cả"}</button>}
        </div>
      ) : <p className="muted">Sơ đồ chưa có người nào gắn hồ sơ nhân sự: bấm vào ô trên sơ đồ để chọn người từ danh sách nhân sự.</p>}
    </section>
  );
}
