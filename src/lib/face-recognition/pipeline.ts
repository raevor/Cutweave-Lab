import type { ScanSample, SceneMatch } from "./types";

export const MAX_VIDEO_DURATION_SECONDS = 3 * 60 * 60;
export const MAX_SCAN_SAMPLES = 2400;

type SceneSelectionOptions = {
  excludedTimestamps?: number[];
  minimumGapSeconds?: number;
  maximumVisualHashDistance?: number;
  visualDuplicateWindowSeconds?: number;
  timelineBucketSeconds?: number;
  maximumMatchesPerTimelineBucket?: number;
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

export function calculateSceneIsolationSeconds(videoDuration: number, desiredCount: number, clipDuration: number) {
  const safeCount = Math.max(1, desiredCount);
  const durationBased = videoDuration / safeCount * 1.3;
  const longFormFloor = videoDuration >= 30 * 60 ? 150
    : videoDuration >= 15 * 60 ? 90
      : 45;
  return Math.min(180, Math.max(longFormFloor, durationBased, clipDuration * 4));
}

type TimelinePlan = { samples: ScanSample[]; quality: number };

function isBetterPlan(candidate: TimelinePlan, current: TimelinePlan) {
  return candidate.samples.length > current.samples.length
    || (candidate.samples.length === current.samples.length && candidate.quality > current.quality);
}

function sampleSelectionQuality(sample: ScanSample) {
  return sample.similarity * 0.65 + sample.weakestSimilarity * 0.2 + sample.faceQuality * 0.15;
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

  const selected = chooseDistinctTimelinePlan(
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
  return {
    timestamp: clipStart,
    similarity: validation.conservativeSimilarity,
    weakestSimilarity: Math.min(...passingChecks.map((sample) => sample.weakestSimilarity)),
    referenceHits: Math.round(medianNumber(passingChecks.map((sample) => sample.referenceHits))),
    faceCount: Math.round(medianNumber(passingChecks.map((sample) => sample.faceCount))),
    faceQuality: Math.min(...passingChecks.map((sample) => sample.faceQuality)),
    visualHash: checks[0]?.visualHash,
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

export async function captureVideoFrame(video: HTMLVideoElement, includePreview = false, maximumWidth = 960) {
  const { width, height } = frameSize(video, maximumWidth);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser could not prepare a local video frame.");
  context.drawImage(video, 0, 0, width, height);
  const visualHash = createVisualHash(canvas);
  const previewBlob = includePreview
    ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82))
    : null;
  const bitmap = await createImageBitmap(canvas);
  canvas.width = 1;
  canvas.height = 1;
  return { bitmap, previewBlob, visualHash };
}
