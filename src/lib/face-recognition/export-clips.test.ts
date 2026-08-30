import { describe, expect, it } from "vitest";
import { sceneClipFilename } from "./export-clips";

describe("scene export filenames", () => {
  it("uses simple sequential MP4 names", () => {
    expect(sceneClipFilename(0, "mp4")).toBe("Scene01.mp4");
    expect(sceneClipFilename(24, "mp4")).toBe("Scene25.mp4");
  });

  it("keeps the simple name for the compatibility format", () => {
    expect(sceneClipFilename(2, "webm")).toBe("Scene03.webm");
  });
});
