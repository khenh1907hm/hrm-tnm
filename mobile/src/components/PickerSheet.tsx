import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, type Tone } from "@/lib/theme";
import { AppIcon, Glyph, type IconName } from "./AppIcon";
import { MODAL_ORIENTATIONS } from "@/lib/layout";

export type PickerItem = { id: string; title: string; subtitle?: string; badge?: string; icon?: IconName; tone?: Tone; disabled?: boolean; /** Hiện số (vd số ảnh cần chụp) thay cho icon. */ number?: number };

/** Bỏ dấu tiếng Việt để tìm "cong truong" ra "Công trường". */
export const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/**
 * Hộp chọn trượt từ dưới lên, có ô tìm kiếm (không phân biệt dấu).
 * Dùng cho chọn nơi làm việc (dự án) khi điểm danh và chọn dự án khi lập báo cáo.
 */
export function PickerSheet({ visible, title, placeholder, items, selectedId, emptyText, onSelect, onClose }: {
  visible: boolean; title: string; placeholder: string; items: PickerItem[]; selectedId: string | null; emptyText: string;
  onSelect: (item: PickerItem) => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    setQuery("");
    slide.setValue(0);
    Animated.timing(slide, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [visible, slide]);

  const filtered = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return items;
    return items.filter((item) => fold(`${item.title} ${item.subtitle ?? ""} ${item.badge ?? ""}`).includes(q));
  }, [items, query]);

  return (
    <Modal supportedOrientations={MODAL_ORIENTATIONS} visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Đóng" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.holder} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 12, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [500, 0] }) }] }]}>
          <View style={styles.grip} />
          <View style={styles.headRow}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button"><Text style={styles.close}>Đóng</Text></Pressable>
          </View>
          <View style={styles.search}>
            <Glyph name="search" size={20} color={colors.skyDeep} fillOpacity={0.12} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={placeholder}
              placeholderTextColor={colors.faint}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel={placeholder}
            />
            {query ? <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Xóa tìm kiếm"><Text style={styles.clear}>✕</Text></Pressable> : null}
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
            ListEmptyComponent={<Text style={styles.empty}>{query ? `Không tìm thấy "${query}".` : emptyText}</Text>}
            renderItem={({ item }) => {
              const selected = item.id === selectedId;
              return (
                <Pressable
                  onPress={() => { if (!item.disabled) onSelect(item); }}
                  style={({ pressed }) => [styles.row, selected && styles.rowOn, pressed && !item.disabled && styles.rowPressed, item.disabled && styles.rowOff]}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: item.disabled }}
                >
                  {item.number !== undefined ? <View style={[styles.num, selected && styles.numOn]}><Text style={styles.numText}>{item.number}</Text></View> : <AppIcon name={item.icon ?? "home"} tone={item.tone ?? "sky"} size={40} />}
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
                    {item.subtitle ? <Text style={styles.rowSub} numberOfLines={1}>{item.subtitle}</Text> : null}
                  </View>
                  {item.badge ? <Text style={[styles.badge, selected && styles.badgeOn]}>{item.badge}</Text> : null}
                  {selected ? <Text style={styles.tick}>✓</Text> : null}
                </Pressable>
              );
            }}
          />
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(11,31,102,0.45)" },
  holder: { flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: "#F7FAFE", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 8, maxHeight: "80%", width: "100%", maxWidth: 560, alignSelf: "center" },
  grip: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#CBD8EC", alignSelf: "center", marginBottom: 8 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  title: { fontSize: 20, lineHeight: 28, fontFamily: fonts.black, color: colors.navy },
  close: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, color: colors.skyDeep },
  search: { flexDirection: "row", alignItems: "center", gap: 8, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.fieldLine, backgroundColor: "#fff", paddingHorizontal: 12, marginBottom: 12 },
  searchInput: { flex: 1, height: 44, fontSize: 16, fontFamily: fonts.medium, color: colors.navy },
  clear: { fontSize: 14, color: colors.faint, fontFamily: fonts.bold },
  list: { flexGrow: 0 },
  empty: { textAlign: "center", color: colors.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, paddingVertical: 24 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 16, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1.5, borderColor: "#E6EEF8" },
  rowOn: { borderColor: colors.orange, backgroundColor: "#FFF8F2" },
  rowPressed: { transform: [{ scale: 0.99 }], opacity: 0.9 },
  rowOff: { opacity: 0.55 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, color: colors.navy },
  rowSub: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
  badge: { fontSize: 11, lineHeight: 16, fontFamily: fonts.bold, color: colors.skyDeep, backgroundColor: colors.skyTint, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  badgeOn: { color: "#B34700", backgroundColor: "#FFEBDC" },
  tick: { fontSize: 16, color: colors.orange, fontFamily: fonts.black },
  num: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.skyDeep, alignItems: "center", justifyContent: "center" },
  numOn: { backgroundColor: colors.orange },
  numText: { fontSize: 18, lineHeight: 22, fontFamily: fonts.black, color: "#fff" },
});
