import Constants from "expo-constants";
import { LinearGradient } from "expo-linear-gradient";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { AppIcon, Glyph, type IconName } from "@/components/AppIcon";
import { SecondaryButton } from "@/components/GradientButton";
import { GridBackground } from "@/components/GridBackground";
import { NotificationBell } from "@/components/NotificationBell";
import { Card, FadeSlide, Screen } from "@/components/Screen";
import { useAuth } from "@/lib/auth";
import { Columns } from "@/lib/layout";
import { colors, fonts, gradients, radius, type Tone } from "@/lib/theme";

const ROLE_LABEL: Record<string, string> = { admin: "Admin", hr: "HR", engineer: "Kỹ sư", employee: "Nhân viên" };

function Row({ icon, tone, label, value }: { icon: IconName; tone: Tone; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <AppIcon name={icon} tone={tone} size={32} />
      <View style={styles.rowText}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowValue} numberOfLines={1}>{value}</Text></View>
    </View>
  );
}

export default function AccountScreen() {
  const { session, role, signOut } = useAuth();
  const email = session?.user.email ?? "";
  const initials = email.split("@")[0]?.slice(0, 2).toUpperCase() ?? "";
  return (
    <Screen wide title="Tài khoản" right={<NotificationBell />}>
      <Columns leftFlex={1} left={
      <FadeSlide delay={60}>
        <LinearGradient colors={gradients.skyline} locations={gradients.skylineStops} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <GridBackground tone="light" />
          <LinearGradient colors={gradients.sunrise} locations={gradients.sunriseStops} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </LinearGradient>
          <Text style={styles.email} numberOfLines={1}>{email}</Text>
          <Text style={styles.role}>{role ? ROLE_LABEL[role] ?? role : ""}</Text>
        </LinearGradient>
      </FadeSlide>
      } right={<>
      <FadeSlide delay={110}>
        <Card>
          <Row icon="user" tone="navy" label="Tài khoản đăng nhập" value={email} />
          <Row icon="shield" tone="orange" label="Vai trò" value={role ? ROLE_LABEL[role] ?? role : "—"} />
          <Row icon="lock" tone="sky" label="Đăng nhập" value="Mỗi tài khoản chỉ dùng một nơi, tối đa 24 giờ" />
        </Card>
      </FadeSlide>
      <FadeSlide delay={160}>
        <Pressable onPress={() => void Linking.openURL("https://tnm.com.vn/?desktop=1")} style={styles.link} accessibilityRole="link">
          <Glyph name="home" size={18} color={colors.skyDeep} fillOpacity={0.15} />
          <Text style={styles.linkText}>Mở bản web đầy đủ: tnm.com.vn</Text>
        </Pressable>
      </FadeSlide>
      <FadeSlide delay={200} from="up">
        <SecondaryButton label="Đăng xuất" danger onPress={() => void signOut()} icon={<Glyph name="logout" size={18} color={colors.bad} fillOpacity={0.12} />} />
      </FadeSlide>
      </>} />
      <Text style={styles.version}>Thiên Nhật Minh · phiên bản {Constants.expoConfig?.version ?? "1.0.0"}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.card, paddingVertical: 24, alignItems: "center", gap: 4, overflow: "hidden" },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  avatarText: { color: "#fff", fontFamily: fonts.black, fontSize: 20 },
  email: { color: "#fff", fontSize: 16, lineHeight: 24, fontFamily: fonts.bold, marginTop: 8, paddingHorizontal: 16 },
  role: { color: "#FFB27A", fontSize: 12, lineHeight: 16, fontFamily: fonts.bold },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 12, lineHeight: 16, fontFamily: fonts.semibold, color: colors.faint },
  rowValue: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, color: colors.navy },
  link: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.9)", borderWidth: 1, borderColor: colors.line },
  linkText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, color: colors.skyDeep },
  version: { textAlign: "center", fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, color: colors.faint, marginTop: 8 },
});
