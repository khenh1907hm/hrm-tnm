import { CameraView, useCameraPermissions, type FlashMode } from "expo-camera";
import * as Haptics from "expo-haptics";
import { LightSensor } from "expo-sensors";
import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { preparePhoto } from "@/lib/attendance";
import { useSettings, type FlashPref } from "@/lib/settings";
import { colors, fonts, radius, space, text } from "@/lib/theme";
import { Glyph } from "./AppIcon";
import { LogoLoader } from "./LogoLoader";
import { MODAL_ORIENTATIONS } from "@/lib/layout";

/** Dưới ngưỡng này (lux, cảm biến ánh sáng Android) coi là tối → bật đèn màn hình. */
const DARK_LUX = 15;
const FLASH_LABEL: Record<FlashPref, string> = { auto: "Tự động", on: "Bật", off: "Tắt" };
const NEXT_FLASH: Record<FlashPref, FlashPref> = { auto: "on", on: "off", off: "auto" };

/**
 * Đo độ sáng xung quanh khi camera mở (chỉ Android có cảm biến ánh sáng).
 * Trả null nếu máy không có cảm biến.
 */
function useAmbientLux(active: boolean): number | null {
  const [lux, setLux] = useState<number | null>(null);
  useEffect(() => {
    if (!active || Platform.OS !== "android") return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    void LightSensor.isAvailableAsync().then((ok) => {
      if (!ok || cancelled) return;
      LightSensor.setUpdateInterval(500);
      sub = LightSensor.addListener(({ illuminance }) => setLux(illuminance));
    }).catch(() => undefined);
    return () => { cancelled = true; sub?.remove(); };
  }, [active]);
  return lux;
}

/**
 * Đèn thực tế cho camera trước:
 *  - iOS: "auto"/"on" dùng Retina Flash (màn hình sáng trắng), hệ điều hành tự quyết khi nào tối.
 *  - Android: camera trước hầu như không có đèn → dùng đèn màn hình ("screen") khi cảm biến báo tối
 *    (hoặc luôn bật nếu chọn Bật). Máy không có cảm biến thì để camera tự quyết ("auto").
 */
function resolveFlash(pref: FlashPref, lux: number | null): { mode: FlashMode; dark: boolean } {
  if (pref === "off" || Platform.OS === "web") return { mode: "off", dark: false };
  if (Platform.OS === "ios") return { mode: pref === "on" ? "on" : "auto", dark: false };
  if (pref === "on") return { mode: "screen", dark: true };
  if (lux === null) return { mode: "auto", dark: false };
  return lux < DARK_LUX ? { mode: "screen", dark: true } : { mode: "off", dark: false };
}

export type SelfiePhoto = { uri: string; base64: string };

/** Camera trước toàn màn hình để chụp ảnh điểm danh: ảnh giữ chiều như lúc xem (không bị lật), tự bật đèn khi tối. */
export function SelfieCamera({ visible, title, onCapture, onCancel, onError }: {
  visible: boolean; title: string; onCapture: (photo: SelfiePhoto) => void; onCancel: () => void; onError: (error: unknown) => void;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  // Khung mặt: tỷ lệ 0.78, vừa 68% chiều ngang và 56% chiều cao (không tràn khi xoay ngang / iPad), tối đa 420 px
  const frameWidth = Math.min(window.width * 0.68, window.height * 0.56 * 0.78, 420);
  const { settings } = useSettings();
  const [permission, requestPermission] = useCameraPermissions();
  const [flashPref, setFlashPref] = useState<FlashPref>(settings.flash);
  const [ready, setReady] = useState(false);
  const [shooting, setShooting] = useState(false);
  const camera = useRef<CameraView>(null);
  const lux = useAmbientLux(visible && flashPref === "auto");
  const flash = resolveFlash(flashPref, lux);

  useEffect(() => {
    if (!visible) return;
    setFlashPref(settings.flash);
    setReady(false);
    setShooting(false);
    if (permission && !permission.granted) {
      if (!permission.canAskAgain) { onError(new Error("CHECKIN_NO_CAMERA")); return; }
      void requestPermission().then((result) => { if (!result.granted) onError(new Error("CHECKIN_NO_CAMERA")); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, permission?.granted]);

  const shoot = async () => {
    if (!camera.current || shooting) return;
    setShooting(true);
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    try {
      const picture = await camera.current.takePictureAsync({ quality: 0.8, shutterSound: false });
      if (!picture?.uri) throw new Error("CHECKIN_NO_PHOTO");
      onCapture(await preparePhoto(picture));
    } catch (error) {
      onError(error);
    } finally {
      setShooting(false);
    }
  };

  return (
    <Modal supportedOrientations={MODAL_ORIENTATIONS} visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent presentationStyle="fullScreen">
      <View style={styles.root}>
        {permission?.granted ? (
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing="front"
            mirror={settings.mirrorSelfie}
            flash={flash.mode}
            mode="picture"
            onCameraReady={() => setReady(true)}
            onMountError={(event) => onError(new Error(event.message || "CHECKIN_NO_CAMERA"))}
          />
        ) : (
          <View style={styles.center}><LogoLoader size={64} stroke={4} variant="light" /></View>
        )}

        {/* Khung mặt */}
        <View style={styles.frameWrap} pointerEvents="none"><View style={[styles.frame, { width: frameWidth }]} /></View>

        <View style={[styles.top, { paddingTop: insets.top + space.xs }]}>
          <Pressable onPress={onCancel} style={styles.round} accessibilityRole="button" accessibilityLabel="Đóng camera">
            <Glyph name="close" size={20} color="#fff" fillOpacity={0} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Pressable onPress={() => setFlashPref((current) => NEXT_FLASH[current])} style={[styles.flashBtn, flashPref !== "off" && styles.flashOn]} accessibilityRole="button" accessibilityLabel={`Đèn: ${FLASH_LABEL[flashPref]}`}>
            <Glyph name={flashPref === "off" ? "flashOff" : "flash"} size={16} color={flashPref === "off" ? "#fff" : colors.navy} fillOpacity={flashPref === "off" ? 0 : 0.4} />
            <Text style={[styles.flashText, flashPref !== "off" && styles.flashTextOn]}>{FLASH_LABEL[flashPref]}</Text>
          </Pressable>
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
          <Text style={styles.hint}>
            {flash.dark ? "Trời tối: màn hình sẽ sáng lên khi chụp" : "Đưa mặt vào khung rồi bấm chụp"}
          </Text>
          <Pressable onPress={() => void shoot()} disabled={!ready || shooting} style={({ pressed }) => [styles.shutter, (pressed || shooting) && styles.shutterPressed, !ready && styles.shutterWait]} accessibilityRole="button" accessibilityLabel="Chụp ảnh">
            <View style={styles.shutterInner} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  frameWrap: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  frame: { aspectRatio: 0.78, borderRadius: 999, borderWidth: 3, borderColor: "rgba(255,255,255,0.85)", borderStyle: "dashed" },
  top: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, maxWidth: 720, alignSelf: "center", width: "100%" },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: "#fff", fontSize: text.body, lineHeight: 24, fontFamily: fonts.bold, textAlign: "center" },
  flashBtn: { flexDirection: "row", alignItems: "center", gap: space.xxs, height: 40, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.45)" },
  flashOn: { backgroundColor: "#FFD54A" },
  flashText: { color: "#fff", fontSize: text.caption, fontFamily: fonts.bold },
  flashTextOn: { color: colors.navy },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", gap: space.md, paddingTop: space.lg, backgroundColor: "rgba(0,0,0,0.35)" },
  hint: { color: "#fff", fontSize: text.small, lineHeight: 20, fontFamily: fonts.semibold },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.orange },
  shutterPressed: { transform: [{ scale: 0.92 }] },
  shutterWait: { opacity: 0.5 },
});
