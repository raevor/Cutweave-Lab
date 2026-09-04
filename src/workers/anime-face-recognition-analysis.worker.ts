import * as ort from "onnxruntime-web/webgpu";
import {
  calculateAnimeReferenceVariantAgreement,
  evaluateAnimeIdentityCandidateVariants,
  normalizeAnimeEmbedding,
} from "@/lib/anime-face-recognition/anime-face-recognition-identity-matching";
import type {
  AnimeFaceEngine,
  AnimeFaceScanMode,
  AnimeFaceWorkerRequest,
  AnimeFaceWorkerResponse,
} from "@/lib/anime-face-recognition/anime-face-recognition-types";

type AnimeHeadDetection = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};

type DetectorInput = {
  tensor: ort.Tensor;
  scale: number;
  padX: number;
  padY: number;
};

type ReusableFloatTensor = {
  data: Float32Array;
  tensor: ort.Tensor;
};

type AnimeCrop = {
  x: number;
  y: number;
  size: number;
};

type AnimeReferenceFeatures = {
  ccip: number[][];
};

type AnimeCandidate = AnimeHeadDetection & {
  ccipEmbeddings: number[][];
};

const DETECTOR_URL = "/models/anime-face-recognition/detector/anime-head-detector.onnx";
const IDENTITY_FP16_URL = "/models/anime-face-recognition/identity/anime-ccip-24-pruned-feature-fp16.onnx";
const IDENTITY_FP32_URL = "/models/anime-face-recognition/identity/anime-ccip-24-pruned-feature-fp32.onnx";
const IDENTITY_FP16_PARTS = [
  "anime-ccip-24-pruned-feature-fp16.part1.data",
] as const;
const IDENTITY_FP32_PARTS = [
  "anime-ccip-24-pruned-feature-fp32.part1.data",
  "anime-ccip-24-pruned-feature-fp32.part2.data",
] as const;
const CCIP_SIZE = 384;
const CCIP_MEAN = [0.48145466, 0.4578275, 0.40821073] as const;
const CCIP_STANDARD_DEVIATION = [0.26862954, 0.26130258, 0.27577711] as const;
const referenceEmbeddings = new Map<number, AnimeReferenceFeatures>();
const cancelledJobs = new Set<string>();
const MAX_REMEMBERED_CANCELLED_JOBS = 32;

let detectorSession: ort.InferenceSession | null = null;
let identitySession: ort.InferenceSession | null = null;
let activeEngine: AnimeFaceEngine | null = null;
let activeBackend = "";
let detectorCanvas: OffscreenCanvas | null = null;
let detectorContext: OffscreenCanvasRenderingContext2D | null = null;
let embeddingCanvas: OffscreenCanvas | null = null;
let embeddingContext: OffscreenCanvasRenderingContext2D | null = null;
let detectorInputBuffer: ReusableFloatTensor | null = null;
const embeddingInputBuffers = new Map<string, ReusableFloatTensor>();

async function restBetweenInferenceBursts(startedAt: number, stage: "detector" | "identity") {
  const elapsed = Math.max(1, performance.now() - startedAt);
  const isGpu = activeBackend === "webgpu";
  const targetDutyCycle = isGpu ? 0.72 : 0.88;
  const minimumRest = stage === "identity" ? (isGpu ? 8 : 4) : (isGpu ? 5 : 3);
  const maximumRest = stage === "identity" ? (isGpu ? 32 : 20) : (isGpu ? 18 : 12);
  const rest = Math.min(maximumRest, Math.max(minimumRest, elapsed * (1 / targetDutyCycle - 1)));
  await new Promise<void>((resolve) => setTimeout(resolve, rest));
}

function send(message: AnimeFaceWorkerResponse) {
  self.postMessage(message);
}

function rememberCancelledJob(jobId: string) {
  cancelledJobs.add(jobId);
  while (cancelledJobs.size > MAX_REMEMBERED_CANCELLED_JOBS) {
    const oldest = cancelledJobs.values().next().value;
    if (oldest === undefined) break;
    cancelledJobs.delete(oldest);
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function intersectionOverUnion(first: AnimeHeadDetection, second: AnimeHeadDetection) {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = first.width * first.height + second.width * second.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function suppressOverlaps(detections: AnimeHeadDetection[], threshold = 0.55, maximumResults = Number.POSITIVE_INFINITY) {
  const sorted = [...detections].sort((first, second) => second.score - first.score);
  const kept: AnimeHeadDetection[] = [];
  for (const detection of sorted) {
    if (kept.every((selected) => intersectionOverUnion(selected, detection) <= threshold)) kept.push(detection);
    if (kept.length >= maximumResults) break;
  }
  return kept;
}

function reusableFloatTensor(
  current: ReusableFloatTensor | undefined | null,
  length: number,
  dimensions: readonly number[],
) {
  if (current?.data.length === length) return current;
  current?.tensor.dispose();
  const data = new Float32Array(length);
  return { data, tensor: new ort.Tensor("float32", data, dimensions) };
}

function reusableCanvas(
  kind: "detector" | "embedding",
  size: number,
) {
  let canvas = kind === "detector" ? detectorCanvas : embeddingCanvas;
  let context = kind === "detector" ? detectorContext : embeddingContext;
  if (!canvas || !context) {
    canvas = new OffscreenCanvas(size, size);
    context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) throw new Error("The browser could not prepare an anime frame for analysis.");
    if (kind === "detector") {
      detectorCanvas = canvas;
      detectorContext = context;
    } else {
      embeddingCanvas = canvas;
      embeddingContext = context;
    }
  }
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  return { canvas, context };
}

function makeDetectorInput(bitmap: ImageBitmap, size: number): DetectorInput {
  const { context } = reusableCanvas("detector", size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const renderedWidth = Math.max(1, Math.round(bitmap.width * scale));
  const renderedHeight = Math.max(1, Math.round(bitmap.height * scale));
  const padX = (size - renderedWidth) / 2;
  const padY = (size - renderedHeight) / 2;
  context.fillStyle = "rgb(114, 114, 114)";
  context.fillRect(0, 0, size, size);
  context.drawImage(bitmap, padX, padY, renderedWidth, renderedHeight);
  const pixels = context.getImageData(0, 0, size, size).data;
  const plane = size * size;
  detectorInputBuffer = reusableFloatTensor(detectorInputBuffer, plane * 3, [1, 3, size, size]);
  const tensorData = detectorInputBuffer.data;
  for (let pixel = 0; pixel < plane; pixel += 1) {
    const rgba = pixel * 4;
    tensorData[pixel] = pixels[rgba] / 255;
    tensorData[plane + pixel] = pixels[rgba + 1] / 255;
    tensorData[plane * 2 + pixel] = pixels[rgba + 2] / 255;
  }
  return {
    tensor: detectorInputBuffer.tensor,
    scale,
    padX,
    padY,
  };
}

function decodeHeadDetections(
  output: ort.Tensor,
  sourceWidth: number,
  sourceHeight: number,
  input: DetectorInput,
  confidenceThreshold: number,
  maximumResults: number,
) {
  const dimensions = output.dims.map(Number);
  if (dimensions.length !== 3 || dimensions[1] < 5) {
    throw new Error(`The anime detector returned an unsupported shape: ${dimensions.join("×")}.`);
  }
  const candidateCount = dimensions[2];
  const data = output.data;
  const detections: AnimeHeadDetection[] = [];
  for (let index = 0; index < candidateCount; index += 1) {
    const score = Number(data[4 * candidateCount + index]);
    if (!Number.isFinite(score) || score < confidenceThreshold) continue;
    const centerX = Number(data[index]);
    const centerY = Number(data[candidateCount + index]);
    const width = Number(data[candidateCount * 2 + index]);
    const height = Number(data[candidateCount * 3 + index]);
    if (![centerX, centerY, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    const x = clamp((centerX - width / 2 - input.padX) / input.scale, 0, sourceWidth);
    const y = clamp((centerY - height / 2 - input.padY) / input.scale, 0, sourceHeight);
    const right = clamp((centerX + width / 2 - input.padX) / input.scale, 0, sourceWidth);
    const bottom = clamp((centerY + height / 2 - input.padY) / input.scale, 0, sourceHeight);
    if (right - x >= 12 && bottom - y >= 12) detections.push({ x, y, width: right - x, height: bottom - y, score });
  }
  return suppressOverlaps(detections, 0.55, maximumResults);
}

function characterCrop(head: AnimeHeadDetection, variant: "portrait" | "head"): AnimeCrop {
  const headSize = Math.max(head.width, head.height);
  const size = headSize * (variant === "portrait" ? 2.5 : 1.55);
  const centerX = head.x + head.width / 2;
  const centerY = head.y + head.height * (variant === "portrait" ? 0.92 : 0.52);
  return { x: centerX - size / 2, y: centerY - size / 2, size };
}

function drawCharacterCrop(
  bitmap: ImageBitmap,
  crop: AnimeCrop,
  canvas: OffscreenCanvas,
  context: OffscreenCanvasRenderingContext2D,
) {
  const outputSize = canvas.width;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "rgb(123, 117, 104)";
  context.fillRect(0, 0, outputSize, outputSize);
  const sourceLeft = clamp(crop.x, 0, bitmap.width);
  const sourceTop = clamp(crop.y, 0, bitmap.height);
  const sourceRight = clamp(crop.x + crop.size, 0, bitmap.width);
  const sourceBottom = clamp(crop.y + crop.size, 0, bitmap.height);
  const sourceWidth = sourceRight - sourceLeft;
  const sourceHeight = sourceBottom - sourceTop;
  if (sourceWidth > 0 && sourceHeight > 0) {
    const destinationX = (sourceLeft - crop.x) / crop.size * outputSize;
    const destinationY = (sourceTop - crop.y) / crop.size * outputSize;
    const destinationWidth = sourceWidth / crop.size * outputSize;
    const destinationHeight = sourceHeight / crop.size * outputSize;
    context.drawImage(
      bitmap,
      sourceLeft,
      sourceTop,
      sourceWidth,
      sourceHeight,
      destinationX,
      destinationY,
      destinationWidth,
      destinationHeight,
    );
  }
}

function makeEmbeddingBatchInput(
  bitmap: ImageBitmap,
  detections: AnimeHeadDetection[],
  size: number,
  mean: readonly number[],
  standardDeviation: readonly number[],
) {
  const variants = detections.flatMap((detection) => [
    characterCrop(detection, "portrait"),
    characterCrop(detection, "head"),
  ]);
  const plane = size * size;
  const batchStride = plane * 3;
  const bufferKey = `${variants.length}:${size}`;
  const inputBuffer = reusableFloatTensor(
    embeddingInputBuffers.get(bufferKey),
    variants.length * batchStride,
    [variants.length, 3, size, size],
  );
  embeddingInputBuffers.set(bufferKey, inputBuffer);
  const { data } = inputBuffer;
  const { canvas, context } = reusableCanvas("embedding", size);
  for (let batch = 0; batch < variants.length; batch += 1) {
    drawCharacterCrop(bitmap, variants[batch], canvas, context);
    const pixels = context.getImageData(0, 0, size, size).data;
    const batchOffset = batch * batchStride;
    for (let pixel = 0; pixel < plane; pixel += 1) {
      const rgba = pixel * 4;
      data[batchOffset + pixel] = (pixels[rgba] / 255 - mean[0]) / standardDeviation[0];
      data[batchOffset + plane + pixel] = (pixels[rgba + 1] / 255 - mean[1]) / standardDeviation[1];
      data[batchOffset + plane * 2 + pixel] = (pixels[rgba + 2] / 255 - mean[2]) / standardDeviation[2];
    }
  }
  return inputBuffer.tensor;
}

async function extractEmbeddings(
  session: ort.InferenceSession | null,
  bitmap: ImageBitmap,
  detections: AnimeHeadDetection[],
  size: number,
  mean: readonly number[],
  standardDeviation: readonly number[],
  maximumDetectionsPerBatch: number,
) {
  if (!session) throw new Error("The anime identity model is not ready.");
  if (!detections.length) return [];
  if (detections.length > maximumDetectionsPerBatch) {
    const embeddings: number[][][] = [];
    for (let start = 0; start < detections.length; start += maximumDetectionsPerBatch) {
      embeddings.push(...await extractEmbeddings(
        session,
        bitmap,
        detections.slice(start, start + maximumDetectionsPerBatch),
        size,
        mean,
        standardDeviation,
        maximumDetectionsPerBatch,
      ));
    }
    return embeddings;
  }
  const input = makeEmbeddingBatchInput(bitmap, detections, size, mean, standardDeviation);
  let output: ort.InferenceSession.OnnxValueMapType | null = null;
  const startedAt = performance.now();
  try {
    output = await session.run({ input });
    const embedding = output[session.outputNames[0]];
    const batchSize = detections.length * 2;
    if (!embedding?.data?.length || embedding.data.length % batchSize !== 0) {
      throw new Error("The anime identity model returned invalid character features.");
    }
    const embeddingData = embedding.data as Float32Array;
    const featureSize = embeddingData.length / batchSize;
    return detections.map((_, detectionIndex) => [0, 1].map((variant) => {
      const start = (detectionIndex * 2 + variant) * featureSize;
      return normalizeAnimeEmbedding(Array.from(embeddingData.subarray(start, start + featureSize)));
    }));
  } finally {
    if (output) Object.values(output).forEach((tensor) => tensor.dispose());
    await restBetweenInferenceBursts(startedAt, "identity");
  }
}

async function detectAnimeCharacters(bitmap: ImageBitmap, mode: AnimeFaceScanMode | "reference") {
  if (!detectorSession || !identitySession) {
    throw new Error("The local anime character engine is not ready.");
  }
  const inferSize = 640;
  const threshold = mode === "reference" ? 0.28 : mode === "verify" ? 0.26 : 0.22;
  const candidateLimit = mode === "coarse" ? 8 : 10;
  try {
    const detectorInput = makeDetectorInput(bitmap, inferSize);
    let detectorOutput: ort.InferenceSession.OnnxValueMapType | null = null;
    let detections: AnimeHeadDetection[];
    const detectorStartedAt = performance.now();
    try {
      detectorOutput = await detectorSession.run({ images: detectorInput.tensor });
      const raw = detectorOutput.output0;
      if (!raw) throw new Error("The anime detector returned no output.");
      detections = decodeHeadDetections(raw, bitmap.width, bitmap.height, detectorInput, threshold, candidateLimit)
        .sort((first, second) => (second.score - first.score)
          || (second.width * second.height - first.width * first.height))
        .slice(0, candidateLimit);
    } finally {
      if (detectorOutput) Object.values(detectorOutput).forEach((tensor) => tensor.dispose());
      await restBetweenInferenceBursts(detectorStartedAt, "detector");
    }
    const embeddingDetections = mode === "reference"
      ? [...detections].sort((first, second) => (
        second.width * second.height * second.score - first.width * first.height * first.score
      )).slice(0, 1)
      : detections;
    const ccipEmbeddings = await extractEmbeddings(
      identitySession,
      bitmap,
      embeddingDetections,
      CCIP_SIZE,
      CCIP_MEAN,
      CCIP_STANDARD_DEVIATION,
      activeBackend === "webgpu" ? 2 : 1,
    );
    return embeddingDetections.map((detection, index) => ({
      ...detection,
      ccipEmbeddings: ccipEmbeddings[index],
    } satisfies AnimeCandidate));
  } finally {
    bitmap.close();
  }
}

async function releaseSessions() {
  const sessions = [detectorSession, identitySession];
  detectorSession = null;
  identitySession = null;
  await Promise.all(sessions.map(async (session) => {
    if (session) await session.release();
  }));
  detectorInputBuffer?.tensor.dispose();
  detectorInputBuffer = null;
  embeddingInputBuffers.forEach(({ tensor }) => tensor.dispose());
  embeddingInputBuffers.clear();
}

async function openSessions(engine: AnimeFaceEngine, origin: string) {
  await releaseSessions();
  ort.env.wasm.wasmPaths = `${origin}/wasm/anime-face-recognition/`;
  ort.env.wasm.proxy = false;
  ort.env.wasm.numThreads = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated
    ? Math.max(1, Math.min(2, navigator.hardwareConcurrency || 1))
    : 1;

  const detectorUrl = `${origin}${DETECTOR_URL}`;
  const webGpuProvider = {
    name: "webgpu",
    preferredLayout: "NCHW",
    validationMode: "disabled",
    storageBufferCacheMode: "simple",
    uniformBufferCacheMode: "simple",
  } satisfies ort.InferenceSession.WebGpuExecutionProviderOption;
  const identityProvider: ort.InferenceSession.ExecutionProviderConfig[] = engine === "gpu"
    ? [webGpuProvider]
    : ["wasm"];

  const createSessions = async (
    executionProviders: ort.InferenceSession.ExecutionProviderConfig[],
    useGpuIdentityModel: boolean,
  ) => {
    const detector = await ort.InferenceSession.create(detectorUrl, {
      executionProviders,
      graphOptimizationLevel: "all",
    });
    try {
      const identityBaseUrl = `${origin}/models/anime-face-recognition/identity/`;
      const identityParts = useGpuIdentityModel ? IDENTITY_FP16_PARTS : IDENTITY_FP32_PARTS;
      const identity = await ort.InferenceSession.create(
        `${origin}${useGpuIdentityModel ? IDENTITY_FP16_URL : IDENTITY_FP32_URL}`,
        {
          executionProviders,
          graphOptimizationLevel: "all",
          externalData: identityParts.map((part) => ({
            path: part,
            data: `${identityBaseUrl}${part}`,
          })),
        },
      );
      return { detector, identity };
    } catch (error) {
      await detector.release();
      throw error;
    }
  };

  try {
    const sessions = await createSessions(identityProvider, engine === "gpu");
    detectorSession = sessions.detector;
    identitySession = sessions.identity;
    activeBackend = engine === "gpu" ? "webgpu" : "wasm";
  } catch (preferredError) {
    detectorSession = null;
    identitySession = null;
    if (engine !== "gpu") throw preferredError;
    const sessions = await createSessions(["wasm"], false);
    detectorSession = sessions.detector;
    identitySession = sessions.identity;
    activeBackend = "wasm";
  }

  activeEngine = engine;
  referenceEmbeddings.clear();
  return activeBackend;
}

self.onmessage = async (event: MessageEvent<AnimeFaceWorkerRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    rememberCancelledJob(message.jobId);
    send({ type: "cancelled", jobId: message.jobId });
    return;
  }

  try {
    if (message.type === "init") {
      const backend = activeEngine === message.engine && detectorSession && identitySession
        ? activeBackend
        : await openSessions(message.engine, message.origin);
      send({ type: "ready", requestId: message.requestId, engine: message.engine, backend });
      return;
    }

    if (message.type === "clear-references") {
      referenceEmbeddings.clear();
      send({ type: "references-cleared", requestId: message.requestId });
      return;
    }

    if (message.type === "reference") {
      const candidates = await detectAnimeCharacters(message.bitmap, "reference");
      const selected = [...candidates].sort((first, second) =>
        (second.width * second.height * second.score) - (first.width * first.height * first.score))[0];
      if (!selected) throw new Error("No clear anime character head was found in this crop. Try a closer shot with the hairstyle visible.");
      const agreement = calculateAnimeReferenceVariantAgreement([
        ...[...referenceEmbeddings.values()].map((reference) => reference.ccip),
        selected.ccipEmbeddings,
      ]);
      if (referenceEmbeddings.size > 0 && agreement < 0.72) {
        throw new Error("This crop does not look like the earlier anime character. Keep the same character and include the hairstyle.");
      }
      referenceEmbeddings.set(message.slot, {
        ccip: selected.ccipEmbeddings,
      });
      send({
        type: "reference-ready",
        requestId: message.requestId,
        slot: message.slot,
        faceCount: candidates.length,
        box: [selected.x, selected.y, selected.width, selected.height],
        agreement,
      });
      return;
    }

    if (message.type === "scan") {
      if (cancelledJobs.has(message.jobId)) {
        cancelledJobs.delete(message.jobId);
        message.bitmap.close();
        send({ type: "cancelled", jobId: message.jobId });
        return;
      }
      const candidates = await detectAnimeCharacters(message.bitmap, message.mode);
      if (cancelledJobs.has(message.jobId)) {
        cancelledJobs.delete(message.jobId);
        send({ type: "cancelled", jobId: message.jobId });
        return;
      }
      if (referenceEmbeddings.size < 3) throw new Error("Three anime character references are required before scanning.");
      const references = [...referenceEmbeddings.values()];
      const ranked = candidates.map((candidate) => {
        const identity = evaluateAnimeIdentityCandidateVariants(
          references.map((reference) => reference.ccip),
          candidate.ccipEmbeddings,
          message.threshold,
        );
        const minimumHeadSize = Math.min(candidate.width, candidate.height);
        const sizeQuality = clamp((minimumHeadSize - 16) / 105, 0, 1);
        return {
          similarity: identity.similarity,
          weakestSimilarity: identity.weakestSimilarity,
          referenceHits: identity.referenceHits,
          quality: clamp(candidate.score * 0.75 + sizeQuality * 0.25, 0, 1),
        };
      }).sort((first, second) => (second.referenceHits - first.referenceHits)
        || (second.similarity - first.similarity)
        || (second.quality - first.quality));
      const best = ranked[0];
      send({
        type: "scan-result",
        requestId: message.requestId,
        jobId: message.jobId,
        timestamp: message.timestamp,
        similarity: best?.similarity ?? 0,
        weakestSimilarity: best?.weakestSimilarity ?? 0,
        referenceHits: best?.referenceHits ?? 0,
        faceCount: ranked.length,
        faceQuality: best?.quality ?? 0,
      });
    }
  } catch (error) {
    if ("bitmap" in message) {
      try { message.bitmap.close(); } catch { /* The bitmap may already have been closed after inference. */ }
    }
    send({
      type: "error",
      requestId: "requestId" in message ? message.requestId : undefined,
      jobId: "jobId" in message ? message.jobId : undefined,
      message: error instanceof Error ? error.message : "The local anime character engine stopped unexpectedly.",
    });
  }
};

export {};
