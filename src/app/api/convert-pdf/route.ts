import { handleConvertRequest } from "../../../lib/officeToPdf";

// LibreOffice có thể mất vài giây (và lâu hơn khi máy chủ vừa "thức dậy")
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleConvertRequest(request, {
    gotenbergUrl: process.env.GOTENBERG_URL,
    gotenbergUsername: process.env.GOTENBERG_USERNAME,
    gotenbergPassword: process.env.GOTENBERG_PASSWORD,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
