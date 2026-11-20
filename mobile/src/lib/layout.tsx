import * as ScreenOrientation from "expo-screen-orientation";
import { Fragment, useEffect, type ReactNode } from "react";
import { Dimensions, Platform, StyleSheet, useWindowDimensions, View, type ViewStyle } from "react-native";
import { space } from "./theme";

/**
 * Bố cục theo kích thước màn hình:
 *  - Điện thoại: một cột, khóa màn hình dọc.
 *  - Máy tính bảng (iPad, tablet Android ≥ 600 dp cạnh ngắn): xoay tự do; cửa sổ rộng ≥ 768 thì chia hai cột.
 * Dựa vào kích thước CỬA SỔ nên iPad chia đôi màn hình (Split View) hẹp vẫn tự về một cột.
 */
export const WIDE_MIN = 768;

/** Modal trên iOS mặc định chỉ dọc → iPad đang ngang sẽ bị ép xoay. Mọi Modal dùng giá trị này. */
export const MODAL_ORIENTATIONS = ["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"] as ("portrait" | "portrait-upside-down" | "landscape" | "landscape-left" | "landscape-right")[];

/** Máy là tablet (theo màn hình vật lý, không đổi khi xoay). */
export function isTabletDevice(): boolean {
  if (Platform.OS === "ios" && Platform.isPad) return true;
  const { width, height } = Dimensions.get("screen");
  return Math.min(width, height) >= 600;
}

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const wide = width >= WIDE_MIN;
  return { width, height, wide, landscape: width > height, tablet: isTabletDevice() };
}

/** Khóa dọc trên điện thoại, cho xoay trên tablet. Gọi một lần ở gốc app. */
export function useOrientationPolicy() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    const lock = isTabletDevice() ? ScreenOrientation.OrientationLock.DEFAULT : ScreenOrientation.OrientationLock.PORTRAIT_UP;
    void ScreenOrientation.lockAsync(lock).catch(() => undefined);
  }, []);
}

/**
 * Hai cột khi màn hình rộng (cột trái chính, cột phải phụ), một cột khi hẹp.
 * Mỗi cột xếp dọc với khoảng cách như các thẻ trong Screen.
 */
export function Columns({ left, right, leftFlex = 1.15, style }: { left: ReactNode; right: ReactNode; leftFlex?: number; style?: ViewStyle }) {
  const { wide } = useLayout();
  if (!wide) return <Fragment>{left}{right}</Fragment>;
  return (
    <View style={[styles.row, style]}>
      <View style={[styles.col, { flex: leftFlex }]}>{left}</View>
      <View style={[styles.col, { flex: 1 }]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.lg },
  col: { minWidth: 0, gap: space.sm },
});
