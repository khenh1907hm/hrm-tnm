import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import type { Actor } from "../../modules/auth/permissions";
import type { CertificateTypeRecord } from "../../modules/certificate-types/types";
import type { Commander } from "../../modules/commanders/types";
import { POSITIONS, type Position } from "../../modules/employees/types";
import { reminderEmail } from "../../modules/reminders/email";
import { issueText, type App, type SetNotice } from "./shared";

export function SettingsPanel(props: { app: App; actor: Actor; setNotice: SetNotice; onAddSignature: () => void; sessionFiles: Record<string, File> }) {
  const [section, setSection] = useState<"types" | "signatures" | "emails" | "commanders">("types");
  const [cmdList, setCmdList] = useState<Commander[]>([]);
  const [cmdIncludeHidden, setCmdIncludeHidden] = useState(false);
  const [cmdFormOpen, setCmdFormOpen] = useState(false);
  const [editingCmd, setEditingCmd] = useState<Commander | null>(null);
  const [cmdForm, setCmdForm] = useState<{ name: string; role: string; phone: string; address: string }>({ name: "", role: "Chỉ huy trưởng công trường", phone: "", address: "" });
  const [cmdError, setCmdError] = useState("");
  const [types, setTypes] = useState<CertificateTypeRecord[]>([]);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [editingType, setEditingType] = useState<CertificateTypeRecord | null>(null);
  const [typeFormOpen, setTypeFormOpen] = useState(false);
  const [typeForm, setTypeForm] = useState<{ name: string; englishName: string; requiredForPositions: Position[] }>({ name: "", englishName: "", requiredForPositions: [] });
  const [signatures, setSignatures] = useState<{ id: string; name: string; role: string; isDefault: boolean; file: { id: string } }[]>([]);
  const [signatureUrls, setSignatureUrls] = useState<Record<string, string>>({});
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [emails, setEmails] = useState<string[]>([]);
  const [sendExpiredNotice, setSendExpiredNotice] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailError, setEmailError] = useState("");
  const [sample, setSample] = useState<{ subject: string; text: string } | null>(null);

  const refreshTypes = useCallback(async () => {
    const result = await props.app.certificateTypes.list(props.actor, props.actor.role === "admin" && includeHidden);
    if (result.ok) setTypes(result.value);
  }, [props.app, props.actor, includeHidden]);

  const refreshCommanders = useCallback(async () => {
    const result = await props.app.commanders.list(props.actor, props.actor.role === "admin" && cmdIncludeHidden);
    if (result.ok) setCmdList(result.value);
  }, [props.app, props.actor, cmdIncludeHidden]);

  useEffect(() => {
    void props.app.commanders.list(props.actor, props.actor.role === "admin" && cmdIncludeHidden).then((result) => { if (result.ok) setCmdList(result.value); });
  }, [props.app, props.actor, cmdIncludeHidden]);

  const refreshSignatures = useCallback(async () => {
    const result = await props.app.signatures.list(props.actor);
    if (result.ok) setSignatures(result.value);
  }, [props.app, props.actor]);

  useEffect(() => {
    void props.app.certificateTypes.list(props.actor, props.actor.role === "admin" && includeHidden).then((result) => { if (result.ok) setTypes(result.value); });
  }, [props.app, props.actor, includeHidden]);
  useEffect(() => {
    void props.app.signatures.list(props.actor).then((result) => { if (result.ok) setSignatures(result.value); });
  }, [props.app, props.actor]);
  useEffect(() => {
    const urls = Object.fromEntries(signatures.flatMap((signature) => {
      const file = props.sessionFiles[signature.file.id];
      return file ? [[signature.id, URL.createObjectURL(file)]] : [];
    }));
    const timer = window.setTimeout(() => setSignatureUrls(urls), 0);
    return () => { window.clearTimeout(timer); Object.values(urls).forEach((url) => URL.revokeObjectURL(url)); };
  }, [signatures, props.sessionFiles]);
  useEffect(() => {
    let active = true;
    void Promise.all([props.app.settings.get(props.actor), props.app.employees.list(props.actor), props.app.certificates.listExpiring(props.actor)]).then(([current, workers, expiring]) => {
      if (!active) return;
      if (current.ok) { setEmails(current.value.reminderEmails); setSettingsVersion(current.value.version); setSendExpiredNotice(current.value.sendExpiredNotice); }
      if (workers.ok && expiring.ok && expiring.value.length) {
        const item = expiring.value[0];
        if (item) {
          const employee = workers.value.items.find((entry) => entry.id === item.employeeId);
          const category = types.find((entry) => entry.key === item.type);
          if (employee) setSample(reminderEmail(employee, item, item.daysLeft, `/nhan-su/${employee.id}`, category));
        }
      }
    });
    return () => { active = false; };
  }, [props.app, props.actor, types]);

  const startTypeEdit = (type: CertificateTypeRecord | null) => {
    setTypeFormOpen(true);
    setEditingType(type);
    setTypeForm(type ? { name: type.name, englishName: type.englishName ?? "", requiredForPositions: [...type.requiredForPositions] } : { name: "", englishName: "", requiredForPositions: [] });
  };
  const saveType = async () => {
    if (props.actor.role !== "admin") return;
    const result = editingType
      ? await props.app.certificateTypes.update(props.actor, { id: editingType.id, expectedVersion: editingType.version, ...typeForm, sortOrder: editingType.sortOrder })
      : await props.app.certificateTypes.create(props.actor, typeForm);
    if (!result.ok) { props.setNotice(result.errors.map((item) => issueText(item.code)).join(" ")); return; }
    startTypeEdit(null); setTypeFormOpen(false); await refreshTypes(); props.setNotice(editingType ? "Đã cập nhật loại chứng chỉ." : "Đã thêm loại chứng chỉ.");
  };
  const moveType = async (type: CertificateTypeRecord, direction: -1 | 1) => {
    if (props.actor.role !== "admin") return;
    const ordered = [...types].filter((item) => !item.archived).sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((item) => item.id === type.id);
    const other = ordered[index + direction];
    if (!other) return;
    const saveOrder = async (record: CertificateTypeRecord, sortOrder: number) => props.app.certificateTypes.update(props.actor, { id: record.id, expectedVersion: record.version, name: record.name, englishName: record.englishName, requiredForPositions: record.requiredForPositions, sortOrder });
    const first = await saveOrder(type, other.sortOrder + direction);
    if (!first.ok) { props.setNotice(issueText(first.errors[0]?.code ?? "CONFLICT")); return; }
    const updatedOther = await saveOrder(other, type.sortOrder);
    if (!updatedOther.ok) { props.setNotice(issueText(updatedOther.errors[0]?.code ?? "CONFLICT")); return; }
    await refreshTypes();
  };
  const hideType = async (type: CertificateTypeRecord) => {
    const reason = window.prompt("Nhập lý do ẩn loại chứng chỉ:");
    if (reason === null) return;
    const result = await props.app.certificateTypes.archive(props.actor, { id: type.id, expectedVersion: type.version, reason });
    props.setNotice(result.ok ? "Đã ẩn loại chứng chỉ." : issueText(result.errors[0]?.code ?? "CTYPE_HAS_CURRENT_CERTIFICATES"));
    await refreshTypes();
  };
  const saveSettings = async () => {
    const result = await props.app.settings.update(props.actor, { reminderEmails: emails, sendExpiredNotice, expectedVersion: settingsVersion });
    if (!result.ok) { props.setNotice(issueText(result.errors[0]?.code ?? "SETTING_EMAIL_INVALID")); return; }
    setSettingsVersion(result.value.version); props.setNotice("Đã lưu cài đặt địa chỉ nhận.");
  };
  const addEmail = () => {
    const candidate = emailDraft.trim();
    if (!/^\S+@\S+\.\S+$/.test(candidate)) { setEmailError(issueText("SETTING_EMAIL_INVALID")); return; }
    if (emails.length >= 10) { setEmailError(issueText("SETTING_EMAIL_LIMIT")); return; }
    setEmails((current) => [...current, candidate]); setEmailDraft(""); setEmailError("");
  };

  const saveCommander = async () => {
    if (props.actor.role !== "admin") return;
    if (!cmdForm.name.trim() || !cmdForm.role.trim() || !cmdForm.phone.trim()) { setCmdError("Vui lòng điền đủ Họ tên, Chức vụ và Số điện thoại."); return; }
    const result = editingCmd
      ? await props.app.commanders.update(props.actor, { ...cmdForm, id: editingCmd.id, expectedVersion: editingCmd.version })
      : await props.app.commanders.create(props.actor, cmdForm);
    if (!result.ok) { setCmdError(result.errors.map((item) => issueText(item.code)).join(" ")); return; }
    setCmdError(""); setCmdFormOpen(false); setEditingCmd(null); await refreshCommanders();
    props.setNotice(editingCmd ? "Đã cập nhật chỉ huy trưởng." : "Đã thêm chỉ huy trưởng.");
  };

  const archiveCommander = async (cmd: Commander) => {
    if (props.actor.role !== "admin") return;
    const result = await props.app.commanders.archive(props.actor, { id: cmd.id, expectedVersion: cmd.version });
    if (!result.ok) { props.setNotice(issueText(result.errors[0]?.code ?? "COMMANDER_IN_USE")); return; }
    await refreshCommanders(); props.setNotice("Đã ẩn chỉ huy trưởng.");
  };

  return <>
    <div className="page-head"><div><h1>Cài đặt</h1><p>Thiết lập loại chứng chỉ, chữ ký, địa chỉ nhắc hạn và chỉ huy trưởng</p></div></div>
    <div className="button-row settings-tabs"><button className="button" onClick={() => setSection("types")}>Loại chứng chỉ</button><button className="button" onClick={() => setSection("emails")}>Nhắc hạn</button></div>
    {section === "types" && <section className="panel detail-panel"><div className="page-head"><h2>Loại chứng chỉ</h2>{props.actor.role === "admin" && <button className="button primary" onClick={() => startTypeEdit(null)}>Thêm loại chứng chỉ</button>}</div>{props.actor.role === "admin" && <label className="check-field"><input type="checkbox" checked={includeHidden} onChange={(event) => setIncludeHidden(event.target.checked)} /> Hiện loại đã ẩn</label>}<div className="table-scroll"><table><thead><tr><th>Tên tiếng Việt</th><th>Tên tiếng Anh trên phiếu</th><th>Chức danh bắt buộc</th><th>Thứ tự</th><th>Nhãn</th><th>Tình trạng</th><th>Thao tác</th></tr></thead><tbody>{types.map((type) => <tr key={type.id}><td>{type.name}</td><td>{type.englishName ?? "—"}</td><td>{type.requiredForPositions.length ? type.requiredForPositions.map((position) => <span className="pill" key={position}>{position}</span>) : "Không bắt buộc"}</td><td>{type.sortOrder}</td><td>{type.system ? "Loại hệ thống" : "Tự thêm"}</td><td>{type.archived ? "Đã ẩn" : "Đang dùng"}</td><td>{props.actor.role === "admin" && <><button className="button" onClick={() => startTypeEdit(type)}>Sửa</button>{!type.archived && <><button className="button" aria-label={`Chuyển ${type.name} lên`} onClick={() => void moveType(type, -1)}>↑</button><button className="button" aria-label={`Chuyển ${type.name} xuống`} onClick={() => void moveType(type, 1)}>↓</button>{!type.system && <button className="button danger" onClick={() => void hideType(type)}>Ẩn</button>}</>}</>}</td></tr>)}</tbody></table></div>{typeFormOpen && props.actor.role === "admin" ? <div className="type-edit-form"><label className="field"><span>Tên tiếng Việt</span><input value={typeForm.name} onChange={(event) => setTypeForm({ ...typeForm, name: event.target.value })} /></label><label className="field"><span>Tên tiếng Anh trên phiếu (không bắt buộc)</span><input value={typeForm.englishName} onChange={(event) => setTypeForm({ ...typeForm, englishName: event.target.value })} /></label><fieldset><legend>Chức danh bắt buộc</legend>{POSITIONS.map((position) => <label className="check-field" key={position}><input type="checkbox" checked={typeForm.requiredForPositions.includes(position)} onChange={(event) => setTypeForm({ ...typeForm, requiredForPositions: event.target.checked ? [...typeForm.requiredForPositions, position] : typeForm.requiredForPositions.filter((item) => item !== position) })} />{position}</label>)}</fieldset><button className="button primary" onClick={() => void saveType()}>Lưu loại chứng chỉ</button><button className="button" onClick={() => { startTypeEdit(null); setTypeFormOpen(false); }}>Hủy</button></div> : null}</section>}
    {section === "signatures" && <section className="panel detail-panel"><div className="page-head"><h2>Thư viện chữ ký</h2>{props.actor.role === "admin" && <button className="button primary" onClick={props.onAddSignature}>Thêm chữ ký</button>}</div><div className="signature-grid">{signatures.map((signature) => <div className="panel signature-card checkerboard" key={signature.id}>{signatureUrls[signature.id] ? <Image className="signature-image" src={signatureUrls[signature.id] ?? ""} width={300} height={110} unoptimized alt={`Chữ ký của ${signature.name}`} /> : <div className="signature-sample">Chưa có ảnh trong phiên này</div>}<b>{signature.name}</b><span>{signature.role}</span>{signature.isDefault && <span className="pill ok">Mặc định</span>}{props.actor.role === "admin" && <div className="button-row">{!signature.isDefault && <button className="button" onClick={async () => { const result = await props.app.signatures.setDefault(props.actor, signature.id); if (!result.ok) props.setNotice(issueText(result.errors[0]?.code ?? "SIGNATURE_NOT_FOUND")); await refreshSignatures(); }}>Đặt mặc định</button>}<button className="button danger" onClick={async () => { const result = await props.app.signatures.remove(props.actor, signature.id); props.setNotice(result.ok ? "Đã xóa chữ ký." : issueText(result.errors[0]?.code ?? "SIGNATURE_LAST")); await refreshSignatures(); }}>Xóa</button></div>}</div>)}</div></section>}
    {section === "commanders" && <section className="panel detail-panel"><div className="page-head"><h2>Chỉ huy trưởng công trường</h2>{props.actor.role === "admin" && <button className="button primary" onClick={() => { setEditingCmd(null); setCmdForm({ name: "", role: "Chỉ huy trưởng công trường", phone: "", address: "" }); setCmdError(""); setCmdFormOpen(true); }}>Thêm chỉ huy trưởng</button>}</div>{props.actor.role === "admin" && <label className="check-field"><input type="checkbox" checked={cmdIncludeHidden} onChange={(e) => setCmdIncludeHidden(e.target.checked)} /> Hiện chỉ huy đã ẩn</label>}<div className="table-scroll"><table><thead><tr><th>Họ và tên</th><th>Chức vụ</th><th>Điện thoại</th><th>Địa chỉ</th><th>Tình trạng</th><th>Thao tác</th></tr></thead><tbody>{cmdList.map((cmd) => <tr key={cmd.id}><td>{cmd.name}</td><td>{cmd.role}</td><td>{cmd.phone}</td><td>{cmd.address}</td><td>{cmd.archived ? <span className="pill bad">Đã ẩn</span> : <span className="pill ok">Đang dùng</span>}</td><td>{props.actor.role === "admin" && !cmd.archived && <><button className="button" onClick={() => { setEditingCmd(cmd); setCmdForm({ name: cmd.name, role: cmd.role, phone: cmd.phone, address: cmd.address }); setCmdError(""); setCmdFormOpen(true); }}>Sửa</button><button className="button danger" onClick={() => void archiveCommander(cmd)}>Ẩn</button></>}</td></tr>)}</tbody></table></div>{cmdFormOpen && props.actor.role === "admin" && <div className="type-edit-form"><label className="field"><span>Họ và tên</span><input value={cmdForm.name} onChange={(e) => setCmdForm({ ...cmdForm, name: e.target.value })} /></label><label className="field"><span>Chức vụ</span><input value={cmdForm.role} onChange={(e) => setCmdForm({ ...cmdForm, role: e.target.value })} /></label><label className="field"><span>Số điện thoại</span><input value={cmdForm.phone} onChange={(e) => setCmdForm({ ...cmdForm, phone: e.target.value })} /></label><label className="field"><span>Địa chỉ</span><input value={cmdForm.address} onChange={(e) => setCmdForm({ ...cmdForm, address: e.target.value })} /></label>{cmdError && <p className="form-error">{cmdError}</p>}<button className="button primary" onClick={() => void saveCommander()}>Lưu chỉ huy trưởng</button><button className="button" onClick={() => { setCmdFormOpen(false); setEditingCmd(null); }}>Hủy</button></div>}</section>}
    {section === "emails" && <section className="panel detail-panel"><h2>Địa chỉ nhận nhắc hạn</h2><div className="email-entry"><input aria-label="Địa chỉ email mới" value={emailDraft} disabled={props.actor.role !== "admin"} onChange={(event) => setEmailDraft(event.target.value)} /><button className="button" onClick={addEmail} disabled={props.actor.role !== "admin"}>Thêm địa chỉ</button></div>{emailError && <small className="form-error">{emailError}</small>}{emails.map((email) => <div className="email-entry" key={email}><span>{email}</span>{props.actor.role === "admin" && <button className="button" onClick={() => setEmails((current) => current.filter((item) => item !== email))}>Xóa</button>}</div>)}<p className="muted">Nhắc trước 30 ngày</p><details><summary>Xem trước email nhắc hạn</summary>{sample ? <><h3>{sample.subject}</h3><pre>{sample.text}</pre></> : <p>Chưa có chứng chỉ nhắc hạn để tạo email mẫu.</p>}</details>{props.actor.role === "admin" && <button className="button primary" onClick={() => void saveSettings()}>Lưu cài đặt</button>}</section>}
  </>;
}
