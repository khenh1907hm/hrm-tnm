import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { AppIcon, Glyph } from "@/components/AppIcon";
import { NameChips, NumberField, TextField } from "@/components/Fields";
import { GradientButton } from "@/components/GradientButton";
import { LogoLoader } from "@/components/LogoLoader";
import { PickerSheet, type PickerItem } from "@/components/PickerSheet";
import { NotificationBell } from "@/components/NotificationBell";
import { Columns, MODAL_ORIENTATIONS } from "@/lib/layout";
import { Card, FadeSlide, Screen, SectionTitle } from "@/components/Screen";
import { useToast } from "@/components/Toast";
import { addDays, dayLabel, dmy, todayISO } from "@/lib/dates";
import { emptyDraft, issuesOf, loadRecentReports, loadReportProjects, loadRoster, MAX_PHOTOS, MAX_TASKS, readBoard, sendReport, type Draft, type Photo, type ReportProject, type RosterPerson, type SavedReport } from "@/lib/dailyReport";
import { isLink } from "@/lib/attendance";
import { errorText } from "@/lib/errors";
import { colors, fonts, gradients, radius } from "@/lib/theme";

const LAST_PROJECT = "tnm.lastReportProject";

const fromSaved = (report: SavedReport, date: string): Draft => ({
  date, total: report.total, present: report.present, absent: report.absent, absentNames: [...report.absentNames], otCount: report.otCount, otHours: report.otHours,
  tasks: report.tasks.length ? report.tasks.map((t) => ({ ...t, members: [...t.members] })) : [{ task: "", leader: "", members: [] }],
});

export default function ReportScreen() {
  const toast = useToast();
  const today = todayISO();
  const [projects, setProjects] = useState<ReportProject[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [people, setPeople] = useState<RosterPerson[]>([]);
  const roster = useMemo(() => people.map((p) => p.name), [people]);
  const [unsure, setUnsure] = useState<string[]>([]);
  const [recent, setRecent] = useState<SavedReport[]>([]);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(today));
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState<"send" | "read" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const [list, last] = await Promise.all([loadReportProjects(), AsyncStorage.getItem(LAST_PROJECT).catch(() => null)]);
      setProjects(list);
      setLoadError(null);
      setProjectId((current) => (current && list.some((p) => p.projectId === current) ? current : last && list.some((p) => p.projectId === last) ? last : list[0]?.projectId ?? null));
    } catch (error) {
      setProjects((current) => current ?? []);
      setLoadError(errorText(error));
    }
  }, []);
  useFocusEffect(useCallback(() => { void loadProjects(); }, [loadProjects]));

  // Đổi dự án: tải danh sách công nhân (gợi ý tên) và các báo cáo gần đây
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    setPeople([]); setRecent([]); setUnsure([]);
    void loadRoster(projectId).then((list) => { if (active) setPeople(list); }, () => undefined);
    void loadRecentReports(projectId).then((list) => { if (active) setRecent(list); }, () => undefined);
    return () => { active = false; };
  }, [projectId]);

  // Ngày đã có báo cáo: mở lại để sửa; chưa có: bản trống
  const existing = useMemo(() => recent.find((r) => r.date === draft.date) ?? null, [recent, draft.date]);
  useEffect(() => {
    setDraft((current) => (existing ? fromSaved(existing, current.date) : emptyDraft(current.date)));
    setPhotos([]);
    setUnsure([]);
  }, [existing, projectId]);

  const project = projects?.find((p) => p.projectId === projectId) ?? null;
  const previous = recent.find((r) => r.date < draft.date) ?? null;
  const issues = issuesOf(draft);
  const blocking = issues.filter((i) => i.level === "error");
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setTask = (index: number, patch: Partial<Draft["tasks"][number]>) => setDraft((d) => ({ ...d, tasks: d.tasks.map((t, i) => (i === index ? { ...t, ...patch } : t)) }));

  const items: PickerItem[] = useMemo(() => (projects ?? []).map((p) => ({ id: p.projectId, title: p.name, subtitle: [p.code, isLink(p.site) ? "" : p.site].filter(Boolean).join(" · "), badge: p.code, icon: "report", tone: "rose" })), [projects]);

  const addPhotos = async (source: "camera" | "library") => {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) { toast(`Tối đa ${MAX_PHOTOS} ảnh.`, "warn"); return; }
    const permission = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { toast("Hãy cho phép app dùng camera / thư viện ảnh.", "warn"); return; }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: room, quality: 0.8 });
    if (result.canceled) return;
    setPhotos((list) => [...list, ...result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }))].slice(0, MAX_PHOTOS));
  };

  /** Chụp / chọn ảnh bảng phân công rồi gửi máy chủ đọc thành bản nháp (giống nút "Đọc bảng" trên web). */
  const readFromBoard = async (source: "camera" | "library") => {
    if (!project) return;
    const permission = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { toast("Hãy cho phép app dùng camera / thư viện ảnh.", "warn"); return; }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setBusy("read");
    try {
      const read = await readBoard(project.projectId, { uri: asset.uri, width: asset.width, height: asset.height }, people, draft.date);
      setDraft(read.draft);
      setUnsure(read.unsure);
      const count = read.draft.tasks.filter((t) => t.task.trim()).length;
      toast(read.unsure.length ? `Đã đọc ${count} công việc. Kiểm tra lại ${read.unsure.length} tên chưa chắc chắn.` : `Đã đọc ${count} công việc. Kiểm tra lại trước khi gửi.`, read.unsure.length ? "warn" : "ok");
    } catch (error) {
      toast(errorText(error), "err");
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!project) return;
    if (blocking.length) { toast(blocking[0]!.text, "err"); return; }
    setBusy("send");
    try {
      const result = await sendReport(project.projectId, draft, photos);
      const totals = `${draft.present ?? 0} người hiện diện · lũy kế ${result.cumulativeWorkdays} công`;
      toast(result.telegramSent ? `Đã gửi báo cáo ${dmy(draft.date)} vào nhóm Telegram. ${totals}.` : `Đã lưu báo cáo (${totals}). Chưa gửi được Telegram: ${result.telegramError}`, result.telegramSent ? "ok" : "warn");
      setPhotos([]);
      setRecent(await loadRecentReports(project.projectId).catch(() => recent));
    } catch (error) {
      toast(errorText(error), "err");
    } finally {
      setBusy(null);
    }
  };

  if (projects === null) {
    return <Screen right={<NotificationBell />} title="Báo cáo ngày"><View style={styles.loadingBox}><LogoLoader size={64} stroke={4} variant="light" /></View></Screen>;
  }

  if (!projects.length) {
    return (
      <Screen right={<NotificationBell />} title="Báo cáo ngày" onRefresh={() => void loadProjects()}>
        <FadeSlide delay={60}>
          <Card style={styles.empty}>
            <AppIcon name="report" tone="rose" size={48} />
            <Text style={styles.emptyTitle}>Chưa có dự án để lập báo cáo</Text>
            <Text style={styles.emptyText}>{loadError ?? "Báo cáo ngày do PM hoặc Chỉ huy trưởng của dự án đang thi công lập. Nếu bạn phụ trách dự án, nhờ Admin cập nhật vai trò trong dự án."}</Text>
          </Card>
        </FadeSlide>
      </Screen>
    );
  }

  return (
    <Screen wide right={<NotificationBell />} title="Báo cáo ngày" subtitle="Gửi vào nhóm Telegram kèm file Excel">
      <Columns
        left={<>
          <FadeSlide delay={40}>
            <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel="Chọn dự án" style={({ pressed }) => [pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] }]}>
              <Card style={styles.projectCard}>
                <AppIcon name="report" tone="rose" size={40} />
                <View style={styles.flex}>
                  <Text style={styles.small}>Dự án</Text>
                  <Text style={styles.projectName} numberOfLines={2}>{project?.name ?? "Chọn dự án"}</Text>
                  {project ? <Text style={styles.projectSub} numberOfLines={1}>{[project.code, isLink(project.site) ? "" : project.site].filter(Boolean).join(" · ")}</Text> : null}
                </View>
                <View style={styles.change}><Text style={styles.changeText}>Đổi</Text></View>
              </Card>
            </Pressable>
          </FadeSlide>

          <FadeSlide delay={80}>
            <LinearGradient colors={gradients.skyline} locations={gradients.skylineStops} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.dateBar}>
              <Pressable onPress={() => set("date", addDays(draft.date, -1))} hitSlop={10} style={styles.dateBtn} accessibilityLabel="Ngày trước"><Text style={styles.dateArrow}>‹</Text></Pressable>
              <View style={styles.dateMid}>
                <Text style={styles.dateLabel}>{draft.date === today ? "Hôm nay" : draft.date === addDays(today, -1) ? "Hôm qua" : "Ngày báo cáo"}</Text>
                <Text style={styles.dateValue}>{dayLabel(draft.date)}</Text>
              </View>
              <Pressable onPress={() => { if (draft.date < today) set("date", addDays(draft.date, 1)); }} hitSlop={10} style={[styles.dateBtn, draft.date >= today && { opacity: 0.35 }]} accessibilityLabel="Ngày sau"><Text style={styles.dateArrow}>›</Text></Pressable>
            </LinearGradient>
          </FadeSlide>

          {existing ? (
            <FadeSlide from="up"><Text style={styles.noteInfo}>Ngày này đã có báo cáo{existing.sentAt ? " và đã gửi" : ""}{existing.createdByName ? ` (${existing.createdByName})` : ""}. Sửa rồi gửi lại sẽ thay bản cũ.</Text></FadeSlide>
          ) : previous ? (
            <FadeSlide from="up">
              <Pressable onPress={() => setDraft(fromSaved(previous, draft.date))} style={styles.copy} accessibilityRole="button">
                <Glyph name="copy" size={18} color={colors.skyDeep} fillOpacity={0.15} />
                <Text style={styles.copyText}>Chép báo cáo ngày {dmy(previous.date)} để sửa nhanh</Text>
              </Pressable>
            </FadeSlide>
          ) : null}

          <FadeSlide delay={100}>
            <Card style={styles.board}>
              <View style={styles.boardHead}>
                <AppIcon name="image" tone="orange" size={36} />
                <View style={styles.flex}>
                  <Text style={styles.boardTitle}>Nhập nhanh từ ảnh bảng phân công</Text>
                  <Text style={styles.boardSub}>Chụp bảng ghi công việc, tổ trưởng, người làm, sĩ số. Máy đọc và điền sẵn các ô bên dưới (10–30 giây).</Text>
                </View>
              </View>
              <View style={styles.photoBtns}>
                <Pressable onPress={() => void readFromBoard("camera")} disabled={busy !== null} style={styles.photoBtn} accessibilityRole="button" accessibilityLabel="Chụp ảnh bảng phân công để đọc"><AppIcon name="camera" tone="sky" size={32} /><Text style={styles.photoBtnText}>Chụp bảng</Text></Pressable>
                <Pressable onPress={() => void readFromBoard("library")} disabled={busy !== null} style={styles.photoBtn} accessibilityRole="button" accessibilityLabel="Chọn ảnh bảng phân công để đọc"><AppIcon name="image" tone="navy" size={32} /><Text style={styles.photoBtnText}>Chọn ảnh</Text></Pressable>
              </View>
              {draft.model ? <Text style={styles.hint}>Đã điền từ ảnh{existing ? " (thay bản đang mở)" : ""}. Sửa lại nếu máy đọc sai.</Text> : null}
              {unsure.length > 0 && <Text style={[styles.issue, styles.issueWarn]}>Tên chưa chắc chắn, kiểm tra lại: {unsure.join(", ")}</Text>}
            </Card>
          </FadeSlide>

          <FadeSlide delay={120}><SectionTitle>Nhân lực</SectionTitle></FadeSlide>
          <FadeSlide delay={140}>
            <Card>
              <View style={styles.numRow}>
                <NumberField label="Tổng số" value={draft.total} onChange={(v) => setDraft((d) => ({ ...d, total: v, absent: v !== null && d.present !== null ? Math.max(0, v - d.present) : d.absent }))} />
                <NumberField label="Hiện diện" value={draft.present} onChange={(v) => setDraft((d) => ({ ...d, present: v, absent: v !== null && d.total !== null ? Math.max(0, d.total - v) : d.absent }))} />
                <NumberField label="Vắng" value={draft.absent} onChange={(v) => set("absent", v)} accent />
              </View>
              <NameChips label="Người vắng" names={draft.absentNames} onChange={(v) => set("absentNames", v)} suggestions={roster} />
            </Card>
          </FadeSlide>

          <FadeSlide delay={180}><SectionTitle>Tăng ca</SectionTitle></FadeSlide>
          <FadeSlide delay={200}>
            <Card>
              <View style={styles.numRow}>
                <NumberField label="Số người" value={draft.otCount} onChange={(v) => set("otCount", v ?? 0)} />
                <NumberField label="Số giờ" value={draft.otHours} onChange={(v) => set("otHours", v ?? 0)} step={0.5} />
              </View>
            </Card>
          </FadeSlide>
          <FadeSlide delay={300}><SectionTitle right={<Text style={styles.count}>{photos.length}/{MAX_PHOTOS}</Text>}>Ảnh thi công</SectionTitle></FadeSlide>
          <FadeSlide delay={320}>
            <Card>
              {photos.length > 0 && (
                <View style={styles.photos}>
                  {photos.map((photo, index) => (
                    <View key={`${photo.uri}-${index}`} style={styles.thumbBox}>
                      <Image source={{ uri: photo.uri }} style={styles.thumb} contentFit="cover" />
                      <Pressable onPress={() => setPhotos((list) => list.filter((_, i) => i !== index))} style={styles.thumbX} hitSlop={6} accessibilityLabel={`Bỏ ảnh ${index + 1}`}><Text style={styles.thumbXText}>✕</Text></Pressable>
                    </View>
                  ))}
                </View>
              )}
              <View style={styles.photoBtns}>
                <Pressable onPress={() => void addPhotos("camera")} style={styles.photoBtn} accessibilityRole="button"><AppIcon name="camera" tone="sky" size={32} /><Text style={styles.photoBtnText}>Chụp ảnh</Text></Pressable>
                <Pressable onPress={() => void addPhotos("library")} style={styles.photoBtn} accessibilityRole="button"><AppIcon name="image" tone="navy" size={32} /><Text style={styles.photoBtnText}>Chọn từ máy</Text></Pressable>
              </View>
              <Text style={styles.hint}>Không bắt buộc. Ảnh chỉ nằm trong file Excel gửi Telegram, hệ thống không lưu ảnh.</Text>
            </Card>
          </FadeSlide>
        </>}
        right={<>
          <FadeSlide delay={240}><SectionTitle right={<Text style={styles.count}>{draft.tasks.length}/{MAX_TASKS}</Text>}>Công việc</SectionTitle></FadeSlide>
          {draft.tasks.map((task, index) => (
            <FadeSlide key={index} delay={260 + index * 30}>
              <Card>
                <View style={styles.taskHead}>
                  <LinearGradient colors={gradients.sunrise} locations={gradients.sunriseStops} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.taskNo}><Text style={styles.taskNoText}>{index + 1}</Text></LinearGradient>
                  <Text style={styles.taskTitle}>Công việc {index + 1}</Text>
                  {draft.tasks.length > 1 && (
                    <Pressable onPress={() => setDraft((d) => ({ ...d, tasks: d.tasks.filter((_, i) => i !== index) }))} hitSlop={8} accessibilityLabel={`Xóa công việc ${index + 1}`}>
                      <Glyph name="trash" size={16} color={colors.bad} fillOpacity={0.12} />
                    </Pressable>
                  )}
                </View>
                <TextField value={task.task} onChange={(v) => setTask(index, { task: v })} placeholder="Vd: Kéo cáp tầng 3, lắp tủ điện DB-3A" multiline />
                <TextField label="Tổ trưởng" value={task.leader} onChange={(v) => setTask(index, { leader: v })} placeholder="Tên tổ trưởng" suggestions={roster} />
                <NameChips label="Người làm" names={task.members} onChange={(v) => setTask(index, { members: v })} suggestions={roster} />
              </Card>
            </FadeSlide>
          ))}
          {draft.tasks.length < MAX_TASKS && (
            <Pressable onPress={() => setDraft((d) => ({ ...d, tasks: [...d.tasks, { task: "", leader: "", members: [] }] }))} style={styles.addTask} accessibilityRole="button">
              <Glyph name="plus" size={20} color={colors.orange} fillOpacity={0.15} />
              <Text style={styles.addTaskText}>Thêm công việc</Text>
            </Pressable>
          )}
        </>}
      />

      {issues.length > 0 && (
        <FadeSlide from="up">
          <View style={styles.issues}>
            {issues.map((issue) => (
              <Text key={issue.text} style={[styles.issue, issue.level === "error" ? styles.issueErr : styles.issueWarn]}>{issue.level === "error" ? "Cần sửa: " : "Lưu ý: "}{issue.text}</Text>
            ))}
          </View>
        </FadeSlide>
      )}

      <FadeSlide delay={340} from="up">
        <GradientButton label={existing ? "Gửi lại báo cáo" : "Gửi báo cáo"} busyLabel="Đang gửi…" busy={busy === "send"} onPress={() => void send()} />
      </FadeSlide>

      <PickerSheet
        visible={picking}
        title="Chọn dự án"
        placeholder="Tìm theo tên hoặc mã dự án"
        items={items}
        selectedId={projectId}
        emptyText="Chưa có dự án nào."
        onSelect={(item) => { setProjectId(item.id); setPicking(false); void AsyncStorage.setItem(LAST_PROJECT, item.id).catch(() => undefined); }}
        onClose={() => setPicking(false)}
      />

      <Modal supportedOrientations={MODAL_ORIENTATIONS} visible={busy !== null} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.busy}>
            <LogoLoader size={80} stroke={4} variant="light" />
            <Text style={styles.busyText}>{busy === "read" ? "Đang đọc ảnh bảng phân công…" : "Đang tạo file Excel và gửi Telegram…"}</Text>
            <Text style={styles.busySub}>Có thể mất 10–30 giây</Text>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  loadingBox: { alignItems: "center", paddingVertical: 48 },
  empty: { alignItems: "center", paddingVertical: 24, gap: 8 },
  emptyTitle: { fontSize: 16, lineHeight: 24, fontFamily: fonts.bold, color: colors.navy, textAlign: "center" },
  emptyText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.muted, textAlign: "center" },
  projectCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  small: { fontSize: 12, lineHeight: 16, fontFamily: fonts.bold, color: colors.faint, textTransform: "uppercase", letterSpacing: 0.5 },
  projectName: { fontSize: 16, lineHeight: 24, fontFamily: fonts.bold, color: colors.navy },
  projectSub: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
  change: { height: 32, justifyContent: "center", backgroundColor: colors.skyTint, paddingHorizontal: 12, borderRadius: 999 },
  changeText: { fontSize: 12, fontFamily: fonts.bold, color: colors.skyDeep },
  dateBar: { borderRadius: radius.card, flexDirection: "row", alignItems: "center", padding: 8 },
  dateBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  dateArrow: { color: "#fff", fontSize: 24, lineHeight: 28, fontFamily: fonts.bold },
  dateMid: { flex: 1, alignItems: "center" },
  dateLabel: { color: "rgba(255,255,255,0.85)", fontSize: 12, lineHeight: 16, fontFamily: fonts.semibold },
  dateValue: { color: "#fff", fontSize: 16, lineHeight: 24, fontFamily: fonts.black },
  noteInfo: { fontSize: 12, lineHeight: 16, fontFamily: fonts.medium, color: colors.warn, backgroundColor: colors.warnBg, borderRadius: 12, padding: 12, overflow: "hidden", borderWidth: 1, borderColor: "#FFD2B0" },
  copy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 40, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.sky, backgroundColor: "rgba(255,255,255,0.9)", paddingHorizontal: 12 },
  copyText: { fontSize: 12, lineHeight: 16, fontFamily: fonts.bold, color: colors.skyDeep },
  numRow: { flexDirection: "row", gap: 8 },
  count: { fontSize: 12, lineHeight: 16, fontFamily: fonts.bold, color: colors.faint },
  taskHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  taskNo: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  taskNoText: { color: "#fff", fontFamily: fonts.black, fontSize: 12 },
  taskTitle: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, color: colors.navy },
  addTask: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 16, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#FFB27A", backgroundColor: "rgba(255,246,238,0.9)" },
  addTaskText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, color: colors.orange },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumbBox: { width: "31%", aspectRatio: 1, borderRadius: 12, overflow: "hidden" },
  thumb: { width: "100%", height: "100%" },
  thumbX: { position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(18,20,24,0.7)", alignItems: "center", justifyContent: "center" },
  thumbXText: { color: "#fff", fontSize: 10, fontFamily: fonts.bold },
  photoBtns: { flexDirection: "row", gap: 8 },
  photoBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: radius.control, backgroundColor: colors.field, borderWidth: 1.5, borderColor: colors.fieldLine },
  photoBtnText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, color: colors.navy },
  board: { gap: 12 },
  boardHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  boardTitle: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, color: colors.navy },
  boardSub: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
  hint: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted, textAlign: "center" },
  issues: { gap: 4 },
  issue: { fontSize: 12, lineHeight: 16, fontFamily: fonts.medium, borderRadius: 12, padding: 8, overflow: "hidden", borderWidth: 1 },
  issueErr: { color: colors.bad, backgroundColor: colors.badBg, borderColor: colors.badLine },
  issueWarn: { color: colors.warn, backgroundColor: colors.warnBg, borderColor: "#FFD2B0" },
  modalBg: { flex: 1, backgroundColor: "rgba(11,31,102,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  busy: { backgroundColor: "#fff", borderRadius: 24, paddingVertical: 24, paddingHorizontal: 32, alignItems: "center", gap: 8, maxWidth: 320 },
  busyText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, color: colors.navy, textAlign: "center" },
  busySub: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
});
