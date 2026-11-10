import { useCallback, useEffect, useState } from "react";
import type { Actor } from "../../modules/auth/permissions";
import type { NotificationTarget } from "../../modules/notifications/types";
import { getSupabaseClient } from "../../lib/supabase/client";
import { issueText, type App, type SetNotice } from "./shared";

type Draft = { id?: string; expectedVersion?: number; name: string; chatId: string; enabled: boolean };
const EMPTY: Draft = { name: "", chatId: "", enabled: true };

/** Admin quản lý nơi nhận Telegram (nhóm, người) cho bản tin chứng chỉ hằng ngày; mỗi nơi nhận có nút Gửi thử. */
export function TelegramTargetsPanel(props: { app: App; actor: Actor; setNotice: SetNotice }) {
  const [targets, setTargets] = useState<NotificationTarget[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await props.app.notifications.listTargets(props.actor);
    if (result.ok) setTargets(result.value);
  }, [props.app, props.actor]);
  useEffect(() => {
    void props.app.notifications.listTargets(props.actor).then((result) => { if (result.ok) setTargets(result.value); });
  }, [props.app, props.actor]);

  const save = async () => {
    if (!draft) return;
    const result = await props.app.notifications.saveTarget(props.actor, { ...draft, topics: ["certificate_digest"] });
    if (!result.ok) { setError(result.errors.map((item) => issueText(item.code)).join(" ")); return; }
    props.setNotice(draft.id ? "Đã cập nhật nơi nhận Telegram." : "Đã thêm nơi nhận Telegram.", "success");
    setDraft(null); setError(""); await refresh();
  };
  const remove = async (target: NotificationTarget) => {
    if (!window.confirm(`Xóa nơi nhận “${target.name}”? Nhóm này sẽ không nhận bản tin nữa.`)) return;
    const result = await props.app.notifications.removeTarget(props.actor, target.id);
    props.setNotice(result.ok ? "Đã xóa nơi nhận Telegram." : issueText(result.errors[0]?.code ?? "NOTIFY_TARGET_NOT_FOUND"), result.ok ? "success" : undefined);
    await refresh();
  };
  const toggle = async (target: NotificationTarget) => {
    const result = await props.app.notifications.saveTarget(props.actor, { id: target.id, expectedVersion: target.version, name: target.name, chatId: target.chatId, enabled: !target.enabled, topics: target.topics });
    if (!result.ok) props.setNotice(issueText(result.errors[0]?.code ?? "CONFLICT"));
    await refresh();
  };
  const sendTest = async (target: NotificationTarget) => {
    const client = getSupabaseClient();
    if (!client) { props.setNotice("Bản demo không gửi Telegram thật."); return; }
    setBusy(target.id);
    try {
      const token = (await client.auth.getSession()).data.session?.access_token;
      const response = await fetch("/api/notifications/telegram/test", {
        method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ targetId: target.id }),
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; message?: string; count?: number } | null;
      if (!response.ok || !body?.ok) { props.setNotice(body?.message ?? "Không gửi được tin thử Telegram."); return; }
      props.setNotice(`Đã gửi tin thử (${body.count ?? 0} chứng chỉ) tới “${target.name}”. Mở Telegram để kiểm tra.`, "success");
    } catch { props.setNotice("Không kết nối được máy chủ để gửi tin thử."); }
    finally { setBusy(null); }
  };

  return <section className="panel detail-panel">
    <div className="page-head"><h2>Nơi nhận Telegram</h2>{!draft && <button className="button primary" onClick={() => { setDraft({ ...EMPTY }); setError(""); }}>Thêm nơi nhận</button>}</div>
    <p className="muted">Mỗi sáng (8:00) bot gửi bản tin: tổng số chứng chỉ đã hết hạn và còn tối đa 30 ngày, kèm danh sách ngắn. Thêm bot vào nhóm (hoặc bấm Start với bot) rồi nhập Chat ID của nhóm, người nhận.</p>
    {targets.length ? <div className="table-scroll"><table><thead><tr><th>Tên</th><th>Chat ID</th><th>Tình trạng</th><th>Thao tác</th></tr></thead><tbody>{targets.map((target) => <tr key={target.id}>
      <td>{target.name}</td><td><code>{target.chatId}</code></td>
      <td>{target.enabled ? <span className="pill ok">Đang nhận</span> : <span className="pill bad">Đã tắt</span>}</td>
      <td><div className="button-row">
        <button className="button" disabled={busy === target.id} onClick={() => void sendTest(target)}>{busy === target.id ? "Đang gửi…" : "Gửi thử"}</button>
        <button className="button" onClick={() => { setDraft({ id: target.id, expectedVersion: target.version, name: target.name, chatId: target.chatId, enabled: target.enabled }); setError(""); }}>Sửa</button>
        <button className="button" onClick={() => void toggle(target)}>{target.enabled ? "Tắt" : "Bật"}</button>
        <button className="button danger" onClick={() => void remove(target)}>Xóa</button>
      </div></td>
    </tr>)}</tbody></table></div> : <p>Chưa có nơi nhận Telegram nào.</p>}
    {draft && <div className="type-edit-form">
      <label className="field"><span>Tên nơi nhận (vd Nhóm HSE công trường)</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="field"><span>Chat ID (số, nhóm thường bắt đầu bằng -100…, hoặc @tên_kênh)</span><input value={draft.chatId} inputMode="text" onChange={(event) => setDraft({ ...draft, chatId: event.target.value })} /></label>
      <label className="check-field"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Nhận bản tin chứng chỉ hằng ngày</label>
      {error && <p className="form-error">{error}</p>}
      <button className="button primary" onClick={() => void save()}>Lưu nơi nhận</button>
      <button className="button" onClick={() => { setDraft(null); setError(""); }}>Hủy</button>
    </div>}
  </section>;
}
