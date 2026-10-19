import { describe, expect, it } from "vitest";
import { enhancedOutputSize } from "./output";

describe("enhancedOutputSize", () => {
  it("keeps source dimensions for unscaled 1080p GPU output", () => {
    expect(enhancedOutputSize(1920, 1080, 1, "gpu")).toEqual({ width: 1920, height: 1080 });
  });

  it("doubles 1080p to 4K on GPU without stretching", () => {
    expect(enhancedOutputSize(1920, 1080, 2, "gpu")).toEqual({ width: 3840, height: 2160 });
  });

  it("respects portrait orientation and the CPU ceiling", () => {
    expect(enhancedOutputSize(540, 960, 2, "cpu")).toEqual({ width: 1080, height: 1920 });
  });

  it("caps memory-only output at 720p", () => {
    expect(enhancedOutputSize(1920, 1080, 2, "gpu", true)).toEqual({ width: 1280, height: 720 });
  });
});
