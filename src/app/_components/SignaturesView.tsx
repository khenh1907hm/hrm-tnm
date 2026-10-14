import type { Actor } from "../../modules/auth/permissions";
import { issueText, type App, type SetNotice, type SignatureRow } from "./shared";

export function SignaturesView(props: { app: App; actor: Actor; signatureRows: SignatureRow[]; onSignatureRowsChange: (rows: SignatureRow[]) => void; onAdd: () => void; setNotice: SetNotice }) {
  const { app, actor, signatureRows } = props;
  const setDefault = async (signature: SignatureRow) => {
    const result = await app.signatures.setDefault(actor, signature.id);
    props.setNotice(result.ok ? "Đã đổi chữ ký mặc định." : issueText(result.errors[0]?.code ?? "SIGNATURE_NOT_FOUND"));
    const updated = await app.signatures.list(actor);
    if (updated.ok) props.onSignatureRowsChange(updated.value);
  };
  return <>
    <div className="page-head"><div><h1>Thư viện chữ ký</h1><p>Quản lý người ký phiếu thông tin</p></div>{actor.role === "admin" && <button className="button primary" onClick={props.onAdd}>＋ Thêm chữ ký</button>}</div>
    <div className="signature-grid">{signatureRows.map((signature) => <div className="panel signature-card" key={signature.id}><b>{signature.name}</b><span>{signature.role}</span><span className={signature.isDefault ? "pill ok" : "pill none"}>{signature.isDefault ? "Mặc định" : "Chưa đặt mặc định"}</span>{actor.role === "admin" && !signature.isDefault && <button className="button" onClick={() => void setDefault(signature)}>Đặt mặc định</button>}</div>)}{!signatureRows.length && <div className="panel empty">Chưa có chữ ký mẫu.</div>}</div>
  </>;
}
