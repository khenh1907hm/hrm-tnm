import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs";
import { Fragment, useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Glyph, type IconName } from "@/components/AppIcon";
import { CreateSheet } from "@/components/CreateSheet";
import { colors, fonts, gradients } from "@/lib/theme";

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: "Điểm danh", icon: "clock" },
  report: { label: "Báo cáo", icon: "report" },
  settings: { label: "Cài đặt", icon: "settings" },
  account: { label: "Tài khoản", icon: "user" },
};
/** Nút + chen vào giữa, sau tab thứ mấy. */
const CENTER_AFTER = 2;

function TabItem({ focused, label, icon, onPress }: { focused: boolean; label: string; icon: IconName; onPress: () => void }) {
  const anim = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => { Animated.spring(anim, { toValue: focused ? 1 : 0, useNativeDriver: true, friction: 7, tension: 90 }).start(); }, [focused, anim]);
  return (
    <Pressable onPress={onPress} style={styles.item} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={label}>
      <Animated.View style={[styles.bubbleWrap, { opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
        <LinearGradient colors={gradients.sunrise} locations={gradients.sunriseStops} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.bubble} />
      </Animated.View>
      <Animated.View style={{ transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) }] }}>
        <Glyph name={icon} size={20} color={focused ? "#fff" : colors.faint} fillOpacity={focused ? 0.3 : 0.14} />
      </Animated.View>
      <Text style={[styles.label, focused && styles.labelOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Nút + tròn gradient nổi lên giữa thanh menu: mở "Tạo mới" (đơn, phiếu…). */
function CenterButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]} accessibilityRole="button" accessibilityLabel="Tạo mới">
      <LinearGradient colors={gradients.sunrise} locations={gradients.sunriseStops} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabFill}>
        <Glyph name="add" size={28} color="#fff" fillOpacity={0} strokeWidth={2.8} />
      </LinearGradient>
    </Pressable>
  );
}

/** Thanh tab kính mờ nổi ở đáy, tab đang chọn có bong bóng gradient Bình minh, nút + ở giữa. */
function GlassTabBar({ state, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [creating, setCreating] = useState(false);
  return (
    <View style={[styles.outer, { paddingBottom: Math.max(insets.bottom, 8) }]} pointerEvents="box-none">
      <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        {Platform.OS === "ios" ? <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} /> : null}
        {state.routes.map((route, index) => {
          const meta = TABS[route.name];
          if (!meta) return null;
          const focused = state.index === index;
          return (
            <Fragment key={route.key}>
            {index === CENTER_AFTER ? <View style={styles.slot} /> : null}
            <TabItem
              focused={focused}
              label={meta.label}
              icon={meta.icon}
              onPress={() => {
                if (focused) return;
                if (Platform.OS !== "web") void Haptics.selectionAsync().catch(() => undefined);
                navigateToTab(route.key);
              }}
            />
            </Fragment>
          );
        })}
      </View>
      <View style={styles.fabHolder} pointerEvents="box-none">
        <CenterButton onPress={() => {
          if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
          setCreating(true);
        }} />
      </View>
      </View>
      <CreateSheet visible={creating} onClose={() => setCreating(false)} />
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{ headerShown: false, animation: "shift", sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="report" />
      <Tabs.Screen name="settings" />
      <Tabs.Screen name="account" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  outer: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", paddingHorizontal: 16 },
  wrap: { width: "100%", maxWidth: 480 },
  slot: { width: 64 },
  fabHolder: { position: "absolute", top: -22, left: 0, right: 0, alignItems: "center" },
  fab: { width: 60, height: 60, borderRadius: 30, borderWidth: 4, borderColor: "#fff", shadowColor: "#FF2E6E", shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 12, backgroundColor: "#fff" },
  fabPressed: { transform: [{ scale: 0.94 }] },
  fabFill: { flex: 1, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  bar: {
    width: "100%", maxWidth: 480, height: 64, borderRadius: 24, overflow: "hidden", flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 4,
    backgroundColor: Platform.OS === "ios" ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.96)", borderWidth: 1, borderColor: "rgba(220,230,244,0.95)",
    shadowColor: "#0B1F66", shadowOpacity: 0.16, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 10,
  },
  item: { flex: 1, height: 56, alignItems: "center", justifyContent: "center", gap: 4 },
  bubbleWrap: { position: "absolute", top: 4, width: 48, height: 28, alignItems: "center", justifyContent: "center" },
  bubble: { width: 48, height: 28, borderRadius: 14 },
  label: { fontSize: 11, lineHeight: 16, fontFamily: fonts.semibold, color: colors.faint },
  labelOn: { color: colors.orange, fontFamily: fonts.bold },
});
