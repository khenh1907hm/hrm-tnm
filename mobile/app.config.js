/**
 * Cấu hình động bọc app.json. Chỉ thêm một việc: khi build bản web để đặt dưới một đường dẫn con
 * (vd https://tnm.com.vn/app cho sếp xem trên trình duyệt), đặt EXPO_WEB_BASE_URL=/app lúc export.
 * Chạy bình thường (npx expo start, Expo Go, build điện thoại) không đổi gì.
 */
module.exports = ({ config }) => {
  const baseUrl = process.env.EXPO_WEB_BASE_URL;
  if (!baseUrl) return config;
  return { ...config, experiments: { ...config.experiments, baseUrl } };
};
