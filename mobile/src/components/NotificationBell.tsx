import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { loadNotifications } from "@/lib/notifications";
import { colors, fonts } from "@/lib/theme";
import { Glyph } from "./AppIcon";

/** Nút chuông góc phải trên: số thông báo chưa đọc, bấm mở danh sách. Tự cập nhật mỗi phút khi đang mở màn hình. */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);

  useFocusEffect(useCallback(() => {
    let alive = true;
    const check = () => { void loadNotifications(50).then((list) => { if (alive) setUnread(list.filter((n) => !n.readAt).length); }).catch(() => undefined); };
    check();
    const timer = setInterval(check, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, []));

  return (
    <Pressable
      onPress={() => router.push("/notifications")}
      style={({ pressed }) => [styles.bell, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={unread ? `Thông báo, ${unread} chưa đọc` : "Thông báo"}
      hitSlop={8}
    >
      <Glyph name="bell" size={20} color={colors.navy} fillOpacity={0.12} />
      {unread > 0 && (
        <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text></View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bell: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center",
    shadowColor: "#0B1F66", shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.95 }] },
  badge: { position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.rose, borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 10, lineHeight: 12, fontFamily: fonts.black },
});
