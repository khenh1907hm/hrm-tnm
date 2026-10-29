"use client";
// TẠM: trang nhập hồ sơ 3 nhân sự từ thư mục Ho-so trên máy. Xóa cả thư mục nhap-ho-so-tam sau khi nhập xong.
import { useState } from "react";
import { randomIds } from "../../lib/ids";
import type { FileRef } from "../../modules/certificates/types";
import { useBackend } from "../_components/useBackend";
import { IMPORT_EMPLOYEES, LABOR_TYPE, type ImportCert } from "./manifest";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const mimeOf = (name: string) => name.toLowerCase().endsWith(".pdf") ? "application/pdf" : name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";

export default function ImportHoSoPage() {
  const backend = useBackend();
  const [files, setFiles] = useState<Record<string, File>>({});
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const add = (line: string) => setLog((current) => [...current, line]);

  const needed = [...new Set(IMPORT_EMPLOYEES.flatMap((employee) => employee.certs.map((cert) => cert.file)))];
  const problems = needed.flatMap((path) => {
    const file = files[path];
    if (!file) return [`Thiếu tệp: ${path}`];
    return file.size > MAX_FILE_SIZE ? [`Tệp quá 10 MB: ${path}`] : [];
  });

  const pickFolder = (list: FileList | null) => {
    const picked: Record<string, File> = {};
    for (const file of Array.from(list ?? [])) picked[file.webkitRelativePath.split("/").slice(1).join("/")] = file;
    setFiles(picked);
  };

  const run = async () => {
    if (backend.status !== "ready" || !backend.fileStore) return;
    const { app, actor, fileStore } = backend;
    setBusy(true); setLog([]);
    try {
      const ids = randomIds();
      const types = await app.certificateTypes.list(actor, true);
      if (!types.ok) throw new Error(`Không đọc được loại chứng chỉ: ${types.errors[0]?.code}`);
      let laborKey = types.value.find((type) => type.name === LABOR_TYPE.name)?.key;
      if (!laborKey) {
        const created = await app.certificateTypes.create(actor, { name: LABOR_TYPE.name, englishName: LABOR_TYPE.englishName, requiredForPositions: [], noExpiry: true });
        if (!created.ok) throw new Error(`Không tạo được loại Hợp đồng lao động: ${created.errors[0]?.code}`);
        laborKey = created.value.key;
        add(`✓ Tạo loại chứng chỉ "${LABOR_TYPE.name}"`);
      }

      // Tệp dùng chung (hợp đồng bảo hiểm) chỉ tải lên một lần
      const uploaded = new Map<string, FileRef>();
      const upload = async (path: string): Promise<FileRef> => {
        const cached = uploaded.get(path);
        if (cached) return cached;
        const source = files[path]!;
        const name = path.split("/").pop()!;
        const ref: FileRef = { id: ids.next(), name, mime: mimeOf(name), size: source.size };
        await fileStore.put("certificates", ref.id, new File([source], name, { type: ref.mime }));
        uploaded.set(path, ref);
        return ref;
      };

      for (const { input, certs } of IMPORT_EMPLOYEES) {
        const existing = await app.employees.list(actor, { query: input.code, includeArchived: true, pageSize: 50 });
        let employee = existing.ok ? existing.value.items.find((item) => item.code === input.code) : undefined;
        if (employee) add(`• ${input.code} ${input.name}: đã có, chỉ thêm chứng chỉ còn thiếu`);
        else {
          const created = await app.employees.create(actor, input);
          if (!created.ok) { add(`✗ ${input.code} ${input.name}: không tạo được (${created.errors.map((item) => `${item.field ?? ""} ${item.code}`).join(", ")})`); continue; }
          employee = created.value;
          add(`✓ Tạo nhân sự ${input.code} ${input.name}`);
        }
        const current = await app.certificates.listByEmployee(actor, employee.id);
        for (const cert of certs) {
          const type = cert.type === "labor" ? laborKey : cert.type;
          const label = `${input.code} · ${cert.title || type} · ${cert.number}`;
          if (current.ok && current.value.some((item) => item.type === type && item.number === cert.number && item.state === "current")) { add(`• ${label}: đã có, bỏ qua`); continue; }
          const document = await upload(cert.file);
          const result = await app.certificates.add(actor, { employeeId: employee.id, ...toInput(cert, type), document, supplementaryFiles: [] });
          add(result.ok ? `✓ ${label}` : `✗ ${label}: ${result.errors.map((item) => `${item.field ?? ""} ${item.code}`).join(", ")}`);
        }
      }
      add("Xong.");
    } catch (error) {
      add(`✗ Dừng lại: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setBusy(false); }
  };

  if (backend.status !== "ready") return <main style={{ padding: 24 }}>Hãy đăng nhập bằng tài khoản Admin ở trang chính (/) rồi mở lại trang này.</main>;
  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto", fontSize: 14 }}>
      <h1>Nhập hồ sơ 3 nhân sự (trang tạm)</h1>
      <p>Đang đăng nhập: <b>{backend.email}</b> · chế độ <b>{backend.mode}</b> · vai trò <b>{backend.actor.role}</b></p>
      <p>1. Chọn thư mục <b>Downloads\Ho-so</b> (gồm “2026-1027 - Vinci”, “Bang cap”, “_bo-sung-nhap”):{" "}
        <input type="file" {...{ webkitdirectory: "", directory: "" }} multiple onChange={(event) => pickFolder(event.target.files)} />
      </p>
      <p>Đã chọn {Object.keys(files).length} tệp · cần {needed.length} tệp · {problems.length ? <span style={{ color: "crimson" }}>{problems.length} vấn đề</span> : <span style={{ color: "green" }}>đủ tệp</span>}</p>
      {problems.length > 0 && <ul style={{ color: "crimson" }}>{problems.map((item) => <li key={item}>{item}</li>)}</ul>}
      {IMPORT_EMPLOYEES.map(({ input, certs }) => (
        <section key={input.code} style={{ marginBottom: 16 }}>
          <h3>{input.code} · {input.name} · {input.dob} · CCCD {input.cccd} · {input.phone}</h3>
          <table style={{ borderCollapse: "collapse", width: "100%" }}><tbody>
            {certs.map((cert) => (
              <tr key={cert.file + cert.type} style={{ borderTop: "1px solid #ddd" }}>
                <td>{cert.type === "labor" ? LABOR_TYPE.name : cert.type}</td><td>{cert.title}</td><td>{cert.number}</td>
                <td>{cert.issueDate ?? "—"} → {cert.expiryDate ?? "không thời hạn"}</td>
                <td style={{ color: files[cert.file] ? "green" : "crimson" }}>{files[cert.file] ? "có tệp" : "thiếu tệp"}</td>
              </tr>
            ))}
          </tbody></table>
        </section>
      ))}
      <button type="button" className="button primary" disabled={busy || problems.length > 0 || backend.actor.role !== "admin"} onClick={() => void run()}>
        {busy ? "Đang nhập…" : "2. Nhập vào cơ sở dữ liệu"}
      </button>
      <pre style={{ background: "#f6f6f6", padding: 12, marginTop: 16, whiteSpace: "pre-wrap" }}>{log.join("\n")}</pre>
    </main>
  );
}

function toInput(cert: ImportCert, type: string) {
  return { type, title: cert.title, number: cert.number, issueDate: cert.issueDate, expiryDate: cert.expiryDate, ...(cert.expiryDate === null ? { noExpiry: true } : {}), ...(cert.safetyGroup ? { safetyGroup: cert.safetyGroup } : {}) };
}
