import { describe, expect, it } from "vitest";
import { applyMatte, fitToPixels, refineAlpha, subjectCoverage } from "./alpha";

describe("background remover alpha", () => {
  it("clears faint matte values and keeps solid ones", () => {
    expect(refineAlpha(5, 0)).toBe(0);
    expect(refineAlpha(255, 0)).toBe(255);
    expect(refineAlpha(128, 0)).toBeGreaterThan(110);
    expect(refineAlpha(128, 0)).toBeLessThan(140);
  });

  it("hardens the edge as the edge setting rises", () => {
    expect(refineAlpha(80, 1)).toBe(0);
    expect(refineAlpha(170, 1)).toBe(255);
    expect(refineAlpha(80, 0)).toBeGreaterThan(0);
  });

  it("writes the matte into a copy of the pixels", () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const output = applyMatte(rgba, new Uint8Array([255, 0]), 0.2);
    expect([...output]).toEqual([10, 20, 30, 255, 40, 50, 60, 0]);
    expect(rgba[7]).toBe(255);
    expect(() => applyMatte(rgba, new Uint8Array([1]), 0)).toThrow();
  });

  it("measures how much of the image is subject", () => {
    expect(subjectCoverage(new Uint8Array([0, 200, 255, 10]))).toBe(0.5);
  });

  it("fits large images into a pixel budget", () => {
    expect(fitToPixels(8000, 6000, 24_000_000)).toEqual({ width: 5657, height: 4243, scaled: true });
    expect(fitToPixels(1200, 800, 24_000_000)).toEqual({ width: 1200, height: 800, scaled: false });
  });
});
