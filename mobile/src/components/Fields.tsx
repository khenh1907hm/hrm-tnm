import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, fonts, radius } from "@/lib/theme";
import { fold } from "./PickerSheet";

/** Ô số có nút − / +, bước tùy chọn (vd 0,5 giờ). `null` = để trống. */
export function NumberField({ label, value, onChange, step = 1, accent = false }: { label: string; value: number | null; onChange: (value: number | null) => void; step?: number; accent?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value === null ? "" : String(value).replace(".", ","));
  const bump = (delta: number) => { setText(null); onChange(Math.max(0, Math.round(((value ?? 0) + delta) * 10) / 10)); };
  return (
    <View style={styles.numBox}>
      <Text style={styles.numLabel} numberOfLines={1}>{label}</Text>
      <View style={[styles.numRow, accent && styles.numRowAccent]}>
        <Pressable onPress={() => bump(-step)} hitSlop={6} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`Giảm ${label}`}><Text style={styles.stepText}>−</Text></Pressable>
        <TextInput
          value={shown}
          onChangeText={(next) => {
            setText(next);
            const cleaned = next.replace(",", ".").trim();
            if (!cleaned) { onChange(null); return; }
            const parsed = Number(cleaned);
            if (Number.isFinite(parsed) && parsed >= 0) onChange(parsed);
          }}
          onBlur={() => setText(null)}
          keyboardType="decimal-pad"
          style={styles.numInput}
          placeholder="0"
          placeholderTextColor={colors.faint}
          accessibilityLabel={label}
          selectTextOnFocus
        />
        <Pressable onPress={() => bump(step)} hitSlop={6} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`Tăng ${label}`}><Text style={styles.stepText}>+</Text></Pressable>
      </View>
    </View>
  );
}

/** Ô chữ có nhãn. */
export function TextField({ label, value, onChange, placeholder, multiline, suggestions }: { label?: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; suggestions?: string[] }) {
  const [focused, setFocused] = useState(false);
  const matches = useMemo(() => {
    if (!suggestions?.length || !focused) return [];
    const q = fold(value.trim());
    return suggestions.filter((s) => s !== value && (!q || fold(s).includes(q))).slice(0, 5);
  }, [suggestions, value, focused]);
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        multiline={multiline}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        style={[styles.input, multiline && styles.inputMulti, focused && styles.inputFocused]}
        accessibilityLabel={label ?? placeholder}
      />
      {matches.length > 0 && (
        <View style={styles.suggest}>
          {matches.map((name) => (
            <Pressable key={name} onPress={() => onChange(name)} style={styles.suggestChip}><Text style={styles.suggestText}>{name}</Text></Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/** Danh sách tên dạng thẻ: gõ tên rồi Enter / bấm gợi ý để thêm, bấm ✕ để bỏ. */
export function NameChips({ label, names, onChange, suggestions, placeholder = "Gõ tên rồi bấm Thêm" }: { label: string; names: string[]; onChange: (names: string[]) => void; suggestions: string[]; placeholder?: string }) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const add = (raw: string) => {
    const name = raw.trim();
    if (!name || names.some((n) => fold(n) === fold(name))) { setText(""); return; }
    onChange([...names, name]);
    setText("");
  };
  const matches = useMemo(() => {
    if (!focused && !text) return [];
    const q = fold(text.trim());
    return suggestions.filter((s) => !names.includes(s) && (!q || fold(s).includes(q))).slice(0, 6);
  }, [suggestions, names, text, focused]);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}{names.length ? ` · ${names.length}` : ""}</Text>
      {names.length > 0 && (
        <View style={styles.chips}>
          {names.map((name) => (
            <Pressable key={name} onPress={() => onChange(names.filter((n) => n !== name))} style={styles.chip} accessibilityLabel={`Bỏ ${name}`}>
              <Text style={styles.chipText}>{name}</Text><Text style={styles.chipX}>✕</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.addRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => add(text)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          returnKeyType="done"
          blurOnSubmit={false}
          style={[styles.input, styles.addInput, focused && styles.inputFocused]}
          accessibilityLabel={label}
        />
        <Pressable onPress={() => add(text)} style={styles.addBtn} accessibilityRole="button"><Text style={styles.addText}>Thêm</Text></Pressable>
      </View>
      {matches.length > 0 && (
        <View style={styles.suggest}>
          {matches.map((name) => (
            <Pressable key={name} onPress={() => add(name)} style={styles.suggestChip}><Text style={styles.suggestText}>+ {name}</Text></Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  numBox: { flex: 1, minWidth: 88, gap: 4 },
  numLabel: { fontSize: 12, lineHeight: 16, fontFamily: fonts.bold, color: colors.muted, textAlign: "center" },
  numRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.field, borderWidth: 1.5, borderColor: colors.fieldLine, borderRadius: radius.control, height: 40, overflow: "hidden" },
  numRowAccent: { backgroundColor: "#FFF6EE", borderColor: "#FFD2B0" },
  stepBtn: { width: 32, height: "100%", alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 20, lineHeight: 24, color: colors.skyDeep, fontFamily: fonts.bold },
  numInput: { flex: 1, minWidth: 0, textAlign: "center", fontSize: 16, fontFamily: fonts.black, color: colors.navy, paddingVertical: 0 },
  field: { gap: 4 },
  fieldLabel: { fontSize: 12, lineHeight: 16, fontFamily: fonts.bold, color: colors.navy },
  input: { minHeight: 40, borderRadius: radius.control, borderWidth: 1.5, borderColor: colors.fieldLine, backgroundColor: colors.field, paddingHorizontal: 12, fontSize: 14, fontFamily: fonts.medium, color: colors.navy },
  inputMulti: { minHeight: 64, paddingTop: 8, textAlignVertical: "top" },
  inputFocused: { borderColor: colors.sky, backgroundColor: "#fff" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, height: 28, backgroundColor: colors.skyTint, borderRadius: 999, paddingLeft: 12, paddingRight: 8 },
  chipText: { fontSize: 12, lineHeight: 16, fontFamily: fonts.semibold, color: colors.navy },
  chipX: { fontSize: 10, color: colors.skyDeep, fontFamily: fonts.bold },
  addRow: { flexDirection: "row", gap: 8 },
  addInput: { flex: 1 },
  addBtn: { height: 40, paddingHorizontal: 16, borderRadius: radius.control, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  addText: { color: "#fff", fontSize: 14, lineHeight: 20, fontFamily: fonts.bold },
  suggest: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  suggestChip: { height: 28, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: "#FFD2B0", backgroundColor: "#FFF6EE", paddingHorizontal: 12 },
  suggestText: { fontSize: 12, lineHeight: 16, fontFamily: fonts.semibold, color: "#B34700" },
});
