/** Mã lỗi từ máy chủ (giống web: src/messages.vi.ts) → câu tiếng Việt cho người dùng. */
const MESSAGES: Record<string, string> = {
  FORBIDDEN: "Bạn không có quyền thực hiện thao tác này.",
  CHECKIN_NO_EMPLOYEE: "Tài khoản chưa được liên kết với hồ sơ nhân sự. Nhờ Admin liên kết ở mục Tài khoản.",
  CHECKIN_NO_SITE: "Dự án chưa đặt vị trí công trường nên chưa tự chấm công được. Nhờ PM hoặc Admin nhập tọa độ công trường.",
  CHECKIN_NO_GPS: "Không lấy được vị trí: hãy bật định vị (GPS) và cho phép app truy cập vị trí.",
  CHECKIN_NO_PHOTO: "Cần chụp ảnh tại chỗ để chấm công.",
  CHECKIN_NO_CAMERA: "Không mở được camera: hãy cho phép app dùng camera rồi thử lại.",
  CHECKIN_OUT_OF_RANGE: "Bạn đang cách công trường {value} m, ngoài phạm vi cho phép. Hãy đến công trường hoặc nhờ tổ trưởng chấm hộ.",
  CHECKIN_ALREADY: "Hôm nay bạn đã chấm Vào ở dự án này.",
  CHECKOUT_WITHOUT_CHECKIN: "Chưa chấm Vào nên chưa chấm Ra được.",
  TS_PROJECT_NOT_ACTIVE: "Dự án không ở trạng thái Đang thi công.",
  TS_OUTSIDE_MEMBERSHIP: "Bạn chưa thuộc dự án này hôm nay. Nhờ CHT hoặc PM thêm bạn vào dự án.",
  TS_FUTURE_DATE: "Không lập báo cáo cho ngày trong tương lai.",
  DR_DATE_REQUIRED: "Chọn ngày báo cáo.",
  DR_TASKS_REQUIRED: "Báo cáo cần ít nhất một công việc.",
  DR_NOT_FOUND: "Không tìm thấy báo cáo ngày.",
  CHECKIN_REJECTED: "Máy chủ không nhận ảnh chấm công: tài khoản chưa liên kết hồ sơ nhân sự hoặc dự án không còn đang thi công. Nhờ Admin kiểm tra ở mục Tài khoản.",
  TS_PERIOD_LOCKED: "Tháng này đã khóa sổ, không gửi giải trình được nữa.",
  ATR_TOO_OLD: "Chỉ gửi giải trình cho ngày trong 45 ngày gần đây.",
  ATR_REASON_REQUIRED: "Chọn lý do giải trình.",
  ATR_NOTE_REQUIRED: "Lý do khác: ghi chú rõ lý do (ít nhất 5 ký tự).",
  ATR_NOTE_TOO_LONG: "Ghi chú quá dài (tối đa 900 ký tự).",
  ATR_ACTIVITY_REQUIRED: "Chọn hoạt động cần giải trình: Vào ca hoặc Ra ca.",
  ATR_TIME_REQUIRED: "Chọn giờ đề nghị ghi nhận.",
  ATR_TIME_ORDER: "Giờ Ra phải sau giờ Vào của ngày đó.",
  ATR_PENDING_EXISTS: "Ngày này đã có một giải trình đang chờ PM duyệt. Hủy phiếu cũ trên lịch nếu muốn gửi lại.",
  ATR_ATTACHMENT_INVALID: "Ảnh đính kèm không hợp lệ (tối đa 3 ảnh).",
  ATR_NOT_PENDING: "Giải trình này đã được xử lý, không hủy được nữa.",
  NETWORK: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.",
};

export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error ?? "");
  const [code = "", value = ""] = raw.split(":");
  const known = MESSAGES[code.trim()];
  if (known) return known.replace("{value}", value.trim());
  // Kho ảnh / bảng từ chối ghi (RLS): thường do tài khoản chưa liên kết hồ sơ nhân sự hoặc dự án không còn thi công
  if (/row-level security/i.test(raw)) return MESSAGES.CHECKIN_REJECTED!;
  if (/network|fetch|timed? ?out/i.test(raw)) return MESSAGES.NETWORK!;
  return raw || "Có lỗi xảy ra, thử lại sau.";
}
