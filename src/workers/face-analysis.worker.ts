import "@tensorflow/tfjs-backend-webgpu";
import * as faceapi from "@vladmandic/face-api/dist/face-api.esm-nobundle.js";
import {
  calculateReferenceAgreement,
  evaluateIdentityCandidate,
  prepareFaceEmbedding,
} from "@/lib/face-recognition/identity-matching";
import type { FaceEngine, FaceWorkerRequest, FaceWorkerResponse } from "@/lib/face-recognition/types";

let activeEngine: FaceEngine | null = null;
const referenceEmbeddings = new Map<number, number[]>();
const cancelledJobs = new Set<string>();
const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.2 });
const tfRuntime = faceapi.tf as typeof faceapi.tf & {
  setWasmPaths: (path: string) => void;
  setBackend: (backend: string) => Promise<boolean>;
  ready: () => Promise<void>;
  getBackend: () => string;
};

function configureWorkerEnvironment() {
  class WorkerMediaPlaceholder {}
  const canvasClass = typeof OffscreenCanvas === "undefined" ? WorkerMediaPlaceholder : OffscreenCanvas;
  const imageClass = typeof ImageBitmap === "undefined" ? WorkerMediaPlaceholder : ImageBitmap;
  const imageDataClass = typeof ImageData === "undefined" ? WorkerMediaPlaceholder : ImageData;
  faceapi.env.setEnv({
    Canvas: canvasClass,
    CanvasRenderingContext2D: WorkerMediaPlaceholder,
    Image: imageClass,
    ImageData: imageDataClass,
    Video: WorkerMediaPlaceholder,
    createCanvasElement: () => {
      if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas is unavailable in this browser worker.");
      return new OffscreenCanvas(1, 1);
    },
    createImageElement: () => { throw new Error("Image elements are unavailable in this browser worker."); },
    createVideoElement: () => { throw new Error("Video elements are unavailable in this browser worker."); },
    fetch: (url: string, init?: RequestInit) => fetch(url, init),
    readFile: async () => { throw new Error("Filesystem access is disabled in the browser worker."); },
  } as unknown as faceapi.Environment);
}

configureWorkerEnvironment();

function send(message: FaceWorkerResponse) {
  self.postMessage(message);
}

function referenceAgreement(nextEmbedding?: number[]) {
  const embeddings = [...referenceEmbeddings.values()];
  if (nextEmbedding) embeddings.push(nextEmbedding);
  return calculateReferenceAgreement(embeddings);
}

async function initialize(engine: FaceEngine, origin: string) {
  const requestedBackend = engine === "gpu" ? "webgpu" : "wasm";
  let backend = requestedBackend;
  if (backend === "wasm") tfRuntime.setWasmPaths(`${origin}/wasm/`);
  try {
    const activated = await tfRuntime.setBackend(backend);
    if (!activated) throw new Error(`${backend} could not be activated`);
  } catch (backendError) {
    if (requestedBackend !== "webgpu") throw backendError;
    backend = "wasm";
    tfRuntime.setWasmPaths(`${origin}/wasm/`);
    const activated = await tfRuntime.setBackend(backend);
    if (!activated) throw backendError;
  }
  await tfRuntime.ready();
  const modelPath = `${origin}/models/face-api`;
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(modelPath),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(modelPath),
    faceapi.nets.faceRecognitionNet.loadFromUri(modelPath),
  ]);
  activeEngine = engine;
  referenceEmbeddings.clear();
  return tfRuntime.getBackend();
}

async function detect(bitmap: ImageBitmap) {
  let tensor: ReturnType<typeof faceapi.tf.browser.fromPixels> | null = null;
  try {
    tensor = faceapi.tf.browser.fromPixels(bitmap);
    return await faceapi.detectAllFaces(tensor, detectorOptions)
      .withFaceLandmarks(true)
      .withFaceDescriptors();
  } finally {
    tensor?.dispose();
    bitmap.close();
  }
}

self.onmessage = async (event: MessageEvent<FaceWorkerRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelledJobs.add(message.jobId);
    send({ type: "cancelled", jobId: message.jobId });
    return;
  }

  try {
    if (message.type === "init") {
      const backend = activeEngine === message.engine
        ? tfRuntime.getBackend()
        : await initialize(message.engine, message.origin);
      send({ type: "ready", requestId: message.requestId, engine: message.engine, backend });
      return;
    }

    if (message.type === "clear-references") {
      referenceEmbeddings.clear();
      send({ type: "references-cleared", requestId: message.requestId });
      return;
    }

    if (message.type === "reference") {
      const faces = await detect(message.bitmap);
      const selected = [...faces].sort((first, second) => {
        const firstBox = first.detection.box;
        const secondBox = second.detection.box;
        return (secondBox.width * secondBox.height) - (firstBox.width * firstBox.height);
      })[0];
      if (!selected?.descriptor?.length) throw new Error("No clear face was found in this crop. Try a closer, front-facing shot.");
      const embedding = prepareFaceEmbedding(Array.from(selected.descriptor));
      const agreement = referenceAgreement(embedding);
      if (referenceEmbeddings.size > 0 && agreement < 0.28) {
        throw new Error("This crop does not look like the earlier reference face. Crop the same person more closely.");
      }
      referenceEmbeddings.set(message.slot, embedding);
      const box = selected.detection.box;
      send({
        type: "reference-ready",
        requestId: message.requestId,
        slot: message.slot,
        faceCount: faces.length,
        box: [box.x, box.y, box.width, box.height],
        agreement,
      });
      return;
    }

    if (message.type === "scan") {
      if (cancelledJobs.has(message.jobId)) {
        message.bitmap.close();
        send({ type: "cancelled", jobId: message.jobId });
        return;
      }
      const faces = await detect(message.bitmap);
      if (cancelledJobs.has(message.jobId)) {
        send({ type: "cancelled", jobId: message.jobId });
        return;
      }
      if (referenceEmbeddings.size < 3) throw new Error("Three reference faces are required before scanning.");
      const references = [...referenceEmbeddings.values()];
      const candidates = faces
        .filter((face) => face.descriptor?.length
          && face.detection.score >= 0.2
          && Math.min(face.detection.box.width, face.detection.box.height) >= 20)
        .map((face) => {
          const identity = evaluateIdentityCandidate(references, Array.from(face.descriptor), message.threshold);
          const minimumFaceSize = Math.min(face.detection.box.width, face.detection.box.height);
          const sizeQuality = Math.max(0, Math.min(1, (minimumFaceSize - 20) / 100));
          return {
            similarity: identity.similarity,
            weakestSimilarity: identity.weakestSimilarity,
            referenceHits: identity.referenceHits,
            quality: Math.max(0, Math.min(1, face.detection.score * 0.75 + sizeQuality * 0.25)),
          };
        })
        .sort((first, second) => (second.referenceHits - first.referenceHits)
          || (second.similarity - first.similarity)
          || (second.weakestSimilarity - first.weakestSimilarity)
          || (second.quality - first.quality));
      const best = candidates[0];
      send({
        type: "scan-result",
        requestId: message.requestId,
        jobId: message.jobId,
        timestamp: message.timestamp,
        similarity: best?.similarity ?? 0,
        weakestSimilarity: best?.weakestSimilarity ?? 0,
        referenceHits: best?.referenceHits ?? 0,
        faceCount: candidates.length,
        faceQuality: best?.quality ?? 0,
      });
    }
  } catch (error) {
    if ("bitmap" in message && message.bitmap instanceof ImageBitmap) message.bitmap.close();
    send({
      type: "error",
      requestId: "requestId" in message ? message.requestId : undefined,
      jobId: "jobId" in message ? message.jobId : undefined,
      message: error instanceof Error ? error.message : "The local face engine stopped unexpectedly.",
    });
  }
};

export {};
