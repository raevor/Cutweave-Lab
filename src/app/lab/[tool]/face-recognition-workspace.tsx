"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ChangeEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import darkThemeIcon from "../../../../assets/dark-theme.png";
import lightThemeIcon from "../../../../assets/light-theme.png";
import { BrandMark } from "@/components/brand-mark";
import { siteCopy as text } from "@/i18n/messages/en";
import { applySiteTheme, readSiteTheme } from "@/lib/site-theme";
import { canRenderSceneClips, exportScenePackage, preferredClipFormat } from "@/lib/face-recognition/export-clips";
import {
  MAX_VIDEO_DURATION_SECONDS,
  calibrateIdentityThreshold,
  captureCanvasFrame,
  captureVideoFrame,
  createClipCheckOffsets,
  createProposalThreshold,
  createNarrativeCandidateOrder,
  createSampleTimes,
  createVisualContext,
  createVerifiedClipSample,
  createVerificationClipStarts,
  formatTimecode,
  seekVideo,
  selectSceneMatches,
  samplePassesIdentity,
} from "@/lib/face-recognition/pipeline";
import type {
  FaceEngine,
  FaceScanProfile,
  FaceScanMode,
  FaceWorkerRequest,
  FaceWorkerResponse,
  ScanSample,
  SceneMatch,
} from "@/lib/face-recognition/types";
import type { ToolDefinition } from "@/lib/tool-catalog";
import { ReferenceCropper, type NormalizedCrop } from "./reference-cropper";
import styles from "./face-recognition-workspace.module.css";

type ReferenceFrame = {
  slot: number;
  timestamp: number;
  previewUrl: string;
  previewBlob: Blob;
  faceCount: number;
  agreement: number;
};

type CropDraft = { previewUrl: string; previewBlob: Blob; timestamp: number };

type PendingWorkerCall = {
  resolve: (response: FaceWorkerResponse) => void;
  reject: (error: Error) => void;
};

type DecodedFrame = { canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number; duration: number };
type DecodedFrameScanner = {
  canvasesAtTimestamps: (timestamps: number[]) => AsyncGenerator<DecodedFrame | null, void, unknown>;
  getCanvas: (timestamp: number) => Promise<DecodedFrame | null>;
  dispose: () => void;
};

type Phase = "idle" | "source-ready" | "engine-loading" | "analyzing" | "post-processing" | "results" | "exporting" | "cancelled" | "error";
type FaceTheme = "light" | "dark";
type VerificationProgress = { reviewedCandidates: number; totalCandidates: number };
type TrailPoint = { x: number; y: number; createdAt: number };

const subscribeToCapabilities = () => () => undefined;
const MAX_SCENE_COUNT = 100;
const MAX_PRELIMINARY_SCENE_COUNT = MAX_SCENE_COUNT * 8;
const scanProfileOptions = [
  {
    value: "efficient",
    title: "Efficient",
    badge: "Lower load",
    description: "Checks half as many timeline frames. Faster and lighter, but brief appearances may be missed.",
  },
  {
    value: "maximum",
    title: "Maximum",
    badge: "Recommended",
    description: "Uses the current full scan density for the strongest recall.",
  },
] satisfies Array<{ value: FaceScanProfile; title: string; badge: string; description: string }>;

async function createDecodedFrameScanner(file: File): Promise<DecodedFrameScanner | null> {
  if (typeof VideoDecoder === "undefined") return null;
  let input: { dispose: () => void } | null = null;
  try {
    const { ALL_FORMATS, BlobSource, CanvasSink, Input } = await import("mediabunny");
    const nextInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    input = nextInput;
    const track = await nextInput.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) {
      nextInput.dispose();
      return null;
    }
    const displayWidth = await track.getDisplayWidth();
    const coarseSink = new CanvasSink(track, { width: Math.min(800, displayWidth), poolSize: 3 });
    const verificationSink = new CanvasSink(track, { width: Math.min(960, displayWidth), poolSize: 2 });
    return {
      canvasesAtTimestamps: (timestamps) => coarseSink.canvasesAtTimestamps(timestamps),
      getCanvas: (timestamp) => verificationSink.getCanvas(timestamp),
      dispose: () => nextInput.dispose(),
    };
  } catch {
    input?.dispose();
    return null;
  }
}

function getCapabilityMask() {
  const navigatorWithGpu = navigator as Navigator & { gpu?: unknown };
  return (navigatorWithGpu.gpu ? 1 : 0) | (canRenderSceneClips() ? 2 : 0);
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function makeJobId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function cropReferenceImage(source: Blob, crop: NormalizedCrop) {
  const sourceBitmap = await createImageBitmap(source);
  const sourceX = Math.round(crop.x * sourceBitmap.width);
  const sourceY = Math.round(crop.y * sourceBitmap.height);
  const sourceWidth = Math.max(1, Math.round(crop.width * sourceBitmap.width));
  const sourceHeight = Math.max(1, Math.round(crop.height * sourceBitmap.height));
  const scale = Math.min(1, 640 / sourceWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    sourceBitmap.close();
    throw new Error("The browser could not crop this reference frame.");
  }
  context.drawImage(sourceBitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  sourceBitmap.close();
  const previewBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!previewBlob) throw new Error("The cropped reference could not be prepared.");
  const bitmap = await createImageBitmap(canvas);
  canvas.width = 1;
  canvas.height = 1;
  return { previewBlob, bitmap };
}

function SceneClipPlayer({
  source,
  scene,
  label,
  poster,
}: {
  source: string;
  scene: SceneMatch;
  label: string;
  poster?: string;
}) {
  const playerRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const duration = Math.max(0, scene.end - scene.start);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const positionAtStart = () => {
      player.pause();
      player.currentTime = scene.start;
      setIsPlaying(false);
      setElapsed(0);
    };
    if (player.readyState >= 1) positionAtStart();
    else player.addEventListener("loadedmetadata", positionAtStart, { once: true });
    return () => player.removeEventListener("loadedmetadata", positionAtStart);
  }, [scene.id, scene.start]);

  useEffect(() => {
    const pauseWhenAnotherClipStarts = (event: Event) => {
      const activeId = (event as CustomEvent<string>).detail;
      if (activeId === scene.id) return;
      playerRef.current?.pause();
    };
    window.addEventListener("cutweave:clip-play", pauseWhenAnotherClipStarts);
    return () => window.removeEventListener("cutweave:clip-play", pauseWhenAnotherClipStarts);
  }, [scene.id]);

  async function togglePlayback() {
    const player = playerRef.current;
    if (!player) return;
    if (!player.paused) {
      player.pause();
      return;
    }
    if (player.currentTime < scene.start || player.currentTime >= scene.end - 0.04) {
      player.currentTime = scene.start;
      setElapsed(0);
    }
    window.dispatchEvent(new CustomEvent("cutweave:clip-play", { detail: scene.id }));
    await player.play().catch(() => undefined);
  }

  function updateClipProgress() {
    const player = playerRef.current;
    if (!player) return;
    const nextElapsed = Math.max(0, Math.min(duration, player.currentTime - scene.start));
    setElapsed(nextElapsed);
    if (player.currentTime < scene.end - 0.025) return;
    player.pause();
    player.currentTime = scene.start;
    setElapsed(0);
  }

  function seekInsideClip(nextElapsed: number) {
    const player = playerRef.current;
    if (!player) return;
    const boundedElapsed = Math.max(0, Math.min(duration, nextElapsed));
    player.currentTime = Math.min(scene.end - 0.001, scene.start + boundedElapsed);
    setElapsed(boundedElapsed);
  }

  return (
    <div className={styles.clipPlayer}>
      <video
        ref={playerRef}
        src={source}
        poster={poster}
        playsInline
        preload="metadata"
        aria-label={label}
        onClick={togglePlayback}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={updateClipProgress}
      />
      {!isPlaying && (
        <button type="button" className={styles.clipToggle} onClick={togglePlayback} aria-label={label}>
          <span>▶</span>
        </button>
      )}
      <div className={styles.clipTimeline}>
        <button type="button" onClick={togglePlayback} aria-label={label}>{isPlaying ? "Ⅱ" : "▶"}</button>
        <input
          type="range"
          min="0"
          max={duration || 0.1}
          step="0.01"
          value={elapsed}
          onChange={(event) => seekInsideClip(Number(event.target.value))}
          aria-label={label}
        />
        <strong>{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, "0")} / {Math.floor(duration / 60)}:{String(Math.round(duration % 60)).padStart(2, "0")}</strong>
      </div>
    </div>
  );
}

export function FaceRecognitionWorkspace({ tool }: { tool: ToolDefinition }) {
  const copy = {
    nav: "Tool navigation", allTools: "All tools", privacy: "Privacy", local: "Runs on this device",
    input: "YOU ADD", output: "YOU GET", boundary: "YOUR FILE", stays: "STAYS HERE",
    noUpload: "Video, frames, face crops and face data never leave your device.", preflight: "EXECUTION PLAN",
    choose: "CHOOSE A VIDEO TO START", stageIdle: "LOCAL ENGINE READY", chooseStep: "STEP 01 / SOURCE",
    chooseTitle: "Open your video here", chooseBody: "Choose a video up to 3 hours long. It opens in this tab and is never uploaded to Cutweave.",
    chooseButton: "Choose a video", file: "FILE", size: "SIZE", duration: "DURATION", remove: "Remove video",
    limitError: "This build processes videos up to 3 hours. Split this file and choose it again.",
    engineTitle: "PROCESSING MODE", gpu: "GPU", cpu: "CPU", fast: "Fastest option",
    compatible: "Broader device compatibility", gpuMissing: "Fast mode is not available on this device.",
    refsTitle: "CHOOSE THREE REFERENCES", refsBody: "Seek to a clear view of the face. Capture the frame, then crop only the person you want to find.",
    capture: "Add reference from this frame", resetRefs: "Clear all", emptyRef: "REFERENCE",
    faceFound: "face · reference agreement", settingsTitle: "SCAN SETTINGS",
    sceneCount: "Scene count", clipLength: "Length of each clip", threshold: "Match sensitivity", auto: "automatic",
    seconds: "seconds", run: "Start scan", cancel: "Stop analysis", preparing: "Preparing the local face engine",
    analyzing: "Scanning the video at optimized intervals on this device", post: "Verifying candidates and preparing unique scenes for review", processed: "frames processed",
    verifying: "VERIFYING", possibleMatchesReviewed: "Possible matches reviewed",
    noResults: "No reliable matches were found at this threshold. Choose clearer references or lower the match threshold.",
    resultsTitle: "MATCHED SCENES", resultsBody: "Every clip opens with the target face. One long scene is counted once; when there are not enough distinct scenes, fewer results are returned.",
    match: "identity score", checks: "face checks", strong: "strong", likely: "likely", review: "review", removeScene: "Remove scene", export: "Build MP4 clip ZIP", exportFallback: "This browser cannot render clips; use Chrome or Edge.",
    exporting: "Building accelerated MP4 clips on this device", exportCancel: "Stop export", downloadAgain: "Download ZIP again",
    localProof: "MEDIA SENT TO SERVER", zero: "0 B", identityNote: "Cutweave does not research identity. It only tries to find the selected face again inside this video.",
    workflowSource: "Video", workflowRefs: "References", workflowSettings: "Settings", workflowScan: "Scan", workflowReview: "Review",
    intakeKicker: "LOCAL VIDEO SOURCE", intakeTitle: "Choose the video you want to search", intakePrivacy: "The file opens in this tab. It is not uploaded, copied or sent off your device.",
    sourceReady: "VIDEO READY", referencesReady: "REFERENCES READY", settingsBody: "Choose the scene count, clip length, scan intensity and matching sensitivity before you scan.",
    profileTitle: "Scan intensity", profileHelp: "Efficient checks half as many timeline frames. Face matching, final verification and your sensitivity setting stay unchanged.",
    removeReference: "Remove reference", referenceHint: "Move the video to the moment you want, then add a reference.",
    scanKicker: "LOCAL FACE SCAN", scanTitle: "Searching the video for your selected face", scanKeep: "If you cancel, the video, references and every setting are preserved.", scanCancel: "Cancel scan and return to settings",
    included: "Included in ZIP", excluded: "Excluded from ZIP", includeScene: "Include scene in ZIP", excludeScene: "Exclude from ZIP", previewScene: "Play or pause clip", exportSummary: "clips to download", backToSettings: "Change settings",
    cropTitle: "Frame only the face you want", cropInstructions: "Draw a rectangle around the face and nearby head area. Keep other people in the background outside the selection.", cropKeyboard: "Move with the arrow keys; resize with Shift + arrow keys.", cropConfirm: "Use this crop", cropCancel: "Cancel",
  } as const;

  const [theme, setTheme] = useState<FaceTheme>("dark");
  const workspaceRef = useRef<HTMLElement>(null);
  const trailCanvasRef = useRef<HTMLCanvasElement>(null);
  const trailFrame = useRef<number | null>(null);
  const trailPoints = useRef<TrailPoint[]>([]);
  const lastTrailPoint = useRef<TrailPoint | null>(null);
  const trailTheme = useRef<FaceTheme>("dark");
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerEngineRef = useRef<FaceEngine | null>(null);
  const pendingCalls = useRef(new Map<number, PendingWorkerCall>());
  const requestIdRef = useRef(0);
  const activeJobRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const objectUrls = useRef(new Set<string>());
  const allSamplesRef = useRef<ScanSample[]>([]);
  const lastProgressUpdateRef = useRef(0);

  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [engine, setEngine] = useState<FaceEngine>("cpu");
  const [references, setReferences] = useState<ReferenceFrame[]>([]);
  const [referencesUpdating, setReferencesUpdating] = useState(false);
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null);
  const [sceneCount, setSceneCount] = useState(25);
  const [clipLength, setClipLength] = useState(5);
  const [threshold, setThreshold] = useState(0.38);
  const [scanProfile, setScanProfile] = useState<FaceScanProfile>("maximum");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [verificationProgress, setVerificationProgress] = useState<VerificationProgress>({ reviewedCandidates: 0, totalCandidates: 0 });
  const [matches, setMatches] = useState<SceneMatch[]>([]);
  const [excludedMatchIds, setExcludedMatchIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [engineBackend, setEngineBackend] = useState<string | null>(null);
  const capabilityMask = useSyncExternalStore(subscribeToCapabilities, getCapabilityMask, () => 0);
  const gpuAvailable = Boolean(capabilityMask & 1);
  const clipExportAvailable = Boolean(capabilityMask & 2);
  const clipFormat = clipExportAvailable ? preferredClipFormat() : "MP4";

  const isBusy = phase === "engine-loading" || phase === "analyzing" || phase === "post-processing" || phase === "exporting";
  const progressPercent = progress.total ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;
  const includedMatches = useMemo(
    () => matches.filter((match) => !excludedMatchIds.has(match.id)),
    [excludedMatchIds, matches],
  );

  useLayoutEffect(() => {
    const savedTheme = readSiteTheme();
    applySiteTheme(savedTheme, false);
    const restoreFrame = window.requestAnimationFrame(() => setTheme(savedTheme));
    return () => {
      window.cancelAnimationFrame(restoreFrame);
    };
  }, []);

  useEffect(() => {
    trailTheme.current = theme;
  }, [theme]);

  useEffect(() => {
    const resizeCanvas = () => {
      const canvas = trailCanvasRef.current;
      if (!canvas) return;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(window.innerWidth * pixelRatio);
      canvas.height = Math.round(window.innerHeight * pixelRatio);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (trailFrame.current !== null) window.cancelAnimationFrame(trailFrame.current);
    };
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    applySiteTheme(nextTheme);
  }

  function renderTrail(now: number) {
    const canvas = trailCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      trailFrame.current = null;
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lifetime = reducedMotion ? 430 : 680;
    trailPoints.current = trailPoints.current.filter((point) => now - point.createdAt < lifetime);

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    context.globalCompositeOperation = "lighter";

    const palette = trailTheme.current === "dark"
      ? {
          main: "rgba(157, 232, 42, .78)",
          soft: "rgba(121, 201, 48, .16)",
          tip: "rgba(240, 255, 209, .98)",
          glow: "rgba(147, 235, 47, .72)",
        }
      : {
          main: "rgba(10, 133, 182, .9)",
          soft: "rgba(40, 165, 207, .2)",
          tip: "rgba(230, 250, 255, .98)",
          glow: "rgba(10, 139, 192, .78)",
        };

    const points = trailPoints.current;
    for (let index = 1; index < points.length; index += 1) {
      const beforePrevious = points[Math.max(index - 2, 0)];
      const previous = points[index - 1];
      const point = points[index];
      const next = points[Math.min(index + 1, points.length - 1)];
      const life = Math.max(0, 1 - (now - point.createdAt) / lifetime);
      const alpha = life * life;
      const progress = index / Math.max(points.length - 1, 1);
      const firstControlX = previous.x + (point.x - beforePrevious.x) / 6;
      const firstControlY = previous.y + (point.y - beforePrevious.y) / 6;
      const secondControlX = point.x - (next.x - previous.x) / 6;
      const secondControlY = point.y - (next.y - previous.y) / 6;

      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.bezierCurveTo(firstControlX, firstControlY, secondControlX, secondControlY, point.x, point.y);
      context.strokeStyle = palette.soft;
      context.globalAlpha = alpha * .7;
      context.lineWidth = 4.5 + progress * 3.5;
      context.shadowColor = palette.glow;
      context.shadowBlur = 9 + progress * 5;
      context.stroke();
      context.strokeStyle = palette.main;
      context.globalAlpha = alpha * .92;
      context.lineWidth = .45 + progress * 1.45;
      context.shadowBlur = 4 + progress * 3;
      context.stroke();
      context.restore();
    }

    const head = points.at(-1);
    if (head) {
      const headLife = Math.max(0, 1 - (now - head.createdAt) / lifetime);
      const pulse = 4.8 + Math.sin(now / 145) * .7;
      context.save();
      context.globalAlpha = headLife * headLife;
      context.fillStyle = palette.tip;
      context.shadowColor = palette.glow;
      context.shadowBlur = 11;
      context.beginPath();
      context.moveTo(head.x, head.y - pulse);
      context.lineTo(head.x + 1.25, head.y - 1.15);
      context.lineTo(head.x + pulse, head.y);
      context.lineTo(head.x + 1.25, head.y + 1.15);
      context.lineTo(head.x, head.y + pulse);
      context.lineTo(head.x - 1.25, head.y + 1.15);
      context.lineTo(head.x - pulse, head.y);
      context.lineTo(head.x - 1.25, head.y - 1.15);
      context.closePath();
      context.fill();
      context.restore();
    }

    if (points.length > 0) {
      trailFrame.current = window.requestAnimationFrame(renderTrail);
    } else {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      trailFrame.current = null;
    }
  }

  function followPointer(event: ReactPointerEvent<HTMLElement>) {
    const now = event.timeStamp;
    const nextPoint = { x: event.clientX, y: event.clientY, createdAt: now };
    const previous = lastTrailPoint.current;
    const distance = previous ? Math.hypot(nextPoint.x - previous.x, nextPoint.y - previous.y) : Number.POSITIVE_INFINITY;
    const elapsed = previous ? now - previous.createdAt : Number.POSITIVE_INFINITY;

    if (distance >= 5 || elapsed >= 24) {
      trailPoints.current.push(nextPoint);
      if (trailPoints.current.length > 30) trailPoints.current.shift();
      lastTrailPoint.current = nextPoint;
    }
    workspaceRef.current?.style.setProperty("--light-opacity", "1");
    if (trailFrame.current === null) trailFrame.current = window.requestAnimationFrame(renderTrail);
  }

  function hidePointer() {
    workspaceRef.current?.style.setProperty("--light-opacity", "0");
    lastTrailPoint.current = null;
    trailPoints.current = [];
  }

  function updateProgress(completed: number, total: number, force = false) {
    const now = performance.now();
    if (!force && completed < total && now - lastProgressUpdateRef.current < 100) return;
    lastProgressUpdateRef.current = now;
    setProgress({ completed, total });
  }

  useEffect(() => {
    const urls = objectUrls.current;
    const calls = pendingCalls.current;
    return () => {
      workerRef.current?.terminate();
      calls.forEach(({ reject }) => reject(new Error("The local worker was closed.")));
      calls.clear();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (!isBusy) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isBusy]);

  function revokeUrl(url: string | null) {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  }

  function sendWorker(message: FaceWorkerRequest, transfer: Transferable[] = []) {
    return new Promise<FaceWorkerResponse>((resolve, reject) => {
      if (!workerRef.current || !("requestId" in message)) {
        reject(new Error("The local face worker is not available."));
        return;
      }
      pendingCalls.current.set(message.requestId, { resolve, reject });
      workerRef.current.postMessage(message, transfer);
    });
  }

  async function ensureWorker(selectedEngine: FaceEngine) {
    if (workerRef.current && workerEngineRef.current === selectedEngine && engineBackend) return engineBackend;
    workerRef.current?.terminate();
    pendingCalls.current.forEach(({ reject }) => reject(new Error("The processing engine changed.")));
    pendingCalls.current.clear();

    const worker = new Worker(new URL("../../../workers/face-analysis.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    workerEngineRef.current = selectedEngine;
    worker.onmessage = (event: MessageEvent<FaceWorkerResponse>) => {
      const response = event.data;
      if (response.type === "error" && response.requestId !== undefined) {
        const pending = pendingCalls.current.get(response.requestId);
        pendingCalls.current.delete(response.requestId);
        pending?.reject(new Error(response.message));
        return;
      }
      if ("requestId" in response && response.requestId !== undefined) {
        const pending = pendingCalls.current.get(response.requestId);
        pendingCalls.current.delete(response.requestId);
        pending?.resolve(response);
      }
    };
    worker.onerror = (event) => {
      const workerError = new Error(event.message || "The local face worker failed.");
      pendingCalls.current.forEach(({ reject }) => reject(workerError));
      pendingCalls.current.clear();
    };

    setPhase("engine-loading");
    const requestId = ++requestIdRef.current;
    const response = await sendWorker({ type: "init", requestId, engine: selectedEngine, origin: window.location.origin });
    if (response.type !== "ready") throw new Error("The local face engine did not finish loading.");
    setEngineBackend(response.backend);
    return response.backend;
  }

  async function syncWorkerReferences(savedReferences: ReferenceFrame[]) {
    const clearRequestId = ++requestIdRef.current;
    const cleared = await sendWorker({ type: "clear-references", requestId: clearRequestId });
    if (cleared.type !== "references-cleared") throw new Error("The saved references could not be synchronized.");

    for (const reference of savedReferences) {
      if (cancelledRef.current) throw new DOMException("Analysis cancelled", "AbortError");
      const bitmap = await createImageBitmap(reference.previewBlob);
      const requestId = ++requestIdRef.current;
      const response = await sendWorker({ type: "reference", requestId, slot: reference.slot, bitmap }, [bitmap]);
      if (response.type !== "reference-ready") throw new Error("A saved reference could not be restored before scanning.");
    }
  }

  function clearReferencesLocally() {
    references.forEach((reference) => revokeUrl(reference.previewUrl));
    setReferences([]);
  }

  function closeCropDraft() {
    if (cropDraft) revokeUrl(cropDraft.previewUrl);
    setCropDraft(null);
  }

  async function resetReferences() {
    clearReferencesLocally();
    closeCropDraft();
    matches.forEach((match) => revokeUrl(match.thumbnailUrl ?? null));
    setMatches([]);
    setExcludedMatchIds(new Set());
    allSamplesRef.current = [];
    if (workerRef.current) {
      const requestId = ++requestIdRef.current;
      await sendWorker({ type: "clear-references", requestId }).catch(() => undefined);
    }
    setPhase(file ? "source-ready" : "idle");
    setError(null);
  }

  async function removeReference(slot: number) {
    if (isBusy || referencesUpdating) return;
    const removed = references[slot];
    if (!removed) return;
    const remaining = references
      .filter((_, index) => index !== slot)
      .map((reference, index) => ({ ...reference, slot: index }));

    setReferencesUpdating(true);
    setError(null);
    revokeUrl(removed.previewUrl);
    matches.forEach((match) => revokeUrl(match.thumbnailUrl ?? null));
    revokeUrl(exportUrl);
    setMatches([]);
    setExcludedMatchIds(new Set());
    setExportUrl(null);
    setReferences(remaining);

    try {
      if (workerRef.current) {
        const clearRequestId = ++requestIdRef.current;
        await sendWorker({ type: "clear-references", requestId: clearRequestId });
        const refreshed: ReferenceFrame[] = [];
        for (const reference of remaining) {
          const bitmap = await createImageBitmap(reference.previewBlob);
          const requestId = ++requestIdRef.current;
          const response = await sendWorker({ type: "reference", requestId, slot: reference.slot, bitmap }, [bitmap]);
          if (response.type !== "reference-ready") throw new Error("A saved reference could not be restored.");
          refreshed.push({ ...reference, faceCount: response.faceCount, agreement: response.agreement });
        }
        setReferences(refreshed);
      }
      setPhase("source-ready");
    } catch (referenceError) {
      setError(referenceError instanceof Error ? referenceError.message : "The reference could not be removed safely.");
      setPhase("error");
    } finally {
      setReferencesUpdating(false);
    }
  }

  function clearSource() {
    cancelledRef.current = true;
    if (activeJobRef.current) workerRef.current?.postMessage({ type: "cancel", jobId: activeJobRef.current } satisfies FaceWorkerRequest);
    clearReferencesLocally();
    closeCropDraft();
    matches.forEach((match) => revokeUrl(match.thumbnailUrl ?? null));
    revokeUrl(exportUrl);
    revokeUrl(mediaUrl);
    workerRef.current?.terminate();
    workerRef.current = null;
    workerEngineRef.current = null;
    setEngineBackend(null);
    setFile(null);
    setMediaUrl(null);
    setVideoDuration(0);
    setMatches([]);
    setExcludedMatchIds(new Set());
    setExportUrl(null);
    setError(null);
    setPhase("idle");
    setProgress({ completed: 0, total: 0 });
    if (inputRef.current) inputRef.current.value = "";
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    clearSource();
    if (!selectedFile) return;
    const url = URL.createObjectURL(selectedFile);
    objectUrls.current.add(url);
    setFile(selectedFile);
    setMediaUrl(url);
    setPhase("source-ready");
  }

  function readMetadata() {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    setVideoDuration(video.duration);
    if (video.duration > MAX_VIDEO_DURATION_SECONDS) {
      setError(copy.limitError);
      setPhase("error");
    } else {
      setError(null);
      setPhase("source-ready");
    }
  }

  async function changeEngine(nextEngine: FaceEngine) {
    if (nextEngine === "gpu" && !gpuAvailable) return;
    if (nextEngine === engine) return;
    setError(null);
    matches.forEach((match) => revokeUrl(match.thumbnailUrl ?? null));
    revokeUrl(exportUrl);
    setMatches([]);
    setExcludedMatchIds(new Set());
    setExportUrl(null);
    workerRef.current?.terminate();
    workerRef.current = null;
    workerEngineRef.current = null;
    setEngineBackend(null);
    setEngine(nextEngine);
    if (!references.length) {
      setPhase("source-ready");
      return;
    }
    try {
      await ensureWorker(nextEngine);
      const refreshed: ReferenceFrame[] = [];
      for (const reference of references) {
        const bitmap = await createImageBitmap(reference.previewBlob);
        const requestId = ++requestIdRef.current;
        const response = await sendWorker({ type: "reference", requestId, slot: reference.slot, bitmap }, [bitmap]);
        if (response.type !== "reference-ready") throw new Error("A saved reference could not be loaded into the new engine.");
        refreshed.push({ ...reference, faceCount: response.faceCount, agreement: response.agreement });
      }
      setReferences(refreshed);
      setPhase("source-ready");
    } catch (engineError) {
      setError(engineError instanceof Error ? engineError.message : "The processing engine could not be changed.");
      setPhase("error");
    }
  }

  async function captureReference() {
    const video = videoRef.current;
    if (!video || references.length >= 3 || videoDuration > MAX_VIDEO_DURATION_SECONDS) return;
    setError(null);
    try {
      const timestamp = video.currentTime;
      const { bitmap, previewBlob } = await captureVideoFrame(video, true);
      bitmap.close();
      if (!previewBlob) throw new Error("The reference frame could not be prepared.");
      const previewUrl = URL.createObjectURL(previewBlob);
      objectUrls.current.add(previewUrl);
      setCropDraft({ previewUrl, previewBlob, timestamp });
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : "The reference frame could not be analyzed.");
      setPhase("error");
    }
  }

  async function confirmReferenceCrop(crop: NormalizedCrop) {
    if (!cropDraft || references.length >= 3) return;
    setError(null);
    try {
      await ensureWorker(engine);
      const slot = references.length;
      const { previewBlob, bitmap } = await cropReferenceImage(cropDraft.previewBlob, crop);
      const requestId = ++requestIdRef.current;
      const response = await sendWorker({ type: "reference", requestId, slot, bitmap }, [bitmap]);
      if (response.type !== "reference-ready") throw new Error("The cropped reference could not be analyzed.");
      const previewUrl = URL.createObjectURL(previewBlob);
      objectUrls.current.add(previewUrl);
      setReferences((current) => [...current, {
        slot,
        timestamp: cropDraft.timestamp,
        previewUrl,
        previewBlob,
        faceCount: response.faceCount,
        agreement: response.agreement,
      }]);
      closeCropDraft();
      setPhase("source-ready");
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : "The cropped reference could not be analyzed.");
      setPhase("error");
    }
  }

  async function submitScan(
    timestamp: number,
    jobId: string,
    identityThreshold: number,
    mode: FaceScanMode,
    captured: Awaited<ReturnType<typeof captureVideoFrame>>,
  ) {
    const { bitmap, visualHash, visualFingerprint } = captured;
    const requestId = ++requestIdRef.current;
    const response = await sendWorker({ type: "scan", requestId, jobId, timestamp, threshold: identityThreshold, mode, bitmap }, [bitmap]);
    if (response.type !== "scan-result" || response.jobId !== jobId) throw new Error("A stale face result was rejected.");
    return {
      timestamp: response.timestamp,
      similarity: response.similarity,
      weakestSimilarity: response.weakestSimilarity,
      referenceHits: response.referenceHits,
      faceCount: response.faceCount,
      faceQuality: response.faceQuality,
      visualHash,
      visualFingerprint,
    } satisfies ScanSample;
  }

  async function scanAt(timestamp: number, jobId: string, identityThreshold: number, mode: FaceScanMode) {
    const video = videoRef.current;
    if (!video) throw new Error("The video preview is no longer available.");
    await seekVideo(video, timestamp);
    const maximumWidth = mode === "coarse" ? 800 : 960;
    return submitScan(
      timestamp,
      jobId,
      identityThreshold,
      mode,
      await captureVideoFrame(video, false, maximumWidth),
    );
  }

  async function scanDecodedCanvasAt(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    timestamp: number,
    jobId: string,
    identityThreshold: number,
    mode: FaceScanMode,
  ) {
    const maximumWidth = mode === "coarse" ? 800 : 960;
    return submitScan(
      timestamp,
      jobId,
      identityThreshold,
      mode,
      await captureCanvasFrame(canvas, false, maximumWidth),
    );
  }

  async function createThumbnails(scenes: SceneMatch[], jobId: string, decodedScanner?: DecodedFrameScanner | null) {
    const video = videoRef.current;
    if (!video) return scenes;
    const completed: SceneMatch[] = [];
    const appendThumbnail = async (scene: SceneMatch, canvas?: HTMLCanvasElement | OffscreenCanvas) => {
      if (cancelledRef.current || activeJobRef.current !== jobId) throw new DOMException("Analysis cancelled", "AbortError");
      if (!canvas) await seekVideo(video, scene.center);
      const { bitmap, previewBlob } = canvas
        ? await captureCanvasFrame(canvas, true)
        : await captureVideoFrame(video, true);
      bitmap.close();
      if (previewBlob) {
        const thumbnailUrl = URL.createObjectURL(previewBlob);
        objectUrls.current.add(thumbnailUrl);
        completed.push({ ...scene, thumbnailUrl });
      } else {
        completed.push(scene);
      }
    };
    let sceneIndex = 0;
    if (decodedScanner) {
      const decodedFrames = decodedScanner.canvasesAtTimestamps(scenes.map((scene) => scene.center));
      try {
        while (sceneIndex < scenes.length) {
          let decoded: IteratorResult<DecodedFrame | null, void>;
          try {
            decoded = await decodedFrames.next();
          } catch {
            break;
          }
          if (decoded.done) break;
          await appendThumbnail(scenes[sceneIndex], decoded.value?.canvas);
          sceneIndex += 1;
        }
      } finally {
        await decodedFrames.return().catch(() => undefined);
      }
    }
    for (; sceneIndex < scenes.length; sceneIndex += 1) {
      await appendThumbnail(scenes[sceneIndex]);
    }
    return completed;
  }

  async function analyzeVideo() {
    const video = videoRef.current;
    if (!video || !file || references.length !== 3 || !videoDuration || videoDuration > MAX_VIDEO_DURATION_SECONDS) return;
    matches.forEach((match) => revokeUrl(match.thumbnailUrl ?? null));
    revokeUrl(exportUrl);
    setExportUrl(null);
    setMatches([]);
    setExcludedMatchIds(new Set());
    setError(null);
    setVerificationProgress({ reviewedCandidates: 0, totalCandidates: 0 });
    cancelledRef.current = false;
    const jobId = makeJobId();
    activeJobRef.current = jobId;
    let decodedScanner: DecodedFrameScanner | null = null;

    try {
      await ensureWorker(engine);
      if (activeJobRef.current !== jobId || cancelledRef.current) return;
      await syncWorkerReferences(references);
      if (activeJobRef.current !== jobId || cancelledRef.current) return;
      const calibratedThreshold = calibrateIdentityThreshold(threshold, references.at(-1)?.agreement ?? 1);
      // Proposal scans deliberately favor recall. Every exported clip is still
      // re-checked at the user's full threshold across its opening and duration.
      const proposalThreshold = createProposalThreshold(calibratedThreshold);
      const sampleTimes = createSampleTimes(videoDuration, clipLength, scanProfile);
      const samples: ScanSample[] = [];
      setPhase("analyzing");
      updateProgress(0, sampleTimes.length, true);
      video.pause();

      decodedScanner = await createDecodedFrameScanner(file);
      let coarseIndex = 0;
      if (decodedScanner) {
        const decodedFrames = decodedScanner.canvasesAtTimestamps(sampleTimes);
        let decodedFramesFailed = false;
        try {
          while (coarseIndex < sampleTimes.length) {
            let decoded: IteratorResult<DecodedFrame | null, void>;
            try {
              decoded = await decodedFrames.next();
            } catch {
              decodedFramesFailed = true;
              break;
            }
            if (decoded.done) break;
            if (cancelledRef.current || activeJobRef.current !== jobId) throw new DOMException("Analysis cancelled", "AbortError");
            const timestamp = sampleTimes[coarseIndex];
            samples.push(decoded.value
              ? await scanDecodedCanvasAt(decoded.value.canvas, timestamp, jobId, proposalThreshold, "coarse")
              : await scanAt(timestamp, jobId, proposalThreshold, "coarse"));
            coarseIndex += 1;
            updateProgress(coarseIndex, sampleTimes.length, coarseIndex === sampleTimes.length);
          }
        } finally {
          await decodedFrames.return().catch(() => undefined);
        }
        if (decodedFramesFailed) {
          if (decodedScanner) {
            decodedScanner.dispose();
            decodedScanner = null;
          }
        }
      }
      for (let index = coarseIndex; index < sampleTimes.length; index += 1) {
        if (cancelledRef.current || activeJobRef.current !== jobId) throw new DOMException("Analysis cancelled", "AbortError");
        const timestamp = sampleTimes[index];
        samples.push(await scanAt(timestamp, jobId, proposalThreshold, "coarse"));
        updateProgress(index + 1, sampleTimes.length, index + 1 === sampleTimes.length);
      }

      if (activeJobRef.current !== jobId || cancelledRef.current) return;
      allSamplesRef.current = samples;
      setPhase("post-processing");
      const preliminaryThreshold = proposalThreshold;
      const preliminaryCount = Math.min(Math.ceil(sceneCount * 8), MAX_PRELIMINARY_SCENE_COUNT);
      const preliminary = selectSceneMatches(
        samples,
        preliminaryCount,
        clipLength,
        videoDuration,
        preliminaryThreshold,
        {
          minimumGapSeconds: Math.max(1.5, clipLength * 0.45),
          maximumVisualHashDistance: 8,
          visualDuplicateWindowSeconds: Math.max(8, clipLength * 2),
        },
      );
      const verificationCandidates = createNarrativeCandidateOrder(
        preliminary.map((candidate) => samples.find((sample) => Math.abs(sample.timestamp - candidate.start) < 0.03) ?? {
          timestamp: candidate.start,
          similarity: candidate.similarity,
          weakestSimilarity: candidate.similarity,
          referenceHits: 2,
          faceCount: 1,
          faceQuality: 0.5,
          visualHash: candidate.visualHash,
        }).map((candidate) => ({
          ...candidate,
          visualContext: createVisualContext(candidate.timestamp, samples),
        })),
        videoDuration,
        Math.min(sceneCount, preliminary.length),
      );
      const verified: ScanSample[] = [];
      const checkOffsets = createClipCheckOffsets(clipLength);
      const candidateStarts = verificationCandidates.map((candidate) => createVerificationClipStarts(
        candidate.timestamp,
        clipLength,
        videoDuration,
        samples,
        proposalThreshold,
      ));
      const verificationTarget = Math.min(preliminary.length, sceneCount);
      let nextDiversityCheck = verificationTarget;
      let enoughDiverseMatches = false;
      const verificationCache = new Map<number, ScanSample>();
      setVerificationProgress({ reviewedCandidates: 0, totalCandidates: verificationCandidates.length });
      for (let candidateIndex = 0; candidateIndex < verificationCandidates.length && !enoughDiverseMatches; candidateIndex += 1) {
        for (const clipStart of candidateStarts[candidateIndex]) {
          const checkTimes = checkOffsets.map((offset) => Math.max(0, Math.min(videoDuration - 0.05, clipStart + offset)));
          const checks: ScanSample[] = [];
          for (let checkIndex = 0; checkIndex < checkTimes.length; checkIndex += 1) {
            if (cancelledRef.current || activeJobRef.current !== jobId) throw new DOMException("Analysis cancelled", "AbortError");
            const cacheKey = Math.round(checkTimes[checkIndex] * 50);
            let check = verificationCache.get(cacheKey);
            if (!check) {
              if (decodedScanner) {
                let frame: DecodedFrame | null = null;
                try {
                  frame = await decodedScanner.getCanvas(checkTimes[checkIndex]);
                } catch {
                  decodedScanner.dispose();
                  decodedScanner = null;
                }
                if (frame) {
                  check = await scanDecodedCanvasAt(frame.canvas, checkTimes[checkIndex], jobId, calibratedThreshold, "verify");
                }
              }
              check ??= await scanAt(checkTimes[checkIndex], jobId, calibratedThreshold, "verify");
              verificationCache.set(cacheKey, check);
            }
            checks.push(check);
            if (checkIndex === 0 && !samplePassesIdentity(check, calibratedThreshold)) break;
            if (checkIndex === 2 && checks.filter((sample) => samplePassesIdentity(sample, calibratedThreshold)).length < 2) break;
          }
          const verifiedSample = createVerifiedClipSample(checks, calibratedThreshold, clipStart, clipLength);
          if (verifiedSample) {
            verified.push({
              ...verifiedSample,
              visualContext: createVisualContext(clipStart + clipLength / 2, samples),
              narrativeScene: verificationCandidates[candidateIndex].narrativeScene,
            });
            if (verified.length >= nextDiversityCheck) {
              const diversified = selectSceneMatches(verified, verificationTarget, clipLength, videoDuration, calibratedThreshold, {
                minimumGapSeconds: Math.max(1, clipLength * 0.95),
                contentDiversity: true,
              });
              enoughDiverseMatches = diversified.length >= verificationTarget;
              nextDiversityCheck += 4;
            }
            break;
          }
        }
        setVerificationProgress((current) => ({ ...current, reviewedCandidates: candidateIndex + 1 }));
      }
      const selected = selectSceneMatches(verified, sceneCount, clipLength, videoDuration, calibratedThreshold, {
        minimumGapSeconds: Math.max(1, clipLength * 0.95),
        contentDiversity: true,
      });
      const withThumbnails = await createThumbnails(selected, jobId, decodedScanner);
      if (activeJobRef.current !== jobId || cancelledRef.current) return;
      setMatches(withThumbnails);
      setExcludedMatchIds(new Set());
      setPhase("results");
    } catch (analysisError) {
      if ((analysisError instanceof Error || analysisError instanceof DOMException) && analysisError.name === "AbortError") {
        setPhase("cancelled");
      } else {
        setError(analysisError instanceof Error ? analysisError.message : "Local analysis stopped unexpectedly.");
        setPhase("error");
      }
    } finally {
      decodedScanner?.dispose();
      if (activeJobRef.current === jobId) activeJobRef.current = null;
    }
  }

  function cancelActiveWork() {
    cancelledRef.current = true;
    if (!activeJobRef.current) return;
    workerRef.current?.postMessage({ type: "cancel", jobId: activeJobRef.current } satisfies FaceWorkerRequest);
    const cancellationError = new Error("Analysis cancelled");
    cancellationError.name = "AbortError";
    pendingCalls.current.forEach(({ reject }) => reject(cancellationError));
    pendingCalls.current.clear();
    if (phase !== "exporting") setPhase("cancelled");
  }

  function setMatchIncluded(id: string, included: boolean) {
    setExcludedMatchIds((current) => {
      const next = new Set(current);
      if (included) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportMatches() {
    if (!mediaUrl || !file || !includedMatches.length || !clipExportAvailable) return;
    cancelledRef.current = false;
    setError(null);
    setPhase("exporting");
    setProgress({ completed: 0, total: includedMatches.length });
    try {
      const blob = await exportScenePackage(file, mediaUrl, includedMatches, () => cancelledRef.current, (completed, total) => {
        setProgress({ completed, total });
      });
      if (cancelledRef.current) throw new DOMException("Export cancelled", "AbortError");
      revokeUrl(exportUrl);
      const url = URL.createObjectURL(blob);
      objectUrls.current.add(url);
      setExportUrl(url);
      setPhase("results");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${file.name.replace(/\.[^.]+$/, "")}-cutweave-scenes.zip`;
      anchor.click();
    } catch (exportError) {
      if (exportError instanceof DOMException && exportError.name === "AbortError") {
        setPhase("results");
      } else {
        setError(exportError instanceof Error ? exportError.message : "Local export stopped unexpectedly.");
        setPhase("results");
      }
    }
  }

  const activeStageLabel = phase === "engine-loading" ? copy.preparing
    : phase === "analyzing" ? copy.analyzing
      : phase === "post-processing" ? copy.post
        : phase === "exporting" ? copy.exporting
          : file ? copy.choose : copy.stageIdle;

  const scanInProgress = phase === "engine-loading" || phase === "analyzing" || phase === "post-processing";
  const controlsDisabled = isBusy || referencesUpdating;
  const sensitivityPercent = Math.round(((threshold - 0.26) / (0.62 - 0.26)) * 100);
  const workflowStep = !file ? 0 : phase === "results" || phase === "exporting" ? 4 : scanInProgress ? 3 : references.length < 3 ? 1 : 2;
  const workflowLabels = [copy.workflowSource, copy.workflowRefs, copy.workflowSettings, copy.workflowScan, copy.workflowReview];

  return (
    <main
      className={styles.workspace}
      onPointerEnter={followPointer}
      onPointerLeave={hidePointer}
      onPointerMove={followPointer}
      ref={workspaceRef}
    >
      <canvas className={styles.pointerLight} ref={trailCanvasRef} aria-hidden="true" />
      <header className={styles.header}>
        <BrandMark />
        <div className={styles.headerActions}>
          <nav aria-label={copy.nav}>
            <Link href="/lab">← {copy.allTools}</Link>
            <Link href="/privacy">{copy.privacy}</Link>
          </nav>
          <button
            className={styles.themeToggle}
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          >
            <Image src={theme === "dark" ? darkThemeIcon : lightThemeIcon} alt="" width={24} height={24} priority />
          </button>
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{tool.index} / {text.tools[tool.slug].eyebrow}</p>
          <h1>{text.tools[tool.slug].title}</h1>
          <p className={styles.heroPromise}>{text.tools[tool.slug].promise}</p>
        </div>
        <div className={styles.localStatus}>
          <span><i /> {copy.local}</span>
          <strong>{copy.zero}</strong>
          <small>{copy.localProof}</small>
        </div>
      </section>

      <ol className={styles.workflow} aria-label="Face scan steps">
        {workflowLabels.map((label, index) => (
          <li className={index < workflowStep ? styles.stepComplete : index === workflowStep ? styles.stepCurrent : ""} key={label} aria-current={index === workflowStep ? "step" : undefined}>
            <span>{index < workflowStep ? "✓" : String(index + 1).padStart(2, "0")}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>

      {!file ? (
        <section className={styles.intake} aria-labelledby="face-intake-title">
          <div className={styles.intakeVisual} aria-hidden="true">
            <span className={styles.intakeCorner} />
            <i className={styles.intakeScanline} />
            <b>01</b>
          </div>
          <div className={styles.intakeCopy}>
            <p>{copy.intakeKicker}</p>
            <h2 id="face-intake-title">{copy.intakeTitle}</h2>
            <span>{copy.chooseBody}</span>
            <input ref={inputRef} className="sr-only" id="face-video-input" type="file" accept="video/*" onChange={chooseFile} />
            <label className={styles.primaryButton} htmlFor="face-video-input">{copy.chooseButton}<span>↗</span></label>
            <small>{copy.intakePrivacy}</small>
          </div>
          <div className={styles.intakeFacts}>
            <div><small>{copy.input}</small><strong>{text.tools[tool.slug].input}</strong></div>
            <div><small>{copy.output}</small><strong>{`Download ${clipFormat} clips as a ZIP`}</strong></div>
            <div><small>{copy.boundary}</small><strong><i /> {copy.stays}</strong></div>
          </div>
        </section>
      ) : phase !== "results" && phase !== "exporting" ? (
        <section className={styles.setup} aria-label="Video and scan settings">
          <div className={styles.videoColumn}>
            <div className={styles.videoFrame}>
              <div className={styles.videoFrameTop}><span>{copy.sourceReady}</span><b>{videoDuration ? formatTimecode(videoDuration) : "--:--:--"}</b></div>
              <video ref={videoRef} src={mediaUrl ?? undefined} controls playsInline preload="metadata" onLoadedMetadata={readMetadata} />
            </div>
            <div className={styles.sourceMeta}>
              <div><small>{copy.file}</small><strong title={file.name}>{file.name}</strong></div>
              <div><small>{copy.size}</small><strong>{formatBytes(file.size)}</strong></div>
              <button type="button" onClick={clearSource} disabled={isBusy}>{copy.remove}</button>
            </div>
          </div>

          {scanInProgress ? (
            <section className={styles.scanPanel} aria-live="polite" aria-labelledby="scan-title">
              <p>{copy.scanKicker}</p>
              <div className={styles.faceScan} aria-hidden="true">
                <span /><span /><span /><span />
                <div className={styles.scanReferences}>
                  {references.map((reference, index) => (
                    <figure key={reference.previewUrl}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={reference.previewUrl} alt="" />
                      <figcaption>REF 0{index + 1}</figcaption>
                    </figure>
                  ))}
                </div>
                <i
                  className={phase === "post-processing" ? styles.scanLineActive : undefined}
                  style={phase === "post-processing" ? undefined : { top: `${Math.max(8, Math.min(88, progressPercent))}%` }}
                />
                <b className={phase === "post-processing" ? styles.scanActivityBadge : undefined}>
                  {phase === "post-processing" ? copy.verifying : `${progressPercent}%`}
                </b>
              </div>
              <h2 id="scan-title">{copy.scanTitle}</h2>
              <p className={styles.scanStage}>{activeStageLabel}</p>
              {phase === "post-processing" ? (
                <div className={styles.verificationStatus} role="status" aria-label={activeStageLabel}>
                  <div>
                    <span>{copy.possibleMatchesReviewed}</span>
                    <strong>{verificationProgress.reviewedCandidates}/{verificationProgress.totalCandidates}</strong>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
                    <i style={{ width: `${progressPercent}%` }} />
                  </div>
                  <div className={styles.scanMeta}>
                    <span>{phase === "analyzing" && progress.total ? `${progress.completed}/${progress.total} ${copy.processed}` : activeStageLabel}</span>
                    <strong>{progressPercent}%</strong>
                  </div>
                </>
              )}
              <button type="button" className={styles.cancelButton} onClick={cancelActiveWork}>{copy.scanCancel}</button>
              <small className={styles.preserveNote}>{copy.scanKeep}</small>
            </section>
          ) : (
            <div className={styles.controlColumn}>
              <section className={styles.panelSection} aria-labelledby="references-title">
                <div className={styles.sectionHeading}>
                  <div><p>02 / {copy.workflowRefs}</p><h2 id="references-title">{copy.refsTitle}</h2><span>{copy.refsBody}</span></div>
                  <b>{references.length}<small>/3</small></b>
                </div>
                <div className={styles.referenceGrid}>
                  {[0, 1, 2].map((slot) => {
                    const reference = references[slot];
                    return reference ? (
                      <article className={styles.referenceFilled} key={reference.previewUrl}>
                        <button type="button" className={styles.referenceSeek} onClick={() => videoRef.current && seekVideo(videoRef.current, reference.timestamp)} disabled={controlsDisabled}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={reference.previewUrl} alt={`${copy.emptyRef} ${slot + 1}`} />
                          <span>{formatTimecode(reference.timestamp)}</span>
                        </button>
                        <button type="button" className={styles.referenceRemove} aria-label={`${copy.removeReference} ${slot + 1}`} onClick={() => removeReference(slot)} disabled={controlsDisabled}>×</button>
                        <small>0{slot + 1}</small>
                      </article>
                    ) : (
                      <div className={styles.referenceEmpty} key={slot}><b>0{slot + 1}</b><span>{copy.emptyRef}</span></div>
                    );
                  })}
                </div>
                <p className={styles.referenceHint}>{copy.referenceHint}</p>
                <div className={styles.referenceActions}>
                  <button type="button" className={styles.secondaryButton} onClick={captureReference} disabled={references.length >= 3 || controlsDisabled || !videoDuration || videoDuration > MAX_VIDEO_DURATION_SECONDS}>+ {copy.capture}</button>
                  {references.length > 0 && <button type="button" className={styles.textButton} onClick={resetReferences} disabled={controlsDisabled}>{copy.resetRefs}</button>}
                </div>
              </section>

              {references.length === 3 && (
                <section className={styles.panelSection} aria-labelledby="settings-title">
                  <div className={styles.sectionHeadingCompact}>
                    <div><p>03 / {copy.workflowSettings}</p><h2 id="settings-title">{copy.settingsTitle}</h2><span>{copy.settingsBody}</span></div>
                    <em>{copy.referencesReady}</em>
                  </div>

                  <div className={styles.engineChoice} role="radiogroup" aria-label={copy.engineTitle}>
                    <button type="button" role="radio" aria-checked={engine === "gpu"} className={engine === "gpu" ? styles.engineActive : ""} disabled={!gpuAvailable || controlsDisabled} onClick={() => changeEngine("gpu")}>
                      <span>{copy.gpu}</span><strong>{gpuAvailable ? copy.fast : copy.gpuMissing}</strong><i />
                    </button>
                    <button type="button" role="radio" aria-checked={engine === "cpu"} className={engine === "cpu" ? styles.engineActive : ""} disabled={controlsDisabled} onClick={() => changeEngine("cpu")}>
                      <span>{copy.cpu}</span><strong>{copy.compatible}</strong><i />
                    </button>
                  </div>

                  <div className={styles.profileSetting}>
                    <div className={styles.profileHeading}>
                      <strong>{copy.profileTitle}</strong>
                      <p>{copy.profileHelp}</p>
                    </div>
                    <div className={styles.profileChoice} role="radiogroup" aria-label={copy.profileTitle}>
                      {scanProfileOptions.map((option) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={scanProfile === option.value}
                          className={scanProfile === option.value ? styles.profileActive : ""}
                          disabled={controlsDisabled}
                          onClick={() => setScanProfile(option.value)}
                          key={option.value}
                        >
                          <span><b>{option.title}</b><em>{option.badge}</em></span>
                          <small>{option.description}</small>
                          <i />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={styles.settingsGrid}>
                    <label className={styles.numberSetting}>
                      <span>{copy.sceneCount}</span>
                      <input type="number" min="1" max={MAX_SCENE_COUNT} value={sceneCount} disabled={controlsDisabled} onChange={(event) => setSceneCount(Math.max(1, Math.min(MAX_SCENE_COUNT, Number(event.target.value))))} />
                    </label>
                    <label className={styles.rangeSetting}>
                      <span><b>{copy.clipLength}</b><strong>{clipLength} {copy.seconds}</strong></span>
                      <input type="range" min="3" max="10" step="1" value={clipLength} disabled={controlsDisabled} onChange={(event) => setClipLength(Number(event.target.value))} />
                    </label>
                    <label className={styles.rangeSetting}>
                      <span><b>{copy.threshold}</b><strong>%{sensitivityPercent}</strong></span>
                      <input type="range" min="0.26" max="0.62" step="0.01" value={threshold} disabled={controlsDisabled} onChange={(event) => setThreshold(Number(event.target.value))} />
                    </label>
                  </div>
                </section>
              )}

              {error && <div className={styles.error} role="alert">{error}</div>}
              <button type="button" className={styles.runButton} onClick={analyzeVideo} disabled={references.length !== 3 || !videoDuration || videoDuration > MAX_VIDEO_DURATION_SECONDS || controlsDisabled}>
                <span>{copy.run}</span><b>04</b><i>↗</i>
              </button>
            </div>
          )}
        </section>
      ) : null}

      {(phase === "results" || phase === "exporting") && (
        <section className={styles.results} aria-labelledby="face-results-title">
          <div className={styles.resultsHeader}>
            <div><p>05 / {copy.workflowReview}</p><h2 id="face-results-title">{copy.resultsTitle}</h2></div>
            <div className={styles.resultCount}><strong>{includedMatches.length}</strong><span>/ {matches.length}<small>{copy.exportSummary}</small></span></div>
            <div className={styles.resultsIntro}>
              <p>{matches.length ? copy.resultsBody : copy.noResults}</p>
              <button type="button" onClick={() => setPhase("source-ready")} disabled={phase === "exporting"}>← {copy.backToSettings}</button>
            </div>
          </div>

          {matches.length > 0 && mediaUrl && (
            <div className={styles.sceneGrid}>
              {matches.map((match, index) => {
                const isExcluded = excludedMatchIds.has(match.id);
                const clipDuration = match.end - match.start;
                return (
                  <article className={`${styles.sceneCard} ${isExcluded ? styles.sceneExcluded : ""}`} key={match.id}>
                    <div className={styles.sceneMedia}>
                      <SceneClipPlayer
                        source={mediaUrl}
                        scene={match}
                        poster={match.thumbnailUrl}
                        label={`${copy.previewScene} ${index + 1}`}
                      />
                      <div className={styles.sceneDecision}>
                        <button type="button" className={!isExcluded ? styles.decisionActive : ""} aria-pressed={!isExcluded} aria-label={`${copy.includeScene} ${index + 1}`} onClick={() => setMatchIncluded(match.id, true)} disabled={phase === "exporting"}>✓</button>
                        <button type="button" className={isExcluded ? styles.rejectActive : ""} aria-pressed={isExcluded} aria-label={`${copy.excludeScene} ${index + 1}`} onClick={() => setMatchIncluded(match.id, false)} disabled={phase === "exporting"}>×</button>
                      </div>
                    </div>
                    <div className={styles.sceneCardMeta}>
                      <div><small>SAHNE #{String(index + 1).padStart(2, "0")}</small><span className={isExcluded ? styles.sceneStatusExcluded : ""}>{isExcluded ? copy.excluded : copy.included}</span></div>
                      <strong>{formatTimecode(match.start)} → {formatTimecode(match.end)}</strong>
                      <em>{clipDuration.toFixed(1)} {copy.seconds}</em>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {matches.length > 0 && <div className={styles.exportRow}>
            {phase === "exporting" ? <>
              <button type="button" className={styles.cancelButton} onClick={cancelActiveWork}>{copy.exportCancel}</button>
              <div className={styles.exportProgress}><div><i style={{ width: `${progressPercent}%` }} /></div><span>{progress.completed}/{progress.total} · {copy.exporting}</span></div>
            </> : <>
              <div><strong>{includedMatches.length}</strong><span>{copy.exportSummary}</span></div>
              <button type="button" className={styles.exportButton} onClick={exportMatches} disabled={!clipExportAvailable || !includedMatches.length}>{copy.export} <span>↓</span></button>
              {!clipExportAvailable && <p>{copy.exportFallback}</p>}
              {exportUrl && <a className={styles.downloadLink} href={exportUrl} download={`${file?.name.replace(/\.[^.]+$/, "") ?? "cutweave"}-scenes.zip`}>{copy.downloadAgain}</a>}
            </>}
          </div>}
        </section>
      )}

      <footer className={styles.identityNote}><span>PRIVACY</span><p>{copy.identityNote}</p><strong>{copy.zero}</strong></footer>

      {cropDraft && <ReferenceCropper
        imageUrl={cropDraft.previewUrl}
        title={copy.cropTitle}
        instructions={copy.cropInstructions}
        keyboardHint={copy.cropKeyboard}
        confirmLabel={copy.cropConfirm}
        cancelLabel={copy.cropCancel}
        onConfirm={confirmReferenceCrop}
        onCancel={closeCropDraft}
      />}
    </main>
  );
}
