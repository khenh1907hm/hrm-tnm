import { useFocusEffect } from "expo-router";
import { useCallback, useRef, type ReactNode } from "react";
import { Animated, Easing, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius, space, text } from "@/lib/theme";
import { Glyph } from "./AppIcon";
import { useLayout } from "@/lib/layout";
import { GridBackground } from "./GridBackground";

/** Chiều rộng nội dung tối đa, căn giữa: một cột (máy tính bảng / web không bị kéo dãn) và hai cột (`wide`). */
export const CONTENT_MAX = 560;
export const CONTENT_MAX_TABLET = 640;
export const CONTENT_MAX_WIDE = 1080;

/**
 * Hiệu ứng mỗi lần vào trang: mờ dần hiện ra và trượt ngang nhẹ (từ phải sang, hoặc từ trái khi `from="left"`).
 * Chạy lại mỗi lần trang được chọn.
 */
export function FadeSlide({ children, from = "right", delay = 0, style }: { children: ReactNode; from?: "left" | "right" | "up"; delay?: number; style?: ViewStyle }) {
  const progress = useRef(new Animated.Value(0)).current;
  useFocusEffect(useCallback(() => {
    progress.setValue(0);
    const anim = Animated.timing(progress, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.start();
    return () => { anim.stop(); };
  }, [progress, delay]));
  const distance = from === "left" ? -28 : 28;
  const transform = from === "up"
    ? [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }]
    : [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }];
  return <Animated.View style={[{ opacity: progress, transform }, style]}>{children}</Animated.View>;
}

/** Khung trang trong các tab: nền lưới, tiêu đề lớn, nội dung cuộn và căn giữa. */
export function Screen({ title, subtitle, right, children, refreshing, onRefresh, onBack, wide = false, footerSpace = 104 }: {
  /** Bỏ trống thì không có dòng tiêu đề (vd màn Điểm danh đã có tên ở thanh menu). */
  title?: string; subtitle?: string; right?: ReactNode; children: ReactNode; refreshing?: boolean; onRefresh?: () => void; onBack?: () => void;
  /** Màn có bố cục hai cột (Columns) trên màn hình rộng. */
  wide?: boolean; footerSpace?: number;
}) {
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const maxWidth = layout.wide ? (wide ? CONTENT_MAX_WIDE : CONTENT_MAX_TABLET) : CONTENT_MAX;
  const side = layout.wide ? space.lg : space.md;
  return (
    <View style={styles.screen}>
      <GridBackground />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + (layout.wide ? space.lg : space.md), paddingBottom: insets.bottom + footerSpace, paddingLeft: insets.left + side, paddingRight: insets.right + side }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.orange} colors={[colors.orange]} /> : undefined}
      >
        <View style={[styles.inner, { maxWidth }]}>
          {title || onBack || right ? (
            <FadeSlide from="left">
              <View style={styles.head}>
                {onBack ? (
                  <Pressable onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Quay lại" hitSlop={8}>
                    <Glyph name="back" size={20} color={colors.navy} fillOpacity={0} strokeWidth={2.4} />
                  </Pressable>
                ) : null}
                <View style={styles.headText}>
                  {title ? <Text style={styles.title} accessibilityRole="header">{title}</Text> : null}
                  {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
                </View>
                {right}
              </View>
            </FadeSlide>
          ) : null}
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

/** Thẻ trắng bo 22. */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle | ViewStyle[] }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.section}>{children}</Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1 },
  inner: { width: "100%", alignSelf: "center", gap: space.sm },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.xxs },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  headText: { flex: 1, minWidth: 0 },
  title: { fontSize: text.headline, lineHeight: 32, fontFamily: fonts.black, color: colors.navy },
  subtitle: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.regular, color: colors.muted },
  card: {
    backgroundColor: "#fff", borderRadius: radius.card, padding: space.md, gap: space.sm, borderWidth: 1, borderColor: "#EAF1FA",
    shadowColor: "#0B1F66", shadowOpacity: 0.07, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 2,
  },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.xs },
  section: { fontSize: text.caption, lineHeight: 16, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: fonts.bold, color: colors.faint },
});
