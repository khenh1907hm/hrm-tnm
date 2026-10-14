export type IdImageMetadata = { name: string; type: string; size: number };
export type IdImageCheck = { valid: IdImageMetadata[]; rejected: { file: IdImageMetadata; reason: "type" | "size" }[] };
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function checkIdImages(files: readonly IdImageMetadata[], remainingSlots = 4): IdImageCheck {
  const valid: IdImageMetadata[] = [];
  const rejected: IdImageCheck["rejected"] = [];
  for (const file of files) {
    if (!imageTypes.has(file.type)) rejected.push({ file, reason: "type" });
    else if (file.size <= 0 || file.size > 10 * 1024 * 1024) rejected.push({ file, reason: "size" });
    else if (valid.length < remainingSlots) valid.push(file);
    else rejected.push({ file, reason: "size" });
  }
  return { valid, rejected };
}
