import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

/** Cùng project Supabase với bản web (hrm-tnm). Chỉ dùng khóa công khai (publishable). */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url ?? "http://localhost", key ?? "missing", {
  auth: {
    // Lưu phiên trên máy: mở lại app không phải đăng nhập lại
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Trên điện thoại: chỉ tự làm mới token khi app đang mở (app chạy nền thì dừng)
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}
