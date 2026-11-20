import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AppIcon, Glyph, type IconName } from "@/components/AppIcon";
import { FormPopup, type PopupState } from "@/components/FormPopup";
import { GradientButton } from "@/components/GradientButton";
import { LogoLoader } from "@/components/LogoLoader";
import { PickerSheet, type PickerItem } from "@/components/PickerSheet";
import { Card, FadeSlide, Screen, SectionTitle } from "@/components/Screen";
import { useToast } from "@/components/Toast";
import { loadSites, type Site } from "@/lib/attendance";
import { useAuth } from "@/lib/auth";
import { clockVN, dayLabel, dmy, nowClock, todayISO } from "@/lib/dates";
import { errorText } from "@/lib/errors";
import { loadMonthRows, REASONS, submitExplanation, uploadAttachment, type MonthRow, type ReasonCode } from "@/lib/history";
import { Columns } from "@/lib/layout";
import { colors, fonts, radius, space, text, type Tone } from "@/lib/theme";

const LAST_SITE = "tnm.lastWorkplace";
const MAX_FILES = 3;
const REASON_ICON: Record<ReasonCode, { icon: IconName; tone: Tone }> = {
  forgot: { icon: "clock", tone: "orange" },
  outside_work: { icon: "users", tone: "sky" },
  cannot_check: { icon: "pin", tone: "rose" },
  wrong_shift: { icon: "calendar", tone: "navy" },
  other: { icon: "task", tone: "orange" },
};

type Place = { projectId: string; code: string; name: string; workStart: string; workEnd: string };
type Photo = { uri: string; width: number; height: number };

const pad = (n: number) => String(n).padStart(2, "0");
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMinutes = (m: number) => { const v = ((m % 1440) + 1440) % 1440; return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`; };

/** Chọn giờ: bấm ▲▼ đổi giờ / phút (bước 5 phút), hoặc chọn nhanh giờ vào ca, ra ca, bây giờ. */
function TimePicker({ value, onChange, presets }: { value: string; onChange: (v: string) => void; presets: { label: string; value: string }[] }) {
  const step = (delta: number) => { if (Platform.OS !== "web") void Haptics.selectionAsync().catch(() => undefined); onChange(fromMinutes(toMinutes(value) + delta)); };
  const Col = ({ unit, part }: { unit: number; part: string }) => (
    <View style={styles.tCol}>
      <Pressable onPress={() => step(unit)} style={styles.tBtn} hitSlop={6} accessibilityLabel={`Tăng ${unit === 60 ? "giờ" : "phút"}`}><Text style={styles.tArrow}>▲</Text></Pressable>
      <Text style={styles.tValue}>{part}</Text>
      <Pressable onPress={() => step(-unit)} style={styles.tBtn} hitSlop={6} accessibilityLabel={`Giảm ${unit === 60 ? "giờ" : "phút"}`}><Text style={styles.tArrow}>▼</Text></Pressable>
    </View>
  );
  return (
    <View style={styles.tWrap}>
      <View style={styles.tRow}>
        <Col unit={60} part={value.slice(0, 2)} />
        <Text style={styles.tColon}>:</Text>
        <Col unit={5} part={value.slice(3, 5)} />
      </View>
      <View style={styles.presets}>
        {presets.map((preset) => (
          <Pressable key={preset.label} onPress={() => onChange(preset.value)} style={[styles.preset, value === preset.value && styles.presetOn]} accessibilityRole="button">
            <Text style={[styles.presetText, value === preset.value && styles.presetTextOn]}>{preset.label} {preset.value}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Đơn giải trình chấm công: ngày + nơi làm việc lấy sẵn, chọn Vào / Ra, giờ, lý do, ghi chú, ảnh đính kèm. */
export default function ExplainScreen() {
  const params = useLocalSearchParams<{ date?: string; project?: string; activity?: string }>();
  const date = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayISO();
  const toast = useToast();
  const { session } = useAuth();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [dayRows, setDayRows] = useState<MonthRow[]>([]);
  const [projectId, setProjectId] = useState<string | null>(typeof params.project === "string" && params.project ? params.project : null);
  const [activity, setActivity] = useState<"in" | "out">(params.activity === "out" ? "out" : "in");
  const [time, setTime] = useState<string>(params.activity === "out" ? "17:00" : "08:00");
  const [timeTouched, setTimeTouched] = useState(false);
  const [reason, setReason] = useState<ReasonCode | null>(null);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [picking, setPicking] = useState(false);
  const [popup, setPopup] = useState<PopupState>(null);
  const [tried, setTried] = useState(false);

  // Lấy sẵn: công trường đang thi công + lượt chấm của ngày đó (nơi làm việc, giờ ca)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [allSites, rows, last] = await Promise.all([
        loadSites().catch(() => [] as Site[]),
        loadMonthRows(date.slice(0, 7)).then((list) => list.filter((row) => row.workDate === date)).catch(() => [] as MonthRow[]),
        AsyncStorage.getItem(LAST_SITE).catch(() => null),
      ]);
      if (!alive) return;
      setSites(allSites);
      setDayRows(rows);
      setProjectId((current) => current ?? rows[0]?.projectId ?? (last && allSites.some((s) => s.projectId === last) ? last : null) ?? allSites.find((s) => s.isMember)?.projectId ?? allSites[0]?.projectId ?? null);
    })();
    return () => { alive = false; };
  }, [date]);

  const places = useMemo(() => {
    const map = new Map<string, Place>();
    for (const row of dayRows) map.set(row.projectId, { projectId: row.projectId, code: row.code, name: row.projectName, workStart: row.workStart, workEnd: row.workEnd });
    for (const site of sites ?? []) if (!map.has(site.projectId)) map.set(site.projectId, { projectId: site.projectId, code: site.code, name: site.name, workStart: site.workStart, workEnd: site.workEnd });
    return map;
  }, [dayRows, sites]);
  const place = projectId ? places.get(projectId) ?? null : null;
  const row = dayRows.find((r) => r.projectId === projectId) ?? null;

  // Giờ mặc định theo ca của nơi làm việc (chưa tự chỉnh)
  useEffect(() => {
    if (!place || timeTouched) return;
    setTime(activity === "in" ? place.workStart : place.workEnd);
  }, [place, activity, timeTouched]);

  const items: PickerItem[] = useMemo(() => [...places.values()].map((p) => ({
    id: p.projectId, title: p.name, subtitle: `${p.code} · Ca ${p.workStart}–${p.workEnd}`,
    badge: dayRows.some((r) => r.projectId === p.projectId) ? "Đã chấm ngày này" : undefined, icon: "pin", tone: dayRows.some((r) => r.projectId === p.projectId) ? "sky" : "orange",
  })), [places, dayRows]);

  const presets = [
    ...(place ? [{ label: "Vào ca", value: place.workStart }, { label: "Ra ca", value: place.workEnd }] : []),
    ...(date === todayISO() ? [{ label: "Bây giờ", value: nowClock() }] : []),
  ];

  const addPhotos = async (source: "camera" | "library") => {
    const room = MAX_FILES - photos.length;
    if (room <= 0) return;
    const permission = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { toast(source === "camera" ? "Cần cho phép app dùng camera." : "Cần cho phép app đọc thư viện ảnh.", "err"); return; }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: room, quality: 0.8 });
    if (result.canceled) return;
    setPhotos((list) => [...list, ...result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }))].slice(0, MAX_FILES));
  };

  const problems = [
    !place ? "Chọn nơi làm việc." : "",
    !reason ? "Chọn lý do giải trình." : "",
    reason === "other" && note.trim().length < 5 ? "Lý do khác: ghi chú ít nhất 5 ký tự." : "",
  ].filter(Boolean);

  const review = () => {
    setTried(true);
    if (problems.length) { toast(problems[0]!, "err"); return; }
    setPopup({
      kind: "confirm", title: "Gửi giải trình?", confirmLabel: "Gửi giải trình",
      lines: [
        { label: "Ngày", value: dayLabel(date) },
        { label: "Nơi làm việc", value: `${place!.code} · ${place!.name}` },
        { label: "Hoạt động", value: `${activity === "in" ? "Vào ca" : "Ra ca"} lúc ${time}` },
        { label: "Lý do", value: REASONS.find((r) => r.code === reason)!.label },
        ...(note.trim() ? [{ label: "Ghi chú", value: note.trim() }] : []),
        { label: "Đính kèm", value: photos.length ? `${photos.length} ảnh` : "Không có" },
      ],
    });
  };

  const send = async () => {
    if (!place || !reason || !session) return;
    try {
      const paths: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        setPopup({ kind: "busy", title: "Đang gửi giải trình…", detail: `Đang tải ảnh ${i + 1}/${photos.length}` });
        paths.push(await uploadAttachment(place.projectId, session.user.id, photos[i]!, i));
      }
      setPopup({ kind: "busy", title: "Đang gửi giải trình…", detail: "Gửi tới PM của dự án" });
      await submitExplanation({ projectId: place.projectId, date, activity, time, reason, note: note.trim(), attachments: paths });
      setPopup({
        kind: "success", title: "Đã gửi giải trình",
        message: `PM của ${place.code} sẽ xem và duyệt. Theo dõi ngay trên lịch chấm công: chấm vàng là đang chờ duyệt, được duyệt thì giờ ${activity === "in" ? "vào" : "ra"} ${time} sẽ tự ghi vào ngày ${dmy(date)}.`,
        actionLabel: "Về lịch chấm công",
      });
    } catch (error) {
      setPopup({ kind: "error", title: "Chưa gửi được", message: errorText(error) });
    }
  };

  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

  return (
    <Screen wide title="Giải trình chấm công" subtitle={dayLabel(date)} onBack={leave} footerSpace={40}>
      {sites === null ? (
        <View style={styles.loading}><LogoLoader size={64} stroke={4} variant="light" /></View>
      ) : (
        <>
          <Columns
            left={<>
              <FadeSlide delay={40}><SectionTitle>Ngày và nơi làm việc</SectionTitle></FadeSlide>
              <FadeSlide delay={60}>
                <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel="Chọn nơi làm việc" style={({ pressed }) => [pressed && styles.pressed]}>
                  <Card style={[styles.place, tried && !place ? styles.cardError : {}]}>
                    <AppIcon name="pin" tone="orange" size={40} />
                    <View style={styles.flex}>
                      <Text style={styles.overline}>{dmy(date)} · Nơi làm việc</Text>
                      <Text style={styles.placeName} numberOfLines={2}>{place ? place.name : "Chọn nơi làm việc"}</Text>
                      {place ? <Text style={styles.placeSub}>{place.code} · Ca {place.workStart}–{place.workEnd}</Text> : null}
                    </View>
                    <View style={styles.change}><Text style={styles.changeText}>Đổi</Text></View>
                  </Card>
                </Pressable>
              </FadeSlide>
              {row ? (
                <FadeSlide delay={80}>
                  <View style={styles.dayInfo}>
                    <Glyph name="clock" size={16} color={colors.skyDeep} fillOpacity={0.15} />
                    <Text style={styles.dayInfoText}>Đã ghi nhận: vào {clockVN(row.checkInAt)} · ra {row.checkOutAt ? clockVN(row.checkOutAt) : "chưa có"}</Text>
                  </View>
                </FadeSlide>
              ) : null}

              <FadeSlide delay={100}><SectionTitle>Hoạt động cần giải trình</SectionTitle></FadeSlide>
              <FadeSlide delay={120}>
                <View style={styles.activity}>
                  {(["in", "out"] as const).map((kind) => {
                    const on = activity === kind;
                    return (
                      <Pressable key={kind} onPress={() => { setActivity(kind); setTimeTouched(false); }} style={[styles.actCard, on && styles.actOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                        <Glyph name={kind === "in" ? "login" : "logout"} size={22} color={on ? colors.orange : colors.faint} fillOpacity={on ? 0.2 : 0.1} />
                        <Text style={[styles.actText, on && styles.actTextOn]}>{kind === "in" ? "Vào ca" : "Ra ca"}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </FadeSlide>
              <FadeSlide delay={140}>
                <Card>
                  <Text style={styles.fieldLabel}>Giờ {activity === "in" ? "vào" : "ra"} đề nghị ghi nhận</Text>
                  <TimePicker value={time} onChange={(v) => { setTime(v); setTimeTouched(true); }} presets={presets} />
                </Card>
              </FadeSlide>
            </>}
            right={<>
              <FadeSlide delay={160}><SectionTitle>Lý do</SectionTitle></FadeSlide>
              <FadeSlide delay={180}>
                <View style={[styles.reasons, tried && !reason ? styles.reasonsError : {}]}>
                  {REASONS.map((item) => {
                    const on = reason === item.code;
                    const look = REASON_ICON[item.code];
                    return (
                      <Pressable key={item.code} onPress={() => { if (Platform.OS !== "web") void Haptics.selectionAsync().catch(() => undefined); setReason(item.code); }} style={[styles.reason, on && styles.reasonOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                        <AppIcon name={look.icon} tone={look.tone} size={32} />
                        <View style={styles.flex}>
                          <Text style={[styles.reasonTitle, on && { color: colors.orange }]}>{item.label}</Text>
                          <Text style={styles.reasonHint}>{item.hint}</Text>
                        </View>
                        <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
                      </Pressable>
                    );
                  })}
                </View>
              </FadeSlide>

              <FadeSlide delay={200}><SectionTitle right={<Text style={styles.count}>{photos.length}/{MAX_FILES}</Text>}>Đính kèm</SectionTitle></FadeSlide>
              <FadeSlide delay={220}>
                <Card>
                  <View style={styles.files}>
                    {photos.map((photo, index) => (
                      <View key={`${photo.uri}-${index}`} style={styles.file}>
                        <Image source={{ uri: photo.uri }} style={styles.fileImg} contentFit="cover" />
                        <Pressable onPress={() => setPhotos((list) => list.filter((_, i) => i !== index))} style={styles.fileX} hitSlop={6} accessibilityLabel={`Bỏ ảnh ${index + 1}`}>
                          <Glyph name="close" size={12} color="#fff" fillOpacity={0} strokeWidth={3} />
                        </Pressable>
                      </View>
                    ))}
                    {photos.length < MAX_FILES && (
                      <>
                        <Pressable onPress={() => void addPhotos("camera")} style={styles.addFile} accessibilityRole="button" accessibilityLabel="Chụp ảnh đính kèm">
                          <Glyph name="camera" size={22} color={colors.skyDeep} fillOpacity={0.15} />
                          <Text style={styles.addText}>Chụp</Text>
                        </Pressable>
                        <Pressable onPress={() => void addPhotos("library")} style={styles.addFile} accessibilityRole="button" accessibilityLabel="Chọn ảnh đính kèm">
                          <Glyph name="add" size={22} color={colors.skyDeep} fillOpacity={0} strokeWidth={2.4} />
                          <Text style={styles.addText}>Thư viện</Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                  <Text style={styles.hint}>Ảnh chứng minh (biên bản, ảnh công trường, tin nhắn…), không bắt buộc.</Text>
                </Card>
              </FadeSlide>

              <FadeSlide delay={240}><SectionTitle right={<Text style={styles.count}>{note.length}/900</Text>}>Ghi chú</SectionTitle></FadeSlide>
              <FadeSlide delay={260}>
                <TextInput
                  value={note}
                  onChangeText={(v) => setNote(v.slice(0, 900))}
                  placeholder={reason === "other" ? "Bắt buộc: ghi rõ lý do (ít nhất 5 ký tự)" : "Ví dụ: đi mua vật tư ở Bình Dương cùng anh Tuấn"}
                  placeholderTextColor={colors.faint}
                  multiline
                  style={[styles.note, tried && reason === "other" && note.trim().length < 5 ? styles.noteError : {}]}
                  textAlignVertical="top"
                />
              </FadeSlide>
            </>}
          />

          <FadeSlide delay={280} from="up">
            <GradientButton label="Xem lại và gửi" onPress={review} />
          </FadeSlide>
        </>
      )}

      <PickerSheet
        visible={picking}
        title="Nơi làm việc"
        placeholder="Tìm theo tên hoặc mã dự án"
        items={items}
        selectedId={projectId}
        emptyText="Chưa có công trường nào."
        onSelect={(item) => { setProjectId(item.id); setTimeTouched(false); setPicking(false); }}
        onClose={() => setPicking(false)}
      />

      <FormPopup
        state={popup}
        onConfirm={() => void send()}
        onCancel={() => setPopup(null)}
        onRetry={() => void send()}
        onDone={() => { setPopup(null); leave(); }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  loading: { alignItems: "center", paddingVertical: space.xl },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  cardError: { borderColor: colors.badLine, borderWidth: 1.5 },
  place: { flexDirection: "row", alignItems: "center", gap: space.sm },
  overline: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.bold, color: colors.faint, textTransform: "uppercase", letterSpacing: 0.5 },
  placeName: { fontSize: text.body, lineHeight: 24, fontFamily: fonts.bold, color: colors.navy },
  placeSub: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
  change: { height: 32, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: colors.skyTint, justifyContent: "center" },
  changeText: { fontSize: text.caption, fontFamily: fonts.bold, color: colors.skyDeep },
  dayInfo: { flexDirection: "row", alignItems: "center", gap: space.xs, backgroundColor: colors.skyTint, borderRadius: radius.control, paddingHorizontal: space.sm, paddingVertical: space.xs },
  dayInfoText: { flex: 1, fontSize: text.caption, lineHeight: 16, fontFamily: fonts.semibold, color: colors.skyDeep },
  activity: { flexDirection: "row", gap: space.sm },
  actCard: { flex: 1, height: 64, borderRadius: radius.card, backgroundColor: "#fff", borderWidth: 1.5, borderColor: colors.line, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space.xs },
  actOn: { borderColor: colors.orange, backgroundColor: "#FFF6EE" },
  actText: { fontSize: text.body, fontFamily: fonts.bold, color: colors.muted },
  actTextOn: { color: colors.orange },
  fieldLabel: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.bold, color: colors.navy },
  tWrap: { gap: space.sm, alignItems: "center" },
  tRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  tCol: { alignItems: "center", gap: 2 },
  tBtn: { width: 64, height: 32, borderRadius: 10, backgroundColor: colors.field, alignItems: "center", justifyContent: "center" },
  tArrow: { fontSize: 12, color: colors.skyDeep },
  tValue: { fontSize: 40, lineHeight: 48, fontFamily: fonts.black, color: colors.navy, fontVariant: ["tabular-nums"] },
  tColon: { fontSize: 36, lineHeight: 48, fontFamily: fonts.black, color: colors.faint },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, justifyContent: "center" },
  preset: { height: 32, paddingHorizontal: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: "#fff", justifyContent: "center" },
  presetOn: { borderColor: colors.orange, backgroundColor: "#FFF6EE" },
  presetText: { fontSize: text.caption, fontFamily: fonts.semibold, color: colors.muted },
  presetTextOn: { color: colors.orange, fontFamily: fonts.bold },
  reasons: { gap: space.xs, borderRadius: radius.card },
  reasonsError: { borderWidth: 1.5, borderColor: colors.badLine, padding: 4 },
  reason: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: "#fff", borderRadius: radius.card, padding: space.sm, borderWidth: 1.5, borderColor: "#E6EEF8" },
  reasonOn: { borderColor: colors.orange, backgroundColor: "#FFF9F4" },
  reasonTitle: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.bold, color: colors.navy },
  reasonHint: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: colors.orange },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.orange },
  count: { fontSize: text.caption, fontFamily: fonts.bold, color: colors.faint },
  files: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  file: { width: 80, height: 80, borderRadius: 12, overflow: "hidden" },
  fileImg: { width: "100%", height: "100%" },
  fileX: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(18,20,24,0.7)", alignItems: "center", justifyContent: "center" },
  addFile: { width: 80, height: 80, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.sky, backgroundColor: colors.field, alignItems: "center", justifyContent: "center", gap: 2 },
  addText: { fontSize: 11, fontFamily: fonts.bold, color: colors.skyDeep },
  hint: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
  note: { minHeight: 104, borderRadius: radius.control, borderWidth: 1.5, borderColor: colors.fieldLine, backgroundColor: "#fff", padding: space.sm, fontSize: text.body, lineHeight: 22, fontFamily: fonts.medium, color: colors.navy },
  noteError: { borderColor: colors.badLine, backgroundColor: colors.badBg },
});
