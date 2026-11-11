"""
Điền báo cáo ngày vào mẫu "BC ngày" (template.xlsx) và chèn tối đa 4 ảnh thi công vào khung 2×2 bên dưới.

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
from openpyxl.styles import Alignment, Font

HERE = os.path.dirname(os.path.abspath(__file__))
SHEET = "BC ngày"
TASK_FIRST_ROW, TASK_LAST_ROW = 6, 17
# Khung ảnh 2×2: hai khối trái (A:E) / phải (F:H) của hai hàng ảnh đầu tiên trong mẫu
PHOTO_BLOCKS = [("A", "E", 21, 33), ("F", "H", 21, 33), ("A", "E", 34, 46), ("F", "H", 34, 46)]
LAST_ROW = 46
MAX_PHOTOS = 4
PHOTO_SIDE = 1280


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

    # Người vắng: dòng 4 (mẫu để trống)
    absent = [name for name in data.get("absentNames") or [] if name]
    sheet.merge_cells("A4:H4")
    sheet["A4"] = f"Người vắng: {', '.join(absent)}" if absent else ""
    sheet["A4"].alignment = Alignment(wrap_text=True, vertical="center")
    sheet["A4"].font = Font(italic=True)

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

    # Bỏ các khối ảnh thừa của mẫu (dòng 47 trở đi), chỉ giữ khung 2×2
    for merged in list(sheet.merged_cells.ranges):
        if merged.min_row > LAST_ROW:
            sheet.unmerge_cells(str(merged))
    if sheet.max_row > LAST_ROW:
        sheet.delete_rows(LAST_ROW + 1, sheet.max_row - LAST_ROW)

    for path, (first_col, last_col, first_row, last_row) in zip(photos[:MAX_PHOTOS], PHOTO_BLOCKS):
        width, height = block_size(sheet, first_col, last_col, first_row, last_row)
        image = photo_image(path, width, height)
        # Căn giữa ảnh trong khung (lệch theo pixel tính từ ô trên-trái của khung)
        offset_x, offset_y = (width - image.width) / 2, (height - image.height) / 2
        marker = AnchorMarker(col=column_index_from_string(first_col) - 1, colOff=pixels_to_EMU(int(offset_x)), row=first_row - 1, rowOff=pixels_to_EMU(int(offset_y)))
        image.anchor = OneCellAnchor(_from=marker, ext=XDRPositiveSize2D(pixels_to_EMU(int(image.width)), pixels_to_EMU(int(image.height))))
        sheet.add_image(image)

    sheet.print_area = f"A1:H{LAST_ROW}"
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
