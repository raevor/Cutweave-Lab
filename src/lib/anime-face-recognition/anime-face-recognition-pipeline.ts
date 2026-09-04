import type { AnimeFaceScanProfile, ScanSample, SceneMatch, VisualFingerprint } from "./anime-face-recognition-types";

export const MAX_VIDEO_DURATION_SECONDS = 3 * 60 * 60;
export const MAX_SCAN_SAMPLES = 5400;
export const MAX_PRELIMINARY_SCENE_COUNT = 800;
const SHOT_BOUNDARY_DISTANCE = 0.3;
let frameCaptureCanvas: HTMLCanvasElement | null = null;
let visualHashCanvas: HTMLCanvasElement | null = null;
let visualFingerprintCanvas: HTMLCanvasElement | null = null;

type SceneSelectionOptions = {
  excludedTimestamps?: number[];
  minimumGapSeconds?: number;
  maximumVisualHashDistance?: number;
  visualDuplicateWindowSeconds?: number;
  timelineBucketSeconds?: number;
  maximumMatchesPerTimelineBucket?: number;
  contentDiversity?: boolean;
};

export function formatTimecode(seconds: number) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  return [hours, minutes, wholeSeconds].map((part) => String(part).padStart(2, "0")).join(":");
}

const scanProfiles: Record<AnimeFaceScanProfile, {
  intervalMultiplier: number;
  maximumSamples: number;
  preliminaryCandidateMultiplier: number;
}> = {
  light: { intervalMultiplier: 2.8, maximumSamples: 1500, preliminaryCandidateMultiplier: 3 },
  balanced: { intervalMultiplier: 1.5, maximumSamples: 3000, preliminaryCandidateMultiplier: 5 },
  maximum: { intervalMultiplier: 1, maximumSamples: MAX_SCAN_SAMPLES, preliminaryCandidateMultiplier: 8 },
};

export function createSampleTimes(
  duration: number,
  clipDuration: number,
  profile: AnimeFaceScanProfile = "maximum",
) {
  // Anime action cuts can last well under a second. Keep proposal frames close
  // enough to catch them in Maximum, while lighter profiles deliberately trade
  // proposal recall for lower sustained hardware load. Identity math is shared.
  const settings = scanProfiles[profile];
  const coverageInterval = Math.max(0.7, Math.min(1, clipDuration * 0.18)) * settings.intervalMultiplier;
  const boundedInterval = Math.max(coverageInterval, duration / settings.maximumSamples);
  const times: number[] = [];
  for (let timestamp = 0; timestamp < duration; timestamp += boundedInterval) {
    times.push(Math.min(duration - 0.05, timestamp + Math.min(0.35, boundedInterval / 3)));
  }
  return times;
}

export function createPreliminaryCandidateCount(
  sceneCount: number,
  profile: AnimeFaceScanProfile = "maximum",
) {
  const settings = scanProfiles[profile];
  const safeSceneCount = Math.max(1, Math.floor(sceneCount));
  return Math.min(
    Math.ceil(safeSceneCount * settings.preliminaryCandidateMultiplier),
    MAX_PRELIMINARY_SCENE_COUNT,
  );
}

function sampleSelectionQuality(sample: ScanSample) {
  return sample.similarity * 0.65 + sample.weakestSimilarity * 0.2 + sample.faceQuality * 0.15;
}

function averageVectors(vectors: number[][]) {
  const length = vectors[0]?.length ?? 0;
  if (!length || vectors.some((vector) => vector.length !== length)) return [];
  const average = Array.from({ length }, () => 0);
  for (const vector of vectors) {
    for (let index = 0; index < length; index += 1) average[index] += vector[index] / vectors.length;
  }
  return average;
}

function averageVisualFingerprints(fingerprints: VisualFingerprint[]) {
  if (!fingerprints.length) return undefined;
  return {
    luma: averageVectors(fingerprints.map((fingerprint) => fingerprint.luma)),
    histogram: averageVectors(fingerprints.map((fingerprint) => fingerprint.histogram)),
    layout: averageVectors(fingerprints.map((fingerprint) => fingerprint.layout)),
  } satisfies VisualFingerprint;
}

function vectorRootMeanSquareDistance(first: number[], second: number[]) {
  if (!first.length || first.length !== second.length) return 1;
  const total = first.reduce((sum, value, index) => sum + (value - second[index]) ** 2, 0);
  return Math.min(1, Math.sqrt(total / first.length));
}

function histogramHellingerDistance(first: number[], second: number[]) {
  if (!first.length || first.length !== second.length) return 1;
  const firstTotal = first.reduce((sum, value) => sum + value, 0) || 1;
  const secondTotal = second.reduce((sum, value) => sum + value, 0) || 1;
  const coefficient = first.reduce((sum, value, index) => (
    sum + Math.sqrt((value / firstTotal) * (second[index] / secondTotal))
  ), 0);
  return Math.max(0, Math.min(1, Math.sqrt(Math.max(0, 1 - coefficient))));
}

function structuralLumaDistance(first: number[], second: number[]) {
  if (first.length < 2 || first.length !== second.length) return 1;
  const firstMean = first.reduce((sum, value) => sum + value, 0) / first.length;
  const secondMean = second.reduce((sum, value) => sum + value, 0) / second.length;
  let firstVariance = 0;
  let secondVariance = 0;
  let covariance = 0;
  for (let index = 0; index < first.length; index += 1) {
    const firstDelta = first[index] - firstMean;
    const secondDelta = second[index] - secondMean;
    firstVariance += firstDelta ** 2;
    secondVariance += secondDelta ** 2;
    covariance += firstDelta * secondDelta;
  }
  const divisor = first.length - 1;
  firstVariance /= divisor;
  secondVariance /= divisor;
  covariance /= divisor;
  const c1 = 0.01 ** 2;
  const c2 = 0.03 ** 2;
  const similarity = ((2 * firstMean * secondMean + c1) * (2 * covariance + c2))
    / ((firstMean ** 2 + secondMean ** 2 + c1) * (firstVariance + secondVariance + c2));
  return Math.max(0, Math.min(1, (1 - similarity) / 2));
}

export function visualFingerprintDistance(first: VisualFingerprint, second: VisualFingerprint) {
  const histogramDistance = histogramHellingerDistance(first.histogram, second.histogram);
  const layoutDistance = vectorRootMeanSquareDistance(first.layout, second.layout);
  const structureDistance = structuralLumaDistance(first.luma, second.luma);
  const hashDistance = first.hash && second.hash
    ? Math.min(1, visualHashDistance(first.hash, second.hash) / first.hash.length)
    : structureDistance;
  return histogramDistance * 0.38 + layoutDistance * 0.24 + structureDistance * 0.28 + hashDistance * 0.1;
}

type FingerprintDistance = (first: VisualFingerprint, second: VisualFingerprint) => number;

function nearestContextDistance(
  first: VisualFingerprint[],
  second: VisualFingerprint[],
  distance: FingerprintDistance,
) {
  if (!first.length || !second.length) return 1;
  return first.reduce((sum, fingerprint) => sum + Math.min(
    ...second.map((candidate) => distance(fingerprint, candidate)),
  ), 0) / first.length;
}

function visualContextDistance(
  first: VisualFingerprint[],
  second: VisualFingerprint[],
  distance: FingerprintDistance,
) {
  if (!first.length || !second.length) return 1;
  const chamfer = (nearestContextDistance(first, second, distance) + nearestContextDistance(second, first, distance)) / 2;
  const firstCentroid = averageVisualFingerprints(first);
  const secondCentroid = averageVisualFingerprints(second);
  const centroid = firstCentroid && secondCentroid ? distance(firstCentroid, secondCentroid) : 1;
  return chamfer * 0.65 + centroid * 0.35;
}

function measureVisualSceneDistance(first: ScanSample, second: ScanSample, distance: FingerprintDistance) {
  if (!first.visualFingerprint || !second.visualFingerprint) return 1;
  const clipDistance = distance(first.visualFingerprint, second.visualFingerprint);
  if (!first.visualContext?.length || !second.visualContext?.length) return clipDistance;
  const contextDistance = visualContextDistance(first.visualContext, second.visualContext, distance);
  // The selected frame represents the shot. Context only stabilizes camera
  // motion inside that shot; it must not merge neighboring cuts which happen
  // to share the same +/- 15 second neighborhood.
  return clipDistance * 0.72 + contextDistance * 0.28;
}

export function visualSceneDistance(first: ScanSample, second: ScanSample) {
  return measureVisualSceneDistance(first, second, visualFingerprintDistance);
}

function quantile(sorted: number[], fraction: number) {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function adaptiveDuplicateThreshold(distanceMatrix: number[][]) {
  const nearest = distanceMatrix.map((row, rowIndex) => Math.min(
    ...row.filter((_, columnIndex) => columnIndex !== rowIndex),
  )).filter(Number.isFinite).sort((a, b) => a - b);
  if (nearest.length < 4) return 0.1;
  const lowerQuartile = nearest.filter((distance) => distance <= quantile(nearest, 0.25));
  const center = quantile(lowerQuartile, 0.5);
  const deviations = lowerQuartile.map((distance) => Math.abs(distance - center)).sort((a, b) => a - b);
  const mad = quantile(deviations, 0.5);
  return Math.max(0.085, Math.min(0.22, center + mad * 2.5 + 0.018));
}

function chooseContentDiversePlan(samples: ScanSample[], desiredCount: number, minimumGap: number) {
  if (!samples.length) return [];
  const fingerprintCache = new WeakMap<VisualFingerprint, WeakMap<VisualFingerprint, number>>();
  const cachedFingerprintDistance: FingerprintDistance = (first, second) => {
    const cached = fingerprintCache.get(first)?.get(second);
    if (cached !== undefined) return cached;
    const measured = visualFingerprintDistance(first, second);
    const firstMap = fingerprintCache.get(first) ?? new WeakMap<VisualFingerprint, number>();
    const secondMap = fingerprintCache.get(second) ?? new WeakMap<VisualFingerprint, number>();
    firstMap.set(second, measured);
    secondMap.set(first, measured);
    fingerprintCache.set(first, firstMap);
    fingerprintCache.set(second, secondMap);
    return measured;
  };
  const distanceMatrix = Array.from({ length: samples.length }, () => Array.from({ length: samples.length }, () => 0));
  for (let first = 0; first < samples.length; first += 1) {
    for (let second = first + 1; second < samples.length; second += 1) {
      const measured = measureVisualSceneDistance(samples[first], samples[second], cachedFingerprintDistance);
      distanceMatrix[first][second] = measured;
      distanceMatrix[second][first] = measured;
    }
  }
  const duplicateThreshold = Math.max(0.045, adaptiveDuplicateThreshold(distanceMatrix) * 0.62);
  const absoluteDuplicateFloor = 0.012;
  const qualities = samples.map(sampleSelectionQuality);
  const minimumQuality = Math.min(...qualities);
  const maximumQuality = Math.max(...qualities);
  const qualityRange = maximumQuality - minimumQuality || 1;
  const selected: number[] = [qualities.indexOf(maximumQuality)];

  while (selected.length < Math.min(desiredCount, samples.length)) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < samples.length; index += 1) {
      if (selected.includes(index)) continue;
      if (selected.some((selectedIndex) => Math.abs(samples[index].timestamp - samples[selectedIndex].timestamp) < minimumGap)) continue;
      const novelty = Math.min(...selected.map((selectedIndex) => distanceMatrix[index][selectedIndex]));
      // Only effectively identical frames are hard duplicates. Softer visual
      // repeats are penalized, not removed, so a high requested count can still
      // be filled after all distinct material is exhausted.
      if (novelty < absoluteDuplicateFloor) continue;
      const normalizedQuality = (qualities[index] - minimumQuality) / qualityRange;
      const sceneReuseCount = samples[index].narrativeScene === undefined
        ? 0
        : selected.filter((selectedIndex) => samples[selectedIndex].narrativeScene === samples[index].narrativeScene).length;
      // Cover every narrative section first, then allow genuinely different
      // shots from the same section when the requested count still has room.
      const sceneReusePenalty = Math.min(0.24, sceneReuseCount * 0.08);
      const visualRepeatPenalty = novelty < duplicateThreshold
        ? ((duplicateThreshold - novelty) / duplicateThreshold) * 0.22
        : 0;
      const score = normalizedQuality * 0.72 + novelty * 0.28 - sceneReusePenalty - visualRepeatPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    selected.push(bestIndex);
  }
  return selected.map((index) => samples[index]);
}

export function createVisualContext(timestamp: number, samples: ScanSample[], windowSeconds = 15, maximumFrames = 7) {
  const nearby = samples
    .filter((sample) => Math.abs(sample.timestamp - timestamp) <= windowSeconds && sample.visualFingerprint)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (!nearby.length) return [];
  let center = 0;
  for (let index = 1; index < nearby.length; index += 1) {
    if (Math.abs(nearby[index].timestamp - timestamp) < Math.abs(nearby[center].timestamp - timestamp)) center = index;
  }
  let left = center;
  while (left > 0) {
    const distance = visualFingerprintDistance(nearby[left - 1].visualFingerprint!, nearby[left].visualFingerprint!);
    if (distance >= SHOT_BOUNDARY_DISTANCE) break;
    left -= 1;
  }
  let right = center;
  while (right < nearby.length - 1) {
    const distance = visualFingerprintDistance(nearby[right].visualFingerprint!, nearby[right + 1].visualFingerprint!);
    if (distance >= SHOT_BOUNDARY_DISTANCE) break;
    right += 1;
  }
  const shotFrames = nearby.slice(left, right + 1);
  if (shotFrames.length <= maximumFrames) return shotFrames.map((sample) => sample.visualFingerprint!);
  const step = (shotFrames.length - 1) / (maximumFrames - 1);
  return Array.from({ length: maximumFrames }, (_, index) => shotFrames[Math.round(index * step)].visualFingerprint!);
}

function chooseTimelinePlan(samples: ScanSample[], desiredCount: number, minimumGap: number) {
  const ordered = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  if (!ordered.length || desiredCount <= 0) return [];
  const previousCompatible = ordered.map((sample, index) => {
    let low = 0;
    let high = index - 1;
    let compatible = -1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (sample.timestamp - ordered[middle].timestamp >= minimumGap) {
        compatible = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return compatible;
  });
  // Weighted interval scheduling without copying scene arrays into every DP
  // cell. At 5,400 samples and an 800-candidate recall pool this remains
  // bounded to compact numeric tables instead of millions of growing arrays.
  const maximumCount = Math.min(desiredCount, ordered.length);
  const width = maximumCount + 1;
  const rows = ordered.length + 1;
  const qualities = new Float64Array(rows * width);
  qualities.fill(Number.NEGATIVE_INFINITY);
  const tookSample = new Uint8Array(rows * width);
  for (let row = 0; row < rows; row += 1) qualities[row * width] = 0;
  for (let index = 1; index <= ordered.length; index += 1) {
    const sample = ordered[index - 1];
    const sampleQuality = sampleSelectionQuality(sample);
    const compatibleRow = previousCompatible[index - 1] + 1;
    for (let count = 1; count <= Math.min(index, maximumCount); count += 1) {
      const cell = index * width + count;
      const skipped = qualities[(index - 1) * width + count];
      const base = qualities[compatibleRow * width + count - 1];
      const included = Number.isFinite(base) ? base + sampleQuality : Number.NEGATIVE_INFINITY;
      if (included > skipped) {
        qualities[cell] = included;
        tookSample[cell] = 1;
      } else {
        qualities[cell] = skipped;
      }
    }
  }
  let selectedCount = maximumCount;
  while (selectedCount > 0 && !Number.isFinite(qualities[ordered.length * width + selectedCount])) selectedCount -= 1;
  const selected: ScanSample[] = [];
  let row = ordered.length;
  let count = selectedCount;
  while (row > 0 && count > 0) {
    if (tookSample[row * width + count]) {
      selected.push(ordered[row - 1]);
      row = previousCompatible[row - 1] + 1;
      count -= 1;
    } else {
      row -= 1;
    }
  }
  return selected.reverse();
}

function chooseDistinctTimelinePlan(
  samples: ScanSample[],
  desiredCount: number,
  minimumGap: number,
  maximumVisualHashDistance: number,
  visualDuplicateWindowSeconds: number,
) {
  const candidates = [...samples];
  while (candidates.length) {
    const plan = chooseTimelinePlan(candidates, desiredCount, minimumGap);
    let duplicate: [ScanSample, ScanSample] | null = null;
    for (let first = 0; first < plan.length && !duplicate; first += 1) {
      for (let second = first + 1; second < plan.length; second += 1) {
        const firstHash = plan[first].visualHash;
        const secondHash = plan[second].visualHash;
        if (!firstHash || !secondHash) continue;
        if (plan[second].timestamp - plan[first].timestamp > visualDuplicateWindowSeconds) break;
        if (visualHashDistance(firstHash, secondHash) <= maximumVisualHashDistance) {
          duplicate = [plan[first], plan[second]];
          break;
        }
      }
    }
    if (!duplicate) return plan;
    const [first, second] = duplicate;
    const lowerQuality = sampleSelectionQuality(first) < sampleSelectionQuality(second) ? first : second;
    candidates.splice(candidates.indexOf(lowerQuality), 1);
  }
  return [];
}

export function selectSceneMatches(
  samples: ScanSample[],
  desiredCount: number,
  clipDuration: number,
  videoDuration: number,
  minimumSimilarity: number,
  options: SceneSelectionOptions = {},
) {
  const exclusionRadius = Math.max(8, clipDuration * 2);
  const ranked = samples
    .filter((sample) => sample.similarity >= minimumSimilarity
      && sample.weakestSimilarity >= minimumSimilarity - 0.12
      && sample.referenceHits >= 2
      && sample.faceQuality >= 0.16
      && (options.excludedTimestamps ?? []).every((timestamp) => Math.abs(timestamp - sample.timestamp) >= exclusionRadius))
    .sort((a, b) => (b.similarity - a.similarity) || (b.faceQuality - a.faceQuality));

  const timelineCandidates: ScanSample[] = [];
  const bucketCounts = new Map<number, number>();
  const minimumGap = options.minimumGapSeconds ?? Math.max(clipDuration * 0.85, 1);
  for (const sample of ranked) {
    const bucket = options.timelineBucketSeconds
      ? Math.floor(sample.timestamp / options.timelineBucketSeconds)
      : null;
    const bucketHasSpace = bucket === null
      || (bucketCounts.get(bucket) ?? 0) < (options.maximumMatchesPerTimelineBucket ?? Number.POSITIVE_INFINITY);
    if (bucketHasSpace) {
      timelineCandidates.push(sample);
      if (bucket !== null) bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
    }
  }

  const selected = options.contentDiversity
    ? chooseContentDiversePlan(timelineCandidates, desiredCount, minimumGap)
    : chooseDistinctTimelinePlan(
      timelineCandidates,
      desiredCount,
      minimumGap,
      options.maximumVisualHashDistance ?? -1,
      options.visualDuplicateWindowSeconds ?? Number.POSITIVE_INFINITY,
    );

  return selected
    .sort((a, b) => a.timestamp - b.timestamp)
    .map<SceneMatch>((sample, index) => {
      const start = Math.max(0, Math.min(sample.timestamp, Math.max(0, videoDuration - clipDuration)));
      const end = Math.min(videoDuration, start + clipDuration);
      return {
        id: `scene-${index + 1}-${Math.round(sample.timestamp * 1000)}`,
        start,
        end,
        center: Math.min(end, start + Math.min(0.3, clipDuration / 10)),
        similarity: sample.similarity,
        visualHash: sample.visualHash,
        verificationCount: sample.verificationCount,
        verificationTotal: sample.verificationTotal,
      };
    });
}

export function createClipCheckOffsets(clipDuration: number) {
  const safeDuration = Math.max(0.5, clipDuration);
  const last = Math.max(0.05, safeDuration - 0.12);
  const offsets = [0.04, Math.min(0.22, last), Math.min(0.55, last)];
  const interval = Math.max(0.65, Math.min(0.9, safeDuration / 6));
  for (let offset = Math.max(1.15, interval); offset < last - 0.15; offset += interval) offsets.push(offset);
  offsets.push(last);
  return [...new Set(offsets.map((offset) => Math.round(offset * 1000) / 1000))].sort((a, b) => a - b);
}

export function createCandidateClipStarts(candidateTimestamp: number, clipDuration: number, videoDuration: number) {
  const maximumStart = Math.max(0, videoDuration - clipDuration);
  return [...new Set([0, 0.16, 0.32, 0.48, 0.64, 0.8].map((fraction) => {
    const start = Math.max(0, Math.min(maximumStart, candidateTimestamp - clipDuration * fraction));
    return Math.round(start * 1000) / 1000;
  }))];
}

export function createVerificationClipStarts(
  candidateTimestamp: number,
  clipDuration: number,
  videoDuration: number,
  samples: ScanSample[],
  proposalThreshold: number,
) {
  if (!samples.length) return createCandidateClipStarts(candidateTimestamp, clipDuration, videoDuration);
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].timestamp < candidateTimestamp) low = middle + 1;
    else high = middle;
  }
  let closest = low;
  if (closest > 0
    && Math.abs(samples[closest - 1].timestamp - candidateTimestamp) < Math.abs(samples[closest].timestamp - candidateTimestamp)) {
    closest -= 1;
  }
  let runStart = closest;
  while (runStart > 0) {
    const previous = samples[runStart - 1];
    const current = samples[runStart];
    if (current.timestamp - previous.timestamp > 2.6 || !samplePassesIdentity(previous, proposalThreshold)) break;
    if (previous.visualFingerprint && current.visualFingerprint
      && visualFingerprintDistance(previous.visualFingerprint, current.visualFingerprint) >= SHOT_BOUNDARY_DISTANCE) break;
    runStart -= 1;
  }
  const maximumStart = Math.max(0, videoDuration - clipDuration);
  const anchor = Math.max(0, Math.min(maximumStart, samples[runStart].timestamp));
  const candidate = Math.max(0, Math.min(maximumStart, candidateTimestamp));
  const middle = anchor + (candidate - anchor) / 2;
  const smallForwardCorrection = Math.min(maximumStart, anchor + Math.min(0.55, clipDuration * 0.1));
  return [...new Set([anchor, middle, candidate, smallForwardCorrection]
    .map((timestamp) => Math.round(timestamp * 1000) / 1000))]
    .sort((first, second) => first - second)
    .slice(0, 3);
}

export function createBalancedCandidateOrder(samples: ScanSample[], videoDuration: number, desiredBuckets: number) {
  if (samples.length < 2 || videoDuration <= 0 || desiredBuckets <= 1) return [...samples];
  const bucketCount = Math.max(1, Math.min(desiredBuckets, samples.length));
  const buckets = Array.from({ length: bucketCount }, () => [] as ScanSample[]);
  for (const sample of samples) {
    const bucket = Math.min(bucketCount - 1, Math.floor((sample.timestamp / videoDuration) * bucketCount));
    buckets[bucket].push(sample);
  }
  for (const bucket of buckets) bucket.sort((first, second) => sampleSelectionQuality(second) - sampleSelectionQuality(first));
  const ordered: ScanSample[] = [];
  const maximumDepth = Math.max(...buckets.map((bucket) => bucket.length));
  for (let depth = 0; depth < maximumDepth; depth += 1) {
    for (const bucket of buckets) {
      if (bucket[depth]) ordered.push(bucket[depth]);
    }
  }
  return ordered;
}

export function createNarrativeCandidateOrder(samples: ScanSample[], videoDuration: number, desiredBuckets: number) {
  if (!samples.length) return [];
  const ordered = [...samples].sort((first, second) => first.timestamp - second.timestamp);
  const groups: ScanSample[][] = [[]];
  let pending: ScanSample[] = [];
  for (const sample of ordered) {
    const current = groups.at(-1);
    const lastObserved = pending.at(-1) ?? current?.at(-1);
    if (lastObserved && sample.timestamp - lastObserved.timestamp > 150) {
      if (pending.length) groups.push(pending);
      groups.push([sample]);
      pending = [];
      continue;
    }
    let continuesCurrentScene = false;
    if (current?.length && sample.visualFingerprint) {
      const recent = current
        .filter((candidate) => sample.timestamp - candidate.timestamp <= 150 && candidate.visualFingerprint)
        .slice(-8);
      const distances = recent
        .map((candidate) => visualSceneDistance(sample, candidate))
        .sort((first, second) => first - second);
      const closest = distances[0] ?? 1;
      continuesCurrentScene = closest <= 0.26;
    }
    if (continuesCurrentScene) {
      current!.push(...pending, sample);
      pending = [];
      continue;
    }
    pending.push(sample);
    const pendingSpan = pending.at(-1)!.timestamp - pending[0].timestamp;
    // A single unfamiliar POV is not a boundary. Three consecutive unmatched
    // candidates (or a sustained unmatched run) form a new narrative scene.
    if (pending.length >= 3 || pendingSpan >= 75) {
      groups.push(pending);
      pending = [];
    }
  }
  if (pending.length) groups.push(pending);
  if (!groups[0].length) groups.shift();
  const rankedGroups = groups.map((group, narrativeScene) => group
    .map((sample) => ({ ...sample, narrativeScene }))
    .sort((first, second) => sampleSelectionQuality(second) - sampleSelectionQuality(first)));
  const leaders = rankedGroups.map((group) => group[0]);
  const balancedLeaders = createBalancedCandidateOrder(leaders, videoDuration, Math.min(desiredBuckets, leaders.length));
  const groupOrder = balancedLeaders.map((leader) => leader.narrativeScene!);
  const result: ScanSample[] = [];
  const maximumDepth = Math.max(...rankedGroups.map((group) => group.length));
  for (let depth = 0; depth < maximumDepth; depth += 1) {
    for (const groupIndex of groupOrder) {
      if (rankedGroups[groupIndex][depth]) result.push(rankedGroups[groupIndex][depth]);
    }
  }
  return result;
}

export function calibrateIdentityThreshold(requestedThreshold: number, referenceAgreement: number) {
  // Reference disagreement signals uncertainty. It must never make matching
  // more permissive; the robust 2-of-3 template handles one weak reference.
  const uncertaintyFloor = Number.isFinite(referenceAgreement) && referenceAgreement >= 0.78 ? 0.72 : 0.76;
  return Math.max(uncertaintyFloor, Math.min(0.94, requestedThreshold));
}

export function createProposalThreshold(verificationThreshold: number) {
  // Candidate generation gets a narrow recall margin; it is never used to
  // approve a clip. Full-duration verification still uses the requested
  // identity threshold, which prevents recall work from lowering precision.
  return Math.max(0.72, verificationThreshold - 0.04);
}

export function samplePassesIdentity(sample: ScanSample, threshold: number) {
  return sample.similarity >= threshold
    && sample.weakestSimilarity >= threshold - 0.06
    && sample.referenceHits >= 2
    && sample.faceQuality >= 0.16;
}

function calculatePassingCoverage(
  checks: ScanSample[],
  states: boolean[],
  clipStart: number,
  clipDuration: number,
) {
  const clipEnd = clipStart + clipDuration;
  let passingSeconds = 0;
  for (let index = 0; index < checks.length; index += 1) {
    if (!states[index]) continue;
    const left = index === 0
      ? clipStart
      : (checks[index - 1].timestamp + checks[index].timestamp) / 2;
    const right = index === checks.length - 1
      ? clipEnd
      : (checks[index].timestamp + checks[index + 1].timestamp) / 2;
    passingSeconds += Math.max(0, Math.min(clipEnd, right) - Math.max(clipStart, left));
  }
  return Math.min(clipDuration, passingSeconds);
}

export function validateClipChecks(
  checks: ScanSample[],
  threshold: number,
  clipStart = checks[0]?.timestamp ?? 0,
  clipDuration = Math.max(0, (checks.at(-1)?.timestamp ?? clipStart) - clipStart),
) {
  const states = checks.map((sample) => samplePassesIdentity(sample, threshold));
  const passing = states.filter(Boolean);
  const openingChecks = states.slice(0, Math.min(3, states.length));
  const openingIsValid = states[0] === true && openingChecks.filter(Boolean).length >= 2;
  const passingSeconds = calculatePassingCoverage(checks, states, clipStart, clipDuration);
  // A result clip may intentionally include context around a brief action cut.
  // Two verified opening observations are still mandatory, but the character
  // no longer has to occupy most of a five-second export.
  const requiredPresenceSeconds = Math.min(0.3, clipDuration * 0.1);
  return {
    accepted: checks.length >= 3
      && openingIsValid
      && passing.length >= 2
      && passingSeconds >= requiredPresenceSeconds,
    passing: passing.length,
    total: checks.length,
    passingSeconds,
    requiredPresenceSeconds,
    conservativeSimilarity: passing.length ? Math.min(...checks.filter((_, index) => states[index]).map((sample) => sample.similarity)) : 0,
  };
}

function medianNumber(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function createVerifiedClipSample(checks: ScanSample[], threshold: number, clipStart: number, clipDuration: number) {
  const validation = validateClipChecks(checks, threshold, clipStart, clipDuration);
  if (!validation.accepted) return null;
  const passingChecks = checks.filter((sample) => samplePassesIdentity(sample, threshold));
  const visualFingerprint = averageVisualFingerprints(
    passingChecks.flatMap((sample) => sample.visualFingerprint ? [sample.visualFingerprint] : []),
  );
  return {
    timestamp: clipStart,
    similarity: validation.conservativeSimilarity,
    weakestSimilarity: Math.min(...passingChecks.map((sample) => sample.weakestSimilarity)),
    referenceHits: Math.round(medianNumber(passingChecks.map((sample) => sample.referenceHits))),
    faceCount: Math.round(medianNumber(passingChecks.map((sample) => sample.faceCount))),
    faceQuality: Math.min(...passingChecks.map((sample) => sample.faceQuality)),
    visualHash: checks[0]?.visualHash,
    visualFingerprint,
    verificationCount: validation.passing,
    verificationTotal: validation.total,
  } satisfies ScanSample;
}

export function visualHashDistance(first: string, second: string) {
  if (first.length !== second.length || !first.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) distance += 1;
  }
  return distance;
}

export function waitForVideoEvent(video: HTMLVideoElement, eventName: "loadedmetadata" | "seeked" | "canplay") {
  return new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The browser could not read this point in the video."));
    };
    const cleanup = () => {
      video.removeEventListener(eventName, onReady);
      video.removeEventListener("error", onError);
    };
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

export async function seekVideo(video: HTMLVideoElement, timestamp: number) {
  const safeTime = Math.max(0, Math.min(timestamp, Math.max(0, video.duration - 0.05)));
  if (Math.abs(video.currentTime - safeTime) < 0.025 && video.readyState >= 2) return;
  const ready = waitForVideoEvent(video, "seeked");
  video.currentTime = safeTime;
  await ready;
}

function frameSize(video: HTMLVideoElement, maximumWidth = 640) {
  const sourceWidth = Math.max(1, video.videoWidth);
  const sourceHeight = Math.max(1, video.videoHeight);
  const width = Math.min(maximumWidth, sourceWidth);
  return { width, height: Math.max(1, Math.round(width * (sourceHeight / sourceWidth))) };
}

function reusableDocumentCanvas(
  current: HTMLCanvasElement | null,
  width: number,
  height: number,
) {
  const canvas = current ?? document.createElement("canvas");
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas;
}

function createVisualHash(source: CanvasImageSource) {
  visualHashCanvas = reusableDocumentCanvas(visualHashCanvas, 9, 8);
  const context = visualHashCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(source, 0, 0, visualHashCanvas.width, visualHashCanvas.height);
  const pixels = context.getImageData(0, 0, visualHashCanvas.width, visualHashCanvas.height).data;
  let hash = "";
  for (let y = 0; y < visualHashCanvas.height; y += 1) {
    for (let x = 0; x < visualHashCanvas.width - 1; x += 1) {
      const current = (y * visualHashCanvas.width + x) * 4;
      const next = current + 4;
      const currentLuma = pixels[current] * 0.299 + pixels[current + 1] * 0.587 + pixels[current + 2] * 0.114;
      const nextLuma = pixels[next] * 0.299 + pixels[next + 1] * 0.587 + pixels[next + 2] * 0.114;
      hash += currentLuma > nextLuma ? "1" : "0";
    }
  }
  return hash;
}

function rgbToHsv(red: number, green: number, blue: number) {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === red) hue = ((green - blue) / delta) % 6;
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue = ((hue / 6) + 1) % 1;
  }
  return { hue, saturation: maximum ? delta / maximum : 0, value: maximum };
}

function normalizeHistogramRange(histogram: number[], start: number, end: number, total: number) {
  for (let index = start; index < end; index += 1) histogram[index] /= total;
}

function createVisualFingerprint(source: CanvasImageSource, hash?: string): VisualFingerprint | undefined {
  const width = 24;
  const height = 14;
  visualFingerprintCanvas = reusableDocumentCanvas(visualFingerprintCanvas, width, height);
  const context = visualFingerprintCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const luma: number[] = [];
  const histogram = Array.from({ length: 24 }, () => 0);
  const layout = Array.from({ length: 4 * 3 * 3 }, () => 0);
  const layoutCounts = Array.from({ length: 4 * 3 }, () => 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset] / 255;
      const green = pixels[offset + 1] / 255;
      const blue = pixels[offset + 2] / 255;
      luma.push(red * 0.299 + green * 0.587 + blue * 0.114);
      const hsv = rgbToHsv(red, green, blue);
      histogram[Math.min(11, Math.floor(hsv.hue * 12))] += 1;
      histogram[12 + Math.min(5, Math.floor(hsv.saturation * 6))] += 1;
      histogram[18 + Math.min(5, Math.floor(hsv.value * 6))] += 1;
      const cellX = Math.min(3, Math.floor(x / (width / 4)));
      const cellY = Math.min(2, Math.floor(y / (height / 3)));
      const cell = cellY * 4 + cellX;
      layout[cell * 3] += red;
      layout[cell * 3 + 1] += green;
      layout[cell * 3 + 2] += blue;
      layoutCounts[cell] += 1;
    }
  }
  normalizeHistogramRange(histogram, 0, 12, width * height);
  normalizeHistogramRange(histogram, 12, 18, width * height);
  normalizeHistogramRange(histogram, 18, 24, width * height);
  for (let cell = 0; cell < layoutCounts.length; cell += 1) {
    const count = layoutCounts[cell] || 1;
    layout[cell * 3] /= count;
    layout[cell * 3 + 1] /= count;
    layout[cell * 3 + 2] /= count;
  }
  return { luma, histogram, layout, hash };
}

async function captureFrameSource(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  includePreview: boolean,
  maximumWidth: number,
) {
  const width = Math.min(maximumWidth, Math.max(1, sourceWidth));
  const height = Math.max(1, Math.round(width * (Math.max(1, sourceHeight) / Math.max(1, sourceWidth))));
  frameCaptureCanvas = reusableDocumentCanvas(frameCaptureCanvas, width, height);
  const context = frameCaptureCanvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser could not prepare a local video frame.");
  context.drawImage(source, 0, 0, width, height);
  const visualHash = createVisualHash(frameCaptureCanvas);
  const visualFingerprint = createVisualFingerprint(frameCaptureCanvas, visualHash);
  const previewBlob = includePreview
    ? await new Promise<Blob | null>((resolve) => frameCaptureCanvas!.toBlob(resolve, "image/jpeg", 0.82))
    : null;
  const bitmap = await createImageBitmap(frameCaptureCanvas);
  return { bitmap, previewBlob, visualHash, visualFingerprint };
}

export async function captureVideoFrame(video: HTMLVideoElement, includePreview = false, maximumWidth = 960) {
  const { width, height } = frameSize(video, maximumWidth);
  return captureFrameSource(video, width, height, includePreview, maximumWidth);
}

export async function captureCanvasFrame(
  source: HTMLCanvasElement | OffscreenCanvas,
  includePreview = false,
  maximumWidth = 960,
) {
  if (!includePreview && source.width <= maximumWidth) {
    const visualHash = createVisualHash(source);
    const visualFingerprint = createVisualFingerprint(source, visualHash);
    const bitmap = await createImageBitmap(source);
    return { bitmap, previewBlob: null, visualHash, visualFingerprint };
  }
  return captureFrameSource(source, source.width, source.height, includePreview, maximumWidth);
}
