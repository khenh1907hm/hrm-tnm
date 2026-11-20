import { StyleSheet, View } from "react-native";
import Svg, { Defs, Path, Pattern, Rect } from "react-native-svg";
import { colors } from "@/lib/theme";

/** Nền "Lưới kỹ thuật": ô lớn 48 chia ô nhỏ 12, như giấy bản vẽ. `tone="light"` dùng trên nền màu. */
export function GridBackground({ tone = "sky" }: { tone?: "sky" | "light" }) {
  const stroke = tone === "light" ? "#FFFFFF" : colors.sky;
  const minor = tone === "light" ? 0.08 : 0.14;
  const major = tone === "light" ? 0.16 : 0.3;
  const id = `grid-${tone}`;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} width={48} height={48} patternUnits="userSpaceOnUse">
            <Path d="M12 0V48M24 0V48M36 0V48M0 12H48M0 24H48M0 36H48" stroke={stroke} strokeOpacity={minor} strokeWidth={1} />
            <Path d="M0 0V48M0 0H48" stroke={stroke} strokeOpacity={major} strokeWidth={1} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
