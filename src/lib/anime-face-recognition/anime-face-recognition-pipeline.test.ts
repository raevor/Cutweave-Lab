import { describe, expect, it } from "vitest";
import {
  calibrateIdentityThreshold,
  createPreliminaryCandidateCount,
  createSampleTimes,
  createProposalThreshold,
  samplePassesIdentity,
  selectSceneMatches,
  validateClipChecks,
} from "./anime-face-recognition-pipeline";
import type { ScanSample } from "./anime-face-recognition-types";

function sample(overrides: Partial<ScanSample> = {}): ScanSample {
  return {
    timestamp: 12,
    similarity: 0.84,
    weakestSimilarity: 0.84,
    referenceHits: 2,
    faceCount: 1,
    faceQuality: 0.7,
    ...overrides,
  };
}

describe("anime recognition pipeline thresholds", () => {
  it("keeps verification inside the anime-specific CCIP range", () => {
    expect(calibrateIdentityThreshold(0.82, 0.9)).toBe(0.82);
    expect(calibrateIdentityThreshold(0.7, 0.9)).toBe(0.72);
    expect(calibrateIdentityThreshold(0.72, 0.7)).toBe(0.76);
    expect(calibrateIdentityThreshold(0.99, 0.9)).toBe(0.94);
  });

  it("allows recall only in proposal generation", () => {
    expect(createProposalThreshold(0.82)).toBeCloseTo(0.78, 8);
    expect(createProposalThreshold(0.74)).toBe(0.72);
  });

  it("requires two references and a usable head detection", () => {
    expect(samplePassesIdentity(sample(), 0.82)).toBe(true);
    expect(samplePassesIdentity(sample({ referenceHits: 1 }), 0.82)).toBe(false);
    expect(samplePassesIdentity(sample({ faceQuality: 0.15 }), 0.82)).toBe(false);
    expect(samplePassesIdentity(sample({ faceQuality: 0.2 }), 0.82)).toBe(true);
    expect(samplePassesIdentity(sample({ similarity: 0.8 }), 0.82)).toBe(false);
  });

  it("samples densely enough to catch short anime action cuts", () => {
    const times = createSampleTimes(20 * 60, 5);
    const largestGap = Math.max(...times.slice(1).map((timestamp, index) => timestamp - times[index]));

    expect(largestGap).toBeLessThanOrEqual(0.901);
    expect(createSampleTimes(3 * 60 * 60, 5).length).toBeLessThanOrEqual(5400);
  });

  it("reduces proposal work without changing Maximum scan coverage", () => {
    const duration = 90 * 60;
    const maximum = createSampleTimes(duration, 5, "maximum");
    const balanced = createSampleTimes(duration, 5, "balanced");
    const light = createSampleTimes(duration, 5, "light");

    expect(maximum).toEqual(createSampleTimes(duration, 5));
    expect(maximum).toHaveLength(5400);
    expect(balanced.length).toBeLessThan(maximum.length);
    expect(balanced.length).toBeLessThanOrEqual(3000);
    expect(light.length).toBeLessThan(balanced.length);
    expect(light.length).toBeLessThanOrEqual(1500);
  });

  it("bounds verification candidates by the selected scan profile", () => {
    expect(createPreliminaryCandidateCount(25, "light")).toBe(75);
    expect(createPreliminaryCandidateCount(25, "balanced")).toBe(125);
    expect(createPreliminaryCandidateCount(25, "maximum")).toBe(200);
    expect(createPreliminaryCandidateCount(100, "maximum")).toBe(800);
  });

  it("does not discard a small but identity-verified anime head", () => {
    const matches = selectSceneMatches([sample({ faceQuality: 0.2 })], 1, 5, 30, 0.82);
    expect(matches).toHaveLength(1);
  });

  it("accepts a brief verified action appearance without requiring half the clip", () => {
    const checks = [
      sample({ timestamp: 10.04 }),
      sample({ timestamp: 10.22 }),
      sample({ timestamp: 10.55, similarity: 0.6, weakestSimilarity: 0.6, referenceHits: 0 }),
      sample({ timestamp: 11.2, similarity: 0.6, weakestSimilarity: 0.6, referenceHits: 0 }),
    ];
    const validation = validateClipChecks(checks, 0.82, 10, 5);

    expect(validation.accepted).toBe(true);
    expect(validation.passing).toBe(2);
  });

  it("still rejects a single-frame identity coincidence", () => {
    const checks = [
      sample({ timestamp: 10.04 }),
      sample({ timestamp: 10.22, similarity: 0.6, weakestSimilarity: 0.6, referenceHits: 0 }),
      sample({ timestamp: 10.55, similarity: 0.6, weakestSimilarity: 0.6, referenceHits: 0 }),
    ];
    expect(validateClipChecks(checks, 0.82, 10, 5).accepted).toBe(false);
  });
});
