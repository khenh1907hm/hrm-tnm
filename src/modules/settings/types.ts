/** `dailyDigestEmail`: gửi bản tin chứng chỉ hằng ngày tới các địa chỉ nhận nhắc hạn (mặc định bật). */
export type HrSettings = { reminderEmails: string[]; sendExpiredNotice: boolean; dailyDigestEmail: boolean; reminderDays: 30; version: number };
