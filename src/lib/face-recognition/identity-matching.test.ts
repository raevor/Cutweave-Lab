import { describe, expect, it } from "vitest";
import {
  calculateReferenceAgreement,
  euclideanDistance,
  evaluateIdentityCandidate,
  faceDescriptorSimilarity,
} from "./identity-matching";

describe("identity matching", () => {
  const descriptor = (entries: Record<number, number>) => Array.from(
    { length: 128 },
    (_, index) => entries[index] ?? 0,
  );
  const references = [
    descriptor({ 0: 0.1, 1: -0.04, 9: 0.03 }),
    descriptor({ 0: 0.12, 1: -0.03, 9: 0.02 }),
    descriptor({ 0: 0.08, 1: -0.05, 9: 0.04 }),
  ];

  it("uses the recognition model's Euclidean descriptor distance without score saturation", () => {
    const unrelated = descriptor({ 0: 0.85, 1: 0.45, 9: -0.3 });
    expect(euclideanDistance(references[0], unrelated)).toBeGreaterThan(0.9);
    expect(faceDescriptorSimilarity(references[0], unrelated)).toBeLessThan(0.1);
  });

  it("requires the candidate to agree with at least two independent references", () => {
    const sameIdentity = evaluateIdentityCandidate(
      references,
      descriptor({ 0: 0.11, 1: -0.04, 9: 0.03 }),
      0.4,
    );
    const differentIdentity = evaluateIdentityCandidate(
      references,
      descriptor({ 0: 0.8, 1: 0.5, 9: -0.35 }),
      0.4,
    );
    expect(sameIdentity.referenceHits).toBe(3);
    expect(sameIdentity.similarity).toBeGreaterThan(0.95);
    expect(differentIdentity.referenceHits).toBe(0);
    expect(differentIdentity.similarity).toBeLessThan(0.1);
  });

  it("uses the middle reference score so one accidental high match cannot pass", () => {
    const mixedReferences = [
      references[0],
      descriptor({ 0: 0.9, 4: 0.4 }),
      descriptor({ 0: -0.7, 7: 0.5 }),
    ];
    const result = evaluateIdentityCandidate(mixedReferences, references[0], 0.4);
    expect(result.referenceHits).toBe(1);
    expect(result.similarity).toBeLessThan(0.4);
  });

  it("reports low agreement when the reference set contains different identities", () => {
    expect(calculateReferenceAgreement(references)).toBeGreaterThan(0.95);
    expect(calculateReferenceAgreement([
      references[0],
      descriptor({ 0: 0.9, 1: 0.5, 9: -0.4 }),
    ])).toBeLessThan(0.1);
  });
});
