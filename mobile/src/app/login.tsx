import { useRef, useState, type ComponentRef } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Glyph } from "@/components/AppIcon";
import { HeaderBand } from "@/components/Brand";
import { GradientButton } from "@/components/GradientButton";
import { GridBackground } from "@/components/GridBackground";
import { Mascot } from "@/components/Mascot";
import { useAuth } from "@/lib/auth";
import { useLayout } from "@/lib/layout";
import { colors, fonts, radius, shadow } from "@/lib/theme";

export default function LoginScreen() {
  const { signIn, notice } = useAuth();
  const insets = useSafeAreaInsets();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState<"login" | "password" | null>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  const submit = async () => {
    if (busy) return;
    if (!login.trim() || !password) { setError("Nhập email (mã nhân viên) và mật khẩu."); return; }
    setBusy(true); setError(null);
    const message = await signIn(login.trim(), password);
    setBusy(false);
    if (message) setError(message);
  };

  const shownError = error ?? notice;
  // Nhân vật chào: điện thoại 130–180, tablet 180–260 theo chiều cao cửa sổ; cửa sổ quá thấp thì ẩn.
  const { height: winHeight, tablet } = useLayout();
  const mascotHeight = winHeight < 620 ? 0
    : tablet ? Math.round(Math.min(260, Math.max(180, winHeight * 0.24)))
    : Math.round(Math.min(180, Math.max(130, winHeight * 0.2)));

  return (
    <View style={styles.screen}>
      <GridBackground />
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 16 }]} keyboardShouldPersistTaps="handled">
          <HeaderBand title="Đăng nhập" subtitle="Chào mừng bạn quay lại làm việc." />

          <View style={styles.cardWrap}>
          <View style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.label}>Email hoặc mã nhân viên</Text>
              <View style={[styles.inputRow, focused === "login" && styles.inputFocused]}>
                <Glyph name="user" size={18} color={colors.skyDeep} fillOpacity={0.15} />
                <TextInput
                  style={styles.input}
                  value={login}
                  onChangeText={setLogin}
                  onFocus={() => setFocused("login")}
                  onBlur={() => setFocused(null)}
                  placeholder="TNM001"
                  placeholderTextColor={colors.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                  keyboardType="email-address"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  editable={!busy}
                  accessibilityLabel="Email hoặc mã nhân viên"
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Mật khẩu</Text>
              <View style={[styles.inputRow, focused === "password" && styles.inputFocused]}>
                <Glyph name="lock" size={18} color={colors.skyDeep} fillOpacity={0.15} />
                <TextInput
                  ref={passwordRef}
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setFocused("password")}
                  onBlur={() => setFocused(null)}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={() => void submit()}
                  editable={!busy}
                  accessibilityLabel="Mật khẩu"
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10} accessibilityRole="button" accessibilityLabel={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
                  <Text style={styles.toggle}>{showPassword ? "Ẩn" : "Hiện"}</Text>
                </Pressable>
              </View>
            </View>

            {shownError && <Text style={styles.error} accessibilityRole="alert">{shownError}</Text>}

            <GradientButton label="Đăng nhập" busyLabel="Đang đăng nhập…" busy={busy} onPress={() => void submit()} />
          </View>

          </View>

          <View style={styles.foot}>
            {mascotHeight > 0 && <Mascot height={mascotHeight} />}
            <Text style={styles.hint}>Tài khoản do quản trị viên cấp. Liên hệ Admin nếu quên mật khẩu.</Text>
            <Pressable onPress={() => void Linking.openURL("https://www.thiennhatminh.com")} accessibilityRole="link" hitSlop={8}>
              <Text style={styles.site}>www.thiennhatminh.com</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  cardWrap: { marginTop: -24, paddingHorizontal: 16, alignItems: "center" },
  card: {
    width: "100%", maxWidth: 440,
    backgroundColor: "#fff", borderRadius: radius.card, padding: 16, gap: 16, ...shadow.card,
  },
  field: { gap: 4 },
  label: { fontSize: 12, lineHeight: 16, fontFamily: fonts.bold, color: colors.navy },
  inputRow: {
    height: 48, borderRadius: radius.control, borderWidth: 1.5, borderColor: colors.fieldLine, backgroundColor: colors.field,
    flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12,
  },
  inputFocused: { borderColor: colors.sky, backgroundColor: "#fff" },
  input: { flex: 1, height: 44, fontSize: 16, fontFamily: fonts.medium, color: colors.navy },
  toggle: { fontSize: 12, lineHeight: 16, fontFamily: fonts.bold, color: colors.skyDeep },
  error: { fontSize: 14, lineHeight: 20, fontFamily: fonts.medium, color: colors.bad, backgroundColor: colors.badBg, borderWidth: 1, borderColor: colors.badLine, borderRadius: 12, padding: 12 },
  foot: { marginTop: "auto", paddingTop: 24, marginHorizontal: 16, alignItems: "center", gap: 8 },
  hint: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted, textAlign: "center" },
  site: { fontSize: 12, lineHeight: 16, fontFamily: fonts.semibold, color: colors.skyDeep },
});
