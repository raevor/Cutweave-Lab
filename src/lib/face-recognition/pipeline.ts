import type { ScanSample, SceneMatch, VisualFingerprint } from "./types";

export const MAX_VIDEO_DURATION_SECONDS = 3 * 60 * 60;
export const MAX_SCAN_SAMPLES = 2400;

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

export function createSampleTimes(duration: number, clipDuration: number) {
  const coverageInterval = Math.max(1.25, Math.min(2.5, clipDuration * 0.5));
  const boundedInterval = Math.max(coverageInterval, duration / MAX_SCAN_SAMPLES);
  const times: number[] = [];
  for (let timestamp = 0; timestamp < duration; timestamp += boundedInterval) {
    times.push(Math.min(duration - 0.05, timestamp + Math.min(0.35, boundedInterval / 3)));
  }
  return times;
}

type TimelinePlan = { samples: ScanSample[]; quality: number };

function isBetterPlan(candidate: TimelinePlan, current: TimelinePlan) {
  return candidate.samples.length > current.samples.length
    || (candidate.samples.length === current.samples.length && candidate.quality > current.quality);
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
  const contextBoundClipDistance = Math.min(clipDistance, contextDistance + 0.1);
  return contextBoundClipDistance * 0.2 + contextDistance * 0.8;
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
  const duplicateThreshold = adaptiveDuplicateThreshold(distanceMatrix);
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
      if (novelty < duplicateThreshold) continue;
      const normalizedQuality = (qualities[index] - minimumQuality) / qualityRange;
      const score = normalizedQuality * 0.58 + novelty * 0.42;
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

export function createVisualContext(timestamp: number, samples: ScanSample[], windowSeconds = 15, maximumFrames = 9) {
  const nearby = samples
    .filter((sample) => Math.abs(sample.timestamp - timestamp) <= windowSeconds && sample.visualFingerprint)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (nearby.length <= maximumFrames) return nearby.map((sample) => sample.visualFingerprint!);
  const step = (nearby.length - 1) / (maximumFrames - 1);
  return Array.from({ length: maximumFrames }, (_, index) => nearby[Math.round(index * step)].visualFingerprint!);
}

function chooseTimelinePlan(samples: ScanSample[], desiredCount: number, minimumGap: number) {
  const ordered = [...samples].sort((a, b) => a.timestamp - b.timestamp);
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
  const plans = Array.from({ length: ordered.length + 1 }, () => Array.from(
    { length: desiredCount + 1 },
    (): TimelinePlan => ({ samples: [], quality: 0 }),
  ));

  for (let index = 1; index <= ordered.length; index += 1) {
    const sample = ordered[index - 1];
    for (let count = 1; count <= desiredCount; count += 1) {
      const skipped = plans[index - 1][count];
      const base = plans[previousCompatible[index - 1] + 1][count - 1];
      const included = {
        samples: [...base.samples, sample],
        quality: base.quality + sampleSelectionQuality(sample),
      };
      plans[index][count] = isBetterPlan(included, skipped) ? included : skipped;
    }
  }
  return plans[ordered.length][desiredCount].samples;
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
      && sample.faceQuality >= 0.35
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
  const offsets = [0.04, Math.min(0.3, last)];
  const interval = Math.max(0.65, Math.min(0.9, safeDuration / 6));
  for (let offset = Math.max(0.75, interval); offset < last - 0.15; offset += interval) offsets.push(offset);
  offsets.push(last);
  return [...new Set(offsets.map((offset) => Math.round(offset * 1000) / 1000))].sort((a, b) => a - b);
}

export function createCandidateClipStarts(candidateTimestamp: number, clipDuration: number, videoDuration: number) {
  const maximumStart = Math.max(0, videoDuration - clipDuration);
  return [...new Set([0.75, 0.5, 0.25, 0].map((fraction) => {
    const start = Math.max(0, Math.min(maximumStart, candidateTimestamp - clipDuration * fraction));
    return Math.round(start * 1000) / 1000;
  }))].sort((a, b) => a - b);
}

export function calibrateIdentityThreshold(requestedThreshold: number, referenceAgreement: number) {
  const referenceBasedThreshold = referenceAgreement - 0.14;
  return Math.max(0.26, Math.min(0.62, requestedThreshold, referenceBasedThreshold));
}

export function samplePassesIdentity(sample: ScanSample, threshold: number) {
  return sample.similarity >= threshold
    && sample.weakestSimilarity >= threshold - 0.12
    && sample.referenceHits >= 2
    && sample.faceQuality >= 0.35;
}

export function validateClipChecks(checks: ScanSample[], threshold: number) {
  const states = checks.map((sample) => samplePassesIdentity(sample, threshold));
  const passing = states.filter(Boolean);
  const openingIsValid = states[0] === true && states[1] === true;
  const requiredPassing = Math.ceil(checks.length * 0.6);
  return {
    accepted: checks.length >= 3 && openingIsValid && passing.length >= requiredPassing,
    passing: passing.length,
    total: checks.length,
    conservativeSimilarity: passing.length ? Math.min(...checks.filter((_, index) => states[index]).map((sample) => sample.similarity)) : 0,
  };
}

function medianNumber(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function createVerifiedClipSample(checks: ScanSample[], threshold: number, clipStart: number) {
  const validation = validateClipChecks(checks, threshold);
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

function createVisualHash(source: HTMLCanvasElement) {
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 8;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = "";
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width - 1; x += 1) {
      const current = (y * canvas.width + x) * 4;
      const next = current + 4;
      const currentLuma = pixels[current] * 0.299 + pixels[current + 1] * 0.587 + pixels[current + 2] * 0.114;
      const nextLuma = pixels[next] * 0.299 + pixels[next + 1] * 0.587 + pixels[next + 2] * 0.114;
      hash += currentLuma > nextLuma ? "1" : "0";
    }
  }
  canvas.width = 1;
  canvas.height = 1;
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

function createVisualFingerprint(source: HTMLCanvasElement, hash?: string): VisualFingerprint | undefined {
  const canvas = document.createElement("canvas");
  const width = 24;
  const height = 14;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
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
  canvas.width = 1;
  canvas.height = 1;
  return { luma, histogram, layout, hash };
}

export async function captureVideoFrame(video: HTMLVideoElement, includePreview = false, maximumWidth = 960) {
  const { width, height } = frameSize(video, maximumWidth);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser could not prepare a local video frame.");
  context.drawImage(video, 0, 0, width, height);
  const visualHash = createVisualHash(canvas);
  const visualFingerprint = createVisualFingerprint(canvas, visualHash);
  const previewBlob = includePreview
    ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82))
    : null;
  const bitmap = await createImageBitmap(canvas);
  canvas.width = 1;
  canvas.height = 1;
  return { bitmap, previewBlob, visualHash, visualFingerprint };
}
