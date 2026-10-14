import { describe, expect, it } from "vitest";
import { removeWhiteBackground } from "./removeWhiteBackground";

describe("removeWhiteBackground", () => {
  it("removes white pixels and keeps dark ink", () => {
    const result = removeWhiteBackground({ data: new Uint8ClampedArray([255, 255, 255, 255, 80, 70, 60, 255]), width: 2, height: 1 });
    expect(Array.from(result.data)).toEqual([255, 255, 255, 0, 80, 70, 60, 255]);
  });

  it("makes gray pixels partially transparent without mutating input", () => {
    const source = { data: new Uint8ClampedArray([192, 192, 192, 255]), width: 1, height: 1 };
    const result = removeWhiteBackground(source);
    expect(result.data[3]).toBeGreaterThan(0);
    expect(result.data[3]).toBeLessThan(255);
    expect(source.data[3]).toBe(255);
  });
});
