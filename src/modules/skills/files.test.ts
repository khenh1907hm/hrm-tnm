import { describe, expect, it } from "vitest";
import { formatFileSize, imagePathsInHtml, isZipFile, safeZipName } from "./files";

describe("skill library files", () => {
  it("makes a storage-safe zip name from a Vietnamese file name", () => {
    expect(safeZipName("Xuất hồ sơ Đội 1.zip")).toBe("Xuat-ho-so-Doi-1.zip");
    expect(safeZipName("../../etc.ZIP")).toBe("etc.zip");
    expect(safeZipName("###.zip")).toBe("skill.zip");
  });

  it("accepts only .zip files", () => {
    expect(isZipFile({ name: "skill.ZIP" })).toBe(true);
    expect(isZipFile({ name: "skill.rar" })).toBe(false);
  });

  it("formats sizes the Vietnamese way", () => {
    expect(formatFileSize(1_258_291)).toBe("1,2 MB");
    expect(formatFileSize(300)).toBe("1 KB");
  });

  it("finds bucket image paths in post html, ignoring other sources", () => {
    const prefix = "https://x.supabase.co/storage/v1/object/public/skill-files/";
    const html = `<p>a</p><img src="${prefix}images/a.png"><img src="https://elsewhere/b.png"><img src="${prefix}images/a.png">`;
    expect(imagePathsInHtml(html, prefix)).toEqual(["images/a.png"]);
  });
});
