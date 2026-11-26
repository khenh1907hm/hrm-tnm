import { router, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppIcon, type IconName } from "@/components/AppIcon";
import { Card, Screen } from "@/components/Screen";
import { useToast } from "@/components/Toast";
import { colors, fonts, type Tone } from "@/lib/theme";

const ITEMS: { icon: IconName; tone: Tone; title: string; sub: string; href?: Href }[] = [
  { icon: "shield", tone: "rose", title: "Báo cáo công trình", sub: "Sếp kiểm tra công trường: chụp lỗi, khoanh, giao trưởng dự án sửa", href: "/inspection" as Href },
  { icon: "box", tone: "sky", title: "Báo cáo thiết bị", sub: "Kiểm tra dụng cụ, máy điện hằng tháng (chọn thiết bị có sẵn)", href: "/tool-check" as Href },
  { icon: "report", tone: "orange", title: "Báo cáo tháng (PowerPoint)", sub: "Gộp các mục thành file PowerPoint, đang chuẩn bị" },
];

/** BÁO CÁO HẰNG THÁNG: Báo cáo công trình, Báo cáo thiết bị; sau này gộp lại thành file PowerPoint. */
export default function MonthlyScreen() {
  const toast = useToast();
  return (
    <Screen title="Báo cáo hằng tháng" subtitle="Công trình · Thiết bị · Báo cáo tháng" onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
      {ITEMS.map((item) => (
        <Pressable key={item.title} onPress={() => (item.href ? router.push(item.href) : toast(`${item.title}: đang chuẩn bị, sẽ có trong bản sau.`, "ok"))} accessibilityRole="button">
          <Card style={styles.card}>
            <AppIcon name={item.icon} tone={item.tone} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.sub}>{item.sub}</Text>
            </View>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  sub: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.faint },
});
