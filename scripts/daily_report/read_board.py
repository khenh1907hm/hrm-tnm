"""
Đọc ảnh bảng trắng phân công hằng ngày ở công trường thành dữ liệu báo cáo ngày (JSON ra stdout).

  python read_board.py --image bang.jpg [--roster roster.json]

Mô hình đọc ảnh chọn bằng biến môi trường:
  DAILY_REPORT_VISION_PROVIDER = "cloudflare" (mặc định), "gemini", "anthropic", hoặc chuỗi dự phòng "gemini,cloudflare"
  DAILY_REPORT_VISION_MODEL    = mô hình Cloudflare (mặc định @cf/mistralai/mistral-small-3.1-24b-instruct)
  Gemini: GEMINI_API_KEY, GEMINI_VISION_MODEL (mặc định gemini-flash-lite-latest).
  Cloudflare: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN. Claude: ANTHROPIC_API_KEY (model claude-opus-5-5).

Tên đọc được được so với danh sách công nhân của dự án (roster.json: [{"name": "Phạm Văn Kiến", "employeeId": "..."}])
để sửa dấu / sửa chữ sai; tên không khớp ai thì đánh dấu matched = false để chỉ huy trưởng kiểm tra.
Ảnh chỉ đọc trong bộ nhớ, không lưu lại.
"""
from __future__ import annotations

import argparse
import base64
import difflib
import io
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request

PROMPT = """Đây là ảnh bảng trắng phân công công việc hằng ngày ở công trường (tiếng Việt, viết tay).
Bố cục thường gặp:
- Dòng đầu: "Ngày .. Tháng .. Năm ....".
- Góc phải trên: TS (tổng số), HD (hiện diện), V (vắng). Chỉ cần đọc ba con số này; KHÔNG đọc tên người vắng.
- Danh sách công việc đánh số "1/", "2/", ...: tên công việc, mũi tên "=>", rồi tên các thành viên nối bằng dấu "+".
  Một công việc có thể viết tiếp sang dòng dưới (dòng bắt đầu bằng "+").
- Dấu ngoặc nhọn "}" bên phải gom một hoặc nhiều công việc; tên viết sau dấu ngoặc là NHÓM TRƯỞNG của TẤT CẢ các công việc nằm trong ngoặc.
  Công việc không nằm trong ngoặc nào thì nhóm trưởng để rỗng.
Chỉ trả về DUY NHẤT một JSON, không giải thích:
{"date": "YYYY-MM-DD", "total": số TS, "present": số HD, "absent": số V,
 "tasks": [{"no": số thứ tự, "task": "tên công việc", "leader": "nhóm trưởng hoặc rỗng", "members": ["tên", ...]}]}
Giữ đúng dấu tiếng Việt; chữ không đọc được thì để nguyên như đã thấy, không bịa thêm người.
Số nào không thấy trên bảng thì để null."""

CLOUDFLARE_DEFAULT_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct"
# Bí danh luôn trỏ tới bản Flash-Lite mới nhất (gói miễn phí nhiều lượt/ngày hơn Flash)
GEMINI_DEFAULT_MODEL = "gemini-flash-lite-latest"
CLAUDE_MODEL = "claude-opus-5-5"
MAX_SIDE = 1600


class ReadError(Exception):
    """Lỗi đọc ảnh có thông báo tiếng Việt cho người dùng."""


def shrink(image_bytes: bytes) -> tuple[bytes, str]:
    """Thu ảnh về cạnh dài tối đa 1600 px (JPEG) cho nhanh; không có Pillow thì gửi nguyên ảnh."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return image_bytes, "image/jpeg"
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    image.save(out, "JPEG", quality=85)
    return out.getvalue(), "image/jpeg"


def extract_json(text: str) -> dict:
    """Lấy khối JSON đầu tiên trong câu trả lời (mô hình hay bọc trong ```json ... ```)."""
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ReadError("Mô hình không trả về dữ liệu đọc được. Hãy chụp lại rõ hơn hoặc nhập tay.")
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError as error:
        raise ReadError("Dữ liệu mô hình trả về bị lỗi định dạng. Hãy thử lại.") from error


def read_with_cloudflare(image: bytes, media_type: str) -> tuple[str, str]:
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if not account or not token:
        raise ReadError("Máy chủ chưa cấu hình Cloudflare (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN).")
    model = os.environ.get("DAILY_REPORT_VISION_MODEL", "").strip() or CLOUDFLARE_DEFAULT_MODEL
    data_url = f"data:{media_type};base64,{base64.b64encode(image).decode()}"
    body = {"messages": [{"role": "user", "content": [
        {"type": "text", "text": PROMPT},
        {"type": "image_url", "image_url": {"url": data_url}},
    ]}], "max_tokens": 2048, "temperature": 0}
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}",
        data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise ReadError(f"Cloudflare báo lỗi {error.code} khi đọc ảnh.") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise ReadError("Không kết nối được Cloudflare để đọc ảnh.") from error
    text = (result.get("result") or {}).get("response")
    if isinstance(text, dict):
        return json.dumps(text, ensure_ascii=False), model
    if not isinstance(text, str):
        raise ReadError("Cloudflare không trả về nội dung.")
    return text, model


def read_with_gemini(image: bytes, media_type: str) -> tuple[str, str]:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise ReadError("Máy chủ chưa cấu hình Gemini (GEMINI_API_KEY).")
    model = os.environ.get("GEMINI_VISION_MODEL", "").strip() or GEMINI_DEFAULT_MODEL
    body = {
        "contents": [{"role": "user", "parts": [
            {"inline_data": {"mime_type": media_type, "data": base64.b64encode(image).decode()}},
            {"text": PROMPT},
        ]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json", "maxOutputTokens": 4096},
    }
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(body).encode(), headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 429:
            raise ReadError("Gemini đã hết lượt miễn phí hôm nay (hoặc gọi quá nhanh).") from error
        raise ReadError(f"Gemini báo lỗi {error.code} khi đọc ảnh.") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise ReadError("Không kết nối được Gemini để đọc ảnh.") from error
    parts = ((result.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict))
    if not text:
        raise ReadError("Gemini không trả về nội dung.")
    return text, model


def read_with_claude(image: bytes, media_type: str) -> tuple[str, str]:
    try:
        import anthropic
    except ImportError as error:
        raise ReadError("Máy chủ chưa cài thư viện anthropic cho Python.") from error
    client = anthropic.Anthropic()
    try:
        # Bật dự phòng phía máy chủ: Claude từ chối thì tự chạy lại trên mô hình khác trong cùng lần gọi
        response = client.beta.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": base64.standard_b64encode(image).decode("utf-8")}},
                {"type": "text", "text": PROMPT},
            ]}],
        )
    except anthropic.AuthenticationError as error:
        raise ReadError("API key Claude không hợp lệ.") from error
    except anthropic.RateLimitError as error:
        raise ReadError("Claude đang quá tải, thử lại sau ít phút.") from error
    except anthropic.APIStatusError as error:
        raise ReadError(f"Claude báo lỗi {error.status_code} khi đọc ảnh.") from error
    except anthropic.APIConnectionError as error:
        raise ReadError("Không kết nối được Claude để đọc ảnh.") from error
    if response.stop_reason == "refusal":
        raise ReadError("Claude không đọc ảnh này. Hãy nhập tay.")
    text = "".join(block.text for block in response.content if block.type == "text")
    return text, response.model


# ───────────── So tên với danh sách công nhân ─────────────
def plain(text: str) -> str:
    text = unicodedata.normalize("NFD", text).replace("đ", "d").replace("Đ", "D")
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn").lower().strip()


def given_name(full: str) -> str:
    """Tên gọi = chữ cuối ("T.Giang" → "Giang", "Phạm Văn Kiến" → "Kiến")."""
    parts = [part for part in re.split(r"[\s.]+", full.strip()) if part]
    return parts[-1] if parts else ""


class Roster:
    def __init__(self, people: list[dict]):
        self.people = [p for p in people if str(p.get("name", "")).strip()]

    def match(self, text: str) -> dict:
        """
        Trả về {text, name, matched, confidence, employeeId?}. confidence: "exact" (đúng cả dấu), "accent" (chỉ khớp khi bỏ dấu),
        "fuzzy" (gần giống), "none" (không khớp ai). Chỉ nhận khi có đúng một người khớp; còn nghi ngờ thì để người dùng kiểm tra.
        """
        raw = re.sub(r"\s+", " ", str(text)).strip(" +.,;")
        result = {"text": raw, "name": raw, "matched": False, "confidence": "none"}
        if not raw or not self.people:
            return result
        key = given_name(raw)
        prefix = raw[: -len(key)].strip(" .") if key and raw.endswith(key) and len(raw) > len(key) else ""
        confidence = "exact"
        candidates = [p for p in self.people if given_name(p["name"]).lower() == key.lower()]
        if len(candidates) != 1:
            confidence = "accent"
            same = [p for p in self.people if plain(given_name(p["name"])) == plain(key)]
            candidates = same if len(same) == 1 else []
        if len(candidates) != 1:
            confidence = "fuzzy"
            names = sorted({plain(given_name(p["name"])) for p in self.people})
            close = difflib.get_close_matches(plain(key), names, n=2, cutoff=0.8)
            candidates = [p for p in self.people if plain(given_name(p["name"])) == close[0]] if len(close) == 1 else []
        if len(candidates) == 1:
            person = candidates[0]
            name = given_name(person["name"])
            # Giữ chữ viết tắt phía trước để phân biệt hai người trùng tên ("T.Giang")
            return {"text": raw, "name": f"{prefix}.{name}" if prefix else name, "matched": True, "confidence": confidence, "fullName": person["name"], "employeeId": person.get("employeeId")}
        return result


def to_int(value) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def normalize(data: dict, roster: Roster) -> dict:
    date = str(data.get("date") or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        date = ""
    tasks = []
    for index, task in enumerate(data.get("tasks") or [], start=1):
        if not isinstance(task, dict):
            continue
        members = [roster.match(name) for name in task.get("members") or [] if str(name).strip()]
        leader_text = str(task.get("leader") or "").strip()
        tasks.append({
            "no": to_int(task.get("no")) or index,
            "task": re.sub(r"\s+", " ", str(task.get("task") or "")).strip(),
            "leader": roster.match(leader_text) if leader_text else None,
            "members": members,
        })
    # Chỉ đọc số TS / HD / V; không đọc tên người vắng (mô hình hay bịa tên từ danh sách công việc)
    return {
        "date": date,
        "total": to_int(data.get("total")),
        "present": to_int(data.get("present")),
        "absent": to_int(data.get("absent")),
        "absentNames": [],
        "tasks": tasks,
    }


READERS = {"gemini": read_with_gemini, "cloudflare": read_with_cloudflare, "anthropic": read_with_claude}


def read_with_providers(image: bytes, media_type: str) -> tuple[str, str]:
    """Thử lần lượt các nhà cung cấp trong DAILY_REPORT_VISION_PROVIDER ("gemini,cloudflare"): cái đầu lỗi / hết lượt thì dùng cái sau."""
    names = [name.strip().lower() for name in os.environ.get("DAILY_REPORT_VISION_PROVIDER", "cloudflare").split(",") if name.strip()]
    readers = [READERS[name] for name in names if name in READERS] or [read_with_cloudflare]
    errors: list[str] = []
    for reader in readers:
        try:
            return reader(image, media_type)
        except ReadError as error:
            errors.append(str(error))
    raise ReadError(" ".join(errors))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--roster")
    args = parser.parse_args()
    try:
        with open(args.image, "rb") as handle:
            image, media_type = shrink(handle.read())
        people = json.load(open(args.roster, encoding="utf-8")) if args.roster else []
        text, model = read_with_providers(image, media_type)
        result = normalize(extract_json(text), Roster(people))
        result["model"] = model
        print(json.dumps({"ok": True, "data": result}, ensure_ascii=False))
        return 0
    except ReadError as error:
        print(json.dumps({"ok": False, "message": str(error)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
