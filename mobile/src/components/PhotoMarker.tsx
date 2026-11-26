import { Image } from "expo-image";
import { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Ellipse, Rect } from "react-native-svg";
import { MARK_COLOR, markFromDrag, type MarkShape, type PhotoMark } from "@/lib/inspection";
import { colors, fonts, radius } from "@/lib/theme";

/** Nét khoanh (hình tròn / ô vuông) phủ lên ảnh, tọa độ 0..1. */
export function MarkLayer({ marks, preview }: { marks: readonly PhotoMark[]; preview?: PhotoMark | null }) {
  const all = preview ? [...marks, preview] : marks;
  return (
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none" pointerEvents="none">
      {all.map((m, i) => m.shape === "circle"
        ? <Ellipse key={i} cx={(m.x + m.w / 2) * 100} cy={(m.y + m.h / 2) * 100} rx={(m.w / 2) * 100} ry={(m.h / 2) * 100} fill="none" stroke={m.color ?? MARK_COLOR} strokeWidth={3} vectorEffect="non-scaling-stroke" />
        : <Rect key={i} x={m.x * 100} y={m.y * 100} width={m.w * 100} height={m.h * 100} fill="none" stroke={m.color ?? MARK_COLOR} strokeWidth={3} vectorEffect="non-scaling-stroke" />)}
    </Svg>
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
 * Vẽ hình tròn hoặc ô vuông lên ảnh bằng ngón tay để nhấn mạnh điểm lỗi.
 * Chọn công cụ, kéo trên ảnh; Hoàn tác bỏ nét cuối.
 */
export function PhotoMarker({ uri, marks, onChange }: { uri: string; marks: readonly PhotoMark[]; onChange: (marks: PhotoMark[]) => void }) {
  const [shape, setShape] = useState<MarkShape>("circle");
  const [ratio, setRatio] = useState(4 / 3);
  const [preview, setPreview] = useState<PhotoMark | null>(null);
  const size = useRef({ w: 1, h: 1 });
  const start = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef({ shape, marks, onChange });
  latest.current = { shape, marks, onChange };
  const point = (x: number, y: number) => ({ x: x / size.current.w, y: y / size.current.h });
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { start.current = point(e.nativeEvent.locationX, e.nativeEvent.locationY); },
    onPanResponderMove: (e) => { if (start.current) setPreview(markFromDrag(latest.current.shape, start.current, point(e.nativeEvent.locationX, e.nativeEvent.locationY))); },
    onPanResponderRelease: (e) => {
      const from = start.current; start.current = null; setPreview(null);
      if (!from) return;
      const mark = markFromDrag(latest.current.shape, from, point(e.nativeEvent.locationX, e.nativeEvent.locationY));
      if (mark) latest.current.onChange([...latest.current.marks, mark]);
    },
    onPanResponderTerminate: () => { start.current = null; setPreview(null); },
  }), []);
  return (
    <View style={styles.wrap}>
      <View style={styles.tools}>
        {(["circle", "rect"] as const).map((key) => (
          <Pressable key={key} onPress={() => setShape(key)} style={[styles.tool, shape === key && styles.toolOn]} accessibilityRole="button" accessibilityState={{ selected: shape === key }}>
            <Text style={[styles.toolText, shape === key && styles.toolTextOn]}>{key === "circle" ? "◯ Khoanh tròn" : "▢ Ô vuông"}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => onChange(marks.slice(0, -1))} disabled={!marks.length} style={[styles.tool, !marks.length && styles.dim]} accessibilityRole="button"><Text style={styles.toolText}>↶ Hoàn tác</Text></Pressable>
        <Pressable onPress={() => onChange([])} disabled={!marks.length} style={[styles.tool, !marks.length && styles.dim]} accessibilityRole="button"><Text style={styles.toolText}>Xóa nét</Text></Pressable>
      </View>
      <View style={[styles.frame, { aspectRatio: ratio }]} onLayout={(e) => { size.current = { w: e.nativeEvent.layout.width || 1, h: e.nativeEvent.layout.height || 1 }; }} {...responder.panHandlers}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="fill" onLoad={(e) => { const { width, height } = e.source; if (width && height) setRatio(width / height); }} />
        <MarkLayer marks={marks} preview={preview} />
      </View>
      <Text style={styles.hint}>Kéo ngón tay trên ảnh để khoanh điểm lỗi.</Text>
    </View>
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
  hint: { fontFamily: fonts.medium, fontSize: 12, color: colors.faint },
});
