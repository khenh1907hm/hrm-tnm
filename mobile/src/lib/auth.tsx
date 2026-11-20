import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { checkSession, claimSession, forgetSessionKey, kickMessage } from "./singleSession";
import { supabase, supabaseConfigured } from "./supabase";
import { loginCandidates } from "./workerLogin";

export type AuthStatus = "loading" | "signedOut" | "pending" | "ready";

type AuthValue = {
  status: AuthStatus;
  session: Session | null;
  role: string | null;
  /** Mã hồ sơ nhân sự đã liên kết; null = tài khoản chưa liên kết (không chấm công được). */
  employeeId: string | null;
  /** Lý do vừa bị đăng xuất (đăng nhập nơi khác / quá 24 giờ), hiện ở màn hình đăng nhập. */
  notice: string | null;
  signIn: (login: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

async function loadRole(userId: string): Promise<{ role: string; employeeId: string | null }> {
  const { data } = await supabase.from("profiles").select("role, employee_id").eq("id", userId).maybeSingle();
  // Giống web (workspaceRole.ts): giá trị lạ hoặc thiếu → chờ cấp quyền
  const known = ["admin", "hr", "engineer", "employee"];
  const role = typeof data?.role === "string" && known.includes(data.role) ? data.role : "pending";
  return { role, employeeId: typeof data?.employee_id === "string" && data.employee_id ? data.employee_id : null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [role, setRole] = useState<{ userId: string; role: string; employeeId: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseConfigured) { setSession(null); return; }
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  // Vai trò của tài khoản (pending = chưa được cấp quyền)
  useEffect(() => {
    if (!userId) { setRole(null); return; }
    let active = true;
    void loadRole(userId).then((next) => { if (active) setRole({ userId, ...next }); });
    return () => { active = false; };
  }, [userId]);

  // Một tài khoản một nơi: kiểm tra mỗi phút và mỗi lần mở lại app
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const check = async () => {
      const state = await checkSession(supabase);
      if (!active || state === "ok") return;
      setNotice(kickMessage(state));
      await forgetSessionKey();
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    const sub = AppState.addEventListener("change", (state) => { if (state === "active") void check(); });
    return () => { active = false; clearInterval(timer); sub.remove(); };
  }, [userId]);

  const signIn = useCallback(async (login: string, password: string) => {
    if (!supabaseConfigured) return "Chưa cấu hình Supabase (thiếu biến EXPO_PUBLIC_SUPABASE_*).";
    setNotice(null);
    await forgetSessionKey();
    let failed = true;
    for (const email of loginCandidates(login)) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error) { failed = false; break; }
      if (!/invalid login credentials/i.test(error.message)) return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
    }
    if (failed) return "Email (mã nhân viên) hoặc mật khẩu không đúng.";
    await claimSession(supabase);
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await forgetSessionKey();
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }, []);

  const value = useMemo<AuthValue>(() => {
    const currentRole = role && role.userId === userId ? role.role : null;
    const employeeId = role && role.userId === userId ? role.employeeId : null;
    const status: AuthStatus = session === undefined ? "loading"
      : session === null ? "signedOut"
      : currentRole === null ? "loading"
      : currentRole === "pending" ? "pending" : "ready";
    return { status, session: session ?? null, role: currentRole, employeeId, notice, signIn, signOut };
  }, [session, role, userId, notice, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth phải nằm trong AuthProvider");
  return value;
}

/** Gọi API trên VPS (tnm.com.vn/api/...) kèm token đăng nhập, giống bản web. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  return fetch(`${process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://tnm.com.vn"}${path}`, { ...init, headers });
}
