import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Glyph } from "@/components/AppIcon";
import { dmy, todayISO } from "@/lib/dates";
import { colors, fonts, radius } from "@/lib/theme";

const WEEK = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Các ô của một tháng (bắt đầu thứ Hai); null là ô trống đầu / cuối tháng. */
export function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lead = (first + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${pad(month)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** Lịch tháng bật lên: lùi / tiến tháng, bấm một ngày để chọn. */
function CalendarSheet({ value, onPick, onClose }: { value: string | null; onPick: (iso: string) => void; onClose: () => void }) {
  const today = todayISO();
  const base = value ?? today;
  const [ym, setYm] = useState({ y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) });
  const shift = (delta: number) => setYm(({ y, m }) => { const t = y * 12 + (m - 1) + delta; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; });
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Đóng lịch">
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.head}>
            <Pressable onPress={() => shift(-1)} hitSlop={10} style={styles.nav} accessibilityLabel="Tháng trước"><Glyph name="back" size={18} color={colors.navy} fillOpacity={0} strokeWidth={2.4} /></Pressable>
            <Text style={styles.month}>Tháng {ym.m}/{ym.y}</Text>
            <Pressable onPress={() => shift(1)} hitSlop={10} style={[styles.nav, { transform: [{ scaleX: -1 }] }]} accessibilityLabel="Tháng sau"><Glyph name="back" size={18} color={colors.navy} fillOpacity={0} strokeWidth={2.4} /></Pressable>
          </View>
          <View style={styles.grid}>
            {WEEK.map((w) => <Text key={w} style={[styles.cell, styles.week, w === "CN" && styles.sun]}>{w}</Text>)}
            {monthCells(ym.y, ym.m).map((iso, i) => iso ? (
              <Pressable key={iso} style={styles.cellBox} onPress={() => { onPick(iso); onClose(); }} accessibilityRole="button" accessibilityLabel={dmy(iso)} accessibilityState={{ selected: iso === value }}>
                <View style={[styles.day, iso === today && styles.today, iso === value && styles.picked]}>
                  <Text style={[styles.dayText, (i % 7) === 6 && styles.sun, iso === value && styles.pickedText]}>{Number(iso.slice(8))}</Text>
                </View>
              </Pressable>
            ) : <View key={`e${i}`} style={styles.cellBox} />)}
          </View>
          <View style={styles.foot}>
            <Pressable onPress={() => { onPick(today); onClose(); }} style={styles.footBtn}><Text style={styles.footText}>Hôm nay</Text></Pressable>
            <Pressable onPress={onClose} style={styles.footBtn}><Text style={styles.footText}>Đóng</Text></Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Ô ngày: bấm mở lịch để chọn. */
export function DateField({ label, value, onChange, editable = true }: { label: string; value: string | null; onChange: (iso: string) => void; editable?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable disabled={!editable} onPress={() => setOpen(true)} style={[styles.input, !editable && styles.off]} accessibilityRole="button" accessibilityLabel={`${label}: ${value ? dmy(value) : "chưa chọn"}`}>
        <Glyph name="calendar" size={20} color={colors.skyDeep} fillOpacity={0.15} />
        <Text style={[styles.inputText, !value && styles.placeholder]}>{value ? dmy(value) : "Chọn ngày"}</Text>
      </Pressable>
      {open ? <CalendarSheet value={value} onPick={onChange} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.muted },
  input: { flexDirection: "row", alignItems: "center", gap: 10, height: 48, paddingHorizontal: 14, borderRadius: radius.control, borderWidth: 1, borderColor: colors.fieldLine, backgroundColor: colors.field },
  off: { opacity: 0.6 },
  inputText: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  placeholder: { color: colors.faint, fontFamily: fonts.medium },
  backdrop: { flex: 1, backgroundColor: "rgba(11,31,102,0.35)", alignItems: "center", justifyContent: "center", padding: 16 },
  sheet: { width: "100%", maxWidth: 380, backgroundColor: "#fff", borderRadius: radius.sheet, padding: 16, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  nav: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.skyTint, alignItems: "center", justifyContent: "center" },
  month: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, textAlign: "center" },
  cellBox: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  week: { fontFamily: fonts.semibold, fontSize: 12, color: colors.faint, paddingVertical: 6 },
  sun: { color: colors.rose },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  today: { borderWidth: 1.5, borderColor: colors.orange },
  picked: { backgroundColor: colors.orange, borderColor: colors.orange },
  dayText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.navy },
  pickedText: { color: "#fff" },
  foot: { flexDirection: "row", justifyContent: "space-between" },
  footBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  footText: { fontFamily: fonts.bold, fontSize: 14, color: colors.skyDeep },
});
