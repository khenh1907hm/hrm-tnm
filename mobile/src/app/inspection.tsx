import * as ImagePicker from "expo-image-picker";
import { router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Glyph } from "@/components/AppIcon";
import { GradientButton, SecondaryButton } from "@/components/GradientButton";
import { LogoLoader } from "@/components/LogoLoader";
import { MarkedPhoto, PhotoMarker } from "@/components/PhotoMarker";
import { PickerSheet } from "@/components/PickerSheet";
import { Card, Screen, SectionTitle } from "@/components/Screen";
import { useToast } from "@/components/Toast";
import { addDays, dmy, nowClock, todayISO } from "@/lib/dates";
import { errorText } from "@/lib/errors";
import * as api from "@/lib/inspection";
import type { Inspection, InspectionProject, Item, Photo, PhotoMark } from "@/lib/inspection";
import { colors, fonts, radius } from "@/lib/theme";

const TONE: Record<api.InspectionStatus, { bg: string; fg: string }> = {
  draft: { bg: colors.field, fg: colors.muted }, open: { bg: colors.warnBg, fg: colors.warn }, fixed: { bg: colors.skyTint, fg: colors.skyDeep }, closed: { bg: "#E8F8EE", fg: "#146C3A" },
};
const blankItem = (seq: number): Item => ({ id: "", seq, location: "", foundTime: nowClock(), problem: "", countermeasure: "", targetDate: addDays(todayISO(), 3), before: null, beforeMarks: [], after: null, afterMarks: [], comment: "", finishDate: null, fixedByName: "" });

async function takePhoto(source: "camera" | "library", warn: (text: string) => void): Promise<Photo | null> {
  const permission = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) { warn("Hãy cho phép app dùng camera / thư viện ảnh."); return null; }
  const result = source === "camera" ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

function Field({ label, value, onChange, placeholder, multiline, editable = true }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; editable?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={[styles.input, multiline && styles.inputMulti, !editable && styles.inputOff]} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.faint} multiline={multiline} editable={editable} />
    </View>
  );
}

/** Chọn ngày nhanh: lùi / tiến một ngày, về hôm nay. */
function DateField({ label, value, onChange, editable = true }: { label: string; value: string | null; onChange: (v: string) => void; editable?: boolean }) {
  const day = value ?? todayISO();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.dateRow}>
        {editable && <Pressable style={styles.dateBtn} onPress={() => onChange(addDays(day, -1))} accessibilityLabel="Lùi một ngày"><Text style={styles.dateArrow}>−</Text></Pressable>}
        <Text style={styles.dateText}>{value ? dmy(value) : "—"}</Text>
        {editable && <Pressable style={styles.dateBtn} onPress={() => onChange(addDays(day, 1))} accessibilityLabel="Thêm một ngày"><Text style={styles.dateArrow}>+</Text></Pressable>}
        {editable && <Pressable style={styles.chip} onPress={() => onChange(todayISO())}><Text style={styles.chipText}>Hôm nay</Text></Pressable>}
      </View>
    </View>
  );
}

/** Ảnh một phía + chụp / chọn + khoanh. */
function PhotoBlock({ title, photo, urls, marks, editable, onPhoto, onMarks }: { title: string; photo: Photo | null; urls: Record<string, string>; marks: PhotoMark[]; editable: boolean; onPhoto: (p: Photo) => void; onMarks: (m: PhotoMark[]) => void }) {
  const toast = useToast();
  const uri = photo?.uri ?? (photo?.path ? urls[photo.path] : undefined);
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.sideTitle}>{title}</Text>
      {editable && uri ? <PhotoMarker uri={uri} marks={marks} onChange={onMarks} /> : <MarkedPhoto uri={uri} marks={marks} />}
      {editable && (
        <View style={styles.row}>
          <View style={{ flex: 1 }}><GradientButton label={uri ? "Chụp lại" : "Chụp ảnh"} onPress={() => void takePhoto("camera", (t) => toast(t, "warn")).then((p) => { if (p) { onPhoto(p); onMarks([]); } })} /></View>
          <View style={{ flex: 1 }}><SecondaryButton label="Thư viện" onPress={() => void takePhoto("library", (t) => toast(t, "warn")).then((p) => { if (p) { onPhoto(p); onMarks([]); } })} /></View>
        </View>
      )}
    </View>
  );
}

/** Sửa một lỗi: phần Trước (người kiểm tra) hoặc phần Sau (người khắc phục). */
function ItemEditor({ inspection, item, mode, urls, fixer, onClose, onSaved }: { inspection: Inspection; item: Item; mode: "before" | "after"; urls: Record<string, string>; fixer: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<Item>(() => (mode === "after" && !item.finishDate ? { ...item, finishDate: todayISO() } : item));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Item>) => setDraft((d) => ({ ...d, ...patch }));
  const save = async () => {
    setBusy(true);
    try {
      if (mode === "before") await api.saveBefore(inspection.id, draft); else await api.saveAfter(inspection.id, draft, fixer);
      toast("Đã lưu.", "ok");
      onSaved();
    } catch (error) { toast(errorText(error), "err"); } finally { setBusy(false); }
  };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={[styles.editor, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.editorHead}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Đóng"><Glyph name="close" size={22} color={colors.navy} fillOpacity={0} /></Pressable>
          <Text style={styles.editorTitle}>{mode === "before" ? `Lỗi ${draft.seq}` : `Khắc phục lỗi ${draft.seq}`}</Text>
          <View style={{ width: 22 }} />
        </View>
        {mode === "after" && (
          <Card style={styles.beforeRef}>
            <Text style={styles.sideTitle}>Before</Text>
            <MarkedPhoto uri={item.before?.path ? urls[item.before.path] : undefined} marks={item.beforeMarks} />
            <Text style={styles.body}><Text style={styles.bold}>Vấn đề: </Text>{item.problem}</Text>
            {item.countermeasure ? <Text style={styles.body}><Text style={styles.bold}>Cách giải quyết: </Text>{item.countermeasure}</Text> : null}
            {item.targetDate ? <Text style={styles.muted}>Hạn mong muốn {dmy(item.targetDate)}</Text> : null}
          </Card>
        )}
        <Card>
          {mode === "before" ? <>
            <PhotoBlock title="Before · ảnh lỗi" photo={draft.before} urls={urls} marks={draft.beforeMarks} editable onPhoto={(p) => set({ before: p })} onMarks={(m) => set({ beforeMarks: m })} />
            <Field label="Vị trí (Location)" value={draft.location} onChange={(v) => set({ location: v })} placeholder="vd Factory 2FL" />
            <Field label="Giờ" value={draft.foundTime} onChange={(v) => set({ foundTime: v })} placeholder="14:00" />
            <Field label="Vấn đề *" value={draft.problem} onChange={(v) => set({ problem: v })} placeholder="vd Chưa xiết ốc, marking" multiline />
            <Field label="Cách giải quyết" value={draft.countermeasure} onChange={(v) => set({ countermeasure: v })} placeholder="vd Xiết ốc, marking" multiline />
            <DateField label="Thời gian hoàn thiện mong muốn" value={draft.targetDate} onChange={(v) => set({ targetDate: v })} />
          </> : <>
            <PhotoBlock title="After · ảnh sau khi sửa" photo={draft.after} urls={urls} marks={draft.afterMarks} editable onPhoto={(p) => set({ after: p })} onMarks={(m) => set({ afterMarks: m })} />
            <Field label="Comment" value={draft.comment} onChange={(v) => set({ comment: v })} placeholder="vd Đã xiết ốc, marking" multiline />
            <DateField label="Ngày hoàn thành (Finish time)" value={draft.finishDate} onChange={(v) => set({ finishDate: v })} />
          </>}
        </Card>
        <GradientButton label="Lưu" busy={busy} busyLabel="Đang tải ảnh, lưu…" onPress={() => void save()} />
      </ScrollView>
    </Modal>
  );
}

function Detail({ id }: { id: string }) {
  const toast = useToast();
  const [inspection, setInspection] = useState<Inspection | null | undefined>(undefined);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [me, setMe] = useState<{ userId: string; employeeId: string | null; name: string }>({ userId: "", employeeId: null, name: "" });
  const [editing, setEditing] = useState<{ item: Item; mode: "before" | "after" } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [next, employeeId, auth] = await Promise.all([api.loadOne(id), api.myEmployeeId(), import("@/lib/supabase").then((m) => m.supabase.auth.getUser())]);
      setMe({ userId: auth.data.user?.id ?? "", employeeId, name: String(auth.data.user?.user_metadata?.full_name ?? auth.data.user?.email ?? "") });
      setInspection(next);
      if (next) setUrls(await api.photoUrls(next.items.flatMap((i) => [i.before?.path ?? "", i.after?.path ?? ""])));
    } catch (error) { toast(errorText(error), "err"); setInspection((c) => c ?? null); }
  }, [id, toast]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (inspection === undefined) return <Screen title="Báo cáo công trình" onBack={() => router.back()}><LogoLoader /></Screen>;
  if (inspection === null) return <Screen title="Báo cáo công trình" onBack={() => router.back()}><Card><Text style={styles.body}>Không tìm thấy báo cáo, hoặc bạn không có quyền xem.</Text></Card></Screen>;
  const isReporter = inspection.reporterId === me.userId;
  const canEdit = isReporter && inspection.status !== "closed" && inspection.status !== "fixed";
  const canFix = Boolean(me.employeeId) && me.employeeId === inspection.attentionEmployeeId && (inspection.status === "open" || inspection.status === "fixed");
  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await action(); toast(done, "ok"); await load(); } catch (error) { toast(errorText(error), "err"); } finally { setBusy(false); }
  };
  const tone = TONE[inspection.status];
  const blockSubmit = api.submitIssue(inspection);
  const blockFix = api.fixIssue(inspection.items);
  return (
    <Screen title={inspection.number} subtitle={`Kiểm tra ${dmy(inspection.checkDate)} · ${inspection.reporterName}`} onBack={() => (router.canGoBack() ? router.back() : router.replace("/inspection" as Href))}>
      <Card>
        <View style={[styles.pill, { backgroundColor: tone.bg }]}><Text style={[styles.pillText, { color: tone.fg }]}>{api.STATUS_LABEL[inspection.status]}</Text></View>
        <Text style={styles.body}>Giao cho: <Text style={styles.bold}>{inspection.attentionName || "—"}</Text>{inspection.cc ? ` · CC: ${inspection.cc}` : ""}</Text>
        {canFix && inspection.status === "open" ? <Text style={styles.warnText}>Bạn là người khắc phục: mỗi lỗi bấm “Khắc phục”, chụp ảnh sau khi sửa, ghi comment. Xong hết bấm “Báo đã khắc phục xong”.</Text> : null}
      </Card>
      {inspection.items.map((item, index) => (
        <Card key={item.id}>
          <SectionTitle right={canEdit ? <Pressable onPress={() => Alert.alert("Xóa lỗi?", item.problem, [{ text: "Hủy", style: "cancel" }, { text: "Xóa", style: "destructive", onPress: () => void run(() => api.removeItem(item.id), "Đã xóa lỗi.") }])} hitSlop={8}><Glyph name="trash" size={18} color={colors.rose} fillOpacity={0.12} /></Pressable> : undefined}>Defect {index + 1}</SectionTitle>
          <View style={styles.pair}>
            <View style={styles.half}><Text style={styles.sideTitle}>Before</Text><MarkedPhoto uri={item.before?.path ? urls[item.before.path] : undefined} marks={item.beforeMarks} onPress={canEdit ? () => setEditing({ item, mode: "before" }) : undefined} /></View>
            <View style={styles.half}><Text style={[styles.sideTitle, styles.afterTitle]}>After</Text><MarkedPhoto uri={item.after?.path ? urls[item.after.path] : undefined} marks={item.afterMarks} onPress={canFix ? () => setEditing({ item, mode: "after" }) : undefined} /></View>
          </View>
          <Text style={styles.body}><Text style={styles.bold}>Vấn đề: </Text>{item.problem}</Text>
          {item.countermeasure ? <Text style={styles.body}><Text style={styles.bold}>Cách giải quyết: </Text>{item.countermeasure}</Text> : null}
          <Text style={styles.muted}>{[item.location, item.foundTime, item.targetDate ? `hạn ${dmy(item.targetDate)}` : ""].filter(Boolean).join(" · ")}</Text>
          {item.after ? <Text style={styles.body}><Text style={styles.bold}>Comment: </Text>{item.comment || "—"}{item.finishDate ? ` · xong ${dmy(item.finishDate)}` : ""}</Text> : null}
          <View style={styles.row}>
            {canEdit ? <View style={{ flex: 1 }}><SecondaryButton label="Sửa lỗi" onPress={() => setEditing({ item, mode: "before" })} /></View> : null}
            {canFix ? <View style={{ flex: 1 }}><GradientButton label={item.after ? "Sửa khắc phục" : "Khắc phục"} onPress={() => setEditing({ item, mode: "after" })} /></View> : null}
          </View>
        </Card>
      ))}
      {canEdit ? <SecondaryButton label="Thêm lỗi" icon={<Glyph name="add" size={18} color={colors.skyDeep} fillOpacity={0} />} onPress={() => setEditing({ item: blankItem(inspection.items.length + 1), mode: "before" })} /> : null}
      {canEdit && inspection.status === "draft" ? <GradientButton label={blockSubmit ?? "Gửi cho trưởng dự án"} busy={busy} onPress={() => { if (blockSubmit) { toast(blockSubmit, "warn"); return; } void run(() => api.submit(inspection.id), `Đã gửi cho ${inspection.attentionName || "trưởng dự án"}.`); }} /> : null}
      {canFix && inspection.status === "open" ? <GradientButton label="Báo đã khắc phục xong" busy={busy} onPress={() => { if (blockFix) { toast(blockFix, "warn"); return; } void run(() => api.markFixed(inspection.id), "Đã báo cho người kiểm tra."); }} /> : null}
      {isReporter && inspection.status === "fixed" ? <>
        <GradientButton label="Đồng ý, đóng báo cáo" busy={busy} onPress={() => void run(() => api.close(inspection.id), "Đã đóng báo cáo.")} />
        <SecondaryButton label="Chưa đạt, trả lại" onPress={() => void run(() => api.close(inspection.id, true), "Đã trả lại trưởng dự án.")} />
      </> : null}
      {isReporter && inspection.status === "draft" ? <SecondaryButton danger label="Xóa báo cáo nháp" onPress={() => Alert.alert("Xóa báo cáo nháp?", inspection.number, [{ text: "Hủy", style: "cancel" }, { text: "Xóa", style: "destructive", onPress: () => void run(async () => { await api.remove(inspection.id); router.back(); }, "Đã xóa.") }])} /> : null}
      <Text style={styles.muted}>Xuất Excel theo mẫu QHSE PHOTO REPORT ở bản web: Báo cáo hằng tháng → Báo cáo công trình.</Text>
      {editing ? <ItemEditor inspection={inspection} item={editing.item} mode={editing.mode} urls={urls} fixer={me.name} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
    </Screen>
  );
}

function List() {
  const toast = useToast();
  const [list, setList] = useState<Inspection[] | null>(null);
  const [projects, setProjects] = useState<InspectionProject[]>([]);
  const [can, setCan] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [items, projectList, allowed] = await Promise.all([api.loadList(), api.loadProjects(), api.canCreate()]);
      setList(items); setProjects(projectList); setCan(allowed);
    } catch (error) { toast(errorText(error), "err"); setList((c) => c ?? []); }
  }, [toast]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const byId = useMemo(() => new Map(projects.map((p) => [p.projectId, p])), [projects]);
  const start = async (project: InspectionProject) => {
    setPicking(false);
    if (!project.pmEmployeeId) { toast("Dự án chưa có trưởng dự án (PM). Đặt PM trong dự án trước.", "warn"); return; }
    setBusy(true);
    try { const id = await api.create(project, todayISO(), ""); router.push(`/inspection?id=${encodeURIComponent(id)}` as Href); } catch (error) { toast(errorText(error), "err"); } finally { setBusy(false); }
  };
  return (
    <Screen title="Báo cáo công trình" subtitle="QHSE photo report · Báo cáo hằng tháng" onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} refreshing={false} onRefresh={() => void load()}>
      {can ? <GradientButton label="Báo cáo mới: chọn dự án" busy={busy} onPress={() => setPicking(true)} /> : null}
      {!list ? <LogoLoader /> : !list.length ? <Card><Text style={styles.body}>Chưa có báo cáo nào.</Text></Card> : list.map((item) => {
        const project = byId.get(item.projectId);
        const tone = TONE[item.status];
        const fixed = item.items.filter((i) => i.after).length;
        return (
          <Pressable key={item.id} onPress={() => router.push(`/inspection?id=${encodeURIComponent(item.id)}` as Href)} accessibilityRole="button">
            <Card>
              <View style={styles.listHead}><Text style={styles.listTitle} numberOfLines={2}>{project ? `${project.code} · ${project.name}` : item.number}</Text><View style={[styles.pill, { backgroundColor: tone.bg }]}><Text style={[styles.pillText, { color: tone.fg }]}>{api.STATUS_LABEL[item.status]}</Text></View></View>
              <Text style={styles.muted}>{item.number} · {dmy(item.checkDate)} · {item.reporterName} → {item.attentionName || "—"} · đã sửa {fixed}/{item.items.length}</Text>
            </Card>
          </Pressable>
        );
      })}
      <PickerSheet visible={picking} title="Chọn dự án kiểm tra" placeholder="Tìm mã, tên dự án" selectedId={null} emptyText="Không có dự án"
        items={projects.map((p) => ({ id: p.projectId, title: p.name, subtitle: `${p.code} · PM: ${p.pmName || "chưa có"}`, badge: p.code, icon: "report", tone: "rose" }))}
        onSelect={(item) => { const found = projects.find((p) => p.projectId === item.id); if (found) void start(found); }} onClose={() => setPicking(false)} />
    </Screen>
  );
}

/** /inspection: danh sách; /inspection?id=…: chi tiết một báo cáo. */
export default function InspectionScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  return params.id ? <Detail key={params.id} id={params.id} /> : <List />;
}

const styles = StyleSheet.create({
  body: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, color: colors.ink },
  bold: { fontFamily: fonts.bold },
  muted: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.faint },
  warnText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.warn },
  pill: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  pillText: { fontFamily: fonts.bold, fontSize: 12 },
  pair: { flexDirection: "row", gap: 8 },
  half: { flex: 1, gap: 4 },
  sideTitle: { fontFamily: fonts.bold, fontSize: 13, color: colors.bad, textAlign: "center" },
  afterTitle: { color: "#146C3A" },
  row: { flexDirection: "row", gap: 8 },
  listHead: { flexDirection: "row", gap: 8, alignItems: "flex-start", justifyContent: "space-between" },
  listTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  field: { gap: 4 },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.muted },
  input: { minHeight: 46, borderRadius: radius.control, borderWidth: 1, borderColor: colors.fieldLine, backgroundColor: colors.field, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.medium, fontSize: 16, color: colors.ink },
  inputMulti: { minHeight: 72, textAlignVertical: "top" },
  inputOff: { opacity: 0.6 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.skyTint, alignItems: "center", justifyContent: "center" },
  dateArrow: { fontFamily: fonts.bold, fontSize: 20, color: colors.skyDeep },
  dateText: { minWidth: 104, textAlign: "center", fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.field, borderWidth: 1, borderColor: colors.fieldLine },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  editor: { paddingHorizontal: 16, gap: 12, maxWidth: 640, width: "100%", alignSelf: "center" },
  editorHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  editorTitle: { fontFamily: fonts.black ?? fonts.bold, fontSize: 20, color: colors.navy },
  beforeRef: { gap: 6, opacity: Platform.OS === "web" ? 1 : 0.98 },
});
