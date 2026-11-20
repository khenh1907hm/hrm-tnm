import * as Haptics from "expo-haptics";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { hoursOf, hoursText, needsExplanation, type Day, type DayStatus } from "@/lib/history";
import { colors, fonts, radius, space, text } from "@/lib/theme";
import { Glyph } from "./AppIcon";
import { LogoLoader } from "./LogoLoader";

const WEEK = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** Màu từng tình trạng ngày: nền ô + màu chữ. */
export const DAY_STYLE: Record<DayStatus, { bg: string; fg: string; label: string }> = {
  full: { bg: "#E6F8EE", fg: "#0E7A3F", label: "Đủ công" },
  open: { bg: colors.skyTint, fg: colors.skyDeep, label: "Đang làm" },
  missing: { bg: colors.warnBg, fg: "#C2410C", label: "Thiếu giờ ra" },
  absent: { bg: colors.badBg, fg: colors.bad, label: "Không chấm" },
  off: { bg: "transparent", fg: colors.faint, label: "Ngày nghỉ" },
  future: { bg: "transparent", fg: "#B8C4DC", label: "" },
  none: { bg: "transparent", fg: colors.navy, label: "Chưa chấm" },
};

const LEGEND: DayStatus[] = ["full", "missing", "absent", "open"];

/** Lịch chấm công tháng: bấm một ngày để xem chi tiết hoặc giải trình. */
export function AttendanceCalendar({ monthLabel, days, loading, onPrev, onNext, canNext, onPressDay }: {
  monthLabel: string; days: Day[] | null; loading: boolean; onPrev: () => void; onNext: () => void; canNext: boolean; onPressDay: (day: Day) => void;
}) {
  const inMonth = days?.filter((day) => day.inMonth) ?? [];
  const worked = inMonth.filter((day) => day.status === "full" || day.status === "open").length;
  const total = inMonth.reduce((sum, day) => sum + day.rows.reduce((acc, row) => acc + (hoursOf(row)?.total ?? 0), 0), 0);
  const toFix = inMonth.filter((day) => needsExplanation(day)).length;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Pressable onPress={onPrev} style={styles.nav} hitSlop={8} accessibilityRole="button" accessibilityLabel="Tháng trước">
          <Glyph name="back" size={18} color={colors.navy} fillOpacity={0} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.month}>{monthLabel}</Text>
        <Pressable onPress={onNext} disabled={!canNext} style={[styles.nav, !canNext && styles.navOff]} hitSlop={8} accessibilityRole="button" accessibilityLabel="Tháng sau">
          <Glyph name="chevron" size={18} color={colors.navy} fillOpacity={0} strokeWidth={2.4} />
        </Pressable>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}><Text style={styles.statNum}>{worked}</Text><Text style={styles.statLabel}>ngày công</Text></View>
        <View style={styles.statSep} />
        <View style={styles.stat}><Text style={styles.statNum}>{Math.round(total * 10) / 10}</Text><Text style={styles.statLabel}>giờ làm</Text></View>
        <View style={styles.statSep} />
        <View style={styles.stat}><Text style={[styles.statNum, toFix > 0 && { color: colors.orange }]}>{toFix}</Text><Text style={styles.statLabel}>cần giải trình</Text></View>
      </View>

      <View style={styles.week}>
        {WEEK.map((label, index) => <Text key={label} style={[styles.weekDay, index === 6 && { color: colors.rose }]}>{label}</Text>)}
      </View>

      {days === null || loading ? (
        <View style={styles.loading}><LogoLoader size={48} stroke={3} variant="light" /></View>
      ) : (
        <View style={styles.grid}>
          {days.map((day) => {
            const look = DAY_STYLE[day.status];
            const pending = day.explanations.some((item) => item.status === "pending");
            const approved = day.explanations.some((item) => item.status === "approved");
            const fix = needsExplanation(day);
            const disabled = !day.inMonth || day.status === "future";
            return (
              <View key={day.date} style={styles.cellWrap}>
                <Pressable
                  disabled={disabled}
                  onPress={() => { if (Platform.OS !== "web") void Haptics.selectionAsync().catch(() => undefined); onPressDay(day); }}
                  style={({ pressed }) => [styles.cell, { backgroundColor: day.inMonth ? look.bg : "transparent" }, day.isToday && styles.today, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Ngày ${Number(day.date.slice(8, 10))}${look.label ? `, ${look.label}` : ""}${pending ? ", giải trình chờ duyệt" : ""}`}
                >
                  <Text style={[styles.dayNum, { color: day.inMonth ? look.fg : "#D3DCEC" }, day.isToday && styles.todayText]}>{Number(day.date.slice(8, 10))}</Text>
                  {day.inMonth && (pending || approved || fix) ? (
                    <View style={[styles.mark, pending ? styles.markPending : approved ? styles.markOk : styles.markFix]} />
                  ) : null}
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.legend}>
        {LEGEND.map((status) => (
          <View key={status} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: DAY_STYLE[status].bg, borderColor: DAY_STYLE[status].fg }]} />
            <Text style={styles.legendText}>{DAY_STYLE[status].label}</Text>
          </View>
        ))}
        <View style={styles.legendItem}><View style={[styles.mark, styles.markPending, styles.legendMark]} /><Text style={styles.legendText}>Chờ duyệt</Text></View>
      </View>
      {toFix > 0 ? <Text style={styles.tip}>Bấm vào ngày có chấm cam để giải trình.</Text> : null}
    </View>
  );
}

export const dayTotalText = (day: Day) => {
  const total = day.rows.reduce((sum, row) => sum + (hoursOf(row)?.total ?? 0), 0);
  return total ? hoursText(total) : "";
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff", borderRadius: radius.card, padding: space.md, gap: space.sm, borderWidth: 1, borderColor: "#EAF1FA",
    shadowColor: "#0B1F66", shadowOpacity: 0.07, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 2,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  nav: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.field, alignItems: "center", justifyContent: "center" },
  navOff: { opacity: 0.3 },
  month: { fontSize: text.body, lineHeight: 24, fontFamily: fonts.black, color: colors.navy },
  stats: { flexDirection: "row", alignItems: "center", backgroundColor: colors.bg, borderRadius: radius.control, paddingVertical: space.xs },
  stat: { flex: 1, alignItems: "center" },
  statNum: { fontSize: text.title, lineHeight: 28, fontFamily: fonts.black, color: colors.navy, fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 11, lineHeight: 14, fontFamily: fonts.semibold, color: colors.muted },
  statSep: { width: 1, height: 28, backgroundColor: colors.line },
  week: { flexDirection: "row" },
  weekDay: { flex: 1, textAlign: "center", fontSize: 11, lineHeight: 16, fontFamily: fonts.bold, color: colors.faint },
  loading: { alignItems: "center", paddingVertical: space.xl },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cellWrap: { width: `${100 / 7}%`, padding: 2 },
  cell: { height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  today: { borderWidth: 2, borderColor: colors.orange },
  todayText: { fontFamily: fonts.black },
  pressed: { opacity: 0.7, transform: [{ scale: 0.94 }] },
  dayNum: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.bold, fontVariant: ["tabular-nums"] },
  mark: { position: "absolute", top: 5, right: 6, width: 7, height: 7, borderRadius: 4 },
  markFix: { backgroundColor: colors.orange },
  markPending: { backgroundColor: "#F5B400" },
  markOk: { backgroundColor: "#16A34A" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, justifyContent: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 12, height: 12, borderRadius: 4, borderWidth: 1 },
  legendMark: { position: "relative", top: 0, right: 0 },
  legendText: { fontSize: 11, lineHeight: 16, fontFamily: fonts.medium, color: colors.muted },
  tip: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.medium, color: colors.orange, textAlign: "center" },
});
