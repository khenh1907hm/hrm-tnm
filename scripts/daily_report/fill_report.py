"""
Điền báo cáo ngày vào mẫu "BC ngày" (template.xlsx) và chèn ảnh thi công (0–12, không bắt buộc) vào khung bên dưới, 2 ảnh mỗi hàng.

  python fill_report.py --data report.json --out bao-cao.xlsx [--photo a.jpg ...] [--template template.xlsx]

report.json: {"projectName", "projectCode", "date": "YYYY-MM-DD", "total", "present", "absent", "absentNames": [..],
              "otCount", "otHours", "cumulativeWorkdays", "cumulativeOtHours", "tasks": [{"no", "task", "leader", "members": [..]}]}
Ảnh được thu nhỏ (cạnh dài 1280 px, JPEG) chỉ trong bộ nhớ để file gửi Telegram nhẹ; không ghi ảnh ra đĩa.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys

from openpyxl import load_workbook
from openpyxl.drawing.image import Image as XlImage
from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.utils import column_index_from_string
from openpyxl.utils.units import pixels_to_EMU
from openpyxl.styles import Alignment, Border, Side
from openpyxl.worksheet.pagebreak import Break

HERE = os.path.dirname(os.path.abspath(__file__))
SHEET = "BC ngày"
TASK_FIRST_ROW, TASK_LAST_ROW = 6, 17
# Phần ảnh của mẫu: tiêu đề "Hình Ảnh Dự Án" ở dòng 19, sáu hàng khung (mỗi hàng 13 dòng, trái A:E / phải F:H).
# Trang 1 chứa 2 hàng khung (dòng 21–46), dòng 47 là ngắt trang, trang 2 chứa 4 hàng (48–99).
PHOTO_SECTION_FIRST_ROW = 18
PHOTO_ROW_STARTS = [21, 34, 48, 61, 74, 87]
PHOTO_ROW_HEIGHT = 13
MAX_PHOTOS = 2 * len(PHOTO_ROW_STARTS)
PHOTO_SIDE = 1280
THIN = Side(style="thin")


def column_px(sheet, letter: str) -> float:
    width = sheet.column_dimensions[letter].width or 8.43
    return width * 7 + 5


def row_px(sheet, row: int) -> float:
    height = sheet.row_dimensions[row].height or sheet.sheet_format.defaultRowHeight or 15
    return height * 96 / 72


def block_size(sheet, first_col: str, last_col: str, first_row: int, last_row: int) -> tuple[float, float]:
    cols = [chr(code) for code in range(ord(first_col), ord(last_col) + 1)]
    return sum(column_px(sheet, col) for col in cols), sum(row_px(sheet, row) for row in range(first_row, last_row + 1))


def photo_image(path: str, max_w: float, max_h: float) -> XlImage:
    from PIL import Image, ImageOps
    picture = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    picture.thumbnail((PHOTO_SIDE, PHOTO_SIDE))
    buffer = io.BytesIO()
    picture.save(buffer, "JPEG", quality=78)
    buffer.seek(0)
    image = XlImage(buffer)
    # Vừa khung, giữ tỷ lệ, chừa lề 6 px
    scale = min((max_w - 12) / picture.width, (max_h - 12) / picture.height)
    image.width, image.height = picture.width * scale, picture.height * scale
    return image


def box(sheet, first_row: int, last_row: int) -> None:
    """Viền mỏng quanh khối A:H của một hàng khung, bỏ đường chia giữa E|F."""
    for row in range(first_row, last_row + 1):
        for col in "ABCDEFGH":
            sheet[f"{col}{row}"].border = Border(
                left=THIN if col == "A" else Side(), right=THIN if col == "H" else Side(),
                top=THIN if row == first_row else Side(), bottom=THIN if row == last_row else Side())


def dmy(iso: str) -> str:
    parts = (iso or "").split("-")
    return f"{parts[2]}/{parts[1]}/{parts[0]}" if len(parts) == 3 else iso or ""


def number(value):
    if value is None or value == "":
        return None
    try:
        as_float = float(value)
    except (TypeError, ValueError):
        return value
    return int(as_float) if as_float.is_integer() else as_float


def fill(template: str, data: dict, photos: list[str], out: str) -> None:
    book = load_workbook(template)
    for name in list(book.sheetnames):
        if name != SHEET:
            del book[name]
    sheet = book[SHEET]

    sheet["A1"] = f"BÁO CÁO NGÀY DỰ ÁN: {data.get('projectName', '')}".strip()
    sheet["H1"] = data.get("projectCode", "")
    sheet["B2"] = dmy(data.get("date", ""))
    for cell, key in (("D2", "total"), ("F2", "present"), ("H2", "absent"), ("B3", "otCount"), ("D3", "otHours"), ("F3", "cumulativeWorkdays"), ("H3", "cumulativeOtHours")):
        sheet[cell] = number(data.get(key))

    # Chỉ ghi số vắng (ô H2), không ghi tên người vắng: dòng 4 của mẫu để trống
    wrap = Alignment(wrap_text=True, vertical="center")
    tasks = list(data.get("tasks") or [])
    capacity = TASK_LAST_ROW - TASK_FIRST_ROW + 1
    if len(tasks) > capacity:
        # Mẫu có 12 dòng: gộp phần dư vào dòng cuối để không mất thông tin
        extra = tasks[capacity - 1:]
        tasks = tasks[: capacity - 1] + [{"no": extra[0].get("no"), "task": "; ".join(str(t.get("task", "")) for t in extra), "leader": "", "members": [m for t in extra for m in t.get("members") or []]}]
    for offset, task in enumerate(tasks):
        row = TASK_FIRST_ROW + offset
        members = [name for name in task.get("members") or [] if name]
        sheet[f"A{row}"] = task.get("no") or offset + 1
        sheet[f"A{row}"].alignment = Alignment(horizontal="center", vertical="center")
        sheet[f"B{row}"] = task.get("task", "")
        sheet[f"B{row}"].alignment = wrap
        sheet[f"F{row}"] = task.get("leader") or ""
        sheet[f"F{row}"].alignment = wrap
        sheet[f"G{row}"] = " + ".join(members)
        sheet[f"G{row}"].alignment = wrap
        # Dòng nhiều tên thì cao lên cho đủ chữ (khoảng 22 ký tự / dòng ở cột Thành viên)
        lines = max(1, -(-len(sheet[f"G{row}"].value or "") // 22), -(-len(str(task.get("task", ""))) // 28))
        sheet.row_dimensions[row].height = max(18.85, 15 * lines)

    # Khung ảnh: chỉ giữ đủ hàng khung cho số ảnh đã chọn (2 ảnh mỗi hàng); không có ảnh thì bỏ cả phần "Hình Ảnh Dự Án"
    photos = photos[:MAX_PHOTOS]
    frame_rows = -(-len(photos) // 2)
    last_row = PHOTO_ROW_STARTS[frame_rows - 1] + PHOTO_ROW_HEIGHT - 1 if frame_rows else TASK_LAST_ROW
    for merged in list(sheet.merged_cells.ranges):
        if merged.min_row > last_row:
            sheet.unmerge_cells(str(merged))
    if sheet.max_row > last_row:
        sheet.delete_rows(last_row + 1, sheet.max_row - last_row)
    if not frame_rows and sheet.max_row >= PHOTO_SECTION_FIRST_ROW:
        sheet.delete_rows(PHOTO_SECTION_FIRST_ROW, sheet.max_row - PHOTO_SECTION_FIRST_ROW + 1)

    blocks = []
    for index in range(len(photos)):
        start = PHOTO_ROW_STARTS[index // 2]
        end = start + PHOTO_ROW_HEIGHT - 1
        if index == len(photos) - 1 and index % 2 == 0:
            # Ảnh lẻ cuối cùng: gộp cả hàng A:H để ảnh nằm giữa, không để trống khung bên phải
            sheet.unmerge_cells(f"A{start}:E{end}")
            sheet.unmerge_cells(f"F{start}:H{end}")
            sheet.merge_cells(f"A{start}:H{end}")
            box(sheet, start, end)
            blocks.append(("A", "H", start, end))
        else:
            blocks.append(("A", "E", start, end) if index % 2 == 0 else ("F", "H", start, end))
    if frame_rows > 2:
        # Hai hàng khung đầu ở trang 1, phần còn lại sang trang 2 (giữ nguyên khung, không cắt đôi ảnh)
        sheet.row_breaks.append(Break(id=PHOTO_ROW_STARTS[2] - 1))

    for path, (first_col, last_col, first_row, last_row_block) in zip(photos, blocks):
        width, height = block_size(sheet, first_col, last_col, first_row, last_row_block)
        image = photo_image(path, width, height)
        # Căn giữa ảnh trong khung (lệch theo pixel tính từ ô trên-trái của khung)
        offset_x, offset_y = (width - image.width) / 2, (height - image.height) / 2
        marker = AnchorMarker(col=column_index_from_string(first_col) - 1, colOff=pixels_to_EMU(int(offset_x)), row=first_row - 1, rowOff=pixels_to_EMU(int(offset_y)))
        image.anchor = OneCellAnchor(_from=marker, ext=XDRPositiveSize2D(pixels_to_EMU(int(image.width)), pixels_to_EMU(int(image.height))))
        sheet.add_image(image)

    sheet.print_area = f"A1:H{last_row}"
    sheet.page_setup.orientation = "portrait"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    book.save(out)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--photo", action="append", default=[])
    parser.add_argument("--template", default=os.path.join(HERE, "template.xlsx"))
    args = parser.parse_args()
    with open(args.data, encoding="utf-8") as handle:
        data = json.load(handle)
    fill(args.template, data, args.photo, args.out)
    print(json.dumps({"ok": True, "out": args.out}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
