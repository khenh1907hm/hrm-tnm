import { handleDailyRead } from "../../../../lib/dailyReport";

// Đọc ảnh bằng Python + mô hình xem ảnh (Cloudflare / Claude) có thể mất vài chục giây
export const maxDuration = 150;

export async function POST(request: Request) {
  return handleDailyRead(request, { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
}
