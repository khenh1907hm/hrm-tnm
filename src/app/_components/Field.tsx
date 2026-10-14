export function Field(props: { label: string; name: string; value: string; error: string | undefined; type?: string; fromOcr?: boolean; onChange: (value: string) => void }) {
  return <label className={props.fromOcr ? "field ocr-filled" : "field"}><span>{props.label}</span>{props.fromOcr && <small>Tự điền từ ảnh, hãy kiểm tra</small>}<input name={props.name} type={props.type ?? "text"} value={props.value} onChange={(event) => props.onChange(event.target.value)} />{props.error && <small>{props.error}</small>}</label>;
}
