import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, type Tone } from "@/lib/theme";
import { AppIcon, type IconName } from "./AppIcon";

type Kind = "ok" | "warn" | "err";
type Toast = { id: number; kind: Kind; text: string };
const ToastContext = createContext<(text: string, kind?: Kind) => void>(() => undefined);

const LOOK: Record<Kind, { icon: IconName; tone: Tone; bg: string; fg: string; border: string }> = {
  ok: { icon: "check", tone: "sky", bg: "#121418", fg: "#FFFFFF", border: "#121418" },
  warn: { icon: "shield", tone: "orange", bg: "#FFF4E8", fg: "#8A3A00", border: "#FFD2B0" },
  err: { icon: "shield", tone: "rose", bg: "#FFEFF4", fg: "#9E0F3E", border: "#FFC4D6" },
};

/** Thanh báo nhanh trượt xuống từ trên, tự ẩn sau vài giây. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setToast(null));
  }, [anim]);

  const show = useCallback((text: string, kind: Kind = "ok") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), kind, text });
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 70 }).start();
    timer.current = setTimeout(hide, kind === "ok" ? 3200 : 5200);
  }, [anim, hide]);

  const look = toast ? LOOK[toast.kind] : null;
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && look && (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.wrap, { top: insets.top + 8, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }] }]}
        >
          <Pressable onPress={hide} accessibilityRole="alert" style={[styles.toast, { backgroundColor: look.bg, borderColor: look.border }]}>
            <AppIcon name={look.icon} tone={look.tone} size={32} />
            <Text style={[styles.text, { color: look.fg }]}>{toast.text}</Text>
          </Pressable>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, alignItems: "center", zIndex: 100 },
  toast: {
    maxWidth: 480, width: "100%", flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingLeft: 8, paddingRight: 16,
    borderRadius: 16, borderWidth: 1, shadowColor: "#0B1F66", shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8,
  },
  text: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: fonts.medium },
});

