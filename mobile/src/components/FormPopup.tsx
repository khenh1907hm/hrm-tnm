import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Modal, Platform, StyleSheet, Text, View } from "react-native";
import { MODAL_ORIENTATIONS } from "@/lib/layout";
import { colors, fonts, gradients, radius, space, text } from "@/lib/theme";
import { Glyph } from "./AppIcon";
import { GradientButton, SecondaryButton } from "./GradientButton";
import { LogoLoader } from "./LogoLoader";

/**
 * Hộp thoại cho mọi đơn từ (giải trình, nghỉ phép, đề xuất… sau này):
 *  - confirm: tóm tắt trước khi gửi, hai nút Gửi / Sửa lại.
 *  - busy: đang gửi, có dòng tiến độ (vd "Đang tải ảnh 1/2").
 *  - success: dấu tick bật lên + rung nhẹ, lời nhắn bước tiếp theo.
 *  - error: lý do lỗi rõ ràng + nút thử lại.
 */
export type PopupState =
  | { kind: "confirm"; title: string; lines: { label: string; value: string }[]; confirmLabel: string }
  | { kind: "busy"; title: string; detail?: string }
  | { kind: "success"; title: string; message: string; actionLabel: string }
  | { kind: "error"; title: string; message: string }
  | null;

function SuccessMark() {
  const scale = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
      Animated.timing(ring, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [scale, ring]);
  return (
    <View style={styles.markWrap}>
      <Animated.View style={[styles.ring, { opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.6] }) }] }]} />
      <Animated.View style={{ transform: [{ scale }] }}>
        <LinearGradient colors={["#34D399", "#0E9F6E"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.mark}>
          <Glyph name="check" size={40} color="#fff" fillOpacity={0} strokeWidth={2.6} />
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

function ErrorMark() {
  useEffect(() => { if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined); }, []);
  return (
    <LinearGradient colors={["#FF85A8", "#E0144F"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.mark}>
      <Glyph name="close" size={34} color="#fff" fillOpacity={0} strokeWidth={2.8} />
    </LinearGradient>
  );
}

export function FormPopup({ state, onConfirm, onCancel, onDone, onRetry, children }: {
  state: PopupState; onConfirm?: () => void; onCancel: () => void; onDone?: () => void; onRetry?: () => void; children?: ReactNode;
}) {
  const pop = useRef(new Animated.Value(0)).current;
  const kind = state?.kind ?? null;
  useEffect(() => {
    if (!kind) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }).start();
  }, [kind, pop]);

  return (
    <Modal supportedOrientations={MODAL_ORIENTATIONS} visible={state !== null} transparent animationType="fade" onRequestClose={() => { if (kind !== "busy") onCancel(); }} statusBarTranslucent>
      <View style={styles.bg}>
        {state && (
          <Animated.View style={[styles.box, { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
            {state.kind === "confirm" && (
              <>
                <View style={styles.iconTop}>
                  <LinearGradient colors={gradients.sunrise} locations={gradients.sunriseStops} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.markSm}>
                    <Glyph name="send" size={24} color="#fff" fillOpacity={0.25} />
                  </LinearGradient>
                </View>
                <Text style={styles.title}>{state.title}</Text>
                <View style={styles.summary}>
                  {state.lines.map((line) => (
                    <View key={line.label} style={styles.line}>
                      <Text style={styles.lineLabel}>{line.label}</Text>
                      <Text style={styles.lineValue}>{line.value}</Text>
                    </View>
                  ))}
                </View>
                {children}
                <GradientButton label={state.confirmLabel} onPress={() => onConfirm?.()} />
                <SecondaryButton label="Sửa lại" onPress={onCancel} />
              </>
            )}
            {state.kind === "busy" && (
              <View style={styles.center}>
                <LogoLoader size={80} stroke={4} variant="light" />
                <Text style={styles.title}>{state.title}</Text>
                {state.detail ? <Text style={styles.message}>{state.detail}</Text> : null}
              </View>
            )}
            {state.kind === "success" && (
              <View style={styles.center}>
                <SuccessMark />
                <Text style={styles.title}>{state.title}</Text>
                <Text style={styles.message}>{state.message}</Text>
                <View style={styles.full}><GradientButton label={state.actionLabel} onPress={() => onDone?.()} /></View>
              </View>
            )}
            {state.kind === "error" && (
              <View style={styles.center}>
                <ErrorMark />
                <Text style={styles.title}>{state.title}</Text>
                <Text style={styles.message}>{state.message}</Text>
                <View style={styles.full}>
                  {onRetry ? <GradientButton label="Thử lại" onPress={onRetry} /> : null}
                  <SecondaryButton label="Đóng" onPress={onCancel} />
                </View>
              </View>
            )}
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: "rgba(11,31,102,0.5)", alignItems: "center", justifyContent: "center", padding: space.lg },
  box: { width: "100%", maxWidth: 400, backgroundColor: "#fff", borderRadius: radius.sheet, padding: space.lg, gap: space.sm },
  center: { alignItems: "center", gap: space.sm },
  full: { alignSelf: "stretch", gap: space.xs, marginTop: space.xs },
  iconTop: { alignItems: "center" },
  title: { fontSize: text.title, lineHeight: 28, fontFamily: fonts.black, color: colors.navy, textAlign: "center" },
  message: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.regular, color: colors.muted, textAlign: "center" },
  summary: { backgroundColor: colors.bg, borderRadius: radius.control, padding: space.sm, gap: space.xs },
  line: { flexDirection: "row", gap: space.sm },
  lineLabel: { width: 96, fontSize: text.caption, lineHeight: 18, fontFamily: fonts.semibold, color: colors.faint },
  lineValue: { flex: 1, fontSize: text.caption, lineHeight: 18, fontFamily: fonts.bold, color: colors.navy },
  markWrap: { width: 96, height: 96, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", width: 80, height: 80, borderRadius: 40, backgroundColor: "#34D399" },
  mark: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  markSm: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});
