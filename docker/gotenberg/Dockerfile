# Gotenberg (LibreOffice) có cài font của mẫu hồ sơ, để PDF xuất ra giống file Excel.
# Image gốc chạy Linux, không có Tahoma/Times New Roman/Calibri/Segoe UI Symbol: LibreOffice thay bằng font khác
# rộng hơn → chữ xuống dòng, tràn ô, lệch bố cục. Đặt các tệp .ttf vào thư mục fonts/ (xem README.md) rồi build.
FROM gotenberg/gotenberg:8

USER root
COPY fonts/ /usr/local/share/fonts/tnm/
RUN chmod 644 /usr/local/share/fonts/tnm/* && fc-cache -f
USER gotenberg

CMD ["gotenberg", "--api-enable-basic-auth"]
