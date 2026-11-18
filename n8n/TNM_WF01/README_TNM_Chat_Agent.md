# TNM Internal Knowledge Agent – Phase 1: TNM_WF01_Telegram_Chat_Agent

Chatbot Telegram trò chuyện nhiều lượt, nhớ ngữ cảnh riêng cho từng nhân viên. Phase 1 chưa có Knowledge Base, chưa có RAG, chưa đọc tài liệu.

| Mục | Giá trị |
|---|---|
| n8n | 2.46.4, Docker trên VPS, https://n8n.tnm.com.vn |
| Workflow | `TNM_WF01_Telegram_Chat_Agent` (ID `TnmWf01ChatAgent`), đang **Active** |
| File export | `TNM_WF01_Telegram_Chat_Agent.json` (cùng thư mục) |
| Bộ nhớ hội thoại | Data Table n8n `tnm_chat_memory` (lưu bền vững trong database của n8n) |
| AI | Gemini `models/gemini-3.1-flash-lite`, gọi qua API `generateContent` |

## 1. Kiến trúc

```
Telegram Trigger → Config → Normalize Input → Check Message Type
   ├─ Ignore (tin trùng, tin từ bot, thiếu mã) ............ dừng
   ├─ Group chat → Reply Group Chat ─────────────────────────────┐
   └─ Private chat → Check User Access                            │
        ├─ chưa có quyền → Reply Access Denied ──────────────────┤
        └─ có quyền → Route Content                               │
             ├─ Not text → Reply Unsupported Message ────────────┤
             ├─ Empty    → Reply Empty Message ──────────────────┤
             ├─ Command  → Handle Commands → Command Action        │
             │               ├─ Reset → Reset Memory ─┐           │
             │               ├─ New   → New Session Marker → Start New Session ─┐
             │               └─ Reply only ───────────┴→ Command Reply ─────────┤
             └─ Chat → Load Conversation Memory → Build AI Context → LLM Chat   │
                          ├─ thành công → Read AI Answer                         │
                          │                 ├─ Prepare Memory Rows → Save Conversation Memory
                          │                 └───────────────────────────────────┤
                          └─ lỗi → Build Error Reply ───────────────────────────┤
                                                                                 ▼
                     Format Response → Telegram Send Message (HTML)
                                          └─ lỗi → Fallback To Plain Text → Telegram Send Plain Text
                                                                               └─ lỗi → Log Send Failure
```

## 2. Mục đích từng node

| Node | Việc làm |
|---|---|
| Telegram Trigger | Nhận tin nhắn mới gửi tới bot (chỉ loại `message`, không tải tệp). |
| Config | Cấu hình: `allowedUserIds`, `chatModel`, `temperature` (0.6), `maxOutputTokens` (2048), `maxHistoryTurns` (12), `aiTimeoutMs` (60000). |
| Normalize Input | Chuẩn hóa: `telegram_user_id`, `chat_id`, `message_id`, `first_name`, `username`, `message_text`, `chat_type`, `message_type`, `timestamp`. Tạo khóa nhớ `tnm:<chat_id>:<telegram_user_id>`. Bỏ tin trùng (nhớ 300 `update_id` gần nhất). Thiếu username không gây lỗi. Định danh người dùng bằng **User ID**, không dùng username. |
| Check Message Type | Tách tin trùng hoặc không hợp lệ, tin trong group, tin chat riêng. |
| Check User Access | Chỉ người có User ID trong `allowedUserIds` mới dùng được. |
| Route Content | Phân loại: không phải văn bản, rỗng, lệnh, hội thoại. |
| Handle Commands, Command Action | `/start`, `/help`, `/new`, `/reset`, xử lý **trước** khi gọi AI. Lệnh lạ thì hiện hướng dẫn. |
| Reset Memory | `/reset`: xóa mọi dòng nhớ có khóa của chính người gửi. |
| New Session Marker, Start New Session | `/new`: ghi một dòng đánh dấu `session_start`; khi tải bộ nhớ sẽ dừng ở dấu này, nên AI không dùng phiên cũ nữa. |
| Load Conversation Memory | Lấy tối đa `maxHistoryTurns × 2 + 1` dòng mới nhất của **đúng khóa** người gửi. |
| Build AI Context | Ghép system prompt, lịch sử của phiên hiện tại và câu hỏi mới. Lọc lại theo khóa một lần nữa để chắc chắn không trộn lịch sử. |
| LLM Chat | Gọi Gemini; timeout 60 giây; thử lại 1 lần; lỗi thì đi nhánh lỗi. |
| Read AI Answer | Lấy câu trả lời; câu trả lời rỗng được thay bằng lời xin lỗi và không lưu vào bộ nhớ. |
| Prepare Memory Rows, Save Conversation Memory | Lưu câu hỏi và câu trả lời (mỗi nội dung tối đa 8.000 ký tự) dưới khóa của người gửi, trước khi gửi trả lời. |
| Build Error Reply | Câu báo lỗi thân thiện: hết lượt (429), quá thời gian, hoặc lỗi chung. Không gửi chi tiết kỹ thuật cho người dùng. |
| Format Response | Đổi Markdown sang HTML an toàn cho Telegram (chỉ dùng `<b>`, mọi ký tự đặc biệt được thoát), bảng thành dòng `a \| b`, chia tin dài thành các phần ≤ 3.500 ký tự. Kèm bản chữ thường để dự phòng. |
| Telegram Send Message | Gửi về đúng `chat_id` của người hỏi. |
| Fallback To Plain Text, Telegram Send Plain Text | Nếu Telegram từ chối bản HTML thì gửi lại dạng chữ thường. |
| Log Send Failure | Vẫn không gửi được thì đánh dấu lần chạy là lỗi (xem trong tab Executions). |

## 3. Credentials đang dùng (chỉ tên)

| Credential | Loại | Dùng ở |
|---|---|---|
| `Telegram account` | Telegram API | Telegram Trigger, Telegram Send Message, Telegram Send Plain Text |
| `Google Gemini(PaLM) Api account` | Google Gemini (PaLM) API | LLM Chat |

Bot này **cũng là bot đang gửi thông báo RFQ** (workflow `001.RFQ email`). Hai việc không xung đột: workflow RFQ chỉ gửi tin, còn WF01 nhận tin qua webhook. Muốn tách riêng một bot "TNM Assistant":

1. Tạo bot mới với @BotFather.
2. Trong n8n vào **Credentials → Add credential → Telegram API**, dán token **ngay trong n8n** (không gửi token qua chat).
3. Mở WF01, chọn credential mới cho 3 node Telegram, lưu rồi Publish lại.

## 4. Cấu hình thường gặp (node Config)

- **Thêm người dùng thử nghiệm:** người đó nhắn bất kỳ tin nào cho bot. Bot trả về "Mã Telegram của bạn: …". Thêm mã đó vào `allowedUserIds`, cách nhau bằng dấu phẩy (ví dụ `7004924546,123456789`), lưu rồi Publish. Danh sách hiện tại chỉ có `7004924546`, lấy từ chat nhận thông báo RFQ. Người nhắn đầu tiên không bao giờ được tự động cấp quyền.
- **Đổi model AI:** sửa `chatModel`, ví dụ `models/gemini-3.5-flash` (tốt hơn, ít lượt miễn phí hơn). Muốn dùng nhà cung cấp khác thì thay node **LLM Chat**: đầu vào là `$json.request` (systemInstruction, contents, generationConfig), đầu ra cần `candidates[0].content.parts[].text`.
- **Số lượt nhớ:** `maxHistoryTurns` (mặc định 12 lượt hỏi đáp).

## 5. Bộ nhớ hội thoại

- Bảng `tnm_chat_memory` có các cột `user_key`, `role` (`user` / `model` / `session_start`), `content`, cùng `id` và `createdAt`. Xem trong n8n ở mục **Data tables**.
- Mỗi người có khóa riêng `tnm:<chat_id>:<telegram_user_id>`. Không có bộ nhớ chung cho cả bot.
- Đây là **lịch sử hội thoại, không phải kho tri thức**. Phase 2 sẽ dùng nơi lưu khác (Supabase / vector) cho tài liệu.
- Lưu trữ: `/reset` xóa hẳn lịch sử của người gửi. `/new` chỉ ẩn phiên cũ, dữ liệu cũ vẫn nằm trong bảng. Chính sách tự xóa theo thời gian sẽ bổ sung ở giai đoạn sau.
- **Đổi sang Postgres Chat Memory:** khi có PostgreSQL và credential Postgres trong n8n, thay 4 node Data Table (Load, Save, Reset, Start New Session) bằng các truy vấn tương ứng, hoặc chuyển sang AI Agent + Postgres Chat Memory với `sessionKey = {{ $json.memory_key }}`.

## 6. Xử lý lỗi

| Trường hợp | Cách xử lý |
|---|---|
| AI lỗi hoặc hết lượt (429) | "Xin lỗi, hệ thống AI đang tạm hết lượt xử lý…" |
| AI quá 60 giây | "AI phản hồi quá lâu…", gửi lại câu hỏi được |
| Lỗi AI khác | "Xin lỗi, hiện tại tôi chưa thể xử lý câu hỏi này do hệ thống AI đang gặp sự cố…" |
| Tin rỗng | "Bạn vui lòng nhập câu hỏi." |
| Tin quá dài (> 4.000 ký tự) | Chỉ gửi phần đầu và báo cho AI biết. Câu trả lời dài được chia nhiều tin. |
| Ảnh, tệp, giọng nói | Báo chỉ hỗ trợ văn bản |
| Tin trong group | Hướng dẫn chat riêng với bot |
| Người chưa có quyền | Từ chối, kèm mã Telegram của họ |
| Lỗi đọc bộ nhớ | Trả lời không dùng lịch sử. Không bao giờ dùng lịch sử của người khác. |
| Telegram từ chối định dạng | Gửi lại dạng chữ thường |
| Không gửi được Telegram | Lần chạy bị đánh dấu lỗi, xem ở **Executions** |
| Telegram gửi trùng một tin | Bỏ qua theo `update_id` |

Nhật ký: workflow **không lưu nội dung các lần chạy thành công** (để tránh lưu hội thoại vào log); chỉ lưu lần chạy lỗi. Khi cần dò lỗi, vào **Settings** của workflow, đặt *Save successful production executions* = *Save*, xong việc thì tắt lại.

## 7. Cách kiểm thử

Chat riêng với bot (đúng tài khoản có trong `allowedUserIds`):

1. `/start`: bot giới thiệu TNM Assistant.
2. "Xin chào.": bot trả lời tự nhiên.
3. "Tôi đang xây dựng website bán thiết bị điện." → "Tôi sử dụng Next.js." → "Vậy công nghệ frontend của tôi là gì?": bot phải nói Next.js.
4. Trao đổi 5–10 lượt rồi hỏi "Hãy tóm tắt nội dung chúng ta vừa trao đổi."
5. Người thứ hai (đã thêm vào allowlist) hỏi "Bạn có biết tên dự án của tôi không?" sau khi người thứ nhất nói "Tên dự án của tôi là Project Alpha.": bot không được biết.
6. `/reset` rồi hỏi lại thông tin cũ: bot không còn nhớ.
7. "TNM quy định nhân viên nghỉ phép như thế nào?": bot báo chưa có kho quy định.
8. `/help`.
9. Gửi một ảnh: bot báo chỉ hỗ trợ văn bản.
10. Lỗi AI: tạm đổi `chatModel` thành tên không tồn tại, Publish, nhắn một câu (bot phải xin lỗi thân thiện), rồi đổi lại.

## 8. Giới hạn hiện tại

- Chưa có Knowledge Base, RAG, đọc tài liệu, tra cứu pháp luật, kết nối HRM (đúng phạm vi Phase 1).
- Gemini đang dùng **gói miễn phí**, giới hạn lượt theo ngày cho từng model. Khi hết lượt, bot báo "tạm hết lượt xử lý". Dùng thật cho nhiều nhân viên nên bật thanh toán cho Gemini API.
- Allowlist nằm trong node Config. Phase 5 sẽ thay bằng xác thực nhân viên qua HRM.
- Chỉ hỗ trợ chat riêng; trong group bot chỉ hướng dẫn chuyển sang chat riêng.
- Bot dùng chung với thông báo RFQ (xem mục 3).
