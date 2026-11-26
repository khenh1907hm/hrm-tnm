import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { AppIcon, Glyph, type IconName } from "@/components/AppIcon";
import { LogoLoader } from "@/components/LogoLoader";
import { Card, FadeSlide, Screen } from "@/components/Screen";
import { useToast } from "@/components/Toast";
import { errorText } from "@/lib/errors";
import { ago, loadNotifications, markRead, webBase, type AppNotification } from "@/lib/notifications";
import { colors, fonts, radius, space, text, type Tone } from "@/lib/theme";

const KIND: Record<string, { icon: IconName; tone: Tone }> = {
  approval_pending: { icon: "task", tone: "orange" },
  approval_returned: { icon: "shield", tone: "rose" },
  approval_approved: { icon: "check", tone: "sky" },
};

/** Danh sách thông báo (giống chuông trên web). Bấm một thông báo: đánh dấu đã đọc, mở trang liên quan trên web. */
export default function NotificationsScreen() {
  const toast = useToast();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await loadNotifications(50)); } catch (error) { setItems((current) => current ?? []); toast(errorText(error), "err"); }
  }, [toast]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const open = async (item: AppNotification) => {
    if (!item.readAt) {
      setItems((list) => list?.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)) ?? null);
      void markRead([item.id]).catch(() => undefined);
    }
    // Báo cáo công trình mở ngay trong app
    const inspection = /^\/bao-cao-hang-thang\?(?:.*&)?phieu=([0-9a-f-]{36})/i.exec(item.link ?? "");
    if (inspection) { router.push(`/inspection?id=${encodeURIComponent(inspection[1]!)}` as Href); return; }
    if (item.link) void Linking.openURL(item.link.startsWith("http") ? item.link : `${webBase()}${item.link}`);
  };

  const readAll = async () => {
    try {
      await markRead();
      setItems((list) => list?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
    } catch (error) { toast(errorText(error), "err"); }
  };

  const unread = items?.filter((n) => !n.readAt).length ?? 0;

  return (
    <Screen
      title="Thông báo"
      subtitle={unread ? `${unread} chưa đọc` : "Đã xem hết"}
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      right={unread ? (
        <Pressable onPress={() => void readAll()} style={styles.readAll} accessibilityRole="button"><Text style={styles.readAllText}>Đọc hết</Text></Pressable>
      ) : undefined}
      refreshing={refreshing}
      onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }}
      footerSpace={32}
    >
      {items === null ? (
        <View style={styles.loading}><LogoLoader size={64} stroke={4} variant="light" /></View>
      ) : !items.length ? (
        <FadeSlide delay={60}>
          <Card style={styles.empty}>
            <AppIcon name="bell" tone="sky" size={48} />
            <Text style={styles.emptyTitle}>Chưa có thông báo</Text>
            <Text style={styles.emptyText}>Phiếu cần bạn ký, phiếu bị trả về hoặc đã duyệt sẽ hiện ở đây.</Text>
          </Card>
        </FadeSlide>
      ) : items.map((item, index) => {
        const kind = KIND[item.kind] ?? { icon: "bell" as IconName, tone: "navy" as Tone };
        return (
          <FadeSlide key={item.id} delay={40 + Math.min(index, 10) * 30}>
            <Pressable onPress={() => void open(item)} style={({ pressed }) => [styles.item, !item.readAt && styles.itemUnread, pressed && styles.pressed]} accessibilityRole="button">
              <AppIcon name={kind.icon} tone={kind.tone} size={40} />
              <View style={styles.itemText}>
                <Text style={[styles.itemTitle, !item.readAt && styles.itemTitleUnread]} numberOfLines={2}>{item.title}</Text>
                {item.body ? <Text style={styles.itemBody} numberOfLines={2}>{item.body}</Text> : null}
                <Text style={styles.itemTime}>{ago(item.createdAt)}</Text>
              </View>
              {!item.readAt ? <View style={styles.dot} /> : item.link ? <Glyph name="chevron" size={16} color={colors.faint} fillOpacity={0} /> : null}
            </Pressable>
          </FadeSlide>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: "center", paddingVertical: space.xl },
  empty: { alignItems: "center", paddingVertical: space.lg, gap: space.xs },
  emptyTitle: { fontSize: text.body, lineHeight: 24, fontFamily: fonts.bold, color: colors.navy },
  emptyText: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.regular, color: colors.muted, textAlign: "center" },
  readAll: { height: 32, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: colors.skyTint, justifyContent: "center" },
  readAllText: { fontSize: text.caption, fontFamily: fonts.bold, color: colors.skyDeep },
  item: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: "rgba(255,255,255,0.94)", borderRadius: radius.card, padding: space.sm, borderWidth: 1, borderColor: "#E6EEF8" },
  itemUnread: { backgroundColor: "#fff", borderColor: "#FFD2B0" },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  itemText: { flex: 1, minWidth: 0, gap: 2 },
  itemTitle: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.semibold, color: colors.navy },
  itemTitleUnread: { fontFamily: fonts.bold },
  itemBody: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
  itemTime: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.medium, color: colors.faint },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.orange },
});
