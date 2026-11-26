import { BeVietnamPro_400Regular, BeVietnamPro_500Medium, BeVietnamPro_600SemiBold, BeVietnamPro_700Bold, BeVietnamPro_800ExtraBold, useFonts } from "@expo-google-fonts/be-vietnam-pro";
import { LinearGradient } from "expo-linear-gradient";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GridBackground } from "@/components/GridBackground";
import { LogoLoader } from "@/components/LogoLoader";
import { ToastProvider } from "@/components/Toast";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useOrientationPolicy } from "@/lib/layout";
import { SettingsProvider } from "@/lib/settings";
import { colors, fonts, gradients } from "@/lib/theme";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Màn hình mở app: nền Bầu trời + lưới, logo TNM có vòng tải chạy quanh. */
function LoadingScreen({ fontsReady }: { fontsReady: boolean }) {
  return (
    <LinearGradient colors={gradients.skyline} locations={gradients.skylineStops} start={{ x: 0, y: 0 }} end={{ x: 0.8, y: 1 }} style={styles.loading}>
      <GridBackground tone="light" />
      <LogoLoader />
      {fontsReady && <Text style={styles.loadingName}>Thiên Nhật Minh</Text>}
      {fontsReady && <Text style={styles.loadingSub}>Đang tải dữ liệu…</Text>}
    </LinearGradient>
  );
}

function RootStack() {
  const { status } = useAuth();
  if (status === "loading") return <LoadingScreen fontsReady />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: "fade" }}>
      <Stack.Protected guard={status === "signedOut"}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Protected guard={status === "pending"}>
        <Stack.Screen name="pending" />
      </Stack.Protected>
      <Stack.Protected guard={status === "ready"}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="notifications" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="explain" options={{ animation: "slide_from_bottom" }} />
        <Stack.Screen name="tool-check" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="inspection" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="monthly" options={{ animation: "slide_from_right" }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({ BeVietnamPro_400Regular, BeVietnamPro_500Medium, BeVietnamPro_600SemiBold, BeVietnamPro_700Bold, BeVietnamPro_800ExtraBold });
  const fontsReady = loaded || Boolean(error);
  useOrientationPolicy();

  // Ẩn màn hình chờ hệ thống ngay để hiện vòng tải của app
  useEffect(() => { void SplashScreen.hideAsync().catch(() => undefined); }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SettingsProvider>
        <ToastProvider>
          <StatusBar style="dark" />
          {fontsReady ? <RootStack /> : <LoadingScreen fontsReady={false} />}
        </ToastProvider>
        </SettingsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  loadingName: { marginTop: 8, fontSize: 20, lineHeight: 28, fontFamily: fonts.black, color: "#fff" },
  loadingSub: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, color: "rgba(255,255,255,0.85)" },
});
