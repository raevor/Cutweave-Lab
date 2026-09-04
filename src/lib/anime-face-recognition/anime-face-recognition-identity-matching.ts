const CCIP_LOGIT_SCALE = 27.827049255371094;
const CCIP_DISTANCE_OFFSET = 27.827049255371094;
const CCIP_DISTANCE_DIVISOR = 55.65409851074219;

export const ANIME_CHARACTER_DEFAULT_SIMILARITY = 1 - 0.17847511429108218;

export function normalizeAnimeEmbedding(embedding: number[]) {
  const sanitized = embedding.map((value) => Number.isFinite(value) ? value : 0);
  const norm = Math.sqrt(sanitized.reduce((total, value) => total + value * value, 0)) || 1;
  return sanitized.map((value) => value / norm);
}

export function cosineSimilarity(first: number[], second: number[]) {
  if (first.length !== second.length || first.length === 0) return -1;
  const a = normalizeAnimeEmbedding(first);
  const b = normalizeAnimeEmbedding(second);
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) dot += a[index] * b[index];
  return Math.max(-1, Math.min(1, dot));
}

export function animeCharacterDistance(first: number[], second: number[]) {
  const cosine = cosineSimilarity(first, second);
  return Math.max(0, Math.min(1, (CCIP_DISTANCE_OFFSET - CCIP_LOGIT_SCALE * cosine) / CCIP_DISTANCE_DIVISOR));
}

export function animeCharacterSimilarity(first: number[], second: number[]) {
  return 1 - animeCharacterDistance(first, second);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function calculateAnimeReferenceAgreement(embeddings: number[][]) {
  if (embeddings.length < 2) return 1;
  const scores: number[] = [];
  for (let first = 0; first < embeddings.length; first += 1) {
    for (let second = first + 1; second < embeddings.length; second += 1) {
      scores.push(animeCharacterSimilarity(embeddings[first], embeddings[second]));
    }
  }
  return median(scores);
}

export function calculateAnimeReferenceVariantAgreement(referenceVariants: number[][][]) {
  if (referenceVariants.length < 2) return 1;
  const scores: number[] = [];
  for (let first = 0; first < referenceVariants.length; first += 1) {
    for (let second = first + 1; second < referenceVariants.length; second += 1) {
      const pairedVariants = Math.min(referenceVariants[first].length, referenceVariants[second].length);
      const pairedScores = Array.from({ length: pairedVariants }, (_, variant) => (
        animeCharacterSimilarity(referenceVariants[first][variant], referenceVariants[second][variant])
      ));
      scores.push(Math.max(...pairedScores, 0));
    }
  }
  return median(scores);
}

export function evaluateAnimeIdentityCandidate(references: number[][], candidate: number[], threshold: number) {
  const similarities = references.map((reference) => animeCharacterSimilarity(reference, candidate));
  const sorted = [...similarities].sort((a, b) => b - a);
  const consensusSimilarity = sorted[1] ?? 0;
  return {
    similarity: consensusSimilarity,
    weakestSimilarity: sorted[2] ?? consensusSimilarity,
    referenceHits: similarities.filter((score) => score >= threshold).length,
    similarities,
  };
}

export function evaluateAnimeIdentityCandidateVariants(
  references: number[][][],
  candidateVariants: number[][],
  threshold: number,
) {
  const similarities = references.map((referenceVariants) => (
    pairedVariantCcipSimilarity(referenceVariants, candidateVariants)
  ));
  const sorted = [...similarities].sort((a, b) => b - a);
  const consensusSimilarity = sorted[1] ?? 0;
  return {
    similarity: consensusSimilarity,
    weakestSimilarity: sorted[2] ?? consensusSimilarity,
    referenceHits: similarities.filter((score) => score >= threshold).length,
    similarities,
  };
}

function pairedVariantCcipSimilarity(referenceVariants: number[][], candidateVariants: number[][]) {
  const pairedVariants = Math.min(referenceVariants.length, candidateVariants.length);
  if (!pairedVariants) return 0;
  const similarities = Array.from({ length: pairedVariants }, (_, variant) => (
    animeCharacterSimilarity(referenceVariants[variant], candidateVariants[variant])
  ));
  return similarities.reduce((total, similarity) => total + similarity, 0) / similarities.length;
}
