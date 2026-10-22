import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { createHrApp } from "../../app-core/createHrApp";
import { fixedClock, systemClock } from "../../lib/clock";
import { randomIds, sequentialIds } from "../../lib/ids";
import { getSupabaseClient } from "../../lib/supabase/client";
import type { Actor, Role } from "../../modules/auth/permissions";
import { cacheRepositories, TAB_REFRESH_GAP_MS, type CacheStatus, type RepositoryCache } from "../../repositories/cached";
import { createDemoRepositories } from "../../repositories/memory/seedDemo";
import { createSupabaseRepositories } from "../../repositories/supabase/createSupabaseRepositories";
import { createStorageFileStore, type FileStore } from "./fileStore";
import { readyLive, reconcileLive, type LiveBinding } from "./liveSession";
import type { App } from "./shared";

const DEMO_NOW = "2026-10-12T09:00:00+07:00";
/** Dữ liệu cũ hơn mức này thì tải lại (ngầm nếu đã có dữ liệu). */
const CACHE_TTL_MS = 30_000;
const NO_STATUS: CacheStatus = { stale: false, revision: 0 };

export type Backend =
  | { status: "loading" }
  | { status: "signedOut"; signIn: (email: string, password: string) => Promise<string | null> }
  /** Đã đăng nhập nhưng chưa được admin cấp quyền (vai trò pending / không có hồ sơ). */
  | { status: "pending"; email: string | null; signOut: () => Promise<void> }
  /** Vai trò Nhân viên: chỉ Kho Skill AI và Công cụ, không dựng app nhân sự. */
  | { status: "employee"; mode: "demo" | "live"; email: string | null; signOut: () => Promise<void>; exitPreview?: () => void }
  | {
    status: "ready"; mode: "demo" | "live"; app: App; actor: Actor; setActor: (actor: Actor) => void; email: string | null; fileStore: FileStore | null; signOut: () => Promise<void>;
    /** stale: dữ liệu có thể chưa mới nhất (tải ngầm lỗi); revision tăng mỗi khi dữ liệu nền thật sự được thay. */
    dataStatus: CacheStatus;
    /** Chế độ demo: xem thử giao diện vai trò Nhân viên. */
    previewEmployee?: () => void;
  };

type Live = LiveBinding<App> & { cache: RepositoryCache };
type Profile = { userId: string; role: Role | "employee" | "pending" };
type SupabaseClientLike = NonNullable<ReturnType<typeof getSupabaseClient>>;

/** Vai trò của người dùng: admin/hr vào app nhân sự, employee chỉ Kho Skill AI và Công cụ, còn lại → chờ cấp quyền. */
async function fetchRole(client: SupabaseClientLike, id: string): Promise<Profile["role"]> {
  const { data } = await client.from("profiles").select("role").eq("id", id).single();
  return data?.role === "admin" || data?.role === "hr" || data?.role === "employee" ? data.role as Profile["role"] : "pending";
}
const sameProfile = (id: string, role: Profile["role"]) => (current: Profile | null): Profile | null => current?.userId === id && current.role === role ? current : { userId: id, role };

/**
 * Chọn nguồn dữ liệu: có cấu hình Supabase → đăng nhập và dùng cơ sở dữ liệu thật (qua bộ nhớ tạm);
 * không có → chế độ demo với dữ liệu mẫu trong bộ nhớ, không qua bộ nhớ tạm.
 * Bộ nhớ tạm gắn với một người dùng và một vai trò: đổi phiên là xóa ngay, không bao giờ dùng lại cho người khác.
 */
export function useBackend(): Backend {
  const client = getSupabaseClient();
  const [session, setSession] = useState<Session | null | undefined>(client ? undefined : null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [demoApp, setDemoApp] = useState<App | null>(null);
  const [demoActor, setDemoActor] = useState<Actor>({ id: "demo-admin", role: "admin" });
  const [demoEmployee, setDemoEmployee] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const liveRef = useRef<Live | null>(null);
  const userId = session?.user.id ?? null;
  const currentRole = profile && profile.userId === userId && (profile.role === "admin" || profile.role === "hr") ? profile.role : null;
  // Bị hạ về "chờ cấp quyền" hoặc "nhân viên" cũng phải xóa bộ nhớ tạm dữ liệu nhân sự như khi đăng xuất
  const revoked = profile !== null && profile.userId === userId && (profile.role === "pending" || profile.role === "employee");

  // Chế độ demo: nạp dữ liệu mẫu
  useEffect(() => {
    if (client) return;
    let active = true;
    void createDemoRepositories(fixedClock(DEMO_NOW), sequentialIds("demo")).then((repositories) => {
      if (active) setDemoApp(createHrApp({ clock: systemClock, ids: sequentialIds("new"), repositories, mailer: { send: async () => undefined } }));
    });
    return () => { active = false; };
  }, [client]);

  // Chế độ thật: theo dõi phiên đăng nhập (kể cả hết hạn, đăng xuất ở tab khác)
  useEffect(() => {
    if (!client) return;
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [client]);

  // Đọc vai trò của người đang đăng nhập
  useEffect(() => {
    if (!client || !userId) return;
    let active = true;
    void fetchRole(client, userId).then((role) => { if (active) setProfile(sameProfile(userId, role)); });
    return () => { active = false; };
  }, [client, userId]);

  // Đồng bộ app chế độ thật với phiên: khác người hoặc khác vai trò → xóa bộ nhớ tạm cũ, dựng lại
  useEffect(() => {
    if (!client) return;
    let next = reconcileLive(liveRef.current, userId && !revoked ? { userId, role: currentRole } : null);
    if (!next && userId && currentRole) {
      const cache = cacheRepositories(createSupabaseRepositories(client), { ttlMs: CACHE_TTL_MS });
      const app = createHrApp({ clock: systemClock, ids: randomIds(), repositories: cache.repositories });
      next = { userId, role: currentRole, app, cache, dispose: cache.dispose };
    }
    if (next !== liveRef.current) { liveRef.current = next; setLive(next); }
  }, [client, userId, currentRole, revoked]);

  // Quay lại tab: chỉ làm mới bảng đã quá hạn (chặn 5 giây giữa hai lần) và đọc lại vai trò (bắt việc đổi vai trò)
  useEffect(() => {
    if (!client) return;
    let lastRoleCheck = Number.NEGATIVE_INFINITY;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const current = liveRef.current;
      current?.cache.refreshExpired();
      if (!current || Date.now() - lastRoleCheck < TAB_REFRESH_GAP_MS) return;
      lastRoleCheck = Date.now();
      void fetchRole(client, current.userId).then((role) => setProfile(sameProfile(current.userId, role)));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [client]);

  // Rời trang: dọn bộ nhớ tạm và hẹn giờ
  useEffect(() => () => { liveRef.current?.dispose(); liveRef.current = null; }, []);

  const cache = live?.cache ?? null;
  const subscribe = useCallback((listener: () => void) => cache ? cache.subscribe(listener) : () => undefined, [cache]);
  const getStatus = useCallback(() => cache ? cache.status() : NO_STATUS, [cache]);
  const dataStatus = useSyncExternalStore(subscribe, getStatus, getStatus);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!client) return "Chưa cấu hình Supabase.";
    const { error } = await client.auth.signInWithPassword({ email, password });
    return error ? "Email hoặc mật khẩu không đúng." : null;
  }, [client]);

  const signOut = useCallback(async () => {
    // Xóa bộ nhớ tạm trước, kể cả khi lệnh đăng xuất lỗi mạng
    liveRef.current?.dispose();
    liveRef.current = null;
    setLive(null);
    setProfile(null);
    await client?.auth.signOut();
  }, [client]);

  if (!client && demoEmployee) return { status: "employee", mode: "demo", email: null, signOut: async () => undefined, exitPreview: () => setDemoEmployee(false) };
  if (!client) return demoApp ? { status: "ready", mode: "demo", app: demoApp, actor: demoActor, setActor: setDemoActor, email: null, fileStore: null, signOut: async () => undefined, dataStatus: NO_STATUS, previewEmployee: () => setDemoEmployee(true) } : { status: "loading" };
  if (session === undefined) return { status: "loading" };
  if (session === null) return { status: "signedOut", signIn };
  if (profile?.userId === session.user.id && profile.role === "pending") return { status: "pending", email: session.user.email ?? null, signOut };
  if (profile?.userId === session.user.id && profile.role === "employee") return { status: "employee", mode: "live", email: session.user.email ?? null, signOut };
  // Chỉ trả app dựng cho đúng người và đúng vai trò hiện tại; trong lúc dựng lại thì hiện "đang tải"
  const ready = readyLive(live, { userId: session.user.id, role: currentRole });
  if (!ready || !currentRole) return { status: "loading" };
  return { status: "ready", mode: "live", app: ready.app, actor: { id: session.user.id, role: currentRole }, setActor: () => undefined, email: session.user.email ?? null, fileStore: createStorageFileStore(client), signOut, dataStatus };
}
