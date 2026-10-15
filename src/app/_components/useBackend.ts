import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createHrApp } from "../../app-core/createHrApp";
import { fixedClock, systemClock } from "../../lib/clock";
import { randomIds, sequentialIds } from "../../lib/ids";
import { getSupabaseClient } from "../../lib/supabase/client";
import type { Actor, Role } from "../../modules/auth/permissions";
import { createDemoRepositories } from "../../repositories/memory/seedDemo";
import { createSupabaseRepositories } from "../../repositories/supabase/createSupabaseRepositories";
import { createStorageFileStore, type FileStore } from "./fileStore";
import type { App } from "./shared";

const DEMO_NOW = "2026-10-12T09:00:00+07:00";

export type Backend =
  | { status: "loading" }
  | { status: "signedOut"; signIn: (email: string, password: string) => Promise<string | null> }
  | { status: "ready"; mode: "demo" | "live"; app: App; actor: Actor; setActor: (actor: Actor) => void; email: string | null; fileStore: FileStore | null; signOut: () => Promise<void> };

/**
 * Chọn nguồn dữ liệu: có cấu hình Supabase → đăng nhập và dùng cơ sở dữ liệu thật;
 * không có → chế độ demo với dữ liệu mẫu trong bộ nhớ (như trước).
 */
export function useBackend(): Backend {
  const client = getSupabaseClient();
  const [session, setSession] = useState<Session | null | undefined>(client ? undefined : null);
  const [role, setRole] = useState<Role | null>(null);
  const [demoApp, setDemoApp] = useState<App | null>(null);
  const [demoActor, setDemoActor] = useState<Actor>({ id: "demo-admin", role: "admin" });
  const [liveApp, setLiveApp] = useState<App | null>(null);

  // Chế độ demo: nạp dữ liệu mẫu
  useEffect(() => {
    if (client) return;
    let active = true;
    void createDemoRepositories(fixedClock(DEMO_NOW), sequentialIds("demo")).then((repositories) => {
      if (active) setDemoApp(createHrApp({ clock: systemClock, ids: sequentialIds("new"), repositories, mailer: { send: async () => undefined } }));
    });
    return () => { active = false; };
  }, [client]);

  // Chế độ thật: theo dõi phiên đăng nhập
  useEffect(() => {
    if (!client) return;
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [client]);

  // Có phiên → đọc vai trò và dựng app trên Supabase
  useEffect(() => {
    if (!client || !session) return;
    let active = true;
    void client.from("profiles").select("role").eq("id", session.user.id).single().then(({ data }) => {
      if (!active) return;
      setRole(data?.role === "admin" ? "admin" : "hr");
      setLiveApp(createHrApp({ clock: systemClock, ids: randomIds(), repositories: createSupabaseRepositories(client) }));
    });
    return () => { active = false; };
  }, [client, session]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!client) return "Chưa cấu hình Supabase.";
    const { error } = await client.auth.signInWithPassword({ email, password });
    return error ? "Email hoặc mật khẩu không đúng." : null;
  }, [client]);

  const signOut = useCallback(async () => {
    await client?.auth.signOut();
    setRole(null);
    setLiveApp(null);
  }, [client]);

  if (!client) return demoApp ? { status: "ready", mode: "demo", app: demoApp, actor: demoActor, setActor: setDemoActor, email: null, fileStore: null, signOut: async () => undefined } : { status: "loading" };
  if (session === undefined) return { status: "loading" };
  if (session === null) return { status: "signedOut", signIn };
  if (!liveApp || !role) return { status: "loading" };
  return { status: "ready", mode: "live", app: liveApp, actor: { id: session.user.id, role }, setActor: () => undefined, email: session.user.email ?? null, fileStore: createStorageFileStore(client), signOut };
}
