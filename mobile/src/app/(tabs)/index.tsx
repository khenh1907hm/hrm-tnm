import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { AppIcon, Glyph } from "@/components/AppIcon";
import { GradientButton, SecondaryButton } from "@/components/GradientButton";
import { GridBackground } from "@/components/GridBackground";
import { LogoLoader } from "@/components/LogoLoader";
import { MascotAlert, type MascotMessage } from "@/components/MascotAlert";
import { PickerSheet, type PickerItem } from "@/components/PickerSheet";
import { PunchButton } from "@/components/PunchButton";
import { Card, FadeSlide, Screen, SectionTitle } from "@/components/Screen";
import { NotificationBell } from "@/components/NotificationBell";
import { useToast } from "@/components/Toast";
import { SelfieCamera, type SelfiePhoto } from "@/components/SelfieCamera";
import { AttendanceCalendar } from "@/components/AttendanceCalendar";
import { DaySheet } from "@/components/DaySheet";
import { distanceM, freshGps, isLink, loadSites, nextPunch, punch, readGps, siteMapUrl, type GpsFix, type Site, type Workplace } from "@/lib/attendance";
import { buildCalendar, loadMonthExplanations, loadMonthRows, shiftMonth, type Day, type Explanation, type MonthRow } from "@/lib/history";
import { clockVN, dayLabel, monthISO, todayISO } from "@/lib/dates";
import type React from "react";
import { errorText } from "@/lib/errors";
import { useAuth } from "@/lib/auth";
import { Columns, useLayout, MODAL_ORIENTATIONS } from "@/lib/layout";
import { useSettings } from "@/lib/settings";
import { colors, fonts, radius, space, text } from "@/lib/theme";

const LAST_SITE = "tnm.lastWorkplace";

/** Đồng hồ theo giờ VN, chạy từng giây. */
function LiveClock({ right }: { right?: React.ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const vn = new Date(now.getTime() + 7 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <LinearGradient colors={["#0B1F66", "#1B4FB8", "#6EC1F5"]} locations={[0, 0.6, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.clock}>
      <GridBackground tone="light" />
      <View>
        <Text style={styles.clockLabel}>{dayLabel(todayISO(now))}</Text>
        <Text style={styles.clockNote}>Giờ do máy chủ ghi</Text>
      </View>
      <View style={styles.clockRow}>
        <Text style={styles.clockTime}>{pad(vn.getUTCHours())}:{pad(vn.getUTCMinutes())}</Text>
        <Text style={styles.clockSec}>{pad(vn.getUTCSeconds())}</Text>
        {right ? <View style={styles.clockBell}>{right}</View> : null}
      </View>
    </LinearGradient>
  );
}

type Shot = { kind: "in" | "out"; place: Workplace; fix: GpsFix; distance: number | null };
type Pending = Shot & { photo: SelfiePhoto };

export default function CheckinScreen() {
  const toast = useToast();
  const { settings } = useSettings();
  const { employeeId, status } = useAuth();
  const unlinked = status === "ready" && !employeeId;
  const { wide } = useLayout();
  const [shot, setShot] = useState<Shot | null>(null);
  const [gps, setGps] = useState<GpsFix | null>(() => freshGps());
  const [sites, setSites] = useState<Site[] | null>(null);
  const [month, setMonth] = useState(() => monthISO());
  const [monthData, setMonthData] = useState<{ month: string; rows: MonthRow[]; notes: Explanation[] } | null>(null);
  const [openDay, setOpenDay] = useState<Day | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cheer, setCheer] = useState<MascotMessage | null>(null);

  const load = useCallback(async () => {
    try {
      const [allSites, last] = await Promise.all([loadSites(), AsyncStorage.getItem(LAST_SITE).catch(() => null)]);
      setSites(allSites);
      setSelectedId((current) => {
        const has = (id: string | null) => Boolean(id && allSites.some((s) => s.projectId === id));
        if (has(current)) return current;
        if (settings.rememberSite && has(last)) return last;
        return allSites.find((s) => s.today && !s.today.checkOutAt)?.projectId ?? allSites.find((s) => s.isMember)?.projectId ?? null;
      });
    } catch (error) {
      setSites((current) => current ?? []);
      setProblem(errorText(error));
    }
  }, [settings.rememberSite]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Lịch chấm công của tháng đang xem + giải trình của chính mình
  const loadMonthData = useCallback(async (target: string) => {
    const [rows, notes] = await Promise.all([
      loadMonthRows(target).catch(() => [] as MonthRow[]),
      employeeId ? loadMonthExplanations(target, employeeId).catch(() => [] as Explanation[]) : Promise.resolve([] as Explanation[]),
    ]);
    setMonthData({ month: target, rows, notes });
  }, [employeeId]);
  useFocusEffect(useCallback(() => { void loadMonthData(month); }, [loadMonthData, month]));

  const days = useMemo(() => (monthData ? buildCalendar(monthData.month, monthData.rows, monthData.notes) : null), [monthData]);
  const siteName = useCallback((id: string) => { const s = sites?.find((x) => x.projectId === id) ?? null; const r = monthData?.rows.find((x) => x.projectId === id); return s ? `${s.code} · ${s.name}` : r ? `${r.code} · ${r.projectName}` : "Công trường"; }, [sites, monthData]);
  const monthLabel = `Tháng ${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

  // Lấy GPS sẵn khi mở màn hình (theo Cài đặt) để bấm chấm công là gửi ngay.
  useFocusEffect(useCallback(() => {
    if (!settings.gpsWarmup) return;
    let alive = true;
    const warm = () => { void readGps({ fast: settings.gpsFast, fresh: true, ask: false }).then((fix) => { if (alive) setGps(fix); }).catch(() => undefined); };
    warm();
    const timer = setInterval(warm, 45_000);
    return () => { alive = false; clearInterval(timer); };
  }, [settings.gpsWarmup, settings.gpsFast]));

  const site = useMemo(() => sites?.find((s) => s.projectId === selectedId) ?? null, [sites, selectedId]);
  const place: Site | null = site;

  const items: PickerItem[] = useMemo(() => (sites ?? []).map((s) => {
    const next = nextPunch(s);
    return {
      id: s.projectId,
      title: s.name,
      subtitle: [s.code, s.isMember ? "Công trường của bạn" : isLink(s.address) ? "" : s.address].filter(Boolean).join(" · "),
      badge: next === "in" ? (s.hasSite ? "Chưa chấm" : "Chưa có vị trí") : next === "out" ? `Vào ${clockVN(s.today?.checkInAt)}` : "Đã đủ",
      icon: "pin",
      tone: next === "out" ? "sky" : next === null ? "navy" : s.isMember ? "orange" : "rose",
    };
  }), [sites]);

  const choose = (item: PickerItem) => {
    setSelectedId(item.id);
    setPicking(false);
    setProblem(null);
    void AsyncStorage.setItem(LAST_SITE, item.id).catch(() => undefined);
  };

  const start = async (kind: "in" | "out") => {
    if (!place) return;
    setProblem(null);
    if (unlinked) { setProblem(errorText("CHECKIN_NO_EMPLOYEE")); return; }
    if (!place.hasSite) { setProblem(errorText("CHECKIN_NO_SITE")); return; }
    try {
      if (!freshGps()) setBusy("Đang lấy vị trí GPS…");
      const fix = await readGps({ fast: settings.gpsFast });
      setGps(fix);
      const distance = place.siteLat !== null && place.siteLng !== null ? distanceM(place.siteLat, place.siteLng, fix.lat, fix.lng) : null;
      setBusy(null);
      if (distance !== null && distance > place.radiusM) { setProblem(errorText(`CHECKIN_OUT_OF_RANGE:${distance}`)); return; }
      setShot({ kind, place, fix, distance });
    } catch (error) {
      setBusy(null);
      setProblem(errorText(error));
    }
  };

  const submit = async () => {
    if (!pending) return;
    const { kind, place: target, fix, photo } = pending;
    setPending(null);
    setBusy(kind === "in" ? "Đang gửi chấm Vào…" : "Đang gửi chấm Ra…");
    try {
      await punch(kind, target.projectId, fix, photo.base64);
      setCheer(kind === "in"
        ? { title: "Đã chấm Vào", message: "Chúc bạn một ngày làm việc vui vẻ! ❤️", detail: `${target.code} · ${target.name}` }
        : { title: "Đã chấm Ra", message: "Cảm ơn bạn, về nghỉ ngơi thật tốt nhé! ❤️", detail: `${target.code} · ${target.name}` });
      await Promise.all([load(), loadMonthData(month)]);
    } catch (error) {
      setProblem(errorText(error));
      toast(errorText(error), "err");
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => { setRefreshing(true); await Promise.all([load(), loadMonthData(month)]); setRefreshing(false); };
  const next = place ? nextPunch(place) : null;

  return (
    <Screen wide refreshing={refreshing} onRefresh={() => void refresh()}>
      <Columns
        left={<>
          <FadeSlide delay={40}><LiveClock right={<NotificationBell />} /></FadeSlide>

          {unlinked && (
            <FadeSlide delay={60}>
              <Text style={styles.warn} accessibilityRole="alert">
                Tài khoản này chưa liên kết hồ sơ nhân sự nên chưa chấm công được. Nhờ Admin vào Tài khoản trên web để liên kết với hồ sơ của bạn.
              </Text>
            </FadeSlide>
          )}

          {sites === null ? (
            <View style={styles.loadingBox}><LogoLoader size={64} stroke={4} variant="light" /></View>
          ) : (
            <>
              <FadeSlide delay={80}>
                <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel="Chọn công trường" style={({ pressed }) => [pressed && styles.pressed]}>
                  <Card style={styles.site}>
                    <AppIcon name="pin" tone="orange" size={40} />
                    <View style={styles.siteText}>
                      <Text style={styles.overline}>Công trường</Text>
                      <Text style={styles.siteName} numberOfLines={1}>{site ? site.name : "Chọn công trường"}</Text>
                      <Text style={styles.siteSub} numberOfLines={1}>{site ? [site.code, isLink(site.address) ? "" : site.address].filter(Boolean).join(" · ") : `${sites.length} công trường đang thi công`}</Text>
                    </View>
                    <View style={styles.change}><Glyph name="search" size={16} color={colors.skyDeep} fillOpacity={0} /><Text style={styles.changeText}>Chọn</Text></View>
                  </Card>
                </Pressable>
              </FadeSlide>

              {site && place && (
                <FadeSlide delay={120}>
                  <View style={styles.chips}>
                    <Text style={styles.chip}>Giờ làm {place.workStart}–{place.workEnd}</Text>
                    <Text style={styles.chip}>{place.hasSite ? `Bán kính ${place.radiusM} m` : "Chưa đặt vị trí"}</Text>
                    {siteMapUrl(place) ? (
                      <Pressable onPress={() => void Linking.openURL(siteMapUrl(place)!)} accessibilityRole="link" accessibilityLabel="Mở bản đồ công trường" hitSlop={6}>
                        <Text style={[styles.chip, styles.chipMap]}>Mở bản đồ ↗</Text>
                      </Pressable>
                    ) : null}
                    {place.team ? <Text style={styles.chip}>Tổ {place.team}</Text> : null}
                    {!site.isMember ? <Text style={[styles.chip, styles.chipOther]}>Công trường khác</Text> : null}
                    {settings.gpsWarmup ? <Text style={[styles.chip, gps ? styles.chipOk : styles.chipWait]}>{gps ? `GPS sẵn sàng · ±${gps.accuracy} m` : "Đang dò GPS…"}</Text> : null}
                  </View>
                </FadeSlide>
              )}

              {problem && <FadeSlide from="up"><Text style={styles.problem} accessibilityRole="alert">{problem}</Text></FadeSlide>}

              {!site ? (
                <FadeSlide delay={160}>
                  <Card style={styles.center}>
                    <AppIcon name="pin" tone="sky" size={48} />
                    <Text style={styles.centerTitle}>{sites.length ? "Chọn công trường để điểm danh" : "Chưa có công trường nào đang thi công"}</Text>
                    {sites.length ? <SecondaryButton label="Chọn công trường" onPress={() => setPicking(true)} /> : null}
                  </Card>
                </FadeSlide>
              ) : !place ? null : (
                <>
                  <FadeSlide delay={160} from="up">
                    {next ? (
                      <PunchButton kind={next} disabled={busy !== null} onPress={() => void start(next)} />
                    ) : (
                      <Card style={styles.center}>
                        <AppIcon name="check" tone="sky" size={48} />
                        <Text style={styles.centerTitle}>Đã chấm đủ hôm nay</Text>
                        <Text style={styles.centerText}>Hẹn gặp lại ngày mai</Text>
                      </Card>
                    )}
                  </FadeSlide>
                  <FadeSlide delay={200}>
                    <Card style={styles.timeline}>
                      {([
                        { key: "in", label: "Vào", time: place.today?.checkInAt ?? null, distance: place.today?.inDistanceM ?? null },
                        { key: "out", label: "Ra", time: place.today?.checkOutAt ?? null, distance: place.today?.outDistanceM ?? null },
                      ] as const).map((row, index) => (
                        <View key={row.key} style={[styles.tlCol, index === 1 && styles.tlDivider]}>
                          <View style={styles.tlHead}>
                            <View style={[styles.tlDot, row.time && styles.tlDotOn]} />
                            <Text style={styles.tlLabel}>{row.label}</Text>
                          </View>
                          <Text style={styles.tlTime}>{clockVN(row.time)}</Text>
                          <Text style={styles.tlSub}>{row.time ? `cách ${row.distance ?? 0} m` : "Chưa chấm"}</Text>
                        </View>
                      ))}
                    </Card>
                  </FadeSlide>
                </>
              )}
            </>
          )}
        </>}
        right={<>
          <FadeSlide delay={240}><SectionTitle>Lịch sử chấm công</SectionTitle></FadeSlide>
          <FadeSlide delay={260}>
            <AttendanceCalendar
              monthLabel={monthLabel}
              days={days}
              loading={monthData !== null && monthData.month !== month}
              onPrev={() => setMonth((m) => shiftMonth(m, -1))}
              onNext={() => setMonth((m) => shiftMonth(m, 1))}
              canNext={month < monthISO()}
              onPressDay={setOpenDay}
            />
          </FadeSlide>
        </>}
      />

      <DaySheet day={openDay} siteName={siteName} onClose={() => setOpenDay(null)} onChanged={() => void loadMonthData(month)} />

      <PickerSheet
        visible={picking}
        title="Chọn công trường"
        placeholder="Tìm theo tên, mã hoặc địa chỉ"
        items={items}
        selectedId={selectedId}
        emptyText="Chưa có công trường nào đang thi công."
        onSelect={choose}
        onClose={() => setPicking(false)}
      />

      <Modal supportedOrientations={MODAL_ORIENTATIONS} visible={pending !== null} transparent animationType="fade" onRequestClose={() => setPending(null)}>
        <View style={styles.modalBg}>
          {pending && (
            <View style={styles.preview}>
              <Text style={styles.previewTitle}>Gửi chấm {pending.kind === "in" ? "Vào" : "Ra"}</Text>
              <Text style={styles.previewSub}>{pending.place.code} · {pending.place.name}</Text>
              <Image source={{ uri: pending.photo.uri }} style={styles.photo} contentFit="cover" />
              <Text style={styles.previewNote}>
                {pending.distance !== null ? `Cách công trường ${pending.distance} m` : "Đã lấy vị trí"}{pending.fix.accuracy ? ` · sai số ~${pending.fix.accuracy} m` : ""}
              </Text>
              <GradientButton label={`Gửi chấm ${pending.kind === "in" ? "Vào" : "Ra"}`} onPress={() => void submit()} />
              <View style={styles.previewRow}>
                <View style={styles.flex}><SecondaryButton label="Chụp lại" onPress={() => { const kind = pending.kind; setPending(null); setTimeout(() => void start(kind), 450); }} /></View>
                <View style={styles.flex}><SecondaryButton label="Hủy" onPress={() => setPending(null)} /></View>
              </View>
            </View>
          )}
        </View>
      </Modal>

      <SelfieCamera
        visible={shot !== null}
        title={shot ? `Ảnh chấm ${shot.kind === "in" ? "Vào" : "Ra"} · ${shot.place.code}` : ""}
        onCancel={() => setShot(null)}
        onCapture={(photo) => { if (shot) setPending({ ...shot, photo }); setShot(null); }}
        onError={(error) => { setShot(null); setProblem(errorText(error)); }}
      />

      <MascotAlert value={cheer} onClose={() => setCheer(null)} />

      <Modal supportedOrientations={MODAL_ORIENTATIONS} visible={busy !== null} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.busy}>
            <LogoLoader size={80} stroke={4} variant="light" />
            <Text style={styles.busyText}>{busy}</Text>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  clock: { borderRadius: radius.card, paddingHorizontal: space.md, paddingVertical: space.sm, overflow: "hidden", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  clockLabel: { color: "#fff", fontSize: text.small, lineHeight: 20, fontFamily: fonts.bold },
  clockNote: { color: "rgba(255,255,255,0.75)", fontSize: text.caption, lineHeight: 16, fontFamily: fonts.regular },
  clockRow: { flexDirection: "row", alignItems: "flex-start", gap: space.xxs },
  clockBell: { marginLeft: space.sm, alignSelf: "center" },
  clockTime: { color: "#fff", fontSize: text.display, lineHeight: 40, fontFamily: fonts.black, fontVariant: ["tabular-nums"] },
  clockSec: { color: "#FFB27A", fontSize: text.caption, lineHeight: 16, fontFamily: fonts.bold, marginTop: space.xxs, fontVariant: ["tabular-nums"] },
  loadingBox: { alignItems: "center", paddingVertical: space.xl },
  site: { flexDirection: "row", alignItems: "center", gap: space.sm },
  siteText: { flex: 1, minWidth: 0 },
  overline: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.bold, color: colors.faint, textTransform: "uppercase", letterSpacing: 0.5 },
  siteName: { fontSize: text.body, lineHeight: 24, fontFamily: fonts.bold, color: colors.navy },
  siteSub: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
  change: { flexDirection: "row", alignItems: "center", gap: space.xxs, height: 32, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: colors.skyTint },
  changeText: { fontSize: text.caption, fontFamily: fonts.bold, color: colors.skyDeep },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, justifyContent: "center" },
  chipMap: { color: colors.skyDeep, borderColor: colors.skyDeep },
  chip: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.semibold, color: colors.navy, backgroundColor: "rgba(255,255,255,0.92)", borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: space.xxs, overflow: "hidden" },
  chipOk: { color: "#0E6B3A", backgroundColor: "#ECFBF2", borderColor: "#BDEBD0" },
  chipWait: { color: colors.muted },
  chipOther: { color: "#B34700", backgroundColor: "#FFF6EE", borderColor: "#FFD2B0" },
  warn: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.medium, color: colors.warn, backgroundColor: colors.warnBg, borderWidth: 1, borderColor: "#FFD2B0", borderRadius: radius.control, padding: space.sm, overflow: "hidden" },
  problem: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.medium, color: colors.bad, backgroundColor: colors.badBg, borderWidth: 1, borderColor: colors.badLine, borderRadius: radius.control, padding: space.sm, overflow: "hidden" },
  center: { alignItems: "center", paddingVertical: space.lg, gap: space.xs },
  centerTitle: { fontSize: text.body, lineHeight: 24, fontFamily: fonts.bold, color: colors.navy, textAlign: "center" },
  centerText: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.regular, color: colors.muted, textAlign: "center" },
  timeline: { flexDirection: "row", padding: 0, gap: 0 },
  tlCol: { flex: 1, padding: space.md, gap: space.xxs },
  tlDivider: { borderLeftWidth: 1, borderLeftColor: colors.line },
  tlHead: { flexDirection: "row", alignItems: "center", gap: space.xs },
  tlDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  tlDotOn: { backgroundColor: colors.orange },
  tlLabel: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.bold, color: colors.faint },
  tlTime: { fontSize: text.headline, lineHeight: 32, fontFamily: fonts.black, color: colors.navy, fontVariant: ["tabular-nums"] },
  tlSub: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
  day: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: "rgba(255,255,255,0.94)", borderRadius: radius.card, padding: space.sm, borderWidth: 1, borderColor: "#E6EEF8" },
  dayDate: { width: 40, height: 40, borderRadius: radius.control, backgroundColor: colors.skyTint, alignItems: "center", justifyContent: "center" },
  dayNum: { fontSize: text.body, lineHeight: 20, fontFamily: fonts.black, color: colors.skyDeep },
  dayMonth: { fontSize: 10, lineHeight: 12, fontFamily: fonts.bold, color: colors.skyDeep },
  dayText: { flex: 1, minWidth: 0 },
  dayTitle: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.bold, color: colors.navy },
  daySub: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
  dayTimes: { alignItems: "flex-end" },
  dayTime: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.bold, color: colors.navy, fontVariant: ["tabular-nums"] },
  dayOut: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.medium, color: colors.muted, fontVariant: ["tabular-nums"] },
  modalBg: { flex: 1, backgroundColor: "rgba(11,31,102,0.5)", alignItems: "center", justifyContent: "center", padding: space.lg },
  preview: { width: "100%", maxWidth: 400, backgroundColor: "#fff", borderRadius: radius.sheet, padding: space.md, gap: space.sm },
  previewTitle: { fontSize: text.title, lineHeight: 28, fontFamily: fonts.black, color: colors.navy, textAlign: "center" },
  previewSub: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.medium, color: colors.muted, textAlign: "center", marginTop: -space.xs },
  photo: { width: "100%", aspectRatio: 1, borderRadius: radius.card, backgroundColor: "#000" },
  previewNote: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.medium, color: colors.skyDeep, textAlign: "center" },
  previewRow: { flexDirection: "row", gap: space.xs },
  busy: { backgroundColor: "#fff", borderRadius: radius.sheet, paddingVertical: space.lg, paddingHorizontal: space.xl, alignItems: "center", gap: space.sm, minWidth: 224 },
  busyText: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.bold, color: colors.navy },
});
