import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import { tones, type Tone } from "@/lib/theme";

/** Mỗi icon hai lớp: mảng (fill, mờ) + nét (stroke). Vẽ trên lưới 24×24. */
const ICONS = {
  task: { fill: "M7 4h10a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z", stroke: "M7 4h10a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM9.5 2.5h5v3h-5zM8.5 13.5l2.5 2.5 4.5-5" },
  calendar: { fill: "M6 5h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z", stroke: "M6 5h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" },
  report: { fill: "M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", stroke: "M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM14 2v6h6M8 13h8M8 17h5" },
  user: { fill: "M12 3.5a4 4 0 1 1 0 8a4 4 0 1 1 0-8zM4 21a8 8 0 0 1 16 0z", stroke: "M12 3.5a4 4 0 1 1 0 8a4 4 0 1 1 0-8zM4 21a8 8 0 0 1 16 0z" },
  clock: { fill: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z", stroke: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18zM12 7.5V12l3 2" },
  bell: { fill: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9z", stroke: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9zM10.3 21a1.94 1.94 0 0 0 3.4 0" },
  home: { fill: "M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", stroke: "M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9.5 22v-6.5h5V22" },
  cart: { fill: "M6.2 6H21l-1.6 8.4a2 2 0 0 1-2 1.6H9.6a2 2 0 0 1-2-1.6z", stroke: "M2 3h3l2.6 11.4a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 6H6.2M9 19.2a1.3 1.3 0 1 1 0 2.6a1.3 1.3 0 1 1 0-2.6zM17.5 19.2a1.3 1.3 0 1 1 0 2.6a1.3 1.3 0 1 1 0-2.6z" },
  shield: { fill: "M12 2.5l8 3v6c0 5-3.5 8.8-8 10.5c-4.5-1.7-8-5.5-8-10.5v-6z", stroke: "M12 2.5l8 3v6c0 5-3.5 8.8-8 10.5c-4.5-1.7-8-5.5-8-10.5v-6zM12 8v5M12 16.5h.01" },
  check: { fill: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z", stroke: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18zM8 12.5l2.7 2.7L16 9.8" },
  lock: { fill: "M6 10h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z", stroke: "M6 10h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM8 10V7a4 4 0 0 1 8 0v3M12 15v2" },
  search: { fill: "M11 4a7 7 0 1 1 0 14a7 7 0 1 1 0-14z", stroke: "M11 4a7 7 0 1 1 0 14a7 7 0 1 1 0-14zM20.5 20.5l-4.6-4.6" },
  pin: { fill: "M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z", stroke: "M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 7.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5z" },
  camera: { fill: "M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z", stroke: "M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM12 9.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7z" },
  image: { fill: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", stroke: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 7a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3zM21 15l-5-5L5 21" },
  send: { fill: "M22 2L11 13 2 9z", stroke: "M22 2L11 13M22 2l-7 20-4-9-9-4z" },
  users: { fill: "M9 3.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7zM2 20a7 7 0 0 1 14 0z", stroke: "M9 3.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7zM2 20a7 7 0 0 1 14 0M16 4a3.5 3.5 0 0 1 0 7M22 20a6 6 0 0 0-4-5.6" },
  plus: { fill: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z", stroke: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18zM12 8v8M8 12h8" },
  trash: { fill: "M6 7h12l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z", stroke: "M3 7h18M8 7V4h8v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v6M14 11v6" },
  copy: { fill: "M9 9h11v11a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1z", stroke: "M10 9h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" },
  login: { fill: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4z", stroke: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" },
  flash: { fill: "M13 2L4 14h7l-1 8 9-12h-7z", stroke: "M13 2L4 14h7l-1 8 9-12h-7z" },
  flashOff: { fill: "M0 0", stroke: "M13 2l-3.6 4.8M7.5 9.3L4 14h7l-1 8 4.2-5.6M16.3 12.9L19 10h-7l.7-5.4M3 3l18 18" },
  settings: { fill: "M7 3.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5zM17 9.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5zM10 15.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5z", stroke: "M7 3.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5zM17 9.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5zM10 15.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5zM9.5 6H21M3 6h1.5M3 12h11.5M19.5 12H21M12.5 18H21M3 18h4.5" },
  back: { fill: "M0 0", stroke: "M15 18l-6-6 6-6" },
  chevron: { fill: "M0 0", stroke: "M9 6l6 6-6 6" },
  add: { fill: "M0 0", stroke: "M12 5v14M5 12h14" },
  close: { fill: "M0 0", stroke: "M6 6l12 12M18 6L6 18" },
  money: { fill: "M3 6h18v12H3z", stroke: "M3 6h18v12H3zM12 9.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5zM6 9v.01M18 15v.01" },
  box: { fill: "M12 2l9 5v10l-9 5-9-5V7z", stroke: "M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10" },
  logout: { fill: "M5 3h7v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", stroke: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" },
} as const;
export type IconName = keyof typeof ICONS;

/** Chỉ vẽ hình icon (không có khối), màu tùy chọn. */
export function Glyph({ name, size = 22, color = "#fff", fillOpacity = 0.3, strokeWidth = 2 }: { name: IconName; size?: number; color?: string; fillOpacity?: number; strokeWidth?: number }) {
  const icon = ICONS[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={icon.fill} fill={color} fillOpacity={fillOpacity} />
      <Path d={icon.stroke} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Kiểu A "Khối gradient": ô bo tròn đổ gradient theo tông, icon trắng. */
export function AppIcon({ name, tone = "orange", size = 44 }: { name: IconName; tone?: Tone; size?: number }) {
  const [from, to] = tones[tone];
  return (
    <LinearGradient
      colors={[from, to]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.box, { width: size, height: size, borderRadius: size * 0.3, shadowColor: to }]}
    >
      <Glyph name={name} size={size * 0.52} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center", shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
});
