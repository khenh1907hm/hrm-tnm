import type React from "react";
import { Image } from "expo-image";
import { useMemo, useRef, useState } from "react";
import { Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Ellipse, Rect } from "react-native-svg";
import { MARK_COLOR, markFromDrag, type MarkShape, type PhotoMark } from "@/lib/inspection";
import { colors, fonts, radius } from "@/lib/theme";

/** Nét khoanh (hình tròn / ô vuông) phủ lên ảnh, tọa độ 0..1. */
export function MarkLayer({ marks, preview }: { marks: readonly PhotoMark[]; preview?: PhotoMark | null }) {
  const all = preview ? [...marks, preview] : marks;
  // Kích thước điểm ảnh thật của khung: Svg trên web không tự co theo absoluteFill (bị kéo thành hình vuông, nét lệch xuống)
  const [box, setBox] = useState({ w: 0, h: 0 });
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
    {box.w > 0 && box.h > 0 ? <Svg width={box.w} height={box.h} viewBox="0 0 100 100" preserveAspectRatio="none">
      {all.map((m, i) => m.shape === "circle"
        ? <Ellipse key={i} cx={(m.x + m.w / 2) * 100} cy={(m.y + m.h / 2) * 100} rx={(m.w / 2) * 100} ry={(m.h / 2) * 100} fill="none" stroke={m.color ?? MARK_COLOR} strokeWidth={3} vectorEffect="non-scaling-stroke" />
        : <Rect key={i} x={m.x * 100} y={m.y * 100} width={m.w * 100} height={m.h * 100} fill="none" stroke={m.color ?? MARK_COLOR} strokeWidth={3} vectorEffect="non-scaling-stroke" />)}
    </Svg> : null}
    </View>
  );
}

/** Ảnh kèm nét khoanh (xem). Tỉ lệ khung theo ảnh. */
export function MarkedPhoto({ uri, marks, onPress }: { uri: string | undefined; marks: readonly PhotoMark[]; onPress?: () => void }) {
  const [ratio, setRatio] = useState(4 / 3);
  if (!uri) return <View style={[styles.empty]}><Text style={styles.emptyText}>Chưa có ảnh</Text></View>;
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[styles.frame, { aspectRatio: ratio }]} accessibilityRole={onPress ? "button" : "image"}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="fill" onLoad={(e) => { const { width, height } = e.source; if (width && height) setRatio(width / height); }} />
      <MarkLayer marks={marks} />
    </Pressable>
  );
}

/**
 * Khung vẽ toàn màn hình, cố định (không cuộn): chọn Khoanh tròn / Ô vuông, kéo ngón tay trên ảnh.
 * Tọa độ tính theo vị trí khung ảnh trên màn hình (đo lúc chạm), nên hình bắt đầu đúng chỗ đầu ngón tay.
 */
export function PhotoMarker({ uri, marks, onChange, onClose }: { uri: string; marks: readonly PhotoMark[]; onChange: (marks: PhotoMark[]) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [shape, setShape] = useState<MarkShape>("circle");
  const [ratio, setRatio] = useState(4 / 3);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [draft, setDraft] = useState<PhotoMark[]>(() => [...marks]);
  const [preview, setPreview] = useState<PhotoMark | null>(null);
  const frame = useRef<React.ComponentRef<typeof View>>(null);
  const origin = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef({ shape, draft });
  latest.current = { shape, draft };
  const toPoint = (pageX: number, pageY: number) => {
    const o = origin.current;
    if (!o) return null;
    return { x: Math.min(1, Math.max(0, (pageX - o.x) / o.w)), y: Math.min(1, Math.max(0, (pageY - o.y) / o.h)) };
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (_e, g) => {
      const x0 = g.x0, y0 = g.y0;
      start.current = toPoint(x0, y0);
      // Đo lại vị trí khung lúc chạm (phòng khi xoay màn hình / bàn phím), rồi tính lại điểm đầu
      frame.current?.measureInWindow((x, y, w, h) => {
        origin.current = { x, y, w: w || 1, h: h || 1 };
        start.current = toPoint(x0, y0);
      });
    },
    onPanResponderMove: (_e, g) => {
      const from = start.current, to = toPoint(g.moveX, g.moveY);
      if (from && to) setPreview(markFromDrag(latest.current.shape, from, to));
    },
    onPanResponderRelease: (_e, g) => {
      const from = start.current; start.current = null; setPreview(null);
      if (!from || (Math.abs(g.dx) < 4 && Math.abs(g.dy) < 4)) return;
      const to = toPoint(g.moveX, g.moveY);
      const mark = to ? markFromDrag(latest.current.shape, from, to) : null;
      if (mark) setDraft([...latest.current.draft, mark]);
    },
    onPanResponderTerminate: () => { start.current = null; setPreview(null); },
  }), []);
  // Ảnh vừa khít vùng còn trống, giữ tỉ lệ
  const fit = area.w && area.h ? (area.w / area.h > ratio ? { width: area.h * ratio, height: area.h } : { width: area.w, height: area.w / ratio }) : null;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} presentationStyle="fullScreen" statusBarTranslucent>
      <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.tools}>
          {(["circle", "rect"] as const).map((key) => (
            <Pressable key={key} onPress={() => setShape(key)} style={[styles.tool, shape === key && styles.toolOn]} accessibilityRole="button" accessibilityState={{ selected: shape === key }}>
              <Text style={[styles.toolText, shape === key && styles.toolTextOn]}>{key === "circle" ? "◯ Khoanh tròn" : "▢ Ô vuông"}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length} style={[styles.tool, !draft.length && styles.dim]} accessibilityRole="button"><Text style={styles.toolText}>↶ Hoàn tác</Text></Pressable>
          <Pressable onPress={() => setDraft([])} disabled={!draft.length} style={[styles.tool, !draft.length && styles.dim]} accessibilityRole="button"><Text style={styles.toolText}>Xóa nét</Text></Pressable>
        </View>
        <View style={styles.area} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {fit ? (
            <View ref={frame} collapsable={false} onLayout={() => frame.current?.measureInWindow((x, y, w, h) => { origin.current = { x, y, w: w || 1, h: h || 1 }; })} style={[styles.canvas, fit, Platform.OS === "web" ? ({ touchAction: "none", userSelect: "none", cursor: "crosshair" } as object) : null]} {...responder.panHandlers}>
              <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="fill" pointerEvents="none" onLoad={(e) => { const { width, height } = e.source; if (width && height) setRatio(width / height); }} />
              <MarkLayer marks={draft} preview={preview} />
            </View>
          ) : null}
        </View>
        <Text style={styles.hintDark}>Đặt ngón tay ở một góc điểm lỗi rồi kéo sang góc đối diện.</Text>
        <View style={styles.actions}>
          <Pressable onPress={onClose} style={[styles.action, styles.actionGhost]} accessibilityRole="button"><Text style={styles.actionGhostText}>Hủy</Text></Pressable>
          <Pressable onPress={() => { onChange(draft); onClose(); }} style={[styles.action, styles.actionMain]} accessibilityRole="button"><Text style={styles.actionMainText}>Xong ({draft.length} nét)</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  frame: { width: "100%", borderRadius: radius.control, overflow: "hidden", backgroundColor: "#0B1F33" },
  empty: { width: "100%", aspectRatio: 4 / 3, borderRadius: radius.control, borderWidth: 1, borderStyle: "dashed", borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.field },
  emptyText: { fontFamily: fonts.medium, color: colors.faint },
  tools: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tool: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.field, borderWidth: 1, borderColor: colors.fieldLine },
  toolOn: { backgroundColor: colors.rose, borderColor: colors.rose },
  toolText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  toolTextOn: { color: "#fff" },
  dim: { opacity: 0.4 },
  screen: { flex: 1, backgroundColor: "#0B1220", paddingHorizontal: 12, gap: 10 },
  area: { flex: 1, alignItems: "center", justifyContent: "center" },
  canvas: { borderRadius: 8, overflow: "hidden", backgroundColor: "#000" },
  hintDark: { fontFamily: fonts.medium, fontSize: 12, color: "#B8C4DE", textAlign: "center" },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1, height: 48, borderRadius: radius.control, alignItems: "center", justifyContent: "center" },
  actionGhost: { borderWidth: 1, borderColor: "#3A4A6B" },
  actionGhostText: { fontFamily: fonts.semibold, fontSize: 15, color: "#fff" },
  actionMain: { backgroundColor: colors.rose },
  actionMainText: { fontFamily: fonts.bold, fontSize: 15, color: "#fff" },
});
