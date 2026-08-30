export function normalizeEmbedding(embedding: number[]) {
  const norm = Math.sqrt(embedding.reduce((total, value) => total + value * value, 0)) || 1;
  return embedding.map((value) => value / norm);
}

export function prepareFaceEmbedding(embedding: number[]) {
  return embedding.map((value) => Number.isFinite(value) ? value : 0);
}

export function euclideanDistance(first: number[], second: number[]) {
  if (first.length !== second.length || first.length === 0) return Number.POSITIVE_INFINITY;
  let squaredDistance = 0;
  for (let index = 0; index < first.length; index += 1) {
    const difference = first[index] - second[index];
    squaredDistance += difference * difference;
  }
  return Math.sqrt(squaredDistance);
}

export function faceDescriptorSimilarity(first: number[], second: number[]) {
  return Math.max(0, Math.min(1, 1 - euclideanDistance(first, second)));
}

export function cosineSimilarity(first: number[], second: number[]) {
  if (first.length !== second.length || first.length === 0) return 0;
  let dot = 0;
  for (let index = 0; index < first.length; index += 1) dot += first[index] * second[index];
  return Math.max(0, Math.min(1, dot));
}

export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function calculateReferenceAgreement(embeddings: number[][]) {
  if (embeddings.length < 2) return 1;
  const scores: number[] = [];
  for (let first = 0; first < embeddings.length; first += 1) {
    for (let second = first + 1; second < embeddings.length; second += 1) {
      scores.push(faceDescriptorSimilarity(embeddings[first], embeddings[second]));
    }
  }
  return median(scores);
}

export function evaluateIdentityCandidate(references: number[][], candidate: number[], threshold: number) {
  const normalizedCandidate = prepareFaceEmbedding(candidate);
  const similarities = references.map((reference) => faceDescriptorSimilarity(prepareFaceEmbedding(reference), normalizedCandidate));
  const sorted = [...similarities].sort((a, b) => b - a);
  const consensusSimilarity = sorted[1] ?? 0;
  return {
    // Three references form a 2-of-3 robust template. The third, possibly
    // occluded reference is an outlier and must not weaken an otherwise
    // consistent identity decision.
    similarity: consensusSimilarity,
    weakestSimilarity: consensusSimilarity,
    referenceHits: similarities.filter((score) => score >= threshold).length,
    similarities,
  };
}
