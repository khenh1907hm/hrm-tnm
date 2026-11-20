import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors, fonts } from "@/lib/theme";

/** Tỷ lệ rộng / cao của ảnh nhân vật (assets/tnm-mascot*.png). */
const RATIO = 187 / 260;
const GREETINGS = ["Xin chào!", "Hello!"];
const TYPE_MS = 110;
const ERASE_MS = 55;
const HOLD_MS = 2200;
const BORDER = 2;

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduce(v); }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduce;
}

/** Gõ lần lượt từng lời chào, giữ một lúc, xóa rồi gõ lời tiếp theo. */
function useTypewriter(words: string[], enabled: boolean) {
  const [text, setText] = useState(enabled ? "" : words[0]);
  useEffect(() => {
    if (!enabled) { setText(words[0]); return; }
    const chars = words.map((w) => Array.from(w.normalize("NFC")));
    let word = 0, len = 0, erasing = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const cur = chars[word];
      if (!erasing) {
        len += 1;
        setText(cur.slice(0, len).join(""));
        if (len >= cur.length) { erasing = true; timer = setTimeout(tick, HOLD_MS); return; }
        timer = setTimeout(tick, TYPE_MS);
      } else {
        len -= 1;
        setText(cur.slice(0, Math.max(len, 0)).join(""));
        if (len <= 0) { erasing = false; word = (word + 1) % chars.length; timer = setTimeout(tick, 400); return; }
        timer = setTimeout(tick, ERASE_MS);
      }
    };
    timer = setTimeout(tick, 500);
    return () => clearTimeout(timer);
  }, [words, enabled]);
  return text;
}

/**
 * Nhân vật TNM giơ tay chào ở cuối màn đăng nhập (đứng yên), bong bóng thoại gõ chữ "Xin chào!" / "Hello!".
 * Máy bật "Giảm chuyển động" thì hiện sẵn "Xin chào!", không gõ chữ.
 */
export function Mascot({ height }: { height: number }) {
  const reduce = useReduceMotion();
  const text = useTypewriter(GREETINGS, !reduce);
  const caret = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduce) return;
    const blink = Animated.loop(Animated.sequence([
      Animated.timing(caret, { toValue: 0, duration: 450, useNativeDriver: true }),
      Animated.timing(caret, { toValue: 1, duration: 450, useNativeDriver: true }),
    ]));
    blink.start();
    return () => blink.stop();
  }, [reduce, caret]);

  const width = Math.round(height * RATIO);
  const fontSize = Math.round(Math.min(20, Math.max(13, height * 0.085)));
  const tailW = Math.round(fontSize * 0.9);
  const tailH = Math.round(fontSize * 0.6);
  const longest = GREETINGS.reduce((a, b) => (b.length > a.length ? b : a));

  return (
    <View style={[styles.wrap, { width, height }]}accessible accessibilityRole="image" accessibilityLabel="Nhân vật Thiên Nhật Minh chào bạn">
      <Image source={require("../../assets/tnm-mascot.png")} style={{ width, height }} contentFit="contain" transition={0} priority="high" />

      {/* Khung rộng cố định để bong bóng co theo chữ, không bị bẻ dòng vì nhân vật hẹp. */}
      <View pointerEvents="none" style={{ position: "absolute", left: width * 0.86, top: height * 0.04, width: fontSize * 12, alignItems: "flex-start" }}>
      <View style={[styles.bubble, { paddingHorizontal: fontSize * 0.8, paddingVertical: fontSize * 0.4, borderRadius: fontSize * 1.2 }]}>
        {/* Chữ dài nhất ẩn để giữ cố định kích thước bong bóng khi đang gõ. */}
        <Text style={[styles.text, { fontSize, lineHeight: fontSize * 1.35, opacity: 0 }]} numberOfLines={1}>{longest}{" | "}</Text>
        {/* Chữ đang gõ không bị kẹp bề ngang nên không bao giờ bị cắt "…". */}
        <View style={[styles.typed, { left: fontSize * 0.8 }]}>
          <Text style={[styles.text, { fontSize, lineHeight: fontSize * 1.35 }]}>{text}</Text>
          {!reduce && <Animated.Text style={[styles.text, styles.caret, { fontSize, lineHeight: fontSize * 1.35, opacity: caret }]}>|</Animated.Text>}
        </View>
      </View>
      {/* Đuôi nằm ngay DƯỚI bong bóng (không định vị %, không đè lên chữ), kéo lên đúng bằng viền để che đoạn viền đáy. */}
      <Svg width={tailW} height={tailH + BORDER} style={{ marginTop: -BORDER, marginLeft: fontSize * 0.7 }}>
        <Path d={`M0 0 H${tailW} V${BORDER} L${tailW * 0.15} ${tailH + BORDER} L0 ${BORDER} Z`} fill="#fff" />
        <Path d={`M${BORDER / 2} ${BORDER / 2} L${tailW * 0.15} ${tailH + BORDER / 2} L${tailW - BORDER / 2} ${BORDER / 2}`} stroke={colors.navy} strokeWidth={BORDER} strokeLinejoin="round" strokeLinecap="round" fill="none" />
        <Path d={`M${BORDER} 0 H${tailW - BORDER} V${BORDER} H${BORDER} Z`} fill="#fff" />
      </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "center" },
  bubble: {
    backgroundColor: "#fff", borderWidth: BORDER, borderColor: colors.navy,
    // Không dùng elevation: trên Android nó vẽ bong bóng đè lên đuôi.
    shadowColor: colors.navy, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  typed: { position: "absolute", top: 0, bottom: 0, flexDirection: "row", alignItems: "center" },
  text: { fontFamily: fonts.bold, color: colors.navy },
  caret: { color: colors.skyDeep },
});
