import { describe, expect, it } from "vitest";
import { findContentBounds, removeWhiteBackground, type ImagePixels } from "./removeWhiteBackground";

type Rgb = [number, number, number];

/** Ảnh giả lập ảnh chụp: nền giấy theo toạ độ, rồi vẽ nét mực lên. */
function photo(width: number, height: number, paper: (x: number, y: number) => Rgb, ink: (x: number, y: number) => Rgb | null): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    data.set([...(ink(x, y) ?? paper(x, y)), 255], (y * width + x) * 4);
  }
  return { data, width, height };
}

function pixel(image: ImagePixels, x: number, y: number) {
  const index = (y * image.width + x) * 4;
  return { red: image.data[index]!, green: image.data[index + 1]!, blue: image.data[index + 2]!, alpha: image.data[index + 3]! };
}

const BLACK: Rgb = [40, 40, 45];
const STAMP_RED: Rgb = [200, 40, 50];

// Chữ ký là một nét ngang ở trên, mộc là vòng tròn đỏ ở dưới; nửa phải của ảnh bị bóng tay che tối dần
const signatureWithStamp = () => photo(
  120, 120,
  (x) => { const light = x < 60 ? 245 : 245 - (x - 60) * 1.6; return [light, light * 0.98, light * 0.95]; },
  (x, y) => {
    if (y >= 20 && y <= 22 && x >= 15 && x <= 105) return BLACK;
    const distance = Math.hypot(x - 60, y - 80);
    return distance >= 22 && distance <= 26 ? STAMP_RED : null;
  },
);

describe("removeWhiteBackground", () => {
  it("removes the paper even where a shadow darkens it, keeping the signature stroke", () => {
    const result = removeWhiteBackground(signatureWithStamp());
    expect(pixel(result, 5, 5).alpha).toBe(0);
    expect(pixel(result, 115, 40).alpha).toBe(0); // giấy trong vùng bóng tối
    expect(pixel(result, 60, 80).alpha).toBe(0); // giấy trong lòng con dấu
    expect(pixel(result, 30, 21).alpha).toBe(255);
    expect(pixel(result, 100, 21).alpha).toBe(255); // nét mực nằm trong vùng bóng
    expect(pixel(result, 30, 21).red).toBeLessThan(90);
  });

  it("keeps the red stamp red and opaque", () => {
    const result = removeWhiteBackground(signatureWithStamp());
    for (const [x, y] of [[60, 56], [36, 80], [84, 80], [60, 104]] as const) {
      const { red, green, blue, alpha } = pixel(result, x, y);
      expect(alpha).toBe(255);
      expect(red - green).toBeGreaterThan(100);
      expect(red - blue).toBeGreaterThan(100);
    }
  });

  it("removes yellowed paper and keeps blue ink blue", () => {
    const result = removeWhiteBackground(photo(60, 60, () => [235, 220, 175], (x, y) => (y === 30 && x > 10 && x < 50 ? [30, 45, 150] : null)));
    expect(pixel(result, 5, 5).alpha).toBe(0);
    const ink = pixel(result, 30, 30);
    expect(ink.alpha).toBe(255);
    expect(ink.blue - ink.red).toBeGreaterThan(80);
  });

  it("drops dark areas touching the photo edge (desk around the paper) but keeps the ink inside", () => {
    const result = removeWhiteBackground(photo(80, 80, (x) => (x < 8 ? [60, 55, 50] : [240, 238, 232]), (x, y) => (y === 40 && x > 20 && x < 60 ? BLACK : null)));
    expect(pixel(result, 2, 40).alpha).toBe(0);
    expect(pixel(result, 7, 10).alpha).toBe(0);
    expect(pixel(result, 40, 40).alpha).toBe(255);
  });

  it("does not mutate the input", () => {
    const source = signatureWithStamp();
    const before = Array.from(source.data);
    removeWhiteBackground(source);
    expect(Array.from(source.data)).toEqual(before);
  });

  it("keeps an already transparent PNG (e.g. from an AI tool) transparent instead of making gray pixels opaque again", () => {
    // Điểm xám đã trong suốt hẳn, điểm xám bán trong suốt, nét mực đậm
    const result = removeWhiteBackground({ data: new Uint8ClampedArray([192, 192, 192, 0, 192, 192, 192, 40, 20, 20, 60, 255]), width: 3, height: 1 });
    expect(Array.from(result.data)).toEqual([192, 192, 192, 0, 192, 192, 192, 40, 20, 20, 60, 255]);
  });
});

describe("removeWhiteBackground with force (nút Xóa nền)", () => {
  it("re-cuts an already transparent image: grey haze left by an old cut is removed, ink stays", () => {
    // Ảnh tách nền cũ: nền xám còn mờ (alpha 90) + nét mực đậm, phần còn lại trong suốt hẳn
    const old = photo(60, 60, () => [200, 200, 200], (x, y) => (y === 30 && x > 10 && x < 50 ? [30, 40, 120] : null));
    for (let index = 3; index < old.data.length; index += 4) old.data[index] = index % 8 === 3 ? 90 : 0;
    for (let x = 11; x < 50; x++) old.data[(30 * 60 + x) * 4 + 3] = 255;
    expect(removeWhiteBackground(old).data).toEqual(old.data);
    const result = removeWhiteBackground(old, { force: true });
    expect(pixel(result, 5, 5).alpha).toBe(0);
    expect(pixel(result, 6, 5).alpha).toBe(0);
    expect(pixel(result, 30, 30).alpha).toBe(255);
  });
});

describe("findContentBounds", () => {
  it("crops tightly around the signature and stamp with padding", () => {
    const bounds = findContentBounds(removeWhiteBackground(signatureWithStamp()));
    // Mực nằm trong x 15..105, y 20..106 (điểm đơn lẻ ở đáy vòng mộc bị bỏ như hạt bụi); lề 4% của 90px ≈ 4px
    expect(bounds).toEqual({ x: 11, y: 16, width: 99, height: 94 });
  });

  it("returns null for a blank page", () => {
    expect(findContentBounds(removeWhiteBackground(photo(40, 40, () => [240, 240, 240], () => null)))).toBeNull();
  });
});
