import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { fonts, gradients } from "@/lib/theme";
import { Glyph } from "./AppIcon";

/** Nút tròn lớn Chấm Vào (gradient Bình minh) / Chấm Ra (gradient Bầu trời), có vòng sóng lan ra. */
export function PunchButton({ kind, onPress, disabled }: { kind: "in" | "out"; onPress: () => void; disabled?: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const colors = kind === "in" ? gradients.sunrise : gradients.skyline;
  const ring = kind === "in" ? "#FF6B00" : "#1B4FB8";
  return (
    <View style={styles.wrap}>
      {[0, 0.5].map((offset) => {
        const v = Animated.modulo(Animated.add(pulse, offset), 1);
        return (
          <Animated.View
            key={offset}
            pointerEvents="none"
            style={[styles.ring, { borderColor: ring, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }] }]}
          />
        );
      })}
      <Animated.View style={{ transform: [{ scale: press }] }}>
        <Pressable
          onPress={onPress}
          disabled={disabled}
          onPressIn={() => Animated.spring(press, { toValue: 0.95, useNativeDriver: true }).start()}
          onPressOut={() => Animated.spring(press, { toValue: 1, friction: 4, useNativeDriver: true }).start()}
          accessibilityRole="button"
          accessibilityLabel={kind === "in" ? "Chấm Vào" : "Chấm Ra"}
          accessibilityState={{ disabled }}
        >
          <LinearGradient colors={colors} locations={kind === "in" ? gradients.sunriseStops : gradients.skylineStops} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.circle, { shadowColor: ring }, disabled && { opacity: 0.6 }]}>
            <Glyph name={kind === "in" ? "login" : "logout"} size={32} />
            <Text style={styles.label}>{kind === "in" ? "Chấm Vào" : "Chấm Ra"}</Text>
            <Text style={styles.sub}>Ảnh + GPS</Text>
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const SIZE = 144;
const styles = StyleSheet.create({
  wrap: { width: SIZE * 1.5, height: SIZE * 1.5, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  ring: { position: "absolute", width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2 },
  circle: {
    width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 4, borderColor: "rgba(255,255,255,0.7)",
    shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  label: { color: "#fff", fontSize: 20, lineHeight: 24, fontFamily: fonts.black, marginTop: 4 },
  sub: { color: "rgba(255,255,255,0.88)", fontSize: 12, lineHeight: 16, fontFamily: fonts.medium },
});
