import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { TextField } from "@/components/Fields";
import { GradientButton, SecondaryButton } from "@/components/GradientButton";
import { LogoLoader } from "@/components/LogoLoader";
import { NotificationBell } from "@/components/NotificationBell";
import { Card, FadeSlide, Screen, SectionTitle } from "@/components/Screen";
import { useToast } from "@/components/Toast";
import * as api from "@/lib/approvals";
import type { ApprovalCard } from "@/lib/approvals";
import { dmy } from "@/lib/dates";
import { errorText } from "@/lib/errors";
import { webBase } from "@/lib/notifications";
import { colors, fonts, radius, space, text } from "@/lib/theme";

type Filter = "buy" | "all";

/** Một phiếu: tên, dự án, số tiền, tiến độ ký; bấm để ký / trả về (trả về cần ghi lý do). */
function ApprovalItem({ card, director, onDone }: { card: ApprovalCard; director: boolean; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = card.column === "todo" && card.canSign && Boolean(card.stepId);
  const directorCan = director && !mine && (card.column === "todo" || card.column === "waiting");
  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    try { await action(); toast(done, "ok"); setOpen(false); setNote(""); onDone(); } catch (error) { toast(errorText(error), "err"); } finally { setBusy(false); }
  };
  return (
    <Card>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={`${api.DOC_LABEL[card.docType] ?? card.docType} ${card.title}`}>
        <View style={styles.head}>
          <Text style={styles.type}>{api.DOC_LABEL[card.docType] ?? card.docType}{card.projectCode ? ` · ${card.projectCode}` : ""}</Text>
          <Text style={styles.progress}>{card.signed}/{card.total}</Text>
        </View>
        <Text style={styles.title} numberOfLines={3}>{card.title}</Text>
        {card.amount ? <Text style={styles.amount}>{api.money(card.amount)}</Text> : null}
        <Text style={styles.muted}>
          {[card.creatorName && `Lập: ${card.creatorName}`, card.role && `Bước: ${api.ROLE_LABEL[card.role] ?? card.role}`, card.column === "waiting" && card.assignee && `chờ ${card.assignee}`, card.targetDate && `hạn ${dmy(card.targetDate)}`].filter(Boolean).join(" · ")}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.actions}>
          {card.link ? <SecondaryButton label="Xem chi tiết phiếu" onPress={() => void Linking.openURL(`${webBase()}${card.link}`)} /> : null}
          {mine || directorCan ? <TextField label="Ghi chú (bắt buộc khi trả về)" value={note} onChange={setNote} placeholder="vd Đồng ý / Sửa lại đơn giá dòng 3" multiline /> : null}
          {mine ? <>
            <GradientButton label="Ký duyệt" busy={busy} onPress={() => void run(() => api.sign(card.stepId!, true, note.trim()), "Đã ký duyệt.")} />
            <SecondaryButton danger label="Trả về" onPress={() => { if (!note.trim()) { toast("Ghi lý do trả về trước.", "warn"); return; } void run(() => api.sign(card.stepId!, false, note.trim()), "Đã trả về người lập."); }} />
          </> : null}
          {directorCan ? <GradientButton label="Giám đốc duyệt thẳng" busy={busy} onPress={() => void run(() => api.directorApprove(card.docType, card.docId, note.trim()), "Đã duyệt.")} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

/** Tab Duyệt: phiếu mua hàng (yêu cầu vật tư, đơn đặt hàng, đề nghị thanh toán) và các phiếu khác chờ mình ký. */
export default function ApproveScreen() {
  const toast = useToast();
  const [cards, setCards] = useState<ApprovalCard[] | null>(null);
  const [director, setDirector] = useState(false);
  const [filter, setFilter] = useState<Filter>("buy");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try {
      const [list, boss] = await Promise.all([api.loadBoard(), api.isDirector()]);
      setCards(list); setDirector(boss);
    } catch (error) { toast(errorText(error), "err"); setCards((c) => c ?? []); }
  }, [toast]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const shown = useMemo(() => (cards ?? []).filter((card) => filter === "all" || api.PURCHASING.has(card.docType)), [cards, filter]);
  const todo = shown.filter((card) => card.column === "todo" && card.canSign);
  const waiting = shown.filter((card) => card.column === "waiting" || (card.column === "todo" && !card.canSign));
  const done = shown.filter((card) => card.column === "approved" || card.column === "returned").slice(0, 10);
  return (
    <Screen title="Duyệt" subtitle="Mua hàng: vật tư, đơn đặt hàng, thanh toán" right={<NotificationBell />} refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }}>
      <View style={styles.chips}>
        {([["buy", "Mua hàng"], ["all", "Tất cả phiếu"]] as const).map(([key, label]) => (
          <Pressable key={key} onPress={() => setFilter(key)} style={[styles.chip, filter === key && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: filter === key }}>
            <Text style={[styles.chipText, filter === key && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {!cards ? <LogoLoader /> : <>
        <FadeSlide delay={40}><SectionTitle>Chờ tôi ký ({todo.length})</SectionTitle></FadeSlide>
        {!todo.length ? <Card><Text style={styles.muted}>Không có phiếu nào chờ bạn ký.</Text></Card> : todo.map((card) => <ApprovalItem key={`${card.docType}-${card.docId}`} card={card} director={director} onDone={() => void load()} />)}
        {waiting.length ? <>
          <SectionTitle>Đang chờ người khác ({waiting.length})</SectionTitle>
          {waiting.map((card) => <ApprovalItem key={`${card.docType}-${card.docId}`} card={card} director={director} onDone={() => void load()} />)}
        </> : null}
        {done.length ? <>
          <SectionTitle>Gần đây</SectionTitle>
          {done.map((card) => <ApprovalItem key={`${card.docType}-${card.docId}`} card={card} director={false} onDone={() => void load()} />)}
        </> : null}
      </>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.xs },
  type: { flex: 1, fontSize: text.caption, fontFamily: fonts.bold, color: colors.orange },
  progress: { fontSize: text.caption, fontFamily: fonts.semibold, color: colors.faint },
  title: { fontSize: text.body, fontFamily: fonts.bold, color: colors.ink, marginTop: 4 },
  amount: { fontSize: text.body, fontFamily: fonts.semibold, color: colors.skyDeep, marginTop: 2 },
  muted: { fontSize: text.small, fontFamily: fonts.regular, color: colors.muted, marginTop: 4 },
  actions: { gap: space.xs, marginTop: space.sm },
  chips: { flexDirection: "row", gap: space.xs, marginBottom: space.sm },
  chip: { paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.orange, borderColor: colors.orange },
  chipText: { fontSize: text.small, fontFamily: fonts.semibold, color: colors.muted },
  chipTextOn: { color: colors.white },
});
