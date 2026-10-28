import { certificateFileBaseName, certificateRootFolderName, certificateTypeLabel, DEFAULT_CERTIFICATE_FILE_PATTERN, DEFAULT_CERTIFICATE_FOLDER_PATTERN, DEFAULT_EMPLOYEE_FOLDER_PATTERN, employeeFolderName } from "../../modules/excel-template/certificateExportNames";
import { applyFileNamePattern, CERTIFICATE_FILE_TOKENS, CERTIFICATE_FOLDER_TOKENS, FILE_NAME_TOKENS } from "../../modules/excel-template/fileNamePattern";
import type { CertificateExportConfig } from "../../modules/excel-template/types";

type Person = { code: string; name: string; position?: string };

const SAMPLE: Person = { code: "TNM0001", name: "Nguyễn Văn A", position: "Nhân viên hiện trường" };
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
  const person = props.person ?? SAMPLE;
  const set = (patch: Partial<CertificateExportConfig>) => props.onChange({ ...value, ...patch });
  const setLabel = (key: string, label: string) => {
    const typeLabels = { ...value.typeLabels };
    if (label.trim()) typeLabels[key] = label; else delete typeLabels[key];
    set({ typeLabels });
  };
  const root = certificateRootFolderName(value, { templateName: props.templateName, count: props.count ?? 1, exportDate: props.exportDate });
  const folder = employeeFolderName(props.fileNamePattern, person, props.exportDate);
  const examples = props.typeKeys.slice(0, 4).map((key, index) => certificateFileBaseName(value, { index: index + 1, typeLabel: certificateTypeLabel(value, key, props.typeNames), title: "", expiryDate: null }, person, props.exportDate));
  const fileExtra = { stt: "", "loai chung chi": "", "ten chung chi": "", "ngay het han": "" };
  const unknown = [
    ...applyFileNamePattern(value.folderPattern ?? "", null, props.exportDate, { "ten mau": "", "so nguoi": "" }).unknownTokens,
    ...applyFileNamePattern(props.onFileNamePatternChange ? props.fileNamePattern ?? "" : "", person, props.exportDate).unknownTokens,
    ...applyFileNamePattern(value.filePattern ?? "", person, props.exportDate, fileExtra).unknownTokens,
  ];

  const merged = value.layout !== "separate";

  return (
    <div className="certificate-naming">
      <fieldset className="certificate-layout">
        <legend>Cách tải</legend>
        <label className="check-field"><input type="radio" name="certificate-layout" checked={merged} onChange={() => set({ layout: "merged" })} /> <span><b>Gộp thành 1 tệp PDF</b> cho mỗi nhân sự (điện, làm việc trên cao, HĐLĐ… nối tiếp nhau theo thứ tự)</span></label>
        <label className="check-field"><input type="radio" name="certificate-layout" checked={!merged} onChange={() => set({ layout: "separate" })} /> <span>Mỗi chứng chỉ một tệp riêng, đánh số 1, 2, 3… (nén .zip)</span></label>
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
          <input type="text" maxLength={150} value={props.fileNamePattern ?? ""} placeholder={DEFAULT_EMPLOYEE_FOLDER_PATTERN} onChange={(event) => props.onFileNamePatternChange!(event.target.value)} />
        </label>
        <div className="file-name-tokens">
          <span className="muted">Chèn:</span>
          {FILE_NAME_TOKENS.map((item) => <button type="button" className="pill" key={item.token} title={item.label} onClick={() => props.onFileNamePatternChange!(append(props.fileNamePattern, item.token))}>{item.token}</button>)}
        </div>
      </>}

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
