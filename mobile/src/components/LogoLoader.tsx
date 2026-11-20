import { Image } from "expo-image";
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";

/**
 * Vòng tải quanh logo TNM: vòng nền mờ, một vệt gradient cam → hồng đỏ chạy quanh,
 * đầu vệt có chấm sáng. `variant="dark"` cho nền màu (màn hình mở app), "light" cho nền sáng.
 */
export function LogoLoader({ size = 128, stroke = 6, variant = "dark" }: { size?: number; stroke?: number; variant?: "dark" | "light" }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1150, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const arc = circumference * 0.7;
  const core = size - stroke * 2 - 10;

  return (
    <View style={{ width: size, height: size }} accessibilityRole="progressbar" accessibilityLabel="Đang tải">
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={variant === "dark" ? "rgba(255,255,255,0.18)" : "#E3ECF7"} strokeWidth={stroke} fill="none" />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
        <Svg width={size} height={size}>
          <Defs>
            <LinearGradient id="tnm-ring" x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor="#FF8A00" stopOpacity="0" />
              <Stop offset="0.45" stopColor="#FF6B00" />
              <Stop offset="1" stopColor="#FF2E6E" />
            </LinearGradient>
          </Defs>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="url(#tnm-ring)"
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${arc} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
          <Circle cx={size / 2 + r * Math.cos(-Math.PI / 2 + (arc / circumference) * 2 * Math.PI)} cy={size / 2 + r * Math.sin(-Math.PI / 2 + (arc / circumference) * 2 * Math.PI)} r={stroke * 0.75} fill="#FF2E6E" />
        </Svg>
      </Animated.View>
      <View style={[styles.core, { width: core, height: core, borderRadius: core / 2, top: (size - core) / 2, left: (size - core) / 2 }]}>
        <Image source={require("../../assets/tnm-emblem.png")} style={{ width: core * 0.72, height: core * 0.72 * 0.625 }} contentFit="contain" priority="high" transition={0} accessibilityLabel="Logo Thiên Nhật Minh" />
      </View>
    </View>
  );
}

/** Vòng trắng nhỏ trong nút bấm (không có logo). */
export function MiniSpinner({ size = 18, stroke = 2.5 }: { size?: number; stroke?: number }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ rotate }] }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.35)" strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="#fff" strokeWidth={stroke} strokeLinecap="round" fill="none" strokeDasharray={`${c * 0.3} ${c}`} />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  core: { position: "absolute", backgroundColor: "#fff", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
});
