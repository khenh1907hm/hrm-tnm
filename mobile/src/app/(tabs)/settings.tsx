import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { AppIcon, type IconName } from "@/components/AppIcon";
import { NotificationBell } from "@/components/NotificationBell";
import { Card, FadeSlide, Screen, SectionTitle } from "@/components/Screen";
import { useToast } from "@/components/Toast";
import { Columns } from "@/lib/layout";
import { useSettings, type FlashPref } from "@/lib/settings";
import { colors, fonts, radius, space, text, type Tone } from "@/lib/theme";

function ToggleRow({ icon, tone, title, sub, value, onChange }: { icon: IconName; tone: Tone; title: string; sub: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={styles.row} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <AppIcon name={icon} tone={tone} size={36} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: colors.line, true: colors.orange }} thumbColor="#fff" ios_backgroundColor={colors.line} />
    </Pressable>
  );
}

const FLASH: { value: FlashPref; label: string }[] = [
  { value: "auto", label: "Tự động" },
  { value: "on", label: "Luôn bật" },
  { value: "off", label: "Tắt" },
];

/** Cài đặt trên máy: GPS, camera, thông báo. Lưu trên điện thoại, không ảnh hưởng máy khác. */
export default function SettingsScreen() {
  const toast = useToast();
  const { settings, update, reset } = useSettings();
  return (
    <Screen wide title="Cài đặt" subtitle="Lưu trên máy này" right={<NotificationBell />}>
      <Columns leftFlex={1} left={<>
      <FadeSlide delay={40}><SectionTitle>Điểm danh · Vị trí GPS</SectionTitle></FadeSlide>
      <FadeSlide delay={70}>
        <Card>
          <ToggleRow icon="pin" tone="orange" title="Lấy GPS sẵn khi mở Điểm danh" sub="Bấm chấm công là chụp ảnh ngay, không phải chờ dò vị trí."
            value={settings.gpsWarmup} onChange={(v) => update({ gpsWarmup: v })} />
          <View style={styles.sep} />
          <ToggleRow icon="clock" tone="sky" title="Ưu tiên nhanh" sub="Dùng vị trí vừa đo trong 1 phút, độ chính xác vừa phải. Tắt để luôn đo chính xác cao (chậm hơn)."
            value={settings.gpsFast} onChange={(v) => update({ gpsFast: v })} />
          <View style={styles.sep} />
          <ToggleRow icon="task" tone="navy" title="Nhớ công trường lần trước" sub="Mở app là chọn sẵn công trường bạn chấm gần nhất."
            value={settings.rememberSite} onChange={(v) => update({ rememberSite: v })} />
        </Card>
      </FadeSlide>

      </>} right={<>
      <FadeSlide delay={110}><SectionTitle>Camera điểm danh</SectionTitle></FadeSlide>
      <FadeSlide delay={140}>
        <Card>
          <View style={styles.row}>
            <AppIcon name="flash" tone="orange" size={36} />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Đèn khi chụp ảnh</Text>
              <Text style={styles.rowSub}>Tự động: chỗ tối thì màn hình sáng lên làm đèn. Có thể đổi nhanh ngay trong camera.</Text>
            </View>
          </View>
          <View style={styles.segment} accessibilityRole="radiogroup">
            {FLASH.map((option) => {
              const on = settings.flash === option.value;
              return (
                <Pressable key={option.value} onPress={() => update({ flash: option.value })} style={[styles.segItem, on && styles.segOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                  <Text style={[styles.segText, on && styles.segTextOn]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.sep} />
          <ToggleRow icon="camera" tone="rose" title="Ảnh giống lúc xem trước" sub="Giữ ảnh như soi gương, không bị lật ngược trái – phải sau khi chụp."
            value={settings.mirrorSelfie} onChange={(v) => update({ mirrorSelfie: v })} />
        </Card>
      </FadeSlide>

      <FadeSlide delay={180}><SectionTitle>Thông báo</SectionTitle></FadeSlide>
      <FadeSlide delay={210}>
        <Card>
          <View style={styles.row}>
            <AppIcon name="bell" tone="sky" size={36} />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Thông báo đẩy trên điện thoại</Text>
              <Text style={styles.rowSub}>Nhận báo phiếu cần ký, nhắc chấm công… ngay cả khi không mở app. Hiện xem ở nút chuông.</Text>
            </View>
            <Text style={styles.soon}>Sắp có</Text>
          </View>
        </Card>
      </FadeSlide>

      </>} />

      <FadeSlide delay={250} from="up">
        <Pressable onPress={() => { reset(); toast("Đã đưa cài đặt về mặc định.", "ok"); }} style={styles.reset} accessibilityRole="button">
          <Text style={styles.resetText}>Khôi phục mặc định</Text>
        </Pressable>
      </FadeSlide>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: text.small, lineHeight: 20, fontFamily: fonts.bold, color: colors.navy },
  rowSub: { fontSize: text.caption, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
  sep: { height: 1, backgroundColor: colors.line, marginLeft: 48 },
  segment: { flexDirection: "row", backgroundColor: colors.field, borderRadius: radius.control, padding: space.xxs, borderWidth: 1, borderColor: colors.fieldLine },
  segItem: { flex: 1, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: "#fff", shadowColor: "#0B1F66", shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  segText: { fontSize: text.caption, fontFamily: fonts.semibold, color: colors.muted },
  segTextOn: { color: colors.orange, fontFamily: fonts.bold },
  soon: { fontSize: 11, fontFamily: fonts.bold, color: colors.skyDeep, backgroundColor: colors.skyTint, borderRadius: radius.pill, paddingHorizontal: space.xs, paddingVertical: 2, overflow: "hidden" },
  reset: { height: 44, alignItems: "center", justifyContent: "center" },
  resetText: { fontSize: text.small, fontFamily: fonts.bold, color: colors.faint },
});
