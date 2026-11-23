import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon, Glyph } from "@/components/AppIcon";
import { GradientButton, SecondaryButton } from "@/components/GradientButton";
import { LogoLoader } from "@/components/LogoLoader";
import { PickerSheet, type PickerItem } from "@/components/PickerSheet";
import { Card, FadeSlide, Screen, SectionTitle } from "@/components/Screen";
import { useToast } from "@/components/Toast";
import { isLink } from "@/lib/attendance";
import { addDays, dmy, todayISO } from "@/lib/dates";
import { errorText } from "@/lib/errors";
import { MODAL_ORIENTATIONS } from "@/lib/layout";
import { colors, fonts, radius, space, text } from "@/lib/theme";
import {
  canManageTypes, deleteType, emptyRow, fromTemplate, ITEM_KEYS, ITEM_LABEL, itemsOf, photoCountOf, loadCheck, loadPreviousCheck, loadTemplate, loadToolProjects, loadTypes, newKey, OPTIONAL_ITEMS, readDraft, shiftMonth,
  saveCheck, saveTemplate, saveType, signedUrls, writeDraft, type ItemKey, type PhotoRef, type SavedCheck, type TemplateRow, type ToolProject, type ToolRow, type ToolType,
} from "@/lib/toolCheck";

const LAST_PROJECT = "tnm.lastToolProject";
const LAST_CHECKER = "tnm.toolChecker";

/** Một ô ảnh cần chụp: dòng nào, mục nào. */
type Slot = { rowKey: string; item: ItemKey };
/**
 * Luồng chụp ảnh:
 *  - intro: báo trước "Tiếp theo là gì" (chỉ khi chụp lần lượt), để người chụp đến đúng máy, đúng mục.
 *  - preview: xem ảnh vừa chụp to, đủ để biết mờ hay không → Chụp lại hoặc Lưu.
 */
type Flow = { queue: Slot[]; index: number; phase: "intro" | "preview"; photo: PhotoRef | null; source: "camera" | "library" };

/** Nhà thầu (Sub con.) luôn là TNM. */
const SUBCON = "TNM";
/** "2026-11" → "11/2026". */
const monthLabel = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
const toTemplate = (rows: readonly ToolRow[]): TemplateRow[] => rows.filter((r) => r.serial.trim()).map((r) => ({ serial: r.serial.trim(), subcon: SUBCON, typeId: r.typeId }));
const rowName = (row: ToolRow, index: number) => row.serial.trim() || `Dụng cụ #${index + 1} (chưa có tên)`;

export default function ToolCheckScreen() {
  const toast = useToast();
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  const [projects, setProjects] = useState<ToolProject[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [types, setTypes] = useState<ToolType[]>([]);
  const [manager, setManager] = useState(false);
  const [month, setMonth] = useState(thisMonth);
  const [date, setDate] = useState(today);
  const [checkId, setCheckId] = useState<string | null>(null);
  const [checkedBy, setCheckedBy] = useState("");
  const [rows, setRows] = useState<ToolRow[]>([]);
  const [template, setTemplate] = useState<TemplateRow[]>([]);
  const [previous, setPrevious] = useState<SavedCheck | null>(null);
  const [loading, setLoading] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [flow, setFlow] = useState<Flow | null>(null);
  const [cellMenu, setCellMenu] = useState<Slot | null>(null);
  const [typePickerFor, setTypePickerFor] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [askTemplate, setAskTemplate] = useState(false);
  const [askMissing, setAskMissing] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const ready = useRef(false);

  const loadBase = useCallback(async () => {
    try {
      const [list, typeList, canManage, last, checker] = await Promise.all([
        loadToolProjects(), loadTypes(), canManageTypes(), AsyncStorage.getItem(LAST_PROJECT).catch(() => null), AsyncStorage.getItem(LAST_CHECKER).catch(() => null),
      ]);
      setProjects(list); setTypes(typeList); setManager(canManage); setLoadError(null);
      setCheckedBy((current) => current || checker || "");
      setProjectId((current) => (current && list.some((p) => p.projectId === current) ? current : last && list.some((p) => p.projectId === last) ? last : list[0]?.projectId ?? null));
    } catch (error) {
      setProjects((current) => current ?? []);
      setLoadError(errorText(error));
    }
  }, []);
  useEffect(() => { void loadBase(); }, [loadBase]);

  // Đổi dự án / tháng: ưu tiên bản nháp trên máy, rồi phiếu đã lưu của tháng; chưa có thì hỏi dùng danh sách tháng trước
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    ready.current = false;
    setLoading(true); setRows([]); setUrls({}); setShowMissing(false); setCheckId(null); setPrevious(null);
    void (async () => {
      try {
        const [draft, saved, prev, tpl] = await Promise.all([readDraft(projectId, month), loadCheck(projectId, month), loadPreviousCheck(projectId, month), loadTemplate(projectId)]);
        if (!active) return;
        setTemplate(tpl);
        setPrevious(prev);
        setCheckId(saved?.id ?? null);
        setDate(saved?.date ?? (month === thisMonth ? today : `${month}-01`));
        if (draft) { setRows(draft.rows); if (draft.checkedBy) setCheckedBy(draft.checkedBy); }
        else if (saved) { setRows(saved.rows); if (saved.checkedBy) setCheckedBy(saved.checkedBy); }
        const paths = (draft?.rows ?? saved?.rows ?? []).flatMap((r) => Object.values(r.photos).map((p) => p?.path).filter((p): p is string => Boolean(p)));
        const map = await signedUrls(paths).catch(() => ({}));
        if (active) setUrls(map);
      } catch (error) {
        if (active) toast(errorText(error), "err");
      } finally {
        if (active) { setLoading(false); ready.current = true; }
      }
    })();
    return () => { active = false; };
  }, [projectId, month, toast, thisMonth, today]);

  // Lưu nháp trên máy mỗi khi sửa
  useEffect(() => {
    if (!projectId || !ready.current) return;
    const timer = setTimeout(() => { void writeDraft(projectId, month, rows.length ? { checkedBy, rows } : null); }, 400);
    return () => clearTimeout(timer);
  }, [rows, checkedBy, projectId, month]);

  const project = projects?.find((p) => p.projectId === projectId) ?? null;
  const items: PickerItem[] = useMemo(() => (projects ?? []).map((p) => ({ id: p.projectId, title: p.name, subtitle: [p.code, isLink(p.site) ? "" : p.site].filter(Boolean).join(" · "), badge: p.code, icon: "shield", tone: "sky" })), [projects]);

  const patchRow = (key: string, patch: Partial<ToolRow>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setPhoto = (slot: Slot, photo: PhotoRef | null) => setRows((list) => list.map((r) => {
    if (r.key !== slot.rowKey) return r;
    const photos = { ...r.photos };
    if (photo) photos[slot.item] = photo; else delete photos[slot.item];
    return { ...r, photos };
  }));

  const missing = useMemo(() => rows.flatMap((row) => itemsOf(row, types).filter((item) => !row.photos[item]).map((item) => ({ rowKey: row.key, item }))), [rows, types]);
  const missingRows = new Set(missing.map((slot) => slot.rowKey)).size;
  const highlight = showMissing && missing.length > 0;
  const ngCount = rows.filter((r) => r.result === "NG").length;
  const noName = rows.filter((r) => !r.serial.trim()).length;

  /** Chụp hoặc chọn ảnh, trả về ảnh hoặc null nếu hủy. */
  const capture = async (source: "camera" | "library"): Promise<PhotoRef | null> => {
    const permission = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { toast("Hãy cho phép app dùng camera / thư viện ảnh.", "warn"); return null; }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return null;
    const asset = result.assets[0];
    return { uri: asset.uri, width: asset.width, height: asset.height };
  };

  // Cách 1: chụp lần lượt (của một dụng cụ khi bấm nút máy ảnh ở tên, hoặc mọi ô còn thiếu)
  const startSequence = (queue: Slot[]) => {
    if (!queue.length) { toast("Không còn ô nào thiếu ảnh.", "ok"); return; }
    setFlow({ queue, index: 0, phase: "intro", photo: null, source: "camera" });
  };
  const sequenceForRow = (row: ToolRow) => {
    const all = itemsOf(row, types).map((item) => ({ rowKey: row.key, item }));
    const left = all.filter((slot) => !row.photos[slot.item]);
    startSequence(left.length ? left : all);
  };
  // Cách 2: bấm từng ô để chụp / chọn ảnh cho ô đó, xem lại rồi lưu
  const single = async (slot: Slot, source: "camera" | "library") => {
    setCellMenu(null);
    const photo = await capture(source);
    if (photo) setFlow({ queue: [slot], index: 0, phase: "preview", photo, source });
  };

  const flowShoot = async () => {
    if (!flow) return;
    const photo = await capture(flow.source);
    if (photo) setFlow({ ...flow, phase: "preview", photo });
  };
  const flowNext = (keep: boolean) => {
    if (!flow) return;
    if (keep && flow.photo) setPhoto(flow.queue[flow.index]!, flow.photo);
    const next = flow.index + 1;
    if (next >= flow.queue.length) { setFlow(null); if (flow.queue.length > 1) toast("Đã chụp xong lượt này. Kiểm tra lại rồi bấm Lưu phiếu.", "ok"); return; }
    setFlow({ ...flow, index: next, phase: "intro", photo: null });
  };

  /** Bấm Lưu: thiếu ảnh thì báo còn mấy ô (tô đỏ trong bảng) và hỏi chụp bổ sung hay vẫn lưu. */
  const trySave = () => {
    if (!project) return;
    if (!rows.length) { toast("Chưa có dụng cụ nào.", "warn"); return; }
    if (noName) { toast(`Còn ${noName} dòng chưa nhập Serial/Code.`, "err"); return; }
    if (!checkedBy.trim()) { toast("Nhập người kiểm tra (Checked by).", "err"); return; }
    if (missing.length) { setShowMissing(true); setAskMissing(true); return; }
    void save();
  };

  const save = async () => {
    if (!project) return;
    setAskMissing(false);
    setBusy("Đang lưu…");
    try {
      const result = await saveCheck(project.projectId, date, checkedBy, rows.map((r) => ({ ...r, subcon: SUBCON })), types, checkId, (done, total) => setBusy(total ? `Đang tải ảnh ${done}/${total}…` : "Đang lưu…"));
      setRows(result.rows);
      setCheckId(result.id);
      await writeDraft(project.projectId, month, null);
      void AsyncStorage.setItem(LAST_CHECKER, checkedBy.trim()).catch(() => undefined);
      setUrls(await signedUrls(result.rows.flatMap((r) => Object.values(r.photos).map((p) => p?.path).filter((p): p is string => Boolean(p)))).catch(() => urls));
      toast(`Đã lưu phiếu tháng ${monthLabel(month)}: ${rows.length} dụng cụ${ngCount ? ` (${ngCount} NG)` : ""}${missing.length ? `, còn ${missing.length} ô chưa có ảnh` : ""}.`, missing.length ? "warn" : "ok");
      // Lần đầu (dự án chưa có mẫu): hỏi có chuyển thành dữ liệu mẫu không; đã có mẫu thì cập nhật theo danh sách mới (có thêm dụng cụ)
      if (!template.length) setAskTemplate(true);
      else void saveTemplate(project.projectId, rows).then(() => setTemplate(toTemplate(rows)), () => undefined);
    } catch (error) {
      toast(errorText(error), "err");
    } finally {
      setBusy(null);
    }
  };

  const makeTemplate = async () => {
    if (!project) return;
    setAskTemplate(false);
    try {
      await saveTemplate(project.projectId, rows);
      setTemplate(toTemplate(rows));
      toast("Đã lưu làm dữ liệu mẫu. Tháng sau mở phiếu mới bấm dùng danh sách để kiểm tra định kỳ.", "ok");
    } catch (error) { toast(errorText(error), "err"); }
  };

  if (projects === null) {
    return <Screen title="Kiểm tra dụng cụ" onBack={() => router.back()}><View style={styles.loadingBox}><LogoLoader size={64} stroke={4} variant="light" /></View></Screen>;
  }
  if (!projects.length) {
    return (
      <Screen title="Kiểm tra dụng cụ" onBack={() => router.back()} onRefresh={() => void loadBase()}>
        <Card style={styles.empty}>
          <AppIcon name="shield" tone="sky" size={48} />
          <Text style={styles.emptyTitle}>Chưa có dự án để kiểm tra</Text>
          <Text style={styles.emptyText}>{loadError ?? "Chỉ dự án đang thi công mà bạn tham gia (trừ công nhân) mới hiện ở đây."}</Text>
        </Card>
      </Screen>
    );
  }

  const flowSlot = flow ? flow.queue[flow.index]! : null;
  const flowRowIndex = flowSlot ? rows.findIndex((r) => r.key === flowSlot.rowKey) : -1;
  const flowRow = flowRowIndex >= 0 ? rows[flowRowIndex]! : null;
  const menuRow = cellMenu ? rows.find((r) => r.key === cellMenu.rowKey) ?? null : null;
  const menuPhoto = cellMenu && menuRow ? menuRow.photos[cellMenu.item] : undefined;
  const typeRow = typePickerFor ? rows.find((r) => r.key === typePickerFor) ?? null : null;
  const monthStart = `${month}-01`;
  const monthEnd = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const lastDay = monthEnd < today ? monthEnd : today;

  return (
    <Screen wide title="Kiểm tra dụng cụ" subtitle="Kiểm tra định kỳ hàng tháng · Tool & machine check" onBack={() => router.back()}
      right={manager ? <Pressable onPress={() => setSetupOpen(true)} style={styles.setupBtn} accessibilityRole="button" accessibilityLabel="Cài đặt loại dụng cụ"><Glyph name="settings" size={20} color={colors.skyDeep} fillOpacity={0.15} /></Pressable> : undefined}>
      <FadeSlide delay={20}>
        <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel="Chọn dự án">
          <Card style={styles.projectCard}>
            <AppIcon name="shield" tone="sky" size={40} />
            <View style={styles.flex}>
              <Text style={styles.small}>Dự án</Text>
              <Text style={styles.projectName} numberOfLines={2}>{project?.name ?? "Chọn dự án"}</Text>
              {project ? <Text style={styles.muted} numberOfLines={1}>{project.code}</Text> : null}
            </View>
            <Text style={styles.link}>Đổi</Text>
          </Card>
        </Pressable>
      </FadeSlide>

      <Card style={styles.headCard}>
        <View style={styles.dateRow}>
          <Pressable onPress={() => setMonth(shiftMonth(month, -1))} style={styles.dateBtn} accessibilityLabel="Tháng trước"><Text style={styles.dateArrow}>‹</Text></Pressable>
          <View style={styles.flexCenter}><Text style={styles.small}>Kiểm tra định kỳ</Text><Text style={styles.dateText}>Tháng {monthLabel(month)}</Text></View>
          <Pressable onPress={() => month < thisMonth && setMonth(shiftMonth(month, 1))} style={[styles.dateBtn, month >= thisMonth && styles.dim]} accessibilityLabel="Tháng sau"><Text style={styles.dateArrow}>›</Text></Pressable>
        </View>
        <View style={styles.dayRow}>
          <Text style={styles.label}>Ngày kiểm tra</Text>
          <Pressable onPress={() => date > monthStart && setDate(addDays(date, -1))} style={[styles.dayBtn, date <= monthStart && styles.dim]} accessibilityLabel="Lùi một ngày"><Text style={styles.dayArrow}>−</Text></Pressable>
          <Text style={styles.dayText}>{dmy(date)}</Text>
          <Pressable onPress={() => date < lastDay && setDate(addDays(date, 1))} style={[styles.dayBtn, date >= lastDay && styles.dim]} accessibilityLabel="Thêm một ngày"><Text style={styles.dayArrow}>+</Text></Pressable>
        </View>
        <Text style={styles.label}>Người kiểm tra (Checked by)</Text>
        <TextInput style={styles.input} value={checkedBy} onChangeText={setCheckedBy} placeholder="vd: P.TRUNG" autoCapitalize="characters" />
        {checkId ? <Text style={styles.ok}>Tháng này đã có phiếu, sửa rồi bấm Lưu để cập nhật.</Text> : null}
      </Card>

      {loading ? <View style={styles.loadingBox}><LogoLoader size={48} stroke={4} variant="light" /></View> : (
        <>
          {!rows.length && (
            <Card style={styles.startCard}>
              <Text style={styles.startTitle}>Bắt đầu kiểm tra tháng {monthLabel(month)}</Text>
              {previous ? (
                <>
                  <Text style={styles.muted}>Dùng lại danh sách {previous.rows.length} dụng cụ của lần kiểm tra {dmy(previous.date)}. Ảnh để trống, kết quả về OK; có dụng cụ mới thì bấm Thêm dụng cụ.</Text>
                  <GradientButton label={`Dùng danh sách tháng ${monthLabel(previous.date.slice(0, 7))} (${previous.rows.length})`} onPress={() => setRows(previous.rows.map((r) => ({ ...r, key: newKey(), subcon: SUBCON })))} />
                </>
              ) : template.length ? (
                <>
                  <Text style={styles.muted}>Dự án đã có dữ liệu mẫu {template.length} dụng cụ. Dùng mẫu để không sót máy nào, chỉ cần chụp ảnh và chọn kết quả.</Text>
                  <GradientButton label={`Dùng dữ liệu mẫu (${template.length} dụng cụ)`} onPress={() => setRows(fromTemplate(template).map((r) => ({ ...r, subcon: SUBCON })))} />
                </>
              ) : (
                <Text style={styles.muted}>Lần đầu: nhập từng dụng cụ (Serial/Code, loại), chụp ảnh. Lưu xong app hỏi có chuyển thành dữ liệu mẫu để các tháng sau kiểm tra định kỳ theo danh sách này không.</Text>
              )}
              {previous || template.length ? <SecondaryButton label="Nhập mới từ đầu" onPress={() => setRows([emptyRow()])} /> : <GradientButton label="Thêm dụng cụ đầu tiên" onPress={() => setRows([emptyRow()])} />}
            </Card>
          )}

          {rows.length > 0 && (
            <>
              <SectionTitle right={<Text style={styles.muted}>{rows.length} dụng cụ{ngCount ? ` · ${ngCount} NG` : ""}</Text>}>Danh sách dụng cụ</SectionTitle>
              <Text style={styles.hint}>Bấm <Text style={styles.bold}>máy ảnh cạnh tên</Text> để chụp lần lượt các mục của máy đó, bấm <Text style={styles.bold}>từng ô</Text> để chụp / chọn ảnh, bấm <Text style={styles.bold}>Result</Text> để đổi OK / NG. Vuốt ngang để xem hết bảng.</Text>
              {highlight && (
                <View style={styles.missingBox} accessibilityRole="alert">
                  <Text style={styles.missingText}>Còn {missing.length} ô chưa có ảnh ở {missingRows} dụng cụ (tô đỏ trong bảng).</Text>
                  <SecondaryButton label={`Chụp lần lượt ${missing.length} ô còn thiếu`} icon={<Glyph name="camera" size={18} color={colors.skyDeep} fillOpacity={0.15} />} onPress={() => startSequence(missing)} />
                </View>
              )}
              <ToolTable rows={rows} types={types} urls={urls} highlight={highlight}
                onSerial={(row, serial) => patchRow(row.key, { serial })} onNote={(row, note) => patchRow(row.key, { note })}
                onShootRow={sequenceForRow} onType={(row) => setTypePickerFor(row.key)} onCell={setCellMenu}
                onResult={(row) => patchRow(row.key, { result: row.result === "OK" ? "NG" : "OK" })}
                onRemove={(row) => setRows((list) => list.filter((r) => r.key !== row.key))} />
              <SecondaryButton label="Thêm dụng cụ" icon={<Glyph name="add" size={18} color={colors.skyDeep} fillOpacity={0} />} onPress={() => setRows((list) => [...list, emptyRow(SUBCON, list.at(-1)?.typeId ?? null)])} />
              <GradientButton label="Lưu phiếu kiểm tra" busy={Boolean(busy)} busyLabel={busy ?? "Đang lưu…"} onPress={trySave} />
              {checkId && <SecondaryButton label={template.length ? "Cập nhật dữ liệu mẫu theo danh sách này" : "Lưu làm dữ liệu mẫu"} onPress={() => setAskTemplate(true)} />}
            </>
          )}
        </>
      )}

      <PickerSheet visible={picking} title="Chọn dự án" placeholder="Tìm mã, tên dự án" items={items} selectedId={projectId} emptyText="Không có dự án"
        onSelect={(item) => { setPicking(false); setProjectId(item.id); void AsyncStorage.setItem(LAST_PROJECT, item.id).catch(() => undefined); }} onClose={() => setPicking(false)} />

      <PickerSheet visible={typeRow !== null} title="Loại dụng cụ" placeholder="Tìm loại" selectedId={typeRow?.typeId ?? null} emptyText="Chưa có loại nào. Người quản lý đặt ở nút ⚙ trên cùng."
        items={types.map((t) => ({ id: t.id, title: t.name, subtitle: `${photoCountOf(t)} ảnh: ${["Bên ngoài", ...t.items.map((k) => ITEM_LABEL[k].vi)].join(" · ")}`, number: photoCountOf(t) }))}
        onSelect={(item) => { if (typePickerFor) patchRow(typePickerFor, { typeId: item.id }); setTypePickerFor(null); }} onClose={() => setTypePickerFor(null)} />

      {/* Cách 2: menu của một ô */}
      <Sheet visible={cellMenu !== null} onClose={() => setCellMenu(null)} title={cellMenu && menuRow ? `${rowName(menuRow, rows.indexOf(menuRow))} · ${ITEM_LABEL[cellMenu.item].en}` : ""}>
        {menuPhoto && cellMenu ? <Image source={{ uri: menuPhoto.uri ?? (menuPhoto.path ? urls[menuPhoto.path] : undefined) }} style={styles.menuImg} contentFit="contain" /> : null}
        <GradientButton label={menuPhoto ? "Chụp lại" : "Chụp ảnh"} onPress={() => cellMenu && void single(cellMenu, "camera")} />
        <SecondaryButton label="Chọn từ thư viện" onPress={() => cellMenu && void single(cellMenu, "library")} />
        {menuPhoto ? <SecondaryButton danger label="Xóa ảnh ô này" onPress={() => { if (cellMenu) setPhoto(cellMenu, null); setCellMenu(null); }} /> : null}
      </Sheet>

      {/* Luồng chụp: báo trước mục tiếp theo, xem lại ảnh trước khi lưu */}
      <Modal supportedOrientations={MODAL_ORIENTATIONS} visible={flow !== null} animationType="fade" onRequestClose={() => setFlow(null)} statusBarTranslucent>
        {flow && flowSlot && (
          <FlowView flow={flow} title={flowRow ? rowName(flowRow, flowRowIndex) : ""} item={flowSlot.item}
            onShoot={() => void flowShoot()} onSkip={() => flowNext(false)} onSave={() => flowNext(true)} onStop={() => setFlow(null)}
            onRetake={() => void flowShoot()} />
        )}
      </Modal>

      <Sheet visible={askMissing} onClose={() => setAskMissing(false)} title={`Còn ${missing.length} ô chưa có ảnh`}>
        <Text style={styles.muted}>{missingRows} dụng cụ còn thiếu ảnh: dòng tô đỏ nhạt, ô cần bổ sung tô đỏ đậm trong bảng.</Text>
        <GradientButton label={`Chụp lần lượt ${missing.length} ô còn thiếu`} onPress={() => { setAskMissing(false); startSequence(missing); }} />
        <SecondaryButton label="Vẫn lưu, bổ sung sau" onPress={() => void save()} />
        <SecondaryButton label="Để tôi xem lại bảng" onPress={() => setAskMissing(false)} />
      </Sheet>

      <Sheet visible={askTemplate} onClose={() => setAskTemplate(false)} title="Chuyển thành dữ liệu mẫu?">
        <Text style={styles.muted}>Lưu danh sách {rows.filter((r) => r.serial.trim()).length} dụng cụ (Serial/Code, loại) làm mẫu của dự án. Các tháng sau kiểm tra định kỳ chỉ cần dùng lại danh sách rồi chụp ảnh, tránh sót máy; có dụng cụ mới thì thêm vào. Ảnh và kết quả không lưu vào mẫu.</Text>
        <GradientButton label="Có, dùng làm mẫu" onPress={() => void makeTemplate()} />
        <SecondaryButton label="Không" onPress={() => setAskTemplate(false)} />
      </Sheet>

      <TypeSetup visible={setupOpen} types={types} onClose={() => setSetupOpen(false)} onChanged={async () => setTypes(await loadTypes().catch(() => types))} />
    </Screen>
  );
}

/** Màn chụp toàn màn hình: intro (tiếp theo là gì) → preview (xem ảnh to, Chụp lại / Lưu). */
function FlowView({ flow, title, item, onShoot, onSkip, onSave, onStop, onRetake }: {
  flow: Flow; title: string; item: ItemKey; onShoot: () => void; onSkip: () => void; onSave: () => void; onStop: () => void; onRetake: () => void;
}) {
  const insets = useSafeAreaInsets();
  const many = flow.queue.length > 1;
  const step = many ? `Bước ${flow.index + 1}/${flow.queue.length}` : "Xem lại ảnh";
  return (
    <View style={[styles.flow, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.md }]}>
      <View style={styles.flowTop}>
        <Text style={styles.flowStep}>{step}</Text>
        <Pressable onPress={onStop} hitSlop={10} accessibilityLabel="Dừng"><Text style={styles.flowStop}>Dừng</Text></Pressable>
      </View>
      {flow.phase === "intro" ? (
        <View style={styles.flowIntro}>
          <Text style={styles.flowNext}>Tiếp theo</Text>
          <Text style={styles.flowTitle}>{title}</Text>
          <Text style={styles.flowSub}>Sub con.: {SUBCON}</Text>
          <View style={styles.flowItem}>
            <Text style={styles.flowItemEn}>{ITEM_LABEL[item].en}</Text>
            <Text style={styles.flowItemVi}>{ITEM_LABEL[item].vi}</Text>
          </View>
          <Text style={styles.flowHint}>Đến đúng máy rồi bấm Chụp. Chụp xong sẽ xem lại ảnh trước khi lưu.</Text>
        </View>
      ) : (
        <View style={styles.flowPreview}>
          <Text style={styles.flowSmallTitle} numberOfLines={1}>{title} · {ITEM_LABEL[item].en}</Text>
          {flow.photo?.uri ? <Image source={{ uri: flow.photo.uri }} style={styles.flowImg} contentFit="contain" /> : null}
          <Text style={styles.flowHint}>Phóng to xem chữ, số trên đồng hồ có rõ không. Mờ thì Chụp lại.</Text>
        </View>
      )}
      <View style={styles.flowActions}>
        {flow.phase === "intro" ? (
          <>
            <GradientButton label="Chụp" onPress={onShoot} />
            {many ? <SecondaryButton label="Bỏ qua mục này" onPress={onSkip} /> : null}
          </>
        ) : (
          <>
            <GradientButton label={many && flow.index + 1 < flow.queue.length ? "Lưu ảnh, sang mục tiếp" : "Lưu ảnh"} onPress={onSave} />
            <SecondaryButton label="Chụp lại" onPress={onRetake} />
          </>
        )}
      </View>
    </View>
  );
}

/**
 * Bảng ngang như Excel: mỗi dụng cụ một dòng (Serial/Code, Loại, 4 cột ảnh, Result).
 * highlight: dòng còn thiếu ảnh tô đỏ nhạt, ô cần bổ sung tô đỏ đậm.
 */
function ToolTable({ rows, types, urls, highlight, onSerial, onNote, onShootRow, onType, onCell, onResult, onRemove }: {
  rows: ToolRow[]; types: ToolType[]; urls: Record<string, string>; highlight: boolean;
  onSerial: (row: ToolRow, serial: string) => void; onNote: (row: ToolRow, note: string) => void; onShootRow: (row: ToolRow) => void;
  onType: (row: ToolRow) => void; onCell: (slot: Slot) => void; onResult: (row: ToolRow) => void; onRemove: (row: ToolRow) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableWrap} keyboardShouldPersistTaps="handled">
      <View>
        <View style={[styles.tr, styles.thRow]}>
          <Text style={[styles.th, styles.colName]}>Serial/Code</Text>
          <Text style={[styles.th, styles.colType]}>Loại</Text>
          {ITEM_KEYS.map((k, i) => <Text key={k} style={[styles.th, styles.colPhoto]}>{i + 1}. {ITEM_LABEL[k].en}</Text>)}
          <Text style={[styles.th, styles.colResult]}>Result</Text>
        </View>
        {rows.map((row, index) => {
          const items = itemsOf(row, types);
          const type = types.find((t) => t.id === row.typeId);
          const lacking = highlight && items.some((k) => !row.photos[k]);
          return (
            <View key={row.key} style={[styles.tr, index % 2 ? styles.trAlt : undefined, lacking ? styles.trMissing : undefined]}>
              <View style={[styles.tdBox, styles.colName, styles.nameCell]}>
                <TextInput style={styles.tdInput} value={row.serial} onChangeText={(v) => onSerial(row, v)} placeholder={`Dụng cụ #${index + 1}`} autoCapitalize="characters" multiline />
                <View style={styles.nameActions}>
                  <Pressable onPress={() => onShootRow(row)} hitSlop={6} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Chụp lần lượt ${rowName(row, index)}`}><Glyph name="camera" size={18} color={colors.orange} fillOpacity={0.2} /></Pressable>
                  <Pressable onPress={() => onRemove(row)} hitSlop={6} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Bỏ ${rowName(row, index)}`}><Glyph name="trash" size={18} color={colors.rose} fillOpacity={0.12} /></Pressable>
                </View>
              </View>
              <Pressable onPress={() => onType(row)} style={[styles.tdBox, styles.colType]} accessibilityRole="button" accessibilityLabel="Chọn loại dụng cụ">
                <View style={styles.typeChip}>
                  <View style={styles.numSm}><Text style={styles.numSmText}>{items.length}</Text></View>
                  <Text style={styles.typeChipText} numberOfLines={3}>{type?.name ?? "Chọn loại"}</Text>
                </View>
              </Pressable>
              {ITEM_KEYS.map((k) => {
                if (!items.includes(k)) return <View key={k} style={[styles.tdBox, styles.colPhoto, styles.tdNa]}><Text style={styles.naText}>N/A</Text></View>;
                const photo = row.photos[k];
                const src = photo?.uri ?? (photo?.path ? urls[photo.path] : undefined);
                const need = highlight && !photo;
                return (
                  <Pressable key={k} onPress={() => onCell({ rowKey: row.key, item: k })} style={[styles.tdBox, styles.colPhoto]} accessibilityRole="button" accessibilityLabel={`Ảnh ${ITEM_LABEL[k].en}${need ? ", còn thiếu" : ""}`}>
                    {src ? <Image source={{ uri: src }} style={styles.thumb} contentFit="cover" />
                      : <View style={[styles.thumbEmpty, need && styles.thumbNeed]}><Glyph name="camera" size={20} color={need ? "#fff" : colors.skyDeep} fillOpacity={0.12} />{need ? <Text style={styles.needText}>Thiếu</Text> : null}</View>}
                  </Pressable>
                );
              })}
              <View style={[styles.tdBox, styles.colResult]}>
                <Pressable onPress={() => onResult(row)} accessibilityRole="button" accessibilityLabel={`Kết quả ${row.result}, bấm để đổi`}>
                  <Text style={[styles.resultPill, row.result === "OK" ? styles.segOk : styles.segNg]}>{row.result}</Text>
                </Pressable>
                {row.result === "NG" ? <TextInput style={styles.noteInput} value={row.note} onChangeText={(v) => onNote(row, v)} placeholder="Lỗi gì?" multiline /> : null}
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

/** Hộp trượt từ dưới lên đơn giản. */
function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal supportedOrientations={MODAL_ORIENTATIONS} visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Đóng" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.handle} />
        <Text style={styles.sheetTitle}>{title}</Text>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </Modal>
  );
}

/** Người quản lý đặt trước các loại dụng cụ: tên loại và các mục cần chụp (Out look check luôn có). */
function TypeSetup({ visible, types, onClose, onChanged }: { visible: boolean; types: ToolType[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [editing, setEditing] = useState<{ id?: string; name: string; items: ItemKey[]; position: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast("Nhập tên loại.", "err"); return; }
    setBusy(true);
    try { await saveType({ ...editing, position: 1 + editing.items.filter((k) => k !== "outlook").length }); await onChanged(); setEditing(null); toast("Đã lưu loại dụng cụ.", "ok"); } catch (error) { toast(errorText(error), "err"); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    try { await deleteType(id); await onChanged(); setEditing(null); toast("Đã xóa loại.", "ok"); } catch (error) { toast(errorText(error), "err"); }
  };
  return (
    <Sheet visible={visible} onClose={() => { setEditing(null); onClose(); }} title={editing ? (editing.id ? "Sửa loại dụng cụ" : "Thêm loại dụng cụ") : "Loại dụng cụ"}>
      {editing ? (
        <>
          <Text style={styles.label}>Tên loại</Text>
          <TextInput style={styles.input} value={editing.name} onChangeText={(name) => setEditing({ ...editing, name })} placeholder="vd: Máy điện có dây (220/380V)" />
          <Text style={styles.label}>Mục cần chụp ảnh</Text>
          <View style={[styles.check, styles.checkOn, styles.dim]}><Text style={styles.checkText}>✓ {ITEM_LABEL.outlook.en} (luôn có)</Text></View>
          {OPTIONAL_ITEMS.map((key) => {
            const on = editing.items.includes(key);
            return (
              <Pressable key={key} onPress={() => setEditing({ ...editing, items: on ? editing.items.filter((k) => k !== key) : [...editing.items, key] })} style={[styles.check, on && styles.checkOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <Text style={styles.checkText}>{on ? "✓" : "○"} {ITEM_LABEL[key].en} · {ITEM_LABEL[key].vi}</Text>
              </Pressable>
            );
          })}
          <GradientButton label="Lưu loại" busy={busy} onPress={() => void submit()} />
          {editing.id ? <SecondaryButton danger label="Xóa loại này" onPress={() => void remove(editing.id!)} /> : null}
          <SecondaryButton label="Quay lại" onPress={() => setEditing(null)} />
        </>
      ) : (
        <>
          <Text style={styles.muted}>Mỗi loại chọn sẵn các mục cần chụp. Khi kiểm tra chỉ cần chọn loại, app tự hiện đúng các ô ảnh.</Text>
          {types.map((t) => (
            <Pressable key={t.id} onPress={() => setEditing({ id: t.id, name: t.name, items: [...t.items], position: photoCountOf(t) })} style={[styles.typeItem, styles.typeItemRow]} accessibilityRole="button">
              <View style={styles.num}><Text style={styles.numText}>{photoCountOf(t)}</Text></View>
              <View style={styles.flex}>
                <Text style={styles.typeItemName}>{t.name}</Text>
                <Text style={styles.muted}>{["Bên ngoài", ...t.items.map((k) => ITEM_LABEL[k].vi)].join(" · ")}</Text>
              </View>
            </Pressable>
          ))}
          <GradientButton label="Thêm loại" onPress={() => setEditing({ name: "", items: [], position: types.length + 1 })} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  loadingBox: { paddingVertical: space.xl, alignItems: "center" },
  empty: { alignItems: "center", gap: space.xs, padding: space.lg },
  emptyTitle: { fontSize: text.body, fontFamily: fonts.bold, color: colors.navy, textAlign: "center" },
  emptyText: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.regular, color: colors.muted, textAlign: "center" },
  setupBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.skyTint },
  projectCard: { flexDirection: "row", alignItems: "center", gap: space.sm },
  flex: { flex: 1, minWidth: 0 },
  flexCenter: { flex: 1, alignItems: "center" },
  small: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.semibold, color: colors.faint },
  projectName: { fontSize: text.body, lineHeight: 22, fontFamily: fonts.bold, color: colors.navy },
  muted: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.regular, color: colors.muted },
  link: { fontSize: text.small, fontFamily: fonts.bold, color: colors.skyDeep },
  headCard: { gap: space.xs },
  dateRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  dateBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.skyTint, alignItems: "center", justifyContent: "center" },
  dateArrow: { fontSize: 24, lineHeight: 28, fontFamily: fonts.bold, color: colors.skyDeep },
  dateText: { fontSize: text.body, fontFamily: fonts.bold, color: colors.navy },
  dim: { opacity: 0.4 },
  label: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.semibold, color: colors.muted, marginTop: space.xxs },
  input: { minHeight: 44, borderRadius: radius.control, borderWidth: 1, borderColor: colors.fieldLine, backgroundColor: colors.field, paddingHorizontal: space.sm, fontSize: text.body, fontFamily: fonts.medium, color: colors.ink },
  ok: { fontSize: text.caption, fontFamily: fonts.semibold, color: "#0E7A4F" },
  startCard: { gap: space.sm },
  startTitle: { fontSize: text.body, fontFamily: fonts.bold, color: colors.navy },
  hint: { fontSize: text.caption, lineHeight: 18, fontFamily: fonts.regular, color: colors.muted },
  bold: { fontFamily: fonts.bold, color: colors.navy },
  segOk: { backgroundColor: "#0E9F6E" },
  segNg: { backgroundColor: colors.rose },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(11,31,102,0.45)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "88%", backgroundColor: "#fff", borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: space.md, paddingTop: space.xs, alignSelf: "center", width: "100%", maxWidth: 560 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: space.xs },
  sheetTitle: { fontSize: text.title, lineHeight: 28, fontFamily: fonts.bold, color: colors.navy, marginBottom: space.xs },
  sheetBody: { gap: space.sm, paddingBottom: space.sm },
  menuImg: { width: "100%", height: 220, borderRadius: radius.control, backgroundColor: colors.black },
  check: { borderRadius: radius.control, borderWidth: 1, borderColor: colors.line, padding: space.sm },
  checkOn: { borderColor: colors.skyDeep, backgroundColor: colors.skyTint },
  checkText: { fontSize: text.small, fontFamily: fonts.semibold, color: colors.navy },
  typeItem: { borderRadius: radius.control, borderWidth: 1, borderColor: colors.line, padding: space.sm, gap: 2 },
  typeItemRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  num: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.skyDeep, alignItems: "center", justifyContent: "center" },
  numText: { fontSize: 18, lineHeight: 22, fontFamily: fonts.black, color: "#fff" },
  tableWrap: { borderRadius: radius.control, borderWidth: 1, borderColor: colors.line, backgroundColor: "#fff", overflow: "hidden" },
  tr: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1, borderColor: colors.line },
  thRow: { backgroundColor: "#D9E1F2" },
  trAlt: { backgroundColor: "#F7FAFE" },
  th: { fontSize: 11, lineHeight: 14, fontFamily: fonts.bold, color: colors.navy, textAlign: "center", textAlignVertical: "center", paddingVertical: 6, paddingHorizontal: 4, borderRightWidth: 1, borderColor: colors.line },
  tdBox: { alignItems: "center", justifyContent: "center", padding: 4, borderRightWidth: 1, borderColor: colors.line },
  dayRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  dayBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.skyTint, alignItems: "center", justifyContent: "center" },
  dayArrow: { fontSize: 18, lineHeight: 22, fontFamily: fonts.bold, color: colors.skyDeep },
  dayText: { fontSize: text.body, fontFamily: fonts.bold, color: colors.navy, minWidth: 96, textAlign: "center" },
  missingBox: { gap: space.xs, borderRadius: radius.control, borderWidth: 1, borderColor: colors.badLine, backgroundColor: colors.badBg, padding: space.sm },
  missingText: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.bold, color: colors.bad },
  trMissing: { backgroundColor: "#FFE3E3" },
  nameCell: { alignItems: "stretch", gap: 4 },
  tdInput: { minHeight: 40, borderRadius: 8, borderWidth: 1, borderColor: colors.fieldLine, backgroundColor: "#fff", paddingHorizontal: 6, paddingVertical: 4, fontSize: text.caption, lineHeight: 16, fontFamily: fonts.bold, color: colors.navy },
  nameActions: { flexDirection: "row", justifyContent: "space-between" },
  iconBtn: { width: 32, height: 28, borderRadius: 8, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  typeChip: { alignItems: "center", gap: 4 },
  numSm: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.skyDeep, alignItems: "center", justifyContent: "center" },
  numSmText: { fontSize: 12, lineHeight: 16, fontFamily: fonts.black, color: "#fff" },
  typeChipText: { fontSize: 11, lineHeight: 14, fontFamily: fonts.semibold, color: colors.skyDeep, textAlign: "center" },
  thumbNeed: { borderStyle: "solid", borderColor: "#B3001B", backgroundColor: "#D7263D" },
  needText: { fontSize: 11, lineHeight: 14, fontFamily: fonts.bold, color: "#fff" },
  noteInput: { width: "100%", minHeight: 32, marginTop: 4, borderRadius: 6, borderWidth: 1, borderColor: colors.badLine, backgroundColor: "#fff", paddingHorizontal: 4, fontSize: 11, lineHeight: 14, fontFamily: fonts.regular, color: colors.ink },
  colType: { width: 110 },
  tdNa: { backgroundColor: "#F0F0F0" },
  naText: { fontSize: 11, fontFamily: fonts.semibold, color: colors.faint },
  colName: { width: 150 },
  colPhoto: { width: 92 },
  colResult: { width: 84 },
  thumb: { width: 80, height: 60, borderRadius: 6 },
  thumbEmpty: { width: 80, height: 60, borderRadius: 6, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.sky, backgroundColor: colors.skyTint, alignItems: "center", justifyContent: "center" },
  resultPill: { minWidth: 44, textAlign: "center", fontSize: text.small, lineHeight: 28, fontFamily: fonts.bold, color: "#fff", borderRadius: radius.pill, overflow: "hidden" },
  typeItemName: { fontSize: text.body, fontFamily: fonts.bold, color: colors.navy },
  flow: { flex: 1, backgroundColor: colors.black, paddingHorizontal: space.md, gap: space.md },
  flowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  flowStep: { fontSize: text.small, fontFamily: fonts.bold, color: colors.sky },
  flowStop: { fontSize: text.small, fontFamily: fonts.bold, color: "#fff" },
  flowIntro: { flex: 1, justifyContent: "center", alignItems: "center", gap: space.sm },
  flowNext: { fontSize: text.small, fontFamily: fonts.semibold, color: colors.faint, textTransform: "uppercase", letterSpacing: 1 },
  flowTitle: { fontSize: text.display, lineHeight: 40, fontFamily: fonts.black, color: "#fff", textAlign: "center" },
  flowSub: { fontSize: text.body, fontFamily: fonts.medium, color: colors.faint },
  flowItem: { marginTop: space.md, borderRadius: radius.card, backgroundColor: colors.orange, paddingHorizontal: space.lg, paddingVertical: space.md, alignItems: "center" },
  flowItemEn: { fontSize: text.title, fontFamily: fonts.bold, color: "#fff", textAlign: "center" },
  flowItemVi: { fontSize: text.small, fontFamily: fonts.semibold, color: "#FFE3CC" },
  flowHint: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.regular, color: colors.faint, textAlign: "center" },
  flowPreview: { flex: 1, gap: space.xs },
  flowSmallTitle: { fontSize: text.small, fontFamily: fonts.bold, color: "#fff" },
  flowImg: { flex: 1, width: "100%", borderRadius: radius.control },
  flowActions: { gap: space.xs },
});
