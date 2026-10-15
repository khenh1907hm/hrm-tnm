import { useEffect, useMemo, useState } from "react";
import { HardHat } from "lucide-react";
import type { Actor } from "../../modules/auth/permissions";
import { contactFromEmployee, DEFAULT_CONTACT_RELATION } from "../../modules/commanders/fromEmployee";
import type { Commander } from "../../modules/commanders/types";
import type { Employee } from "../../modules/employees/types";
import type { App } from "./shared";

export type ContactChoice = { employeeId: string; relation: string };
export const EMPTY_CONTACT: ContactChoice = { employeeId: "", relation: DEFAULT_CONTACT_RELATION };

/** Tải toàn bộ nhân sự đang hoạt động (qua các trang) để chọn chỉ huy trưởng. */
export function useActiveEmployees(app: App, actor: Actor): Employee[] {
  const [employees, setEmployees] = useState<Employee[]>([]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const all: Employee[] = [];
      for (let page = 1; ; page++) {
        const result = await app.employees.list(actor, { page, pageSize: 100, statuses: ["active", "on_leave"] });
        if (!result.ok) break;
        all.push(...result.value.items);
        if (page >= result.value.pageCount) break;
      }
      if (active) setEmployees(all);
    })();
    return () => { active = false; };
  }, [app, actor]);
  return employees;
}

/** Đổi lựa chọn thành "người liên hệ khẩn cấp" dùng khi điền hồ sơ. */
export function contactOf(choice: ContactChoice, employees: readonly Employee[]): Commander | null {
  const employee = employees.find((item) => item.id === choice.employeeId);
  return employee ? contactFromEmployee(employee, choice.relation) : null;
}

/**
 * Chọn một nhân sự làm Chỉ huy trưởng công trường (người liên hệ khẩn cấp của cả lô hồ sơ).
 * Người trong danh sách xuất được đưa lên đầu.
 */
export function ContactPicker(props: { app: App; actor: Actor; value: ContactChoice; onChange: (value: ContactChoice, contact: Commander | null) => void; preferredIds?: readonly string[] }) {
  const employees = useActiveEmployees(props.app, props.actor);
  const preferred = useMemo(() => employees.filter((employee) => props.preferredIds?.includes(employee.id)), [employees, props.preferredIds]);
  const others = useMemo(() => employees.filter((employee) => !props.preferredIds?.includes(employee.id)), [employees, props.preferredIds]);
  const contact = contactOf(props.value, employees);
  const change = (next: ContactChoice) => props.onChange(next, contactOf(next, employees));
  // Lựa chọn có sẵn (vd từ dự án): báo lại thông tin liên hệ khi danh sách nhân sự đã tải xong
  const { employeeId } = props.value;
  useEffect(() => { if (employees.length && employeeId) props.onChange(props.value, contactOf(props.value, employees)); }, [employees, employeeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const option = (employee: Employee) => <option key={employee.id} value={employee.id}>{employee.code} · {employee.name} · {employee.position}</option>;

  return (
    <section className="contact-picker">
      <h3><HardHat size={16} aria-hidden="true" /> Chỉ huy trưởng công trường (người liên hệ khẩn cấp)</h3>
      <div className="contact-grid">
        <label className="field">
          <span>Chọn nhân sự quản lý dự án</span>
          <select value={props.value.employeeId} onChange={(event) => change({ ...props.value, employeeId: event.target.value })}>
            <option value="">— Chưa chọn (để trống phần liên hệ) —</option>
            {preferred.length > 0 && <optgroup label="Trong danh sách xuất">{preferred.map(option)}</optgroup>}
            {others.length > 0 && <optgroup label={preferred.length ? "Nhân sự khác" : "Nhân sự"}>{others.map(option)}</optgroup>}
          </select>
        </label>
        <label className="field">
          <span>Quan hệ ghi trên hồ sơ</span>
          <input value={props.value.relation} onChange={(event) => change({ ...props.value, relation: event.target.value })} onBlur={() => { if (!props.value.relation.trim()) change({ ...props.value, relation: DEFAULT_CONTACT_RELATION }); }} />
        </label>
      </div>
      {contact
        ? <p className="contact-preview"><b>{contact.name}</b> · {contact.role} · {contact.phone || "chưa có SĐT"} · {contact.address || "chưa có địa chỉ"}</p>
        : <p className="muted">Chọn một lần, áp dụng cho mọi hồ sơ trong lần xuất này (kể cả hồ sơ của chính người đó).</p>}
    </section>
  );
}
