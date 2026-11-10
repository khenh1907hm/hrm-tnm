/** Kênh gửi thông báo. Thêm kênh mới (vd Zalo) thì thêm ở đây và ở ràng buộc `channel` của bảng notification_targets. */
export type NotificationChannel = "telegram";
/** Loại thông báo một nơi nhận có thể đăng ký. Hiện chỉ có bản tin chứng chỉ hằng ngày. */
export type NotificationTopic = "certificate_digest";
export const NOTIFICATION_TOPICS: readonly { key: NotificationTopic; label: string }[] = [
  { key: "certificate_digest", label: "Bản tin chứng chỉ hằng ngày" },
];

/** Một nơi nhận thông báo (vd một nhóm Telegram). Token bot nằm ở máy chủ, không nằm ở đây. */
export type NotificationTarget = {
  id: string; channel: NotificationChannel; name: string;
  /** Chat ID Telegram: số (người, nhóm, vd -1001234567890) hoặc @tên_kênh. */
  chatId: string;
  enabled: boolean; topics: NotificationTopic[]; version: number;
};

/** Đã gửi một thông báo cho một nơi nhận vào một ngày. */
export type NotificationLogEntry = { identity: string; topic: NotificationTopic; channel: "email" | NotificationChannel; targetId: string | null; sentOn: string };
