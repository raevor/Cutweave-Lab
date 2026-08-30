import { describe, expect, it } from "vitest";
import {
  createClipCheckOffsets,
  createCandidateClipStarts,
  createBalancedCandidateOrder,
  calibrateIdentityThreshold,
  createProposalThreshold,
  createNarrativeCandidateOrder,
  createSampleTimes,
  createVerifiedClipSample,
  createVisualContext,
  createVerificationClipStarts,
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

  it("samples long sources densely enough to catch ordinary TV shots without exceeding the bound", () => {
    const times = createSampleTimes(40 * 60, 5);
    const featureLengthTimes = createSampleTimes(2 * 60 * 60 + 18 * 60, 5);
    expect(times.length).toBeGreaterThanOrEqual(1400);
    expect(featureLengthTimes.length).toBeGreaterThanOrEqual(4800);
    expect(featureLengthTimes.length).toBeLessThanOrEqual(5400);
  });

  it("searches for a complete clip window around a coarse candidate", () => {
    expect(createCandidateClipStarts(20, 5, 60)).toEqual([20, 19.2, 18.4, 17.6, 16.8, 16]);
  });

  it("anchors verification at the beginning of a continuous positive face run", () => {
    const samples = [
      sample(8, { similarity: 0.1, weakestSimilarity: 0.1, referenceHits: 0 }),
      sample(10),
      sample(11.7),
      sample(13.4),
      sample(15.1, { similarity: 0.1, weakestSimilarity: 0.1, referenceHits: 0 }),
    ];
    const starts = createVerificationClipStarts(13.4, 5, 60, samples, 0.3);
    expect(starts[0]).toBe(10);
    expect(starts).toHaveLength(3);
    expect(starts.at(-1)).toBeLessThanOrEqual(13.4);
  });

  it("front-loads one high-quality candidate from each timeline region", () => {
    const candidates = [
      sample(10, { similarity: 0.6 }), sample(20, { similarity: 0.8 }),
      sample(110, { similarity: 0.61 }), sample(120, { similarity: 0.81 }),
      sample(210, { similarity: 0.62 }), sample(220, { similarity: 0.82 }),
    ];
    const ordered = createBalancedCandidateOrder(candidates, 300, 3);
    expect(ordered.slice(0, 3).map((candidate) => candidate.timestamp)).toEqual([20, 120, 220]);
    expect(ordered).toHaveLength(candidates.length);
  });

  it("groups a continuous dialogue with recurring camera setups into one narrative scene", () => {
    const dialogue = [0, 28, 61, 104, 158, 221, 287, 344].map((offset, index) => visualSample(
      60 + offset,
      index % 2 ? 7 : 3,
      [index % 2 ? 7 : 3],
    ));
    const nextScene = [460, 492].map((timestamp, index) => visualSample(timestamp, 20 + index));
    const laterReturn = visualSample(760, 3, [3]);
    const ordered = createNarrativeCandidateOrder([...dialogue, ...nextScene, laterReturn], 900, 10);
    const dialogueGroups = new Set(ordered.filter((sample) => sample.timestamp < 450).map((sample) => sample.narrativeScene));
    expect(dialogueGroups.size).toBe(1);
    expect(ordered.filter((sample) => sample.timestamp < 450)).toHaveLength(8);
    expect(ordered.find((sample) => sample.timestamp === 760)?.narrativeScene)
      .not.toBe(ordered.find((sample) => sample.timestamp === 60)?.narrativeScene);
  });

  it("returns only the strongest verified clip from each narrative scene", () => {
    const scenes = selectSceneMatches([
      visualSample(10, 3, [3]),
      visualSample(40, 3, [3]),
      visualSample(80, 3, [3]),
      visualSample(200, 11, [11]),
    ].map((candidate, index) => ({
      ...candidate,
      narrativeScene: index < 3 ? 0 : 1,
      similarity: index === 1 ? 0.9 : candidate.similarity,
    })), 10, 5, 300, 0.38, { minimumGapSeconds: 5, contentDiversity: true });
    expect(scenes).toHaveLength(2);
    expect(scenes.map((scene) => scene.start)).toEqual([40, 200]);
  });

  it("allows additional distinct shots from one scene after other scenes are covered", () => {
    const scenes = selectSceneMatches([
      { ...visualSample(10, 3, [3]), narrativeScene: 0 },
      { ...visualSample(40, 7, [7]), narrativeScene: 0 },
      { ...visualSample(200, 11, [11]), narrativeScene: 1 },
    ], 3, 5, 300, 0.38, { minimumGapSeconds: 5, contentDiversity: true });
    expect(scenes).toHaveLength(3);
    expect(scenes.map((scene) => scene.start)).toEqual([10, 40, 200]);
  });

  it("never lets narrative grouping cap a one-hundred-result request", () => {
    const candidates = Array.from({ length: 120 }, (_, index) => visualSample(index * 10, 3, [3]));
    const ordered = createNarrativeCandidateOrder(candidates, 1_200, 100);
    expect(ordered).toHaveLength(120);
  });

  it("fills one hundred visually distinct clips even when they share one narrative scene", () => {
    const candidates = Array.from({ length: 120 }, (_, index) => ({
      ...visualSample(index * 10, index + 1, [index + 1, index + 121]),
      narrativeScene: 0,
    }));
    const scenes = selectSceneMatches(candidates, 100, 5, 1_200, 0.38, {
      minimumGapSeconds: 5,
      contentDiversity: true,
    });
    expect(scenes).toHaveLength(100);
  });

  it("never lowers the identity threshold when references disagree", () => {
    expect(calibrateIdentityThreshold(0.52, 0.46)).toBe(0.52);
    expect(calibrateIdentityThreshold(0.52, 0.9)).toBe(0.52);
    expect(calibrateIdentityThreshold(0.4, 0.32)).toBe(0.4);
  });

  it("uses a recall margin only for candidate proposals", () => {
    expect(createProposalThreshold(0.38)).toBeCloseTo(0.3);
    expect(createProposalThreshold(0.3)).toBe(0.28);
    expect(createProposalThreshold(0.52)).toBeCloseTo(0.44);
  });

  it("keeps an eight-hundred-candidate plan bounded on a long source", () => {
    const candidates = Array.from({ length: 1_200 }, (_, index) => sample(index * 6));
    const scenes = selectSceneMatches(candidates, 800, 5, 3 * 60 * 60, 0.38, {
      minimumGapSeconds: 5,
      maximumVisualHashDistance: -1,
    });
    expect(scenes).toHaveLength(800);
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
    expect(scenes.filter((scene) => scene.start >= 60 && scene.start <= 305).length).toBeLessThanOrEqual(2);
    expect(scenes.filter((scene) => scene.start >= 500)).toHaveLength(5);
  });

  it("does not let shared neighboring context collapse eighty distinct shots in a long episode", () => {
    const distinctShots = Array.from({ length: 100 }, (_, index) => visualSample(
      120 + index * 22,
      index + 1,
      [200, index + 1, 201],
    ));
    const scenes = selectSceneMatches(
      distinctShots,
      80,
      5,
      2 * 60 * 60 + 18 * 60,
      0.38,
      { minimumGapSeconds: 4.75, contentDiversity: true },
    );
    expect(scenes).toHaveLength(80);
  });

  it("keeps visual context inside the nearest detected shot boundary", () => {
    const firstShot = fingerprint(2);
    const secondShot = fingerprint(19);
    const context = createVisualContext(12, [
      sample(10, { visualFingerprint: firstShot }),
      sample(12, { visualFingerprint: fingerprint(2, 1) }),
      sample(14, { visualFingerprint: secondShot }),
      sample(16, { visualFingerprint: fingerprint(19, 1) }),
    ]);
    expect(context).toHaveLength(2);
    expect(context).not.toContain(secondShot);
  });

  it("uses surrounding context to distinguish matching compositions from different scenes", () => {
    const sharedComposition = fingerprint(3);
    const first = sample(30, { visualFingerprint: sharedComposition, visualContext: [fingerprint(4), fingerprint(5)] });
    const second = sample(70, { visualFingerprint: sharedComposition, visualContext: [fingerprint(14), fingerprint(15)] });
    expect(visualFingerprintDistance(sharedComposition, sharedComposition)).toBeCloseTo(0);
    expect(visualSceneDistance(first, second)).toBeGreaterThan(0.12);
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
