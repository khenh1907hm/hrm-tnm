import { router, type Href } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius, space, text, type Tone } from "@/lib/theme";
import { AppIcon, type IconName } from "./AppIcon";
import { useToast } from "./Toast";
import { MODAL_ORIENTATIONS } from "@/lib/layout";

/**
 * Mục "Tạo mới" của nút + giữa thanh menu. Thêm loại đơn / phiếu mới: thêm một dòng, có `href` là mở được,
 * chưa có `href` thì hiện "Sắp có".
 */
const ACTIONS: { icon: IconName; tone: Tone; title: string; sub: string; href?: Href }[] = [
  { icon: "report", tone: "rose", title: "Báo cáo ngày", sub: "Công việc, nhân lực, ảnh thi công", href: "/report" },
  { icon: "shield", tone: "sky", title: "Kiểm tra dụng cụ điện", sub: "Tool & machine check, ảnh từng máy, OK / NG", href: "/tool-check" as Href },
  { icon: "calendar", tone: "sky", title: "Đơn xin nghỉ phép", sub: "Nghỉ phép, nghỉ việc riêng" },
  { icon: "clock", tone: "orange", title: "Đăng ký tăng ca", sub: "Làm thêm giờ, ngày nghỉ" },
  { icon: "box", tone: "navy", title: "Đề xuất vật tư", sub: "Yêu cầu vật tư cho công trường" },
  { icon: "money", tone: "orange", title: "Đề nghị tạm ứng", sub: "Tạm ứng, thanh toán chi phí" },
];

export function CreateSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    slide.setValue(0);
    Animated.timing(slide, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [visible, slide]);

  const pick = (action: (typeof ACTIONS)[number]) => {
    if (!action.href) { toast(`${action.title}: đang phát triển, sẽ có trong bản sau.`, "ok"); return; }
    onClose();
    router.navigate(action.href);
  };

  return (
    <Modal supportedOrientations={MODAL_ORIENTATIONS} visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Đóng" />
      <View style={styles.holder} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + space.md, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [320, 0] }) }] }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>Tạo mới</Text>
          <View style={styles.grid}>
            {ACTIONS.map((action) => (
              <Pressable key={action.title} onPress={() => pick(action)} style={({ pressed }) => [styles.item, pressed && styles.pressed]} accessibilityRole="button">
                <AppIcon name={action.icon} tone={action.tone} size={40} />
                <View style={styles.itemText}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{action.title}</Text>
                  <Text style={styles.itemSub} numberOfLines={1}>{action.sub}</Text>
                </View>
                {!action.href ? <Text style={styles.soon}>Sắp có</Text> : null}
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(11,31,102,0.45)" },
  holder: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  sheet: { width: "100%", maxWidth: 560, backgroundColor: "#fff", borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: space.md, paddingTop: space.xs, gap: space.sm },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: space.xxs },
  title: { fontSize: text.title, lineHeight: 28, fontFamily: fonts.black, color: colors.navy },
  grid: { gap: space.xs },
  item: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.sm, borderRadius: radius.card, backgroundColor: colors.bg, borderWidth: 1, borderColor: "#E6EEF8" },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  itemText: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.bold, color: colors.navy },
  itemSub: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
  soon: { fontSize: 11, fontFamily: fonts.bold, color: colors.skyDeep, backgroundColor: colors.skyTint, borderRadius: radius.pill, paddingHorizontal: space.xs, paddingVertical: 2, overflow: "hidden" },
});
