import type { TelegramSender } from "../../app-core/context";

type Fetch = typeof fetch;

/**
 * Gửi tin qua Telegram Bot API (`sendMessage`, parse_mode HTML). Trả về null khi chưa có token.
 * Token chỉ nằm ở biến môi trường máy chủ (TELEGRAM_BOT_TOKEN); không ghi token vào log hay thông báo lỗi.
 */
export function createTelegramSender(token: string | undefined, fetcher: Fetch = fetch): TelegramSender | null {
  const bot = token?.trim();
  if (!bot) return null;
  return {
    async send(chatId, text) {
      type TelegramReply = { ok?: boolean; description?: string };
      let body: TelegramReply | null = null;
      try {
        const response = await fetcher(`https://api.telegram.org/bot${bot}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
          signal: AbortSignal.timeout(15_000),
        });
        body = await response.json().catch(() => null) as TelegramReply | null;
        if (response.ok && body?.ok) return;
      } catch (error) {
        console.error(`[telegram] Không kết nối được Telegram: ${error instanceof Error ? error.name : "lỗi"}`);
        throw new Error("Không kết nối được máy chủ Telegram.");
      }
      // Mô tả của Telegram (vd "Bad Request: chat not found") không chứa token nên trả lại được cho Admin
      const description = body?.description ?? "Telegram từ chối tin nhắn.";
      console.error(`[telegram] Gửi lỗi tới ${chatId}: ${description}`);
      throw new Error(description);
    },
  };
}
