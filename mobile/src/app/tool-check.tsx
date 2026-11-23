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
import { addDays, dayLabel, todayISO } from "@/lib/dates";
import { errorText } from "@/lib/errors";
import { MODAL_ORIENTATIONS } from "@/lib/layout";
import { colors, fonts, radius, space, text } from "@/lib/theme";
import {
  canManageTypes, deleteType, emptyRow, fromTemplate, ITEM_LABEL, itemsOf, loadCheck, loadTemplate, loadToolProjects, loadTypes, OPTIONAL_ITEMS, readDraft,
  saveCheck, saveTemplate, saveType, signedUrls, writeDraft, type ItemKey, type PhotoRef, type TemplateRow, type ToolProject, type ToolRow, type ToolType,
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

const rowName = (row: ToolRow, index: number) => row.serial.trim() || `Dụng cụ #${index + 1} (chưa có tên)`;

export default function ToolCheckScreen() {
  const toast = useToast();
  const today = todayISO();
  const [projects, setProjects] = useState<ToolProject[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [types, setTypes] = useState<ToolType[]>([]);
  const [manager, setManager] = useState(false);
  const [date, setDate] = useState(today);
  const [checkedBy, setCheckedBy] = useState("");
  const [rows, setRows] = useState<ToolRow[]>([]);
  const [template, setTemplate] = useState<TemplateRow[]>([]);
  const [savedBefore, setSavedBefore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [flow, setFlow] = useState<Flow | null>(null);
  const [cellMenu, setCellMenu] = useState<Slot | null>(null);
  const [typePickerFor, setTypePickerFor] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [askTemplate, setAskTemplate] = useState(false);
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

  // Đổi dự án / ngày: ưu tiên bản nháp trên máy, rồi phiếu đã lưu, còn không thì để trống (hỏi dùng mẫu)
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    ready.current = false;
    setLoading(true); setRows([]); setUrls({});
    void (async () => {
      try {
        const [draft, saved, tpl] = await Promise.all([readDraft(projectId, date), loadCheck(projectId, date), loadTemplate(projectId)]);
        if (!active) return;
        setTemplate(tpl);
        setSavedBefore(Boolean(saved));
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
  }, [projectId, date, toast]);

  // Lưu nháp trên máy mỗi khi sửa
  useEffect(() => {
    if (!projectId || !ready.current) return;
    const timer = setTimeout(() => { void writeDraft(projectId, date, rows.length ? { checkedBy, rows } : null); }, 400);
    return () => clearTimeout(timer);
  }, [rows, checkedBy, projectId, date]);

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

  // Cách 1: chụp lần lượt (của một dụng cụ khi bấm vào tên, hoặc mọi ô còn thiếu)
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

  const save = async () => {
    if (!project) return;
    if (!rows.length) { toast("Chưa có dụng cụ nào.", "warn"); return; }
    if (noName) { toast(`Còn ${noName} dòng chưa nhập Serial/Code.`, "err"); return; }
    if (!checkedBy.trim()) { toast("Nhập người kiểm tra (Checked by).", "err"); return; }
    setBusy("Đang lưu…");
    try {
      const saved = await saveCheck(project.projectId, date, checkedBy, rows, types, (done, total) => setBusy(total ? `Đang tải ảnh ${done}/${total}…` : "Đang lưu…"));
      setRows(saved);
      await writeDraft(project.projectId, date, null);
      void AsyncStorage.setItem(LAST_CHECKER, checkedBy.trim()).catch(() => undefined);
      setUrls(await signedUrls(saved.flatMap((r) => Object.values(r.photos).map((p) => p?.path).filter((p): p is string => Boolean(p)))).catch(() => urls));
      setSavedBefore(true);
      toast(`Đã lưu phiếu kiểm tra ${rows.length} dụng cụ${ngCount ? ` (${ngCount} NG)` : ""}${missing.length ? `, còn ${missing.length} ô chưa có ảnh` : ""}.`, missing.length ? "warn" : "ok");
      // Lần đầu (dự án chưa có mẫu): hỏi có chuyển thành dữ liệu mẫu không
      if (!template.length) setAskTemplate(true);
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
      setTemplate(rows.filter((r) => r.serial.trim()).map((r) => ({ serial: r.serial.trim(), subcon: r.subcon.trim(), typeId: r.typeId })));
      toast("Đã lưu làm dữ liệu mẫu. Ngày sau bấm “Dùng dữ liệu mẫu” để nhập theo danh sách này.", "ok");
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

  return (
    <Screen title="Kiểm tra dụng cụ" subtitle="Tool & machine check · Electrical" onBack={() => router.back()}
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
          <Pressable onPress={() => setDate(addDays(date, -1))} style={styles.dateBtn} accessibilityLabel="Ngày trước"><Text style={styles.dateArrow}>‹</Text></Pressable>
          <View style={styles.flexCenter}><Text style={styles.small}>Ngày kiểm tra</Text><Text style={styles.dateText}>{dayLabel(date)}</Text></View>
          <Pressable onPress={() => date < today && setDate(addDays(date, 1))} style={[styles.dateBtn, date >= today && styles.dim]} accessibilityLabel="Ngày sau"><Text style={styles.dateArrow}>›</Text></Pressable>
        </View>
        <Text style={styles.label}>Người kiểm tra (Checked by)</Text>
        <TextInput style={styles.input} value={checkedBy} onChangeText={setCheckedBy} placeholder="vd: P.TRUNG" autoCapitalize="characters" />
        {savedBefore ? <Text style={styles.ok}>Ngày này đã có phiếu, sửa rồi bấm Lưu để ghi đè.</Text> : null}
      </Card>

      {loading ? <View style={styles.loadingBox}><LogoLoader size={48} stroke={4} variant="light" /></View> : (
        <>
          {!rows.length && (
            <Card style={styles.startCard}>
              <Text style={styles.startTitle}>Bắt đầu phiếu ngày {dayLabel(date)}</Text>
              {template.length ? (
                <>
                  <Text style={styles.muted}>Dự án đã có dữ liệu mẫu {template.length} dụng cụ. Dùng mẫu để không sót máy nào, chỉ cần chụp ảnh và chọn kết quả.</Text>
                  <GradientButton label={`Dùng dữ liệu mẫu (${template.length} dụng cụ)`} onPress={() => setRows(fromTemplate(template))} />
                  <SecondaryButton label="Nhập mới từ đầu" onPress={() => setRows([emptyRow()])} />
                </>
              ) : (
                <>
                  <Text style={styles.muted}>Ngày đầu: nhập từng dụng cụ (Serial/Code, loại), chụp ảnh. Lưu xong app sẽ hỏi có chuyển thành dữ liệu mẫu để các ngày sau dùng lại không.</Text>
                  <GradientButton label="Thêm dụng cụ đầu tiên" onPress={() => setRows([emptyRow()])} />
                </>
              )}
            </Card>
          )}

          {rows.length > 0 && (
            <>
              <SectionTitle right={<Text style={styles.muted}>{rows.length} dụng cụ · thiếu {missing.length} ảnh</Text>}>Danh sách dụng cụ</SectionTitle>
              <Text style={styles.hint}>Bấm vào <Text style={styles.bold}>tên dụng cụ</Text> để chụp lần lượt các mục của máy đó, hoặc bấm vào <Text style={styles.bold}>từng ô</Text> để chụp / chọn ảnh cho ô đó.</Text>
              {missing.length > 0 && <SecondaryButton label={`Chụp lần lượt ${missing.length} ô còn thiếu`} icon={<Glyph name="camera" size={18} color={colors.skyDeep} fillOpacity={0.15} />} onPress={() => startSequence(missing)} />}
              {rows.map((row, index) => {
                const rowItems = itemsOf(row, types);
                const type = types.find((t) => t.id === row.typeId);
                return (
                  <Card key={row.key} style={row.result === "NG" ? [styles.rowCard, styles.rowNg] : styles.rowCard}>
                    <Pressable onPress={() => sequenceForRow(row)} style={styles.rowHead} accessibilityRole="button" accessibilityLabel={`Chụp lần lượt ${rowName(row, index)}`}>
                      <Text style={styles.rowNo}>{index + 1}</Text>
                      <Text style={styles.rowTitle} numberOfLines={2}>{rowName(row, index)}</Text>
                      <Glyph name="camera" size={20} color={colors.orange} fillOpacity={0.2} />
                    </Pressable>
                    <View style={styles.fieldRow}>
                      <View style={styles.flex2}><Text style={styles.label}>Serial/Code</Text><TextInput style={styles.input} value={row.serial} onChangeText={(v) => patchRow(row.key, { serial: v })} placeholder="vd: MÁY CẮT BÀN 01" autoCapitalize="characters" /></View>
                      <View style={styles.flex1}><Text style={styles.label}>Sub con.</Text><TextInput style={styles.input} value={row.subcon} onChangeText={(v) => patchRow(row.key, { subcon: v })} placeholder="TNM" autoCapitalize="characters" /></View>
                    </View>
                    <Pressable onPress={() => setTypePickerFor(row.key)} style={styles.typeBtn} accessibilityRole="button">
                      <Text style={styles.label}>Loại</Text>
                      <Text style={styles.typeText} numberOfLines={1}>{type?.name ?? "Chọn loại (mặc định chỉ kiểm tra bên ngoài)"}</Text>
                    </Pressable>
                    <View style={styles.cells}>
                      {rowItems.map((item) => {
                        const photo = row.photos[item];
                        const src = photo?.uri ?? (photo?.path ? urls[photo.path] : undefined);
                        return (
                          <Pressable key={item} onPress={() => setCellMenu({ rowKey: row.key, item })} style={[styles.cell, !photo && styles.cellEmpty]} accessibilityRole="button" accessibilityLabel={`Ảnh ${ITEM_LABEL[item].en}`}>
                            {src ? <Image source={{ uri: src }} style={styles.cellImg} contentFit="cover" /> : <Glyph name="camera" size={24} color={colors.faint} fillOpacity={0.1} />}
                            <Text style={[styles.cellLabel, src ? styles.cellLabelOn : undefined]} numberOfLines={2}>{ITEM_LABEL[item].vi}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <View style={styles.resultRow}>
                      <Text style={styles.label}>Result</Text>
                      <View style={styles.segment}>
                        {(["OK", "NG"] as const).map((value) => (
                          <Pressable key={value} onPress={() => patchRow(row.key, { result: value })} style={[styles.seg, row.result === value && (value === "OK" ? styles.segOk : styles.segNg)]} accessibilityRole="button" accessibilityState={{ selected: row.result === value }}>
                            <Text style={[styles.segText, row.result === value && styles.segTextOn]}>{value}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <Pressable onPress={() => setRows((list) => list.filter((r) => r.key !== row.key))} hitSlop={8} accessibilityLabel="Bỏ dụng cụ"><Glyph name="trash" size={20} color={colors.rose} fillOpacity={0.12} /></Pressable>
                    </View>
                    {row.result === "NG" && <TextInput style={styles.input} value={row.note} onChangeText={(v) => patchRow(row.key, { note: v })} placeholder="Lỗi gì? (vd: dây nguồn bị nứt vỏ)" />}
                  </Card>
                );
              })}
              <SecondaryButton label="Thêm dụng cụ" icon={<Glyph name="add" size={18} color={colors.skyDeep} fillOpacity={0} />} onPress={() => setRows((list) => [...list, emptyRow(list.at(-1)?.subcon || "TNM", list.at(-1)?.typeId ?? null)])} />
              <GradientButton label="Lưu phiếu kiểm tra" busy={Boolean(busy)} busyLabel={busy ?? "Đang lưu…"} onPress={() => void save()} />
              {savedBefore && <SecondaryButton label={template.length ? "Cập nhật dữ liệu mẫu theo danh sách này" : "Lưu làm dữ liệu mẫu"} onPress={() => setAskTemplate(true)} />}
            </>
          )}
        </>
      )}

      <PickerSheet visible={picking} title="Chọn dự án" placeholder="Tìm mã, tên dự án" items={items} selectedId={projectId} emptyText="Không có dự án"
        onSelect={(item) => { setPicking(false); setProjectId(item.id); void AsyncStorage.setItem(LAST_PROJECT, item.id).catch(() => undefined); }} onClose={() => setPicking(false)} />

      <PickerSheet visible={typeRow !== null} title="Loại dụng cụ" placeholder="Tìm loại" selectedId={typeRow?.typeId ?? null} emptyText="Chưa có loại nào. Người quản lý đặt ở nút ⚙ trên cùng."
        items={types.map((t) => ({ id: t.id, title: t.name, subtitle: ["Bên ngoài", ...t.items.map((k) => ITEM_LABEL[k].vi)].join(" · "), icon: "box", tone: "navy" }))}
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
          <FlowView flow={flow} title={flowRow ? rowName(flowRow, flowRowIndex) : ""} subcon={flowRow?.subcon ?? ""} item={flowSlot.item}
            onShoot={() => void flowShoot()} onSkip={() => flowNext(false)} onSave={() => flowNext(true)} onStop={() => setFlow(null)}
            onRetake={() => void flowShoot()} />
        )}
      </Modal>

      <Sheet visible={askTemplate} onClose={() => setAskTemplate(false)} title="Chuyển thành dữ liệu mẫu?">
        <Text style={styles.muted}>Lưu danh sách {rows.filter((r) => r.serial.trim()).length} dụng cụ (Serial/Code, Sub con., loại) làm mẫu của dự án. Ngày sau mở phiếu mới chỉ cần bấm “Dùng dữ liệu mẫu” rồi chụp ảnh, tránh sót máy. Ảnh và kết quả không lưu vào mẫu.</Text>
        <GradientButton label="Có, dùng làm mẫu" onPress={() => void makeTemplate()} />
        <SecondaryButton label="Không" onPress={() => setAskTemplate(false)} />
      </Sheet>

      <TypeSetup visible={setupOpen} types={types} onClose={() => setSetupOpen(false)} onChanged={async () => setTypes(await loadTypes().catch(() => types))} />
    </Screen>
  );
}

/** Màn chụp toàn màn hình: intro (tiếp theo là gì) → preview (xem ảnh to, Chụp lại / Lưu). */
function FlowView({ flow, title, subcon, item, onShoot, onSkip, onSave, onStop, onRetake }: {
  flow: Flow; title: string; subcon: string; item: ItemKey; onShoot: () => void; onSkip: () => void; onSave: () => void; onStop: () => void; onRetake: () => void;
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
          {subcon ? <Text style={styles.flowSub}>Sub con.: {subcon}</Text> : null}
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
    try { await saveType(editing); await onChanged(); setEditing(null); toast("Đã lưu loại dụng cụ.", "ok"); } catch (error) { toast(errorText(error), "err"); } finally { setBusy(false); }
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
            <Pressable key={t.id} onPress={() => setEditing({ id: t.id, name: t.name, items: [...t.items], position: types.indexOf(t) + 1 })} style={styles.typeItem} accessibilityRole="button">
              <Text style={styles.typeItemName}>{t.name}</Text>
              <Text style={styles.muted}>{["Bên ngoài", ...t.items.map((k) => ITEM_LABEL[k].vi)].join(" · ")}</Text>
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
  flex1: { flex: 1, minWidth: 0 },
  flex2: { flex: 2, minWidth: 0 },
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
  rowCard: { gap: space.xs },
  rowNg: { borderColor: colors.badLine, backgroundColor: colors.badBg },
  rowHead: { flexDirection: "row", alignItems: "center", gap: space.xs, paddingVertical: space.xxs },
  rowNo: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.navy, color: "#fff", textAlign: "center", lineHeight: 28, fontSize: text.caption, fontFamily: fonts.bold, overflow: "hidden" },
  rowTitle: { flex: 1, fontSize: text.body, lineHeight: 22, fontFamily: fonts.bold, color: colors.navy, textDecorationLine: "underline" },
  fieldRow: { flexDirection: "row", gap: space.xs },
  typeBtn: { borderRadius: radius.control, borderWidth: 1, borderColor: colors.fieldLine, backgroundColor: colors.field, paddingHorizontal: space.sm, paddingVertical: space.xxs },
  typeText: { fontSize: text.small, lineHeight: 22, fontFamily: fonts.semibold, color: colors.skyDeep },
  cells: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  cell: { width: "48%", aspectRatio: 4 / 3, borderRadius: radius.control, overflow: "hidden", borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  cellEmpty: { borderStyle: "dashed", borderColor: colors.sky, backgroundColor: colors.skyTint },
  cellImg: { ...StyleSheet.absoluteFill },
  cellLabel: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.bold, color: colors.skyDeep, marginTop: 4, textAlign: "center", paddingHorizontal: 4 },
  cellLabelOn: { position: "absolute", bottom: 0, left: 0, right: 0, marginTop: 0, color: "#fff", backgroundColor: "rgba(11,31,102,0.65)", paddingVertical: 2 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  segment: { flex: 1, flexDirection: "row", borderRadius: radius.pill, backgroundColor: colors.field, borderWidth: 1, borderColor: colors.fieldLine, padding: 3 },
  seg: { flex: 1, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  segOk: { backgroundColor: "#0E9F6E" },
  segNg: { backgroundColor: colors.rose },
  segText: { fontSize: text.small, fontFamily: fonts.bold, color: colors.muted },
  segTextOn: { color: "#fff" },
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
