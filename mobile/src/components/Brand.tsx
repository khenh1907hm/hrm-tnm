import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, gradients, radius } from "@/lib/theme";
import { GridBackground } from "./GridBackground";

/** Logo trong ô trắng bo tròn + tên công ty (chữ trắng, đặt trên nền màu). */
export function Brand() {
  return (
    <View style={styles.brand}>
      <View style={styles.logoBox}>
        <Image source={require("../../assets/tnm-emblem.png")} style={styles.logo} contentFit="contain" accessibilityLabel="Logo Thiên Nhật Minh" />
      </View>
      <View>
        <Text style={styles.name}>Thiên Nhật Minh</Text>
        <Text style={styles.sub}>Quản trị Online</Text>
      </View>
    </View>
  );
}

/** Phần đầu màn hình: gradient Bầu trời + lưới trắng mờ, bo tròn hai góc dưới. */
export function HeaderBand({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient colors={gradients.skyline} locations={gradients.skylineStops} start={{ x: 0, y: 0 }} end={{ x: 0.8, y: 1 }} style={[styles.band, { paddingTop: insets.top + 16 }]}>
      <GridBackground tone="light" />
      <View style={styles.bandInner}>
        <Brand />
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        {children}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", gap: 12 },
  logoBox: { width: 48, height: 48, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  logo: { width: 40, height: 25 },
  name: { fontSize: 16, lineHeight: 24, fontFamily: fonts.bold, color: "#fff" },
  sub: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, color: "rgba(255,255,255,0.85)" },
  band: { paddingHorizontal: 24, paddingBottom: 48, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet, overflow: "hidden" },
  bandInner: { width: "100%", maxWidth: 424, alignSelf: "center" },
  title: { marginTop: 24, fontSize: 24, lineHeight: 32, fontFamily: fonts.black, color: "#fff" },
  subtitle: { marginTop: 4, fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: "rgba(255,255,255,0.9)" },
});
