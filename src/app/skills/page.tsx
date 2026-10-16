import type { Metadata } from "next";
import SkillsClient from "./SkillsClient";
import "./skills.css";

export const metadata: Metadata = {
  title: "Kho Skill AI · Thiên Nhật Minh",
  description: "Thư viện gói skill .zip cho Claude, kèm mô tả, ảnh minh họa và hướng dẫn cài đặt.",
};

export default function SkillsPage() {
  return <SkillsClient />;
}
