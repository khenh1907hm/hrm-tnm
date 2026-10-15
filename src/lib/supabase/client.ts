import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

/**
 * Supabase client cho trình duyệt. Trả về null khi chưa cấu hình biến môi trường
 * → app chạy chế độ demo (dữ liệu mẫu trong bộ nhớ).
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  cached = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
  return cached;
}
