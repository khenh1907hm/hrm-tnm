import { useEffect, useMemo, useState } from "react";
import { FileArchive, FolderPlus, GripVertical, Trash2, X } from "lucide-react";
import { systemClock, todayVN } from "../../lib/clock";
import type { Actor } from "../../modules/auth/permissions";
import type { Certificate } from "../../modules/certificates/types";
import { formatExpiry } from "../../modules/certificates/status";
import type { Employee } from "../../modules/employees/types";
import { certificateFileBaseName, certificateGroupFolderName, certificateRootFolderName, certificateTypeLabel, employeeFolderName, groupCertificateEntries } from "../../modules/excel-template/certificateExportNames";
import { certificateGroups, certificateUnits, type CertificateUnit } from "../../modules/excel-template/certificateGroups";
import type { CertificateFolderGroup } from "../../modules/excel-template/types";
import { DEFAULT_CERTIFICATE_FOLDER_PRESET, pickCertificatesForFolder, type CertificateFolderPreset } from "../../modules/excel-template/certificateFolderPresets";
import { getSupabaseClient } from "../../lib/supabase/client";
import { loadPresets, readLocalPresets, savePresets as persistPresets } from "./certificateFolderPresetStore";
import { CertificateExportNaming } from "./CertificateExportNaming";
import { downloadBlob, exportCertificateFiles, zipFiles, type ProfileBundleFile } from "./profileExport";
import type { App, SetNotice } from "./shared";
import { moveId, useDragReorder } from "./useDragReorder";

type PersonResult = { employee: Employee; warnings: string[]; error?: string };


/**
 * Tải thư mục chứng chỉ cho một hoặc nhiều nhân sự, không cần mẫu Excel:
 * <thư mục tổng>/<thư mục từng nhân sự>/1. ID.jpg, 2. HĐLĐ.pdf…
 */
export function CertificateFolderExportModal(props: { app: App; actor: Actor; employees: readonly Employee[]; sessionFiles: Readonly<Record<string, File>>; ensureFiles?: (certificates: readonly Certificate[], employee: Employee) => Promise<Readonly<Record<string, File>>>; setNotice: SetNotice; onClose: () => void }) {
  const { app, actor, employees, setNotice } = props;
  const exportDate = todayVN(systemClock);
  // Cấu hình dùng chung lưu trên máy chủ; trong lúc tải hiện tạm cấu hình của trình duyệt
  const [presets, setPresets] = useState<CertificateFolderPreset[]>(readLocalPresets);
  const [draft, setDraft] = useState<CertificateFolderPreset>(() => presets[0]!);
  useEffect(() => {
    let active = true;
    void loadPresets(getSupabaseClient()).then((loaded) => {
      if (!active) return;
      setPresets(loaded.presets);
      setDraft((current) => loaded.presets.find((item) => item.id === current.id) ?? loaded.presets[0]!);
      if (loaded.warning) setNotice(loaded.warning);
    });
    return () => { active = false; };
  }, [setNotice]);
  const [types, setTypes] = useState<{ key: string; name: string }[]>([]);
  const [typeNames, setTypeNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<PersonResult[] | null>(null);
  /** Một nhân sự: xem trước danh sách tệp sẽ có trong thư mục. */
  const [singleCertificates, setSingleCertificates] = useState<Certificate[] | null>(null);
  const single = employees.length === 1 ? employees[0]! : null;

  useEffect(() => {
    let active = true;
    void app.certificateTypes.list(actor).then((result) => { if (active && result.ok) setTypes(result.value.map((type) => ({ key: type.key, name: type.name }))); });
    void app.certificateTypes.list(actor, true).then((result) => { if (active && result.ok) setTypeNames(Object.fromEntries(result.value.map((type) => [type.key, type.name]))); });
    return () => { active = false; };
  }, [app, actor]);

  useEffect(() => {
    if (!single) return;
    let active = true;
    void app.certificates.listByEmployee(actor, single.id).then((result) => { if (active) setSingleCertificates(result.ok ? result.value : []); });
    return () => { active = false; };
  }, [app, actor, single]);

  const allKeys = useMemo(() => types.map((type) => type.key), [types]);
  // Không chọn loại nào = lấy mọi loại; danh sách hiện: loại đã chọn theo thứ tự đánh số, rồi các loại còn lại
  const checked = draft.typeKeys.length ? draft.typeKeys.filter((key) => allKeys.includes(key) || typeNames[key]) : allKeys;
  const listOrder = [...checked, ...allKeys.filter((key) => !checked.includes(key))];
  const setTypeKeys = (typeKeys: string[]) => { setDraft({ ...draft, typeKeys }); setResults(null); };
  const { order, draggingId, handleProps } = useDragReorder(listOrder, (next) => setTypeKeys(next.filter((key) => checked.includes(key))));
  const toggle = (key: string, on: boolean) => setTypeKeys(on ? order.filter((item) => item === key || checked.includes(item)) : checked.filter((item) => item !== key));

  // Thư mục con: gom nhiều loại vào một thư mục đánh số chung (vd "4. Safety certificate/1. An toàn điện.pdf")
  const groups = draft.naming.folders ?? [];
  const setGroups = (next: CertificateFolderGroup[]) => { setDraft({ ...draft, naming: { ...draft.naming, folders: next } }); setResults(null); };
  const addGroup = () => setGroups([...groups, { id: crypto.randomUUID(), name: `Thư mục ${groups.length + 1}`, typeKeys: [] }]);
  const renameGroup = (id: string, name: string) => setGroups(groups.map((group) => group.id === id ? { ...group, name } : group));
  const removeGroup = (id: string) => setGroups(groups.filter((group) => group.id !== id));
  const assignGroup = (key: string, groupId: string) => setGroups(groups.map((group) => ({ ...group, typeKeys: group.id === groupId ? [...group.typeKeys.filter((item) => item !== key), key] : group.typeKeys.filter((item) => item !== key) })));
  const groupIdOf = (key: string) => groups.find((group) => group.typeKeys.includes(key))?.id ?? "";
  /** Số thứ tự hiện cạnh từng loại: "4" khi đứng riêng, "4.2" khi nằm trong thư mục con thứ 4. */
  // Nhóm gộp 1 PDF (mặc định "An toàn") thành một đơn vị trước, rồi mới xếp vào thư mục con — giống lúc xuất thật
  const pdfGroups = certificateGroups(draft.naming);
  const layoutOf = <T,>(items: readonly T[], typeOf: (item: T) => string, idOf: (item: T) => string) => groupCertificateEntries(certificateUnits(items, typeOf, idOf, pdfGroups), (unit) => typeOf(unit.items[0]!), groups);
  const unitBaseName = <T,>(unit: CertificateUnit<T>, index: number, typeOf: (item: T) => string, person: { code: string; name: string; position?: string }, title = "", expiryDate: string | null = null) => {
    const typeLabel = unit.group?.name.trim() || certificateTypeLabel(draft.naming, typeOf(unit.items[0]!), typeNames);
    return certificateFileBaseName(draft.naming, { index, typeLabel, title: unit.group ? "" : title, expiryDate }, person, exportDate);
  };
  const layout = layoutOf(checked, (key) => key, (key) => key);
  /** Chọn số thứ tự: đưa loại tới vị trí của loại đang mang số đó. */
  const moveTo = (key: string, target: string) => setTypeKeys(moveId(checked, key, checked.indexOf(target)));
  const positionOf = new Map(layout.flatMap((entry, index) => entry.group
    ? entry.items.flatMap((unit, inner) => unit.items.map((key) => [key, `${index + 1}.${inner + 1}`] as const))
    : entry.items[0]!.items.map((key) => [key, String(index + 1)] as const)));
  const pdfGroupOf = (key: string) => pdfGroups.find((group) => group.types.includes(key));

  const choosePreset = (id: string) => { const next = presets.find((item) => item.id === id); if (next) { setDraft(next); setResults(null); } };
  /** Lưu cả danh sách lên máy chủ (dùng chung); lỗi thì vẫn giữ trên trình duyệt và báo lại. */
  const savePresets = async (next: CertificateFolderPreset[], current: CertificateFolderPreset, done?: string) => {
    setPresets(next); setDraft(current);
    const problem = await persistPresets(getSupabaseClient(), next);
    if (problem) setNotice(problem); else if (done) setNotice(done, "success");
  };
  const saveCurrent = () => {
    const name = draft.name.trim() || "Không tên";
    const current = { ...draft, name };
    void savePresets(presets.some((item) => item.id === draft.id) ? presets.map((item) => item.id === draft.id ? current : item) : [...presets, current], current, `Đã lưu cấu hình "${name}" cho mọi người dùng.`);
  };
  const saveAsNew = () => {
    const base = draft.name.trim() || "Cấu hình mới";
    const name = presets.some((item) => item.name === base) ? `${base} (bản sao)` : base;
    const current = { ...draft, id: crypto.randomUUID(), name };
    void savePresets([...presets, current], current, `Đã lưu cấu hình mới "${name}" cho mọi người dùng.`);
  };
  const removeCurrent = () => {
    const rest = presets.filter((item) => item.id !== draft.id);
    const next = rest.length ? rest : [DEFAULT_CERTIFICATE_FOLDER_PRESET];
    void savePresets(next, next[0]!);
  };

  const picked = singleCertificates ? pickCertificatesForFolder(singleCertificates, draft, exportDate, allKeys) : [];
  const run = async () => {
    setBusy(true); setProgress(0); setResults(null);
    try {
      const outcomes: PersonResult[] = [];
      const output: (ProfileBundleFile & { folder: string })[] = [];
      for (const [index, employee] of employees.entries()) {
        try {
          const certificates = single && singleCertificates ? singleCertificates : await app.certificates.listByEmployee(actor, employee.id).then((result) => result.ok ? result.value : []);
          const list = pickCertificatesForFolder(certificates, draft, exportDate, allKeys);
          const files = props.ensureFiles ? await props.ensureFiles(list, employee) : props.sessionFiles;
          const result = await exportCertificateFiles({ employee, certificates: list, certificateTypeNames: typeNames, sessionFiles: files, config: draft.naming, fileNamePattern: draft.employeeFolderPattern, exportDate });
          // Hai nhân sự trùng tên thư mục (vd quy tắc chỉ có tên) → thêm mã để không ghi đè lên nhau
          const folder = output.some((file) => file.folder === result.folder) ? `${result.folder} (${employee.code})` : result.folder;
          output.push(...result.files.map((file) => ({ ...file, folder })));
          outcomes.push(result.files.length ? { employee, warnings: result.warnings } : { employee, warnings: [], error: list.length ? result.warnings[0] ?? "Không có tệp chứng chỉ nào." : "Không có chứng chỉ nào thỏa cấu hình." });
        } catch (error) {
          outcomes.push({ employee, warnings: [], error: error instanceof Error ? error.message : "Không tạo được tệp chứng chỉ." });
        }
        setProgress(index + 1);
      }
      const done = outcomes.filter((item) => !item.error).length;
      const root = certificateRootFolderName(draft.naming, { templateName: draft.name, count: done, exportDate });
      if (output.length) downloadBlob(await zipFiles(output.map((file) => ({ ...file, folder: `${root}/${file.folder}` }))), `${root}.zip`);
      setResults(outcomes);
      const failed = outcomes.length - done;
      setNotice(failed ? `Đã tải chứng chỉ của ${done}/${employees.length} nhân sự, ${failed} người không có tệp.` : `Đã tải chứng chỉ của ${done} nhân sự.`, failed && !done ? "error" : undefined);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card batch-export" role="dialog" aria-modal="true" aria-labelledby="cert-folder-title">
        <header>
          <h2 id="cert-folder-title">Tải thư mục chứng chỉ · {single ? `${single.code} · ${single.name}` : `${employees.length} nhân sự`}</h2>
          <button type="button" className="close" aria-label="Đóng" onClick={props.onClose}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="batch-export-body">
          <p className="muted">Không cần mẫu Excel: mỗi chứng chỉ một tệp giữ nguyên bản gốc, đánh số theo thứ tự loại bên dưới; có tệp bổ sung thì gộp thành một PDF.</p>

          <section className="cert-folder-presets">
            <label className="field">
              <span>Cấu hình</span>
              <select value={presets.some((item) => item.id === draft.id) ? draft.id : ""} onChange={(event) => choosePreset(event.target.value)}>
                {!presets.some((item) => item.id === draft.id) && <option value="">{draft.name} (chưa lưu)</option>}
                {presets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Tên cấu hình <small>(dùng cho biến {"{tên mẫu}"})</small></span>
              <input type="text" maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <div className="button-row">
              <button type="button" className="button" onClick={saveCurrent}>Lưu cấu hình</button>
              <button type="button" className="button" onClick={saveAsNew}>Lưu thành cấu hình mới</button>
              {presets.some((item) => item.id === draft.id) && presets.length > 1 && <button type="button" className="button danger" onClick={removeCurrent}>Xóa</button>}
            </div>
          </section>

          <section>
            <h3>Loại chứng chỉ cần lấy <small className="muted">· chọn số thứ tự ở ô bên phải, hoặc kéo ⋮⋮</small></h3>
            {order.map((key) => {
              const on = checked.includes(key);
              const name = typeNames[key] ?? types.find((type) => type.key === key)?.name ?? key;
              return (
                <div className={key === draggingId ? "profile-export-cert-row dragging" : "profile-export-cert-row"} key={key} data-reorder-id={key}>
                  <button type="button" className="drag-handle" aria-label={`Kéo để đổi thứ tự ${name} (hoặc bấm ↑/↓)`} title="Kéo để đổi thứ tự" {...handleProps(key)}>
                    <GripVertical className="ico" size={16} aria-hidden="true" />
                  </button>
                  <label className="check-field profile-export-cert">
                    <input type="checkbox" checked={on} disabled={on && checked.length === 1} onChange={(event) => toggle(key, event.target.checked)} />
                    <span>{on && <b>{positionOf.get(key)}. </b>}{name}{on && draft.naming.typeLabels?.[key]?.trim() && <span className="muted"> → {draft.naming.typeLabels[key]}</span>}{on && pdfGroupOf(key) && <span className="pill">gộp 1 PDF: {pdfGroupOf(key)!.name.trim() || "Nhóm"}</span>}</span>
                  </label>
                  {on && checked.length > 1 && (
                    <select className="cert-position" aria-label={`Thứ tự của ${name}`} title="Số thứ tự" value={key} onChange={(event) => moveTo(key, event.target.value)}>
                      {checked.map((item) => <option key={item} value={item}>{positionOf.get(item)}</option>)}
                    </select>
                  )}
                  {on && groups.length > 0 && (
                    <select className="cert-folder-group-select" aria-label={`Thư mục con của ${name}`} value={groupIdOf(key)} onChange={(event) => assignGroup(key, event.target.value)}>
                      <option value="">Đứng riêng</option>
                      {groups.map((group) => <option key={group.id} value={group.id}>Trong: {group.name.trim() || "Thư mục"}</option>)}
                    </select>
                  )}
                </div>
              );
            })}
            <div className="cert-folder-groups">
              <h4>Thư mục con <small className="muted">· gom nhiều loại vào một thư mục, vd “Safety certificate” chứa An toàn điện, An toàn hàn cắt…</small></h4>
              {groups.map((group) => (
                <div className="cert-folder-group" key={group.id}>
                  <input type="text" maxLength={80} aria-label="Tên thư mục con" value={group.name} onChange={(event) => renameGroup(group.id, event.target.value)} />
                  <span className="muted">{group.typeKeys.filter((key) => checked.includes(key)).length} loại</span>
                  <button type="button" className="button ghost" aria-label={`Xóa thư mục con ${group.name}`} title="Xóa thư mục con (các loại bên trong trở lại đứng riêng)" onClick={() => removeGroup(group.id)}><Trash2 className="ico" size={16} aria-hidden="true" /></button>
                </div>
              ))}
              <button type="button" className="button" onClick={addGroup}><FolderPlus className="ico" size={16} aria-hidden="true" /> Thêm thư mục con</button>
              {groups.length > 0 && <p className="muted">Chọn “Trong: …” ở từng loại bên trên để đưa vào thư mục con. Thư mục con đứng ở vị trí loại đầu tiên của nó.</p>}
            </div>

            <label className="check-field"><input type="checkbox" checked={draft.validOnly} onChange={(event) => { setDraft({ ...draft, validOnly: event.target.checked }); setResults(null); }} /> Chỉ lấy chứng chỉ còn hạn vào ngày xuất</label>
          </section>

          <details className="file-name-rule certificate-naming-box" open>
            <summary>Tên thư mục và tệp</summary>
            <CertificateExportNaming key={draft.id} value={draft.naming} onChange={(naming) => setDraft({ ...draft, naming })} typeKeys={checked} typeNames={typeNames} fileNamePattern={draft.employeeFolderPattern} onFileNamePatternChange={(employeeFolderPattern) => setDraft({ ...draft, employeeFolderPattern })} templateName={draft.name} exportDate={exportDate} person={employees[0]} count={employees.length} />
          </details>

          {checked.length > 0 && (
            <section>
              <h3>Cấu trúc thư mục</h3>
              <div className="certificate-naming-example muted">
                <code className="indent-2">{employeeFolderName(draft.employeeFolderPattern, employees[0] ?? { code: "TNM0001", name: "Nguyễn Văn A" }, exportDate)}/</code>
                {layout.map((entry, index) => entry.group
                  ? [<code className="indent-3" key={entry.group.id}>{certificateGroupFolderName(index + 1, entry.group, exportDate)}/</code>,
                    ...entry.items.map((unit, inner) => <code className="indent-4" key={unit.id}>{unitBaseName(unit, inner + 1, (key) => key, employees[0] ?? { code: "", name: "" })}</code>)]
                  : <code className="indent-3" key={entry.items[0]!.id}>{unitBaseName(entry.items[0]!, index + 1, (key) => key, employees[0] ?? { code: "", name: "" })}</code>)}
              </div>
            </section>
          )}

          {single && singleCertificates && (
            <section>
              <h3>Sẽ có trong thư mục</h3>
              {picked.length ? (
                <ol className="cert-folder-preview">
                  {layoutOf(picked, (certificate) => certificate.type, (certificate) => certificate.id).map((entry, index) => {
                    const line = (unit: CertificateUnit<Certificate>, position: number) => {
                      const first = unit.items[0]!;
                      return <><b>{unitBaseName(unit, position, (certificate) => certificate.type, single, first.title, unit.group ? null : first.expiryDate)}</b>{unit.group
                        ? <span className="muted"> · gộp {unit.items.map((certificate) => typeNames[certificate.type] ?? certificate.type).join(" + ")}</span>
                        : <span className="muted"> · {first.expiryDate ? `Hết hạn ${formatExpiry(first.expiryDate)}` : "Không thời hạn"}</span>}</>;
                    };
                    return entry.group
                      ? <li key={entry.group.id}><b>{certificateGroupFolderName(index + 1, entry.group, exportDate)}/</b><ul>{entry.items.map((unit, inner) => <li key={unit.id}>{line(unit, inner + 1)}</li>)}</ul></li>
                      : <li key={entry.items[0]!.id}>{line(entry.items[0]!, index + 1)}</li>;
                  })}
                </ol>
              ) : <p className="muted">Nhân sự không có chứng chỉ nào thỏa cấu hình.</p>}
            </section>
          )}

          {results && results.some((item) => item.warnings.length || item.error) && (
            <details className="batch-warnings" open={employees.length === 1}>
              <summary>Chi tiết các mục cần kiểm tra</summary>
              {results.filter((item) => item.warnings.length || item.error).map((item) => (
                <div key={item.employee.id}>
                  <b>{item.employee.code} · {item.employee.name}</b>
                  <ul>{item.error ? <li>{item.error}</li> : item.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </div>
              ))}
            </details>
          )}
        </div>
        <footer>
          {busy && <span className="batch-progress" role="status">Đang tạo {progress}/{employees.length}…<progress max={employees.length} value={progress} /></span>}
          <button type="button" className="button" onClick={props.onClose}>Đóng</button>
          <button type="button" className="button primary" disabled={busy || !employees.length || (single !== null && singleCertificates !== null && !picked.length)} onClick={() => void run()}>
            <FileArchive className="ico" size={16} aria-hidden="true" />
            {busy ? "Đang tạo…" : "Tải thư mục chứng chỉ (.zip)"}
          </button>
        </footer>
      </section>
    </div>
  );
}
