"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "../../lib/supabase/client";
import { formatFileSize, imagePathsInHtml, isZipFile, safeZipName, SKILL_BUCKET, SKILL_IMAGE_TYPES, SKILL_MAX_BYTES } from "../../modules/skills/files";

type SkillPost = {
  id: string;
  title: string;
  body_html: string;
  zip_path: string | null;
  zip_name: string | null;
  zip_size: number | null;
  created_at: string;
  updated_at: string;
};

type ZipState = { kind: "new"; file: File } | { kind: "keep"; path: string; name: string; size: number } | null;

const publicPrefix = () => `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/storage/v1/object/public/${SKILL_BUCKET}/`;
const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
const fmtDate = (iso: string) => new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/* ---------- Làm sạch HTML trước khi lưu và hiển thị ---------- */
const ALLOWED = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "S", "H2", "H3", "UL", "OL", "LI", "A", "IMG", "PRE", "CODE", "BLOCKQUOTE", "HR"]);
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "SVG", "MATH", "LINK", "META", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "VIDEO", "AUDIO", "CANVAS", "NOSCRIPT"]);

function sanitize(html: string): string {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild!;
  const prefix = publicPrefix();
  const rename = (el: Element, tag: string) => { const next = doc.createElement(tag); while (el.firstChild) next.appendChild(el.firstChild); el.replaceWith(next); return next; };
  const walk = (node: Element) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue; }
      let el = child as Element;
      if (DROP.has(el.tagName)) { el.remove(); continue; }
      if (el.tagName === "DIV") el = rename(el, "p");
      else if (el.tagName === "H1") el = rename(el, "h2");
      if (!ALLOWED.has(el.tagName)) { walk(el); el.replaceWith(...el.childNodes); continue; }
      const keep: Record<string, string> = {};
      if (el.tagName === "A") { const href = el.getAttribute("href") ?? ""; if (/^https?:\/\//i.test(href)) keep.href = href; }
      if (el.tagName === "IMG") {
        const src = el.getAttribute("src") ?? "";
        if (!prefix || !src.startsWith(prefix)) { el.remove(); continue; }
        keep.src = src; keep.alt = (el.getAttribute("alt") ?? "").slice(0, 200);
      }
      for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
      for (const [key, value] of Object.entries(keep)) el.setAttribute(key, value);
      if (el.tagName === "A") {
        if (!keep.href) { walk(el); el.replaceWith(...el.childNodes); continue; }
        el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer");
      }
      walk(el);
    }
  };
  walk(root);
  return root.innerHTML.trim();
}

const plainText = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/* ---------- Đăng nhập & vai trò ---------- */
function useAdmin(supabase: SupabaseClient | null) {
  const [state, setState] = useState<{ signedIn: boolean; admin: boolean }>({ signedIn: false, admin: false });
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) { if (active) setState({ signedIn: false, admin: false }); return; }
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (active) setState({ signedIn: true, admin: profile?.role === "admin" });
    };
    void check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { void check(); });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [supabase]);
  return state;
}

export default function SkillsClient() {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const { signedIn, admin } = useAdmin(supabase);
  const [posts, setPosts] = useState<SkillPost[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [composer, setComposer] = useState<{ editing: SkillPost | null } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [guideTab, setGuideTab] = useState<"web" | "code">("web");
  const guideRef = useRef<HTMLDetailsElement>(null);
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((value) => value + 1), []);

  // Trên điện thoại thu gọn hướng dẫn để danh sách skill hiện ngay màn hình đầu
  useEffect(() => { if (guideRef.current && window.matchMedia("(max-width: 860px)").matches) guideRef.current.open = false; }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void (async () => {
      const { data, error } = await supabase.from("skill_posts").select("*").order("created_at", { ascending: false }).limit(500);
      if (!active) return;
      if (error) { setLoadError("Không tải được danh sách skill. Thử tải lại trang."); return; }
      setLoadError(""); setPosts(data as SkillPost[]);
    })();
    return () => { active = false; };
  }, [supabase, version]);

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 3500); };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (posts ?? []).filter((post) => !q || `${post.title} ${plainText(post.body_html)} ${post.zip_name ?? ""}`.toLowerCase().includes(q));
  }, [posts, query]);

  const removePost = async (post: SkillPost) => {
    if (!supabase) return;
    const { error } = await supabase.from("skill_posts").delete().eq("id", post.id);
    if (error) { flash("Không xóa được skill. Kiểm tra quyền admin rồi thử lại."); return; }
    const paths = [...imagePathsInHtml(post.body_html, publicPrefix()), ...(post.zip_path ? [post.zip_path] : [])];
    if (paths.length) await supabase.storage.from(SKILL_BUCKET).remove(paths);
    setConfirmId(null); flash("Đã xóa skill."); await load();
  };

  const zipUrl = (post: SkillPost) => supabase && post.zip_path ? supabase.storage.from(SKILL_BUCKET).getPublicUrl(post.zip_path, { download: post.zip_name ?? true }).data.publicUrl : "";

  return (
    <div className="sk-wrap">
      <header className="sk-top">
        <div>
          <Link className="sk-back" href="/">← Quản lý nhân sự</Link>
          <h1>Kho Skill AI</h1>
          <p>Nơi lưu các gói skill (.zip) cho Claude, kèm ghi chú và ảnh minh họa cách dùng. Tải về rồi cài theo mục “Cách cài skill”.</p>
        </div>
        <span className="sk-count">{posts ? `${posts.length} skill` : ""}</span>
      </header>

      <div className="sk-layout">
        <main className="sk-feed">
          <div className="sk-feed-head">
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên hoặc nội dung skill" aria-label="Tìm skill" />
            {admin && !composer && <button type="button" className="sk-btn primary" onClick={() => setComposer({ editing: null })}>+ Đăng skill mới</button>}
          </div>
          {!admin && supabase && <p className="sk-hint">{signedIn ? "Tài khoản của bạn chỉ xem và tải được. Cần quyền admin để đăng skill." : <>Muốn đăng skill? <Link href="/">Đăng nhập tài khoản admin</Link> rồi quay lại trang này.</>}</p>}
          {notice && <div className="sk-notice" role="status">{notice}</div>}

          {composer && supabase && (
            <Composer
              key={composer.editing?.id ?? "new"}
              supabase={supabase}
              editing={composer.editing}
              onCancel={() => setComposer(null)}
              onSaved={async (message) => { setComposer(null); flash(message); await load(); }}
            />
          )}

          {!supabase ? (
            <div className="sk-empty"><b>Chưa cấu hình Supabase.</b><br />Thêm NEXT_PUBLIC_SUPABASE_URL và NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY để dùng kho skill.</div>
          ) : loadError ? (
            <div className="sk-empty">{loadError}</div>
          ) : posts === null ? (
            <div className="sk-empty">Đang tải…</div>
          ) : posts.length === 0 ? (
            <div className="sk-empty"><b>Chưa có skill nào.</b><br />{admin ? "Bấm “Đăng skill mới” để thêm gói .zip đầu tiên kèm mô tả và ảnh." : "Các skill được đăng sẽ hiện ở đây."}</div>
          ) : filtered.length === 0 ? (
            <div className="sk-empty">Không có skill nào khớp “{query}”.</div>
          ) : filtered.map((post) => (
            <article className="sk-post" key={post.id}>
              <div className="sk-post-head">
                <h2>{post.title}</h2>
                <span className="sk-meta">{fmtDate(post.created_at)}{post.updated_at !== post.created_at ? " · đã sửa" : ""}</span>
              </div>
              {post.zip_path && (
                <div className="sk-zipchip">
                  <span className="sk-zipicon">ZIP</span>
                  <span className="sk-zipname">{post.zip_name} · {formatFileSize(post.zip_size ?? 0)}</span>
                  <a className="sk-btn zip" href={zipUrl(post)} download={post.zip_name ?? undefined}>Tải .zip</a>
                </div>
              )}
              {post.body_html && <div className="sk-rich" dangerouslySetInnerHTML={{ __html: sanitize(post.body_html) }} />}
              {admin && (confirmId === post.id ? (
                <div className="sk-confirm">
                  <span>Xóa skill này và file đính kèm? Không hoàn tác được.</span>
                  <button type="button" className="sk-btn danger" onClick={() => void removePost(post)}>Xóa hẳn</button>
                  <button type="button" className="sk-btn ghost" onClick={() => setConfirmId(null)}>Giữ lại</button>
                </div>
              ) : (
                <div className="sk-post-actions">
                  <button type="button" className="sk-btn ghost" onClick={() => { setComposer({ editing: post }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Sửa</button>
                  <button type="button" className="sk-btn ghost" onClick={() => setConfirmId(post.id)}>Xóa</button>
                </div>
              ))}
            </article>
          ))}
        </main>

        <aside className="sk-guide" aria-labelledby="sk-guide-title">
          <details ref={guideRef} open>
            <summary><h2 id="sk-guide-title">Cách cài skill</h2><span aria-hidden="true" /></summary>
            <div className="sk-guide-body">
              <div className="sk-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={guideTab === "web"} onClick={() => setGuideTab("web")}>Claude.ai / App</button>
                <button type="button" role="tab" aria-selected={guideTab === "code"} onClick={() => setGuideTab("code")}>Claude Code</button>
              </div>
              {guideTab === "web" ? (
                <ol className="sk-steps" role="tabpanel">
                  <li>Bấm <b>Tải .zip</b> ở skill muốn dùng.</li>
                  <li>Mở Claude, vào <b>Settings → Capabilities</b> (Cài đặt → Khả năng), bật <b>Code execution</b> nếu chưa bật.</li>
                  <li>Ở mục <b>Skills</b>, bấm <b>Upload skill</b> và chọn file .zip vừa tải. Không cần giải nén.</li>
                  <li>Bật công tắc của skill. Từ đó Claude tự dùng khi câu hỏi khớp mô tả của skill.</li>
                </ol>
              ) : (
                <ol className="sk-steps" role="tabpanel">
                  <li>Tải .zip, giải nén để có thư mục chứa <code>SKILL.md</code>.</li>
                  <li>Chép thư mục đó vào <code>~/.claude/skills/</code> (dùng cho mọi dự án) hoặc <code>.claude/skills/</code> trong repo (chỉ dự án đó, commit để cả nhóm và phiên cloud cùng dùng).</li>
                  <li>Mở phiên Claude Code mới, gõ <code>/</code> để thấy skill trong danh sách.</li>
                </ol>
              )}
              <div className="sk-label">Cấu trúc một gói skill</div>
              <pre>{`ten-skill.zip
└─ ten-skill/
   ├─ SKILL.md      (bắt buộc)
   ├─ scripts/      (tùy chọn)
   └─ references/   (tùy chọn)`}</pre>
              <div className="sk-label">Đầu file SKILL.md</div>
              <pre>{`---
name: ten-skill
description: Làm gì và khi nào dùng
---
Hướng dẫn chi tiết cho Claude…`}</pre>
              <p>Chỉ cài skill từ nguồn bạn tin cậy: skill có thể chứa script chạy trên máy.</p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}

/** Nút thanh định dạng: không lấy focus khỏi khung soạn để giữ vùng chọn. */
function ToolButton(props: { label: ReactNode; title: string; onRun: () => void }) {
  return <button type="button" title={props.title} aria-label={props.title} onMouseDown={(event) => event.preventDefault()} onClick={props.onRun}>{props.label}</button>;
}

/* ---------- Trình soạn bài ---------- */
function Composer(props: { supabase: SupabaseClient; editing: SkillPost | null; onCancel: () => void; onSaved: (message: string) => Promise<void> }) {
  const { supabase, editing } = props;
  const editorRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<Range | null>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [zip, setZip] = useState<ZipState>(editing?.zip_path ? { kind: "keep", path: editing.zip_path, name: editing.zip_name ?? "skill.zip", size: editing.zip_size ?? 0 } : null);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = editing ? sanitize(editing.body_html) : "";
    try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* trình duyệt cũ */ }
  }, [editing]);

  const saveRange = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editorRef.current?.contains(selection.anchorNode)) rangeRef.current = selection.getRangeAt(0).cloneRange();
  };
  const restoreRange = () => {
    editorRef.current?.focus();
    if (rangeRef.current) { const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(rangeRef.current); }
  };
  const exec = (command: string, value?: string) => { restoreRange(); document.execCommand(command, false, value); saveRange(); };

  const insertImages = async (files: readonly File[]) => {
    const images = files.filter((file) => (SKILL_IMAGE_TYPES as readonly string[]).includes(file.type));
    for (const file of images) {
      if (file.size > SKILL_MAX_BYTES) { setStatus({ text: `Ảnh "${file.name}" lớn hơn 50 MB.`, error: true }); continue; }
      const temp = `up-${newId()}`;
      exec("insertHTML", `<img data-temp="${temp}" class="uploading" src="${URL.createObjectURL(file)}" alt=""><p><br></p>`);
      setPending((count) => count + 1); setStatus({ text: "Đang tải ảnh lên…" });
      const ext = file.type.split("/")[1]!.replace("jpeg", "jpg");
      const path = `images/${newId()}.${ext}`;
      const { error } = await supabase.storage.from(SKILL_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      const img = editorRef.current?.querySelector<HTMLImageElement>(`img[data-temp="${temp}"]`);
      if (error) { img?.remove(); setStatus({ text: "Không tải được ảnh lên. Kiểm tra quyền admin rồi thử lại.", error: true }); }
      else if (img) {
        URL.revokeObjectURL(img.src);
        img.src = supabase.storage.from(SKILL_BUCKET).getPublicUrl(path).data.publicUrl;
        img.alt = file.name.replace(/\.[^.]+$/, "");
        img.removeAttribute("data-temp"); img.classList.remove("uploading");
        setStatus({ text: "" });
      }
      setPending((count) => count - 1);
    }
  };

  const chooseZip = (file: File | undefined) => {
    if (!file) return;
    if (!isZipFile(file)) { setStatus({ text: "Chỉ nhận file .zip.", error: true }); return; }
    if (file.size > SKILL_MAX_BYTES) { setStatus({ text: "File .zip lớn hơn 50 MB, kho không nhận được.", error: true }); return; }
    setZip({ kind: "new", file }); setStatus({ text: "" });
  };

  const applyLink = () => {
    setLinkOpen(false);
    const url = linkUrl.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) { restoreRange(); setStatus({ text: "Liên kết phải bắt đầu bằng http:// hoặc https://", error: true }); return; }
    restoreRange();
    if (window.getSelection()?.isCollapsed) exec("insertHTML", `<a href="${url.replace(/"/g, "&quot;")}">${url.replace(/</g, "&lt;")}</a>`);
    else exec("createLink", url);
  };

  const save = async () => {
    if (busy) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) { setStatus({ text: "Nhập tên skill trước khi đăng.", error: true }); return; }
    if (pending) { setStatus({ text: "Chờ ảnh tải lên xong rồi bấm lại.", error: true }); return; }
    const html = sanitize(editorRef.current?.innerHTML ?? "");
    if (!zip && !plainText(html) && !html.includes("<img")) { setStatus({ text: "Thêm file .zip hoặc nội dung mô tả.", error: true }); return; }
    setBusy(true);
    try {
      const id = editing?.id ?? newId();
      let zipFields = { zip_path: null as string | null, zip_name: null as string | null, zip_size: null as number | null };
      if (zip?.kind === "keep") zipFields = { zip_path: zip.path, zip_name: zip.name, zip_size: zip.size };
      if (zip?.kind === "new") {
        setStatus({ text: "Đang tải .zip lên…" });
        const path = `zips/${id}/${newId().slice(0, 8)}-${safeZipName(zip.file.name)}`;
        const { error } = await supabase.storage.from(SKILL_BUCKET).upload(path, zip.file, { contentType: "application/zip", upsert: false });
        if (error) throw new Error("Không tải được file .zip lên. Kiểm tra quyền admin rồi thử lại.");
        zipFields = { zip_path: path, zip_name: zip.file.name, zip_size: zip.file.size };
      }
      setStatus({ text: "Đang lưu…" });
      const now = new Date().toISOString();
      const row = { title: cleanTitle, body_html: html, ...zipFields, updated_at: now };
      const { error } = editing
        ? await supabase.from("skill_posts").update(row).eq("id", id)
        : await supabase.from("skill_posts").insert({ id, ...row, created_at: now });
      if (error) throw new Error("Không lưu được skill. Kiểm tra quyền admin rồi thử lại.");
      if (editing?.zip_path && editing.zip_path !== zipFields.zip_path) await supabase.storage.from(SKILL_BUCKET).remove([editing.zip_path]);
      await props.onSaved(editing ? "Đã lưu thay đổi." : "Đã đăng skill.");
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : "Có lỗi xảy ra. Thử lại sau.", error: true });
    } finally { setBusy(false); }
  };


  return (
    <section className="sk-composer" aria-label={editing ? "Sửa skill" : "Đăng skill mới"}>
      <h2>{editing ? "Sửa skill" : "Đăng skill mới"}</h2>
      <label className="sk-field"><span>Tên skill</span>
        <input type="text" value={title} maxLength={140} onChange={(event) => setTitle(event.target.value)} placeholder="Ví dụ: Xuất hồ sơ nhân sự TNM" autoFocus />
      </label>
      <div className="sk-field">
        <span>Mô tả, cách dùng (chữ và ảnh)</span>
        <div>
          <div className="sk-toolbar" role="toolbar" aria-label="Định dạng">
            <ToolButton label={<b>B</b>} title="Đậm" onRun={() => exec("bold")} />
            <ToolButton label={<i>I</i>} title="Nghiêng" onRun={() => exec("italic")} />
            <ToolButton label={<u>U</u>} title="Gạch chân" onRun={() => exec("underline")} />
            <span className="sk-sep" />
            <ToolButton label={"H2"} title="Tiêu đề lớn" onRun={() => exec("formatBlock", "h2")} />
            <ToolButton label={"H3"} title="Tiêu đề nhỏ" onRun={() => exec("formatBlock", "h3")} />
            <ToolButton label={"¶"} title="Đoạn văn thường" onRun={() => exec("formatBlock", "p")} />
            <span className="sk-sep" />
            <ToolButton label={"• —"} title="Danh sách chấm" onRun={() => exec("insertUnorderedList")} />
            <ToolButton label={"1."} title="Danh sách số" onRun={() => exec("insertOrderedList")} />
            <ToolButton label={"❝"} title="Trích dẫn" onRun={() => exec("formatBlock", "blockquote")} />
            <ToolButton label={"{ }"} title="Khối lệnh / mã" onRun={() => exec("formatBlock", "pre")} />
            <span className="sk-sep" />
            <ToolButton label={"Liên kết"} title="Chèn liên kết" onRun={() => { saveRange(); setLinkUrl("https://"); setLinkOpen(true); }} />
            <ToolButton label={"Ảnh"} title="Chèn ảnh" onRun={() => { saveRange(); imgInput.current?.click(); }} />
            <ToolButton label={"⌫ Kiểu"} title="Xóa định dạng" onRun={() => exec("removeFormat")} />
          </div>
          {linkOpen && (
            <div className="sk-linkbar">
              <input type="url" value={linkUrl} autoFocus aria-label="Địa chỉ liên kết" onChange={(event) => setLinkUrl(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyLink(); } if (event.key === "Escape") { setLinkOpen(false); restoreRange(); } }} />
              <button type="button" className="sk-btn" onClick={applyLink}>Chèn</button>
              <button type="button" className="sk-btn ghost" onClick={() => { setLinkOpen(false); restoreRange(); }}>Hủy</button>
            </div>
          )}
          <div
            ref={editorRef}
            className={`sk-editor sk-rich${dragging ? " drag" : ""}`}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Nội dung bài"
            data-placeholder="Viết skill này làm gì, khi nào dùng, ví dụ câu lệnh… Dán hoặc kéo thả ảnh chụp màn hình trực tiếp vào đây."
            onKeyUp={saveRange}
            onMouseUp={saveRange}
            onInput={saveRange}
            onPaste={(event) => {
              const files = [...event.clipboardData.files];
              if (files.length) { event.preventDefault(); saveRange(); void insertImages(files); return; }
              const html = event.clipboardData.getData("text/html");
              if (html) { event.preventDefault(); exec("insertHTML", sanitize(html)); }
            }}
            onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              setDragging(false);
              const files = [...event.dataTransfer.files];
              if (!files.length) return;
              event.preventDefault();
              const zipFile = files.find(isZipFile);
              if (zipFile) chooseZip(zipFile);
              const caret = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(event.clientX, event.clientY);
              if (caret) rangeRef.current = caret;
              void insertImages(files);
            }}
          />
        </div>
      </div>
      <div className="sk-field">
        <span>File skill (.zip)</span>
        <div className="sk-zipdrop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseZip(event.dataTransfer.files[0]); }}>
          <span className="sk-zipname">{zip ? `${zip.kind === "new" ? zip.file.name : zip.name} · ${formatFileSize(zip.kind === "new" ? zip.file.size : zip.size)}` : "Chưa chọn file. Kéo thả .zip vào đây hoặc bấm Chọn file."}</span>
          <button type="button" className="sk-btn" onClick={() => zipInput.current?.click()}>Chọn file .zip</button>
          {zip && <button type="button" className="sk-btn ghost" onClick={() => setZip(null)}>Bỏ file</button>}
        </div>
      </div>
      <div className="sk-composer-foot">
        <span className={`sk-status${status.error ? " err" : ""}`} role="status">{status.text}</span>
        <div>
          <button type="button" className="sk-btn ghost" onClick={props.onCancel}>Hủy</button>
          <button type="button" className="sk-btn primary" disabled={busy} onClick={() => void save()}>{busy ? "Đang lưu…" : editing ? "Lưu thay đổi" : "Đăng"}</button>
        </div>
      </div>
      <input ref={imgInput} type="file" accept={SKILL_IMAGE_TYPES.join(",")} multiple hidden onChange={(event) => { void insertImages([...(event.target.files ?? [])]); event.target.value = ""; }} />
      <input ref={zipInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => { chooseZip(event.target.files?.[0]); event.target.value = ""; }} />
    </section>
  );
}
