import { handlePhotoAiRequest } from "../../../lib/photoAi";

// Workers AI thường trả ảnh trong vài giây, để dư cho lúc máy chủ AI bận
export const maxDuration = 60;

export async function POST(request: Request) {
  return handlePhotoAiRequest(request, {
    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
