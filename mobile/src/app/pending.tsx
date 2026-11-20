import { StatusBar } from "expo-status-bar";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppIcon, Glyph } from "@/components/AppIcon";
import { HeaderBand } from "@/components/Brand";
import { SecondaryButton } from "@/components/GradientButton";
import { GridBackground } from "@/components/GridBackground";
import { useAuth } from "@/lib/auth";
import { colors, fonts, radius, shadow } from "@/lib/theme";

/** Tài khoản đã đăng nhập nhưng chưa được cấp quyền: không hiển thị dữ liệu nào. */
export default function PendingScreen() {
  const { session, signOut } = useAuth();
  return (
    <View style={styles.screen}>
      <GridBackground />
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <HeaderBand title="Chờ cấp quyền" />
        <View style={styles.card}>
          <AppIcon name="shield" tone="orange" size={48} />
          <Text style={styles.body}>
            Tài khoản <Text style={styles.bold}>{session?.user.email ?? "này"}</Text> đã đăng nhập nhưng chưa được cấp quyền truy cập dữ liệu nhân sự.
          </Text>
          <Text style={styles.muted}>Hãy báo Admin cấp vai trò Nhân viên, HR hoặc Admin cho tài khoản này, rồi đăng nhập lại.</Text>
          <SecondaryButton label="Đăng xuất" danger onPress={() => void signOut()} icon={<Glyph name="logout" size={18} color={colors.bad} fillOpacity={0.12} />} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, paddingBottom: 24 },
  card: { marginTop: -24, marginHorizontal: 16, backgroundColor: "#fff", borderRadius: radius.card, padding: 16, gap: 16, ...shadow.card },
  body: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.navy },
  bold: { fontFamily: fonts.bold },
  muted: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
});
