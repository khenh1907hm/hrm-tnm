import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, gradients, radius, shadow } from "@/lib/theme";
import { MiniSpinner } from "./LogoLoader";

/** Nút chính: gradient Bình minh (cam → hồng đỏ). Mỗi màn hình chỉ một nút này. */
export function GradientButton({ label, busyLabel, busy = false, onPress }: { label: string; busyLabel?: string; busy?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}>
      <LinearGradient colors={gradients.sunrise} locations={gradients.sunriseStops} start={{ x: 0, y: 0.3 }} end={{ x: 1, y: 0.7 }} style={styles.fill}>
        {busy && <MiniSpinner />}
        <Text style={styles.text}>{busy ? busyLabel ?? label : label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

/** Nút phụ: nền trắng, viền xanh da trời. */
export function SecondaryButton({ label, onPress, danger = false, icon }: { label: string; onPress: () => void; danger?: boolean; icon?: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
      <View style={styles.row}>{icon}<Text style={[styles.secondaryText, danger && { color: colors.bad }]}>{label}</Text></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.control, ...shadow.button, shadowOpacity: 0.24, shadowRadius: 12 },
  pressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  fill: { minHeight: 48, borderRadius: radius.control, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16 },
  text: { color: "#fff", fontSize: 16, lineHeight: 24, fontFamily: fonts.bold },
  secondary: { minHeight: 48, borderRadius: radius.control, borderWidth: 1.5, borderColor: colors.sky, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  secondaryText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.semibold, color: colors.navy },
});
