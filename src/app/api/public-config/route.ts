/**
 * Cấu hình công khai cho các trang tĩnh trong public/ (vd /before-after.html):
 * địa chỉ Supabase và khóa publishable — hai giá trị vốn đã lộ ra trình duyệt qua NEXT_PUBLIC_*.
 * Trang tĩnh không đọc được biến môi trường lúc build nên hỏi qua đây.
 * Thiếu cấu hình → trả null, trang tĩnh tự chuyển sang chế độ lưu trên máy.
 */
export function GET() {
  return Response.json(
    {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
      supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
