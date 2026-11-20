import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clockVN, dayLabel } from "@/lib/dates";
import { errorText } from "@/lib/errors";
import { attachmentUrls, cancelExplanation, hoursOf, hoursText, needsExplanation, REASONS, type Day, type Explanation } from "@/lib/history";
import { MODAL_ORIENTATIONS } from "@/lib/layout";
import { colors, fonts, radius, space, text } from "@/lib/theme";
import { AppIcon, Glyph } from "./AppIcon";
import { DAY_STYLE } from "./AttendanceCalendar";
import { GradientButton, SecondaryButton } from "./GradientButton";
import { useToast } from "./Toast";

const STATUS: Record<Explanation["status"], { label: string; fg: string; bg: string }> = {
  pending: { label: "Chờ PM duyệt", fg: "#8A5A00", bg: "#FFF6DA" },
  approved: { label: "Đã duyệt", fg: "#0E7A3F", bg: "#E6F8EE" },
  rejected: { label: "Bị từ chối", fg: colors.bad, bg: colors.badBg },
  cancelled: { label: "Đã hủy", fg: colors.faint, bg: colors.field },
};

function Attachments({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => { let alive = true; void attachmentUrls(paths).then((list) => { if (alive) setUrls(list); }); return () => { alive = false; }; }, [paths]);
  if (!urls.length) return null;
  return <View style={styles.thumbs}>{urls.map((url) => <Image key={url} source={{ uri: url }} style={styles.thumb} contentFit="cover" />)}</View>;
}

/** Chi tiết một ngày: chấm ở đâu, giờ Vào / Ra, tổng giờ, giải trình đã gửi; nút giải trình khi thiếu công. */
export function DaySheet({ day, siteName, onClose, onChanged }: {
  day: Day | null; siteName: (projectId: string) => string; onClose: () => void; onChanged: () => void;
}) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const slide = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState<Day | null>(day);

  useEffect(() => {
    if (!day) return;
    setShown(day);
    slide.setValue(0);
    Animated.timing(slide, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [day, slide]);

  const current = day ?? shown;
  if (!current) return null;
  const look = DAY_STYLE[current.status];
  const fix = needsExplanation(current);
  const hasPending = current.explanations.some((item) => item.status === "pending");
  // Ngày nghỉ tuần (vd Chủ nhật) vẫn giải trình được: đi tăng ca mà quên chấm / không chấm được
  const canExplainMore = !fix && !hasPending && current.status !== "future";
  const offDay = current.status === "off";
  const firstRow = current.rows[0];
  const missingOut = current.rows.find((row) => row.checkInAt && !row.checkOutAt);

  const explain = () => {
    const project = missingOut?.projectId ?? firstRow?.projectId ?? "";
    const activity = missingOut ? "out" : firstRow?.checkInAt ? "out" : "in";
    onClose();
    router.push({ pathname: "/explain", params: { date: current.date, project, activity } });
  };

  const cancel = async (id: string) => {
    try { await cancelExplanation(id); toast("Đã hủy giải trình.", "ok"); onChanged(); onClose(); }
    catch (error) { toast(errorText(error), "err"); }
  };

  return (
    <Modal supportedOrientations={MODAL_ORIENTATIONS} visible={day !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Đóng" />
      <View style={styles.holder} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + space.md, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }] }]}>
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <View style={styles.flex}>
              <Text style={styles.title}>{dayLabel(current.date)}</Text>
              {look.label ? <Text style={[styles.badge, { color: look.fg, backgroundColor: look.bg === "transparent" ? colors.field : look.bg }]}>{look.label}</Text> : null}
            </View>
            <Pressable onPress={onClose} style={styles.close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Đóng">
              <Glyph name="close" size={18} color={colors.navy} fillOpacity={0} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyInner} showsVerticalScrollIndicator={false}>
            {current.rows.length === 0 ? (
              <View style={styles.empty}>
                <AppIcon name={current.status === "off" ? "calendar" : "clock"} tone={current.status === "off" ? "sky" : "rose"} size={44} />
                <Text style={styles.emptyText}>{current.status === "off" ? "Ngày nghỉ theo lịch. Nếu có đi làm tăng ca mà chưa chấm được, bấm giải trình bên dưới — giờ làm ngày nghỉ được tính tăng ca." : current.status === "none" ? "Hôm nay bạn chưa chấm công." : "Không có lượt chấm công nào trong ngày này."}</Text>
              </View>
            ) : current.rows.map((row) => {
              const hours = hoursOf(row);
              return (
                <View key={row.projectId} style={styles.block}>
                  <View style={styles.place}>
                    <AppIcon name="pin" tone="orange" size={32} />
                    <View style={styles.flex}>
                      <Text style={styles.placeName} numberOfLines={2}>{row.projectName}</Text>
                      <Text style={styles.placeSub}>{row.code} · Ca {row.workStart}–{row.workEnd}</Text>
                    </View>
                  </View>
                  <View style={styles.times}>
                    <View style={styles.time}>
                      <Text style={styles.timeLabel}>Giờ vào</Text>
                      <Text style={styles.timeValue}>{clockVN(row.checkInAt)}</Text>
                      <Text style={styles.timeSub}>{row.checkInAt ? (row.source === "explanation" ? "Ghi bù từ giải trình" : "Chấm GPS + ảnh") : "Chưa chấm"}</Text>
                    </View>
                    <View style={[styles.time, styles.timeDivider]}>
                      <Text style={styles.timeLabel}>Giờ ra ca</Text>
                      <Text style={[styles.timeValue, !row.checkOutAt && styles.timeMissing]}>{clockVN(row.checkOutAt)}</Text>
                      <Text style={[styles.timeSub, !row.checkOutAt && row.checkInAt && { color: "#C2410C" }]}>{row.checkOutAt ? "Đã chấm ra" : row.checkInAt ? "Thiếu giờ ra" : "Chưa chấm"}</Text>
                    </View>
                  </View>
                  <View style={styles.total}>
                    <Glyph name="clock" size={18} color={colors.skyDeep} fillOpacity={0.15} />
                    <Text style={styles.totalText}>
                      {hours ? <>Tổng cộng <Text style={styles.totalStrong}>{hoursText(hours.total)}</Text></> : "Chưa đủ giờ vào / ra để tính giờ"}
                    </Text>
                  </View>
                  {hours ? (
                    <Text style={styles.totalSub}>
                      Giờ thường {hours.regular} giờ{hours.ot ? ` · Tăng ca ${hours.ot} giờ` : ""}{hours.lunch ? ` · đã trừ nghỉ trưa ${hoursText(hours.lunch)}` : ""}{hours.fromSheet ? " · theo phiếu công" : ""}
                    </Text>
                  ) : null}
                </View>
              );
            })}

            {current.explanations.length > 0 && <Text style={styles.section}>Giải trình đã gửi</Text>}
            {current.explanations.map((item) => {
              const s = STATUS[item.status];
              return (
                <View key={item.id} style={styles.note}>
                  <View style={styles.noteHead}>
                    <Text style={styles.noteTitle}>{item.activity === "in" ? "Giờ vào" : item.activity === "out" ? "Giờ ra" : "Giải trình"}{item.time ? ` ${item.time}` : ""}</Text>
                    <Text style={[styles.status, { color: s.fg, backgroundColor: s.bg }]}>{s.label}</Text>
                  </View>
                  <Text style={styles.noteBody}>{item.reasonCode ? REASONS.find((r) => r.code === item.reasonCode)?.label : ""}{item.reasonCode ? " · " : ""}{siteName(item.projectId)}</Text>
                  <Text style={styles.noteReason}>{item.reason}</Text>
                  <Attachments paths={item.attachments} />
                  {item.status === "rejected" && item.reviewNote ? <Text style={styles.review}>{item.reviewerName || "PM"}: {item.reviewNote}</Text> : null}
                  {item.status === "pending" ? (
                    <Pressable onPress={() => void cancel(item.id)} style={styles.cancel} accessibilityRole="button"><Text style={styles.cancelText}>Hủy giải trình này</Text></Pressable>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          {fix ? (
            <GradientButton label={missingOut ? "Giải trình thiếu giờ ra" : "Giải trình chấm công"} onPress={explain} />
          ) : canExplainMore ? (
            <SecondaryButton label={offDay ? "Giải trình tăng ca ngày nghỉ" : "Giải trình chấm công ngày này"} onPress={explain} />
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(11,31,102,0.45)" },
  holder: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  sheet: { width: "100%", maxWidth: 560, maxHeight: "88%", backgroundColor: "#fff", borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: space.md, paddingTop: space.xs, gap: space.sm },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  title: { fontSize: text.title, lineHeight: 28, fontFamily: fonts.black, color: colors.navy },
  badge: { alignSelf: "flex-start", marginTop: 4, fontSize: 11, lineHeight: 16, fontFamily: fonts.bold, borderRadius: radius.pill, paddingHorizontal: space.xs, paddingVertical: 2, overflow: "hidden" },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.field, alignItems: "center", justifyContent: "center" },
  body: { flexGrow: 0 },
  bodyInner: { gap: space.sm, paddingBottom: space.xs },
  empty: { alignItems: "center", gap: space.xs, paddingVertical: space.md },
  emptyText: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.medium, color: colors.muted, textAlign: "center" },
  block: { backgroundColor: colors.bg, borderRadius: radius.card, padding: space.sm, gap: space.sm, borderWidth: 1, borderColor: "#E6EEF8" },
  place: { flexDirection: "row", alignItems: "center", gap: space.sm },
  placeName: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.bold, color: colors.navy },
  placeSub: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
  times: { flexDirection: "row", backgroundColor: "#fff", borderRadius: radius.control },
  time: { flex: 1, padding: space.sm, gap: 2 },
  timeDivider: { borderLeftWidth: 1, borderLeftColor: colors.line },
  timeLabel: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.bold, color: colors.faint },
  timeValue: { fontSize: text.headline, lineHeight: 32, fontFamily: fonts.black, color: colors.navy, fontVariant: ["tabular-nums"] },
  timeMissing: { color: "#E3A27A" },
  timeSub: { fontSize: 11, lineHeight: 16, fontFamily: fonts.medium, color: colors.muted },
  total: { flexDirection: "row", alignItems: "center", gap: space.xs },
  totalText: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.medium, color: colors.navy },
  totalStrong: { fontFamily: fonts.black, color: colors.skyDeep },
  totalSub: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted, marginTop: -space.xs },
  section: { fontSize: text.caption, lineHeight: 16, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: fonts.bold, color: colors.faint, marginTop: space.xs },
  note: { borderRadius: radius.card, padding: space.sm, gap: 4, borderWidth: 1, borderColor: colors.line },
  noteHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.xs },
  noteTitle: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.bold, color: colors.navy },
  status: { fontSize: 11, lineHeight: 16, fontFamily: fonts.bold, borderRadius: radius.pill, paddingHorizontal: space.xs, paddingVertical: 2, overflow: "hidden" },
  noteBody: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.semibold, color: colors.skyDeep },
  noteReason: { fontSize: text.caption, lineHeight: 18, fontFamily: fonts.regular, color: colors.muted },
  review: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.medium, color: colors.bad },
  thumbs: { flexDirection: "row", gap: space.xs, marginTop: 2 },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.field },
  cancel: { alignSelf: "flex-start", paddingVertical: 4 },
  cancelText: { fontSize: text.caption, fontFamily: fonts.bold, color: colors.bad },
});
