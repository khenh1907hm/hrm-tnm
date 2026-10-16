/** Tiện ích thuần cho Kho Skill AI (không phụ thuộc trình duyệt). */

export const SKILL_BUCKET = "skill-files";
/** Giới hạn của bucket `skill-files` (50 MB). */
export const SKILL_MAX_BYTES = 50 * 1024 * 1024;
export const SKILL_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/** Tên tệp an toàn cho đường dẫn Storage: bỏ dấu, chỉ giữ chữ, số, `.`, `-`, `_`; luôn kết thúc bằng `.zip`. */
export function safeZipName(name: string): string {
  const base = name
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
    .replace(/\.zip$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${base || "skill"}.zip`;
}

export function isZipFile(file: { name: string }): boolean {
  return /\.zip$/i.test(file.name);
}

/** "1,2 MB" / "350 KB" theo cách viết số tiếng Việt. */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Đường dẫn trong bucket của mọi ảnh trong bài, dựa vào tiền tố URL công khai của bucket. */
export function imagePathsInHtml(html: string, publicPrefix: string): string[] {
  const paths: string[] = [];
  for (const match of html.matchAll(/src="([^"]+)"/g)) {
    const src = match[1]!.replace(/&amp;/g, "&");
    if (src.startsWith(publicPrefix)) paths.push(decodeURIComponent(src.slice(publicPrefix.length).split("?")[0]!));
  }
  return [...new Set(paths)];
}
