import { describe, expect, it } from "vitest";
import {
  createClipCheckOffsets,
  createCandidateClipStarts,
  calibrateIdentityThreshold,
  createSampleTimes,
  createVerifiedClipSample,
  selectSceneMatches,
  validateClipChecks,
  visualHashDistance,
} from "./pipeline";
import type { ScanSample } from "./types";

function sample(timestamp: number, overrides: Partial<ScanSample> = {}): ScanSample {
  return {
    timestamp,
    similarity: 0.65,
    weakestSimilarity: 0.6,
    referenceHits: 3,
    faceCount: 1,
    faceQuality: 0.8,
    ...overrides,
  };
}

describe("strict clip validation", () => {
  it("anchors a clip at the matched frame instead of centering it before the face appears", () => {
    const [scene] = selectSceneMatches([sample(12)], 1, 5, 60, 0.52);
    expect(scene.start).toBe(12);
    expect(scene.end).toBe(17);
  });

  it("checks the opening instant and the full selected duration", () => {
    const offsets = createClipCheckOffsets(5);
    expect(offsets[0]).toBeLessThan(0.1);
    expect(offsets[1]).toBeLessThanOrEqual(0.3);
    expect(offsets.at(-1)).toBeGreaterThan(4.8);
    expect(offsets.length).toBeGreaterThanOrEqual(7);
  });

  it("requires the face at the opening and through most of the clip", () => {
    const intermittentMisses = Array.from({ length: 8 }, (_, index) => sample(10 + index, [4, 7].includes(index) ? { similarity: 0.2, referenceHits: 0 } : {}));
    const openingMiss = intermittentMisses.map((item, index) => index === 0 ? sample(10, { similarity: 0.2, referenceHits: 0 }) : item);
    expect(validateClipChecks(intermittentMisses, 0.52)).toMatchObject({ accepted: true, passing: 6, total: 8 });
    expect(validateClipChecks(openingMiss, 0.52).accepted).toBe(false);
  });

  it("does not let tolerated missed checks poison an otherwise verified clip", () => {
    const checks = Array.from({ length: 8 }, (_, index) => sample(
      10 + index,
      [4, 7].includes(index)
        ? { similarity: 0, weakestSimilarity: 0, referenceHits: 0, faceQuality: 0 }
        : {},
    ));
    const verified = createVerifiedClipSample(checks, 0.52, 10);
    expect(verified).not.toBeNull();
    expect(verified?.weakestSimilarity).toBe(0.6);
    expect(verified?.faceQuality).toBe(0.8);
    expect(selectSceneMatches([verified!], 1, 5, 60, 0.52)).toHaveLength(1);
  });

  it("samples a forty-minute source frequently without exceeding the memory bound", () => {
    const times = createSampleTimes(40 * 60, 5);
    expect(times.length).toBeGreaterThanOrEqual(1500);
    expect(times.length).toBeLessThanOrEqual(2400);
  });

  it("searches for a complete clip window around a coarse candidate", () => {
    expect(createCandidateClipStarts(20, 5, 60)).toEqual([16.25, 17.5, 18.75, 20]);
  });

  it("calibrates a fixed threshold against the actual reference set", () => {
    expect(calibrateIdentityThreshold(0.52, 0.46)).toBeCloseTo(0.32);
    expect(calibrateIdentityThreshold(0.52, 0.9)).toBe(0.52);
    expect(calibrateIdentityThreshold(0.4, 0.32)).toBe(0.26);
  });

  it("removes nearby and visually repeated scenes", () => {
    const firstHash = "0".repeat(64);
    const nearHash = `${"0".repeat(60)}1111`;
    const differentHash = "1".repeat(64);
    const scenes = selectSceneMatches([
      sample(10, { visualHash: firstHash }),
      sample(18, { visualHash: differentHash }),
      sample(50, { visualHash: nearHash }),
      sample(90, { visualHash: differentHash }),
    ], 10, 5, 120, 0.52, { minimumGapSeconds: 30, maximumVisualHashDistance: 10 });
    expect(scenes.map((scene) => scene.start)).toEqual([10, 90]);
    expect(visualHashDistance(firstHash, nearHash)).toBe(4);
  });

  it("prevents one dense timeline section from taking over all results", () => {
    const denseSection = Array.from({ length: 19 }, (_, index) => sample(600 + index * 10, {
      similarity: 0.9 - index * 0.001,
    }));
    const spreadSections = [100, 300, 500, 900, 1200, 1500, 1800, 2100]
      .map((timestamp) => sample(timestamp, { similarity: 0.7 }));
    const scenes = selectSceneMatches(
      [...denseSection, ...spreadSections],
      10,
      5,
      2400,
      0.52,
      {
        minimumGapSeconds: 50,
        timelineBucketSeconds: 96,
        maximumMatchesPerTimelineBucket: 1,
      },
    );
    expect(scenes.filter((scene) => scene.start >= 600 && scene.start < 780)).toHaveLength(3);
    expect(scenes.filter((scene) => scene.start < 600 || scene.start >= 780)).toHaveLength(7);
    expect(scenes.map((scene) => scene.start)).toEqual(expect.arrayContaining([100, 900, 1800]));
  });

  it("allows the same view again when it belongs to a much later scene", () => {
    const repeatedView = "01".repeat(32);
    const scenes = selectSceneMatches([
      sample(10, { visualHash: repeatedView }),
      sample(40, { visualHash: repeatedView }),
      sample(600, { visualHash: repeatedView }),
    ], 3, 5, 900, 0.52, {
      minimumGapSeconds: 1,
      maximumVisualHashDistance: 18,
      visualDuplicateWindowSeconds: 180,
    });
    expect(scenes.map((scene) => scene.start)).toEqual([10, 600]);
  });

  it("excludes the reference-frame neighborhood from result candidates", () => {
    const scenes = selectSceneMatches([sample(20), sample(60)], 10, 5, 120, 0.52, { excludedTimestamps: [18] });
    expect(scenes.map((scene) => scene.start)).toEqual([60]);
  });
});
