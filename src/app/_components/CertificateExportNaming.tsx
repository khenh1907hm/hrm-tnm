import { useState } from "react";
import { certificateFileBaseName, certificateRootFolderName, certificateTypeLabel, DEFAULT_CERTIFICATE_FILE_PATTERN, DEFAULT_CERTIFICATE_FOLDER_PATTERN, DEFAULT_EMPLOYEE_FOLDER_PATTERN, employeeFolderName } from "../../modules/excel-template/certificateExportNames";
import { applyFileNamePattern, CERTIFICATE_FILE_TOKENS, CERTIFICATE_FOLDER_TOKENS, FILE_NAME_TOKENS } from "../../modules/excel-template/fileNamePattern";
import { certificateGroups, certificateUnits, DEFAULT_CERTIFICATE_GROUPS } from "../../modules/excel-template/certificateGroups";
import type { CertificateExportConfig, CertificateExportGroup } from "../../modules/excel-template/types";

type Person = { code: string; name: string; position?: string };

const SAMPLE: Person = { code: "TNM0001", name: "Nguyễn Văn A", position: "Nhân viên hiện trường" };
/** Các kiểu tên thư mục từng nhân sự hay dùng, chọn nhanh trong danh sách (ví dụ theo người đang chọn). */
const EMPLOYEE_FOLDER_PATTERNS = [
  DEFAULT_EMPLOYEE_FOLDER_PATTERN,
  "{tên nhân viên} - {mã nhân viên}",
  "{tên nhân viên}",
  "{mã nhân viên}",
  "{mã nhân viên} - {tên nhân viên} - {chức vụ}",
  "{tên nhân viên} - {chức vụ}",
];
const CUSTOM = "__custom";
const append = (current: string | undefined, token: string) => current?.trim() ? `${current.trimEnd()} ${token}` : token;

/**
 * Xuất riêng chứng chỉ: gộp 1 PDF mỗi nhân sự (mặc định) hoặc từng tệp; quy tắc tên thư mục tổng, tên tệp từng chứng chỉ
 * và tên gọi từng loại (vd CCCD → ID).
 * Dùng ở FORM Báo cáo (lưu vào mẫu) và ở hộp thoại xuất (sửa cho lần xuất đó).
 */
export function CertificateExportNaming(props: {
  value: CertificateExportConfig | undefined;
  onChange: (value: CertificateExportConfig) => void;
  /** Loại chứng chỉ theo thứ tự đánh số. */
  typeKeys: readonly string[];
  typeNames: Readonly<Record<string, string>>;
  fileNamePattern: string | undefined;
  /** Có thì cho sửa luôn tên thư mục từng nhân sự (chính là quy tắc đặt tên tệp của mẫu). */
  onFileNamePatternChange?: ((pattern: string) => void) | undefined;
  templateName: string;
  exportDate: string;
  person?: Person | undefined;
  count?: number;
}) {
  const value = props.value ?? {};
  const folderPattern = props.fileNamePattern?.trim() ?? "";
  const [customFolder, setCustomFolder] = useState(() => Boolean(folderPattern) && !EMPLOYEE_FOLDER_PATTERNS.includes(folderPattern));
  const showFolderInput = customFolder || (Boolean(folderPattern) && !EMPLOYEE_FOLDER_PATTERNS.includes(folderPattern));
  const person = props.person ?? SAMPLE;
  const set = (patch: Partial<CertificateExportConfig>) => props.onChange({ ...value, ...patch });
  const setLabel = (key: string, label: string) => {
    const typeLabels = { ...value.typeLabels };
    if (label.trim()) typeLabels[key] = label; else delete typeLabels[key];
    set({ typeLabels });
  };
  const root = certificateRootFolderName(value, { templateName: props.templateName, count: props.count ?? 1, exportDate: props.exportDate });
  const folder = employeeFolderName(props.fileNamePattern, person, props.exportDate);
  const exampleUnits = certificateUnits(props.typeKeys, (key) => key, (key) => key, certificateGroups(value)).slice(0, 5);
  const examples = exampleUnits.map((unit, index) => certificateFileBaseName(value, { index: index + 1, typeLabel: unit.group?.name.trim() || certificateTypeLabel(value, unit.items[0]!, props.typeNames), title: "", expiryDate: null }, person, props.exportDate));
  const fileExtra = { stt: "", "loai chung chi": "", "ten chung chi": "", "ngay het han": "" };
  const unknown = [
    ...applyFileNamePattern(value.folderPattern ?? "", null, props.exportDate, { "ten mau": "", "so nguoi": "" }).unknownTokens,
    ...applyFileNamePattern(props.onFileNamePatternChange ? props.fileNamePattern ?? "" : "", person, props.exportDate).unknownTokens,
    ...applyFileNamePattern(value.filePattern ?? "", person, props.exportDate, fileExtra).unknownTokens,
  ];

  const merged = value.layout === "merged";
  const groups = value.groups ?? [...DEFAULT_CERTIFICATE_GROUPS];
  const setGroups = (next: CertificateExportGroup[]) => set({ groups: next });
  const groupTypeKeys = Object.keys(props.typeNames).length ? Object.keys(props.typeNames) : [...props.typeKeys];
  const toggleGroupType = (groupIndex: number, key: string, checked: boolean) => setGroups(groups.map((group, index) => index === groupIndex
    ? { ...group, types: checked ? [...group.types.filter((type) => type !== key), key] : group.types.filter((type) => type !== key) }
    // Một loại chỉ ở một nhóm: thêm vào nhóm này thì bỏ khỏi nhóm khác
    : checked ? { ...group, types: group.types.filter((type) => type !== key) } : group));

  return (
    <div className="certificate-naming">
      <fieldset className="certificate-layout">
        <legend>Cách tải</legend>
        <label className="check-field"><input type="radio" name="certificate-layout" checked={!merged} onChange={() => set({ layout: "separate" })} /> <span><b>Từng tệp</b>, đánh số 1, 2, 3… (nén .zip); các loại cùng nhóm bên dưới gộp chung 1 tệp PDF</span></label>
        <label className="check-field"><input type="radio" name="certificate-layout" checked={merged} onChange={() => set({ layout: "merged" })} /> <span>Gộp <b>tất cả</b> thành 1 tệp PDF cho mỗi nhân sự</span></label>
      </fieldset>

      <label className="field">
        <span>Tên thư mục tổng (tên tệp .zip{merged ? " khi xuất nhiều người" : ""})</span>
        <input type="text" maxLength={150} value={value.folderPattern ?? ""} placeholder={DEFAULT_CERTIFICATE_FOLDER_PATTERN} onChange={(event) => set({ folderPattern: event.target.value })} />
      </label>
      <div className="file-name-tokens">
        <span className="muted">Chèn:</span>
        {CERTIFICATE_FOLDER_TOKENS.map((item) => <button type="button" className="pill" key={item.token} title={item.label} onClick={() => set({ folderPattern: append(value.folderPattern, item.token) })}>{item.token}</button>)}
      </div>

      {props.onFileNamePatternChange && <>
        <label className="field">
          <span>{merged ? "Tên tệp PDF của từng nhân sự" : "Tên thư mục từng nhân sự"} <small>(cũng là quy tắc đặt tên tệp hồ sơ)</small></span>
          <select value={showFolderInput ? CUSTOM : folderPattern || DEFAULT_EMPLOYEE_FOLDER_PATTERN} onChange={(event) => {
            if (event.target.value === CUSTOM) { setCustomFolder(true); return; }
            setCustomFolder(false);
            props.onFileNamePatternChange!(event.target.value === DEFAULT_EMPLOYEE_FOLDER_PATTERN ? "" : event.target.value);
          }}>
            {EMPLOYEE_FOLDER_PATTERNS.map((pattern) => <option key={pattern} value={pattern}>{employeeFolderName(pattern, person, props.exportDate)}</option>)}
            <option value={CUSTOM}>Tự đặt (thêm chữ riêng, vd “Vinci - …”)…</option>
          </select>
        </label>
        {showFolderInput && <>
          <input type="text" maxLength={150} aria-label="Tên thư mục từng nhân sự (tự đặt)" value={props.fileNamePattern ?? ""} placeholder={`Vinci - ${DEFAULT_EMPLOYEE_FOLDER_PATTERN}`} onChange={(event) => props.onFileNamePatternChange!(event.target.value)} />
          <div className="file-name-tokens">
            <span className="muted">Chèn:</span>
            {FILE_NAME_TOKENS.map((item) => <button type="button" className="pill" key={item.token} title={item.label} onClick={() => props.onFileNamePatternChange!(append(props.fileNamePattern, item.token))}>{item.token}</button>)}
          </div>
          <p className="muted file-name-example">Ví dụ: <b>{folder}</b></p>
        </>}
      </>}

      {!merged && (
        <div className="certificate-groups">
          <b>Nhóm gộp chung 1 tệp</b> <small className="muted">(vd An toàn = làm việc trên cao + an toàn điện + an toàn lao động; khi xuất hiện thành một dòng, mở ra chọn từng cái)</small>
          {groups.map((group, groupIndex) => (
            <div className="certificate-group" key={group.id}>
              <div className="certificate-group-head">
                <input type="text" maxLength={60} aria-label="Tên nhóm (tên tệp)" value={group.name} placeholder="Tên nhóm, vd An toàn" onChange={(event) => setGroups(groups.map((item, index) => index === groupIndex ? { ...item, name: event.target.value } : item))} />
                <button type="button" className="button danger" onClick={() => setGroups(groups.filter((_, index) => index !== groupIndex))}>Bỏ nhóm</button>
              </div>
              <div className="certificate-group-types">
                {groupTypeKeys.map((key) => (
                  <label className="check-field" key={key}><input type="checkbox" checked={group.types.includes(key)} onChange={(event) => toggleGroupType(groupIndex, key, event.target.checked)} /> {props.typeNames[key] ?? key}</label>
                ))}
              </div>
            </div>
          ))}
          <button type="button" className="button" onClick={() => setGroups([...groups, { id: `g-${Date.now().toString(36)}`, name: "", types: [] }])}>+ Thêm nhóm</button>
        </div>
      )}

      {!merged && <>
      <label className="field">
        <span>Tên tệp từng chứng chỉ</span>
        <input type="text" maxLength={150} value={value.filePattern ?? ""} placeholder={DEFAULT_CERTIFICATE_FILE_PATTERN} onChange={(event) => set({ filePattern: event.target.value })} />
      </label>
      <div className="file-name-tokens">
        <span className="muted">Chèn:</span>
        {[...CERTIFICATE_FILE_TOKENS, ...FILE_NAME_TOKENS].map((item) => <button type="button" className="pill" key={item.token} title={item.label} onClick={() => set({ filePattern: append(value.filePattern, item.token) })}>{item.token}</button>)}
      </div>
      </>}
      {unknown.length > 0 && <p className="form-error">Không nhận ra: {unknown.join(", ")}. Dùng các biến ở trên.</p>}

      {!merged && props.typeKeys.length > 0 && (
        <table className="profile-table certificate-labels">
          <thead><tr><th>Loại chứng chỉ</th><th>Tên gọi khi xuất <small>(trống = giữ tên loại)</small></th></tr></thead>
          <tbody>
            {props.typeKeys.map((key) => (
              <tr key={key}>
                <td>{props.typeNames[key] ?? key}</td>
                <td><input type="text" maxLength={60} aria-label={`Tên gọi khi xuất của ${props.typeNames[key] ?? key}`} value={value.typeLabels?.[key] ?? ""} placeholder={props.typeNames[key] ?? key} onChange={(event) => setLabel(key, event.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="certificate-naming-example muted">
        <span>Ví dụ:</span>
        {merged ? <>
          <code>{folder}.pdf</code>
          <span className="muted">Xuất nhiều người: {root}.zip → mỗi người một tệp PDF như trên.</span>
        </> : <>
          <code>{root}.zip</code>
          <code className="indent-1">{root}/</code>
          <code className="indent-2">{folder}/</code>
          {examples.map((name) => <code className="indent-3" key={name}>{name}.pdf</code>)}
        </>}
      </div>
    </div>
  );
}
