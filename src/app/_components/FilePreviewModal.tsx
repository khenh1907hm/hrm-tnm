import { useState } from "react";
import Image from "next/image";

export type PreviewFile = { name: string; mime: string; url: string };

export function FilePreviewModal(props: { file: PreviewFile; onClose: () => void }) {
  const { file } = props;
  const [zoomed, setZoomed] = useState(false);
  return <div className="modal-backdrop preview-backdrop" role="presentation"><section className="modal-card file-preview" role="dialog" aria-modal="true" aria-label={`Xem ${file.name}`}><header><h2>{file.name}</h2><div><button type="button" className="button" onClick={() => setZoomed((value) => !value)}>{zoomed ? "Thu nhỏ ảnh" : "Phóng to ảnh"}</button><button type="button" className="close" onClick={props.onClose}>×</button></div></header>{file.mime === "application/pdf" ? <iframe title={`Tệp PDF ${file.name}`} src={file.url} /> : <Image className={zoomed ? "preview-image zoomed" : "preview-image"} src={file.url} width={1280} height={900} unoptimized alt={file.name} />}</section></div>;
}
