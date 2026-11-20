import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

/**
 * Giống web (src/app/_components/singleSession.ts): mỗi tài khoản chỉ đăng nhập một nơi, tối đa 24 giờ.
 * Đăng nhập trên điện thoại sẽ đăng xuất phiên trên máy tính và ngược lại.
 */
const KEY = "tnm.sessionKey";

const readKey = () => AsyncStorage.getItem(KEY).catch(() => null);
const writeKey = (value: string | null) => (value ? AsyncStorage.setItem(KEY, value) : AsyncStorage.removeItem(KEY)).catch(() => undefined);

function newKey(): string {
  return Array.from(Crypto.getRandomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

let claiming: Promise<void> | null = null;

/** Gọi ngay sau khi đăng nhập bằng mật khẩu thành công. */
export function claimSession(client: SupabaseClient): Promise<void> {
  claiming ??= doClaim(client).finally(() => { claiming = null; });
  return claiming;
}

async function doClaim(client: SupabaseClient): Promise<void> {
  const key = newKey();
  await writeKey(key);
  const agent = `TNM app (${Platform.OS} ${String(Platform.Version)})`;
  const { error } = await client.rpc("session_claim", { p_key: key, p_agent: agent });
  if (error) return;
  await client.auth.signOut({ scope: "others" }).catch(() => undefined);
}

export type SessionState = "ok" | "replaced" | "expired";

export async function checkSession(client: SupabaseClient): Promise<SessionState> {
  if (claiming) await claiming;
  const key = await readKey();
  if (!key) { await claimSession(client); return "ok"; }
  const { data, error } = await client.rpc("session_check", { p_key: key });
  if (error) return "ok";
  if (data === "none") { await claimSession(client); return "ok"; }
  return data === "replaced" || data === "expired" ? data : "ok";
}

export const kickMessage = (state: Exclude<SessionState, "ok">) => state === "replaced"
  ? "Tài khoản vừa đăng nhập ở nơi khác nên máy này đã được đăng xuất."
  : "Phiên đăng nhập đã quá 24 giờ, vui lòng đăng nhập lại.";

export const forgetSessionKey = () => writeKey(null);
