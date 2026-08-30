import { describe, expect, it } from "vitest";
import {
  createClipCheckOffsets,
  createCandidateClipStarts,
  calibrateIdentityThreshold,
  createSampleTimes,
  createVerifiedClipSample,
  selectSceneMatches,
  validateClipChecks,
  visualFingerprintDistance,
  visualHashDistance,
  visualSceneDistance,
} from "./pipeline";
import type { ScanSample, VisualFingerprint } from "./types";

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

function fingerprint(seed: number, variation = 0): VisualFingerprint {
  const luma = Array.from({ length: 24 * 14 }, (_, index) => (
    ((index * (seed * 2 + 3) + seed * 11) % 31) / 30 + variation * 0.002
  ));
  const histogram = Array.from({ length: 24 }, () => 0);
  histogram[seed % 12] = 1;
  histogram[12 + seed % 6] = 1;
  histogram[18 + (seed * 3) % 6] = 1;
  const layout = Array.from({ length: 36 }, (_, index) => (
    ((index * (seed + 5) + seed * 7) % 23) / 22 + variation * 0.002
  ));
  const hash = Array.from({ length: 64 }, (_, index) => ((index * (seed + 1) + seed) % 5 < 2 ? "1" : "0")).join("");
  return { luma, histogram, layout, hash };
}

function visualSample(timestamp: number, seed: number, contextSeeds = [seed]): ScanSample {
  return sample(timestamp, {
    visualFingerprint: fingerprint(seed),
    visualContext: contextSeeds.map((contextSeed) => fingerprint(contextSeed)),
  });
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
    expect(offsets[1]).toBeLessThanOrEqual(0.22);
    expect(offsets[2]).toBeLessThanOrEqual(0.55);
    expect(offsets.at(-1)).toBeGreaterThan(4.8);
    expect(offsets.length).toBeGreaterThanOrEqual(8);
  });

  it("requires the face at the opening and for at least 52 percent of the clip", () => {
    const offsets = createClipCheckOffsets(5);
    const intermittentMisses = offsets.map((offset, index) => sample(10 + offset, [5, 7].includes(index) ? { similarity: 0.2, referenceHits: 0 } : {}));
    const openingMiss = intermittentMisses.map((item, index) => index === 0 ? sample(item.timestamp, { similarity: 0.2, referenceHits: 0 }) : item);
    const validation = validateClipChecks(intermittentMisses, 0.52, 10, 5);
    expect(validation.accepted).toBe(true);
    expect(validation.passingSeconds).toBeGreaterThanOrEqual(2.6);
    expect(validateClipChecks(openingMiss, 0.52, 10, 5).accepted).toBe(false);
  });

  it("rejects a five-second clip when the target appears only at the start", () => {
    const offsets = createClipCheckOffsets(5);
    const briefAppearance = offsets.map((offset, index) => sample(
      10 + offset,
      index < 3 ? {} : { similarity: 0.2, weakestSimilarity: 0.2, referenceHits: 0 },
    ));
    const validation = validateClipChecks(briefAppearance, 0.52, 10, 5);
    expect(validation.accepted).toBe(false);
    expect(validation.passingSeconds).toBeLessThan(2.6);
  });

  it("does not let tolerated missed checks poison an otherwise verified clip", () => {
    const offsets = createClipCheckOffsets(5);
    const checks = offsets.map((offset, index) => sample(
      10 + offset,
      [5, 7].includes(index)
        ? { similarity: 0, weakestSimilarity: 0, referenceHits: 0, faceQuality: 0 }
        : {},
    ));
    const verified = createVerifiedClipSample(checks, 0.52, 10, 5);
    expect(verified).not.toBeNull();
    expect(verified?.weakestSimilarity).toBe(0.6);
    expect(verified?.faceQuality).toBe(0.8);
    expect(selectSceneMatches([verified!], 1, 5, 60, 0.52)).toHaveLength(1);
  });

  it("samples a forty-minute source frequently without exceeding the memory bound", () => {
    const times = createSampleTimes(40 * 60, 5);
    expect(times.length).toBeGreaterThanOrEqual(900);
    expect(times.length).toBeLessThanOrEqual(2400);
  });

  it("searches for a complete clip window around a coarse candidate", () => {
    expect(createCandidateClipStarts(20, 5, 60)).toEqual([20, 18.75, 17.5, 16.25]);
  });

  it("never lowers the identity threshold when references disagree", () => {
    expect(calibrateIdentityThreshold(0.52, 0.46)).toBe(0.52);
    expect(calibrateIdentityThreshold(0.52, 0.9)).toBe(0.52);
    expect(calibrateIdentityThreshold(0.4, 0.32)).toBe(0.4);
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

  it("keeps twenty-five visually distinct scenes even when many occur inside three minutes", () => {
    const denseDistinctScenes = Array.from({ length: 30 }, (_, index) => visualSample(
      30 + index * 18,
      index + 1,
      [index + 1, index + 31],
    ));
    const scenes = selectSceneMatches(
      denseDistinctScenes,
      25,
      5,
      35 * 60,
      0.52,
      { minimumGapSeconds: 5, contentDiversity: true },
    );
    expect(scenes).toHaveLength(25);
    expect(scenes.filter((scene) => scene.start < 180).length).toBeGreaterThanOrEqual(5);
  });

  it("collapses repeated moments by visual context rather than elapsed time", () => {
    const repeatedScene = Array.from({ length: 8 }, (_, index) => visualSample(
      60 + index * 35,
      index % 2 ? 4 : 2,
      [20, 21, 20, 21],
    ));
    const distinctScenes = [8, 9, 10, 11, 12].map((seed, index) => visualSample(
      500 + index * 40,
      seed,
      [seed, seed + 20],
    ));
    const scenes = selectSceneMatches(
      [...repeatedScene, ...distinctScenes],
      12,
      5,
      900,
      0.52,
      { minimumGapSeconds: 5, contentDiversity: true },
    );
    expect(scenes.length).toBeLessThan(12);
    expect(scenes.filter((scene) => scene.start >= 60 && scene.start <= 305)).toHaveLength(1);
    expect(scenes.filter((scene) => scene.start >= 500)).toHaveLength(5);
  });

  it("uses surrounding context to distinguish matching compositions from different scenes", () => {
    const sharedComposition = fingerprint(3);
    const first = sample(30, { visualFingerprint: sharedComposition, visualContext: [fingerprint(4), fingerprint(5)] });
    const second = sample(70, { visualFingerprint: sharedComposition, visualContext: [fingerprint(14), fingerprint(15)] });
    expect(visualFingerprintDistance(sharedComposition, sharedComposition)).toBeCloseTo(0);
    expect(visualSceneDistance(first, second)).toBeGreaterThan(0.22);
    expect(selectSceneMatches([first, second], 2, 5, 120, 0.52, {
      minimumGapSeconds: 5,
      contentDiversity: true,
    })).toHaveLength(2);
  });

  it("chooses the highest-quality globally spaced plan instead of a greedy local maximum", () => {
    const scenes = selectSceneMatches([
      sample(0, { similarity: 0.81 }),
      sample(60, { similarity: 0.99 }),
      sample(120, { similarity: 0.8 }),
    ], 2, 5, 180, 0.52, { minimumGapSeconds: 100 });
    expect(scenes.map((scene) => scene.start)).toEqual([0, 120]);
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
