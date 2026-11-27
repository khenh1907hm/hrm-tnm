import { Image } from "expo-image";
import { useEffect, useRef } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { GradientButton } from "@/components/GradientButton";
import { MODAL_ORIENTATIONS } from "@/lib/layout";
import { colors, fonts, radius, space, text } from "@/lib/theme";

/** Tỷ lệ rộng / cao của ảnh đầu nhân vật (assets/tnm-mascot-head*.png, cắt từ ảnh ở màn đăng nhập). */
const HEAD_RATIO = 562 / 413;
const HEAD_W = 168;
/** Thẻ đè lên phần cổ áo để nhân vật như đang ló đầu lên khỏi thẻ. */
const OVERLAP = 14;

export type MascotMessage = { title: string; message: string; detail?: string; button?: string };

/** Hộp thông báo có đầu nhân vật TNM ló lên trên, dùng sau khi chấm công xong. */
export function MascotAlert({ value, onClose }: { value: MascotMessage | null; onClose: () => void }) {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!value) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }).start();
  }, [value, pop]);

  const headH = Math.round(HEAD_W / HEAD_RATIO);
  return (
    <Modal supportedOrientations={MODAL_ORIENTATIONS} visible={value !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Đóng thông báo">
        {value && (
          <Pressable onPress={() => undefined} style={styles.wrap} accessibilityRole="alert">
            <Animated.View style={{ transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }, { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }], opacity: pop }}>
              <Image source={require("../../assets/tnm-mascot-head.png")} style={[styles.head, { width: HEAD_W, height: headH }]} contentFit="contain" transition={0} accessibilityLabel="Nhân vật Thiên Nhật Minh" />
            </Animated.View>
            <View style={[styles.card, { marginTop: -OVERLAP }]}>
              <Text style={styles.title}>{value.title}</Text>
              <Text style={styles.message}>{value.message}</Text>
              {value.detail ? <Text style={styles.detail}>{value.detail}</Text> : null}
              <View style={styles.button}><GradientButton label={value.button ?? "Cảm ơn!"} onPress={onClose} /></View>
            </View>
          </Pressable>
        )}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(11,31,102,0.5)", alignItems: "center", justifyContent: "center", padding: space.lg },
  wrap: { width: "100%", maxWidth: 360, alignItems: "center" },
  head: { alignSelf: "center" },
  card: {
    width: "100%", backgroundColor: "#fff", borderRadius: radius.sheet, paddingTop: space.lg, paddingBottom: space.md, paddingHorizontal: space.md, gap: space.xs, alignItems: "center",
    borderWidth: 2, borderColor: colors.navy,
  },
  title: { fontSize: text.title, lineHeight: 28, fontFamily: fonts.black, color: colors.navy, textAlign: "center" },
  message: { fontSize: text.body, lineHeight: 24, fontFamily: fonts.bold, color: colors.orange, textAlign: "center" },
  detail: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.medium, color: colors.muted, textAlign: "center" },
  button: { alignSelf: "stretch", marginTop: space.xs },
});
