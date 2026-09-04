import { describe, expect, it } from "vitest";
import {
  ANIME_CHARACTER_DEFAULT_SIMILARITY,
  animeCharacterDistance,
  animeCharacterSimilarity,
  calculateAnimeReferenceAgreement,
  calculateAnimeReferenceVariantAgreement,
  evaluateAnimeIdentityCandidate,
  evaluateAnimeIdentityCandidateVariants,
} from "./anime-face-recognition-identity-matching";

describe("anime character identity matching", () => {
  it("maps the upstream CCIP distance threshold to similarity", () => {
    expect(ANIME_CHARACTER_DEFAULT_SIMILARITY).toBeCloseTo(0.8215248857, 8);
    expect(animeCharacterDistance([1, 0], [1, 0])).toBeCloseTo(0, 5);
    expect(animeCharacterSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 5);
    expect(animeCharacterSimilarity([1, 0], [0, 1])).toBeCloseTo(0.5, 5);
  });

  it("uses a two-of-three reference consensus", () => {
    const references = [[1, 0, 0], [0.99, 0.05, 0], [0, 0, 1]];
    const sameCharacter = evaluateAnimeIdentityCandidate(references, [0.98, 0.08, 0], 0.82);
    const differentCharacter = evaluateAnimeIdentityCandidate(references, [0, 1, 0], 0.82);

    expect(sameCharacter.referenceHits).toBe(2);
    expect(sameCharacter.similarity).toBeGreaterThan(0.99);
    expect(differentCharacter.referenceHits).toBe(0);
  });

  it("measures agreement across all supplied references", () => {
    expect(calculateAnimeReferenceAgreement([[1, 0], [0.99, 0.04], [0.98, 0.08]])).toBeGreaterThan(0.99);
    expect(calculateAnimeReferenceAgreement([[1, 0], [0, 1]])).toBeCloseTo(0.5, 4);
  });

  it("compares like-for-like portrait and head variants without weakening consensus", () => {
    const references = [
      [[1, 0, 0], [0, 1, 0]],
      [[0.99, 0.05, 0], [0.05, 0.99, 0]],
      [[0, 0, 1], [0, 0, 1]],
    ];
    const sameCharacter = evaluateAnimeIdentityCandidateVariants(
      references,
      [[0.98, 0.08, 0], [0.08, 0.98, 0]],
      0.82,
    );

    expect(sameCharacter.referenceHits).toBe(2);
    expect(sameCharacter.similarity).toBeGreaterThan(0.99);
    expect(calculateAnimeReferenceVariantAgreement(references.slice(0, 2))).toBeGreaterThan(0.99);
  });

  it("keeps the third reference as a weaker final precision guard", () => {
    const references = [[[1, 0, 0]], [[1, 0, 0]], [[0.52, Math.sqrt(1 - 0.52 ** 2), 0]]];
    const candidate = evaluateAnimeIdentityCandidateVariants(
      references,
      [[1, 0, 0]],
      0.79,
    );

    expect(candidate.referenceHits).toBe(2);
    expect(candidate.similarity).toBeGreaterThan(0.79);
    expect(candidate.weakestSimilarity).toBeCloseTo(0.76, 8);
  });

  it("does not accept a lookalike that matches only one of the two crop views", () => {
    const references = [
      [[1, 0, 0], [0, 1, 0]],
      [[1, 0, 0], [0, 1, 0]],
      [[0, 0, 1], [0, 0, 1]],
    ];
    const oneViewLookalike = evaluateAnimeIdentityCandidateVariants(
      references,
      [[1, 0, 0], [0, 0, 1]],
      0.79,
    );

    expect(oneViewLookalike.referenceHits).toBe(0);
    expect(oneViewLookalike.similarity).toBeLessThan(0.79);
  });
});
