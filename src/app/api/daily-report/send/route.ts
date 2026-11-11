import { handleDailySend } from "../../../../lib/dailyReport";

// Điền mẫu Excel bằng Python rồi gửi Telegram
export const maxDuration = 120;

export async function POST(request: Request) {
  return handleDailySend(request, { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
}
