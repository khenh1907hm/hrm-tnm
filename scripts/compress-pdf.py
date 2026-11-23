"""Nén PDF scan xuống dưới giới hạn bucket: hạ độ phân giải ảnh dần cho tới khi đủ nhỏ.
python -I compress-pdf.py <vào.pdf> <ra.pdf> <số byte tối đa>"""
import os
import sys

import pymupdf

src, dst, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
for dpi, quality in ((200, 80), (150, 75), (130, 70), (110, 65), (96, 60)):
    doc = pymupdf.open(src)
    doc.rewrite_images(dpi_threshold=dpi + 10, dpi_target=dpi, quality=quality, lossy=True, lossless=True, bitonal=False, color=True, gray=True)
    doc.save(dst, garbage=4, deflate=True, clean=True)
    doc.close()
    if os.path.getsize(dst) <= limit:
        break
print(os.path.getsize(dst))
