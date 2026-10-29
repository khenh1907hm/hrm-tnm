import { createClient } from "@supabase/supabase-js";
import { handleAccountRequest, type AccountDeps } from "../../../../lib/accountAdmin";
import { createSupabaseAccountStore } from "../../../../lib/supabaseAccountStore";

function buildDeps(): AccountDeps {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  // Khóa bí mật bỏ qua RLS: chỉ dùng ở máy chủ, sau khi đã xác thực người gọi là Admin
  const admin = url && secretKey ? createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return {
    lookupRole: async (userId) => {
      if (!admin) return null;
      const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
      return data?.role ?? null;
    },
    store: admin ? createSupabaseAccountStore(admin) : null,
  };
}

const env = () => ({ supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
const handle = (request: Request) => handleAccountRequest(request, env(), buildDeps());

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
