import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { MODAL_ORIENTATIONS } from "@/lib/layout";
import { colors, fonts, gradients, space, text } from "@/lib/theme";

/** Tỷ lệ rộng / cao của ảnh đầu nhân vật (assets/tnm-mascot-head*.png, cắt từ nhân vật ở màn đăng nhập). */
const HEAD_RATIO = 562 / 413;
const HEAD_W = 150;
const HEAD_H = Math.round(HEAD_W / HEAD_RATIO);
const HALO = 112;
/** Tự đóng sau chừng này; chạm bất kỳ đâu cũng đóng ngay. */
const SHOW_MS = 3200;

export type MascotMessage = { title: string; message: string; detail?: string };

/**
 * Thông báo nổi sau khi chấm công: đầu nhân vật TNM ló lên từ vòng tròn gradient phía trên thẻ,
 * nhãn trạng thái + lời chúc, thanh thời gian chạy hết thì tự đóng (không cần bấm nút).
 */
export function MascotAlert({ value, onClose }: { value: MascotMessage | null; onClose: () => void }) {
  const enter = useRef(new Animated.Value(0)).current;
  const timer = useRef(new Animated.Value(1)).current;
  // Màn cha truyền hàm mới mỗi lần vẽ lại: giữ trong ref để thời gian đếm không bị chạy lại từ đầu
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!value) return;
    enter.setValue(0);
    timer.setValue(1);
    Animated.spring(enter, { toValue: 1, friction: 7, tension: 70, useNativeDriver: true }).start();
    const run = Animated.timing(timer, { toValue: 0, duration: SHOW_MS, easing: Easing.linear, useNativeDriver: true });
    run.start(({ finished }) => { if (finished) close.current(); });
    return () => run.stop();
  }, [value, enter, timer]);

  return (
    <Modal supportedOrientations={MODAL_ORIENTATIONS} visible={value !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Đóng thông báo">
        {value && (
          <Animated.View
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.wrap, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [32, 0] }) }, { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}
          >
            <View style={styles.card}>
              <View style={styles.chip}>
                <View style={styles.dot}><Text style={styles.tick}>✓</Text></View>
                <Text style={styles.chipText}>{value.title}</Text>
              </View>
              <Text style={styles.message}>{value.message}</Text>
              {value.detail ? <Text style={styles.detail} numberOfLines={1}>{value.detail}</Text> : null}
              <View style={styles.track}>
                <Animated.View style={[styles.bar, { transform: [{ scaleX: timer }] }]}>
                  <LinearGradient colors={gradients.sunrise} locations={gradients.sunriseStops} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                </Animated.View>
              </View>
            </View>

            {/* Vòng gradient + đầu nhân vật nằm trên thẻ, ló lên khỏi mép trên */}
            <View pointerEvents="none" style={styles.mascot}>
              <LinearGradient colors={gradients.skyline} locations={gradients.skylineStops} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.halo} />
              <Image source={require("../../assets/tnm-mascot-head.png")} style={styles.head} contentFit="contain" transition={0} />
            </View>
          </Animated.View>
        )}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(11,31,102,0.28)", alignItems: "center", justifyContent: "center", padding: space.lg },
  wrap: { width: "100%", maxWidth: 340, paddingTop: HEAD_H - 28 },
  card: {
    backgroundColor: "#fff", borderRadius: 28, paddingTop: 56, paddingHorizontal: space.lg, paddingBottom: space.lg, alignItems: "center", gap: space.xs, overflow: "hidden",
    shadowColor: colors.navy, shadowOpacity: 0.22, shadowRadius: 28, shadowOffset: { width: 0, height: 14 }, elevation: 12,
  },
  mascot: { position: "absolute", top: 0, left: 0, right: 0, height: HEAD_H + 8, alignItems: "center", justifyContent: "flex-end" },
  halo: { position: "absolute", bottom: 0, width: HALO, height: HALO, borderRadius: HALO / 2, borderWidth: 4, borderColor: "#fff" },
  head: { width: HEAD_W, height: HEAD_H, marginBottom: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#ECFBF2", borderRadius: 999, paddingVertical: 4, paddingLeft: 4, paddingRight: 12 },
  dot: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#16A34A", alignItems: "center", justifyContent: "center" },
  tick: { color: "#fff", fontSize: 12, lineHeight: 14, fontFamily: fonts.black },
  chipText: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.bold, color: "#0E6B3A" },
  message: { fontSize: text.title, lineHeight: 28, fontFamily: fonts.black, color: colors.navy, textAlign: "center", marginTop: space.xxs },
  detail: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.medium, color: colors.faint, textAlign: "center" },
  track: { position: "absolute", left: 0, right: 0, bottom: 0, height: 4, backgroundColor: colors.skyTint },
  bar: { width: "100%", height: "100%", transformOrigin: "left" },
});
