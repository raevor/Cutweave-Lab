"use client";

import { flushSync } from "react-dom";
import Image from "next/image";
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
import { siteCopy as text } from "@/i18n/messages/en";
import { applySiteTheme, readSiteTheme, switchSiteTheme } from "@/lib/site-theme";
import { canRenderSceneClips, exportScenePackage, preferredClipFormat } from "@/lib/anime-face-recognition/anime-face-recognition-export-clips";
import { ANIME_CHARACTER_DEFAULT_SIMILARITY } from "@/lib/anime-face-recognition/anime-face-recognition-identity-matching";
import {
  MAX_VIDEO_DURATION_SECONDS,
  calibrateIdentityThreshold,
  captureCanvasFrame,
  captureVideoFrame,
  createClipCheckOffsets,
  createPreliminaryCandidateCount,
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
} from "@/lib/anime-face-recognition/anime-face-recognition-pipeline";
import type {
  AnimeFaceEngine,
  AnimeFaceScanProfile,
  AnimeFaceScanMode,
  AnimeFaceWorkerRequest,
  AnimeFaceWorkerResponse,
  ScanSample,
  SceneMatch,
} from "@/lib/anime-face-recognition/anime-face-recognition-types";
import type { ToolDefinition } from "@/lib/tool-catalog";
import { AnimeFaceRecognitionReferenceCropper, type AnimeNormalizedCrop } from "./anime-face-recognition-reference-cropper";
import { SourceSlot } from "@/components/source-slot";
import { WorkspaceRuler } from "@/components/workspace-ruler";
import styles from "./anime-face-recognition-workspace.module.css";

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
  resolve: (response: AnimeFaceWorkerResponse) => void;
  reject: (error: Error) => void;
};

type DecodedFrame = { canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number; duration: number };
type DecodedFrameScanner = {
  canvasesAtTimestamps: (timestamps: number[], mode?: AnimeFaceScanMode) => AsyncGenerator<DecodedFrame | null, void, unknown>;
  dispose: () => void;
};

type Phase = "idle" | "source-ready" | "engine-loading" | "analyzing" | "post-processing" | "results" | "exporting" | "cancelled" | "error";
type AnimeFaceTheme = "light" | "dark";
type PerformanceNoticeMode = "checking" | "hidden" | "modal" | "popover";
type VerificationProgress = {
  reviewedCandidates: number;
  totalCandidates: number;
};
type TrailPoint = { x: number; y: number; createdAt: number };

const subscribeToCapabilities = () => () => undefined;
const MAX_SCENE_COUNT = 100;
const performanceNoticeStorageKey = "cutweave-anime-face-performance-notice-dismissed";
const scanProfileOptions = [
  {
    value: "light",
    title: "Light",
    badge: "Lowest load",
    description: "Checks the fewest timeline frames. Best for weaker hardware, but brief appearances may be missed.",
  },
  {
    value: "balanced",
    title: "Balanced",
    badge: "Recommended",
    description: "Reduces sustained load while keeping full-strength identity verification for every result.",
  },
  {
    value: "maximum",
    title: "Maximum",
    badge: "Highest recall",
    description: "Uses the current full scan density and widest candidate search. Slowest and most demanding.",
  },
] as const satisfies readonly {
  value: AnimeFaceScanProfile;
  title: string;
  badge: string;
  description: string;
}[];

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
    const decoderOptions = { optimizeForLatency: true } as const;
    // Processing keeps one canvas active while the next frame is decoded. A
    // two-canvas ring is sufficient and keeps long scans at constant VRAM.
    const coarseSink = new CanvasSink(track, { width: Math.min(800, displayWidth), poolSize: 2, decoderOptions });
    const verificationSink = new CanvasSink(track, { width: Math.min(960, displayWidth), poolSize: 2, decoderOptions });
    return {
      canvasesAtTimestamps: (timestamps, mode = "coarse") => (
        mode === "verify" ? verificationSink : coarseSink
      ).canvasesAtTimestamps(timestamps),
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

async function cropReferenceImage(source: Blob, crop: AnimeNormalizedCrop) {
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

/* Tuned through long test runs on real footage; changing it needs an explicit confirmation. */
const DEFAULT_MATCH_THRESHOLD = Math.round(ANIME_CHARACTER_DEFAULT_SIMILARITY * 100) / 100;

export function AnimeFaceRecognitionWorkspace({ tool }: { tool: ToolDefinition }) {
  const copy = {
    nav: "Tool navigation", allTools: "All tools", privacy: "Privacy", local: "Runs on this device",
    input: "YOU ADD", output: "YOU GET", boundary: "YOUR FILE", stays: "STAYS HERE",
    noUpload: "Video, frames, character crops and feature data never leave your device.", preflight: "EXECUTION PLAN",
    choose: "CHOOSE A VIDEO TO START", stageIdle: "LOCAL ENGINE READY", chooseStep: "STEP 01 / SOURCE",
    chooseTitle: "Open your video here", chooseBody: "Choose a video up to 3 hours long. It opens in this tab and is never uploaded to Cutweave.",
    chooseButton: "Choose a video", file: "FILE", size: "SIZE", duration: "DURATION", remove: "Remove video",
    limitError: "This build processes videos up to 3 hours. Split this file and choose it again.",
    engineTitle: "PROCESSING MODE", gpu: "GPU", cpu: "CPU", fast: "Recommended · fastest",
    compatible: "Broader device compatibility", gpuMissing: "Fast mode is not available on this device.",
    refsTitle: "CHOOSE THREE REFERENCES", refsBody: "Seek to a clear view of the character. Capture the frame, then crop the character with the hairstyle visible.",
    capture: "Add reference from this frame", resetRefs: "Clear all", emptyRef: "REFERENCE",
    faceFound: "character · reference agreement", settingsTitle: "SCAN SETTINGS",
    sceneCount: "Scene count", clipLength: "Length of each clip", threshold: "Match sensitivity", auto: "automatic",
    seconds: "seconds", run: "Start scan", cancel: "Stop analysis", preparing: "Preparing the local anime character engine",
    analyzing: "Scanning the video at optimized intervals on this device", post: "Verifying candidates and preparing unique scenes for review", processed: "frames processed",
    verifying: "VERIFYING", candidateScenesReviewed: "Possible matches reviewed",
    noResults: "No reliable character matches were found at this threshold. Choose clearer references with the hairstyle visible or lower the match threshold.",
    resultsTitle: "MATCHED SCENES", resultsBody: "Every clip opens with the target character. One long scene is counted once; when there are not enough distinct scenes, fewer results are returned.",
    match: "identity score", checks: "character checks", strong: "strong", likely: "likely", review: "review", removeScene: "Remove scene", export: "Build MP4 clip ZIP", exportFallback: "This browser cannot render clips; use Chrome or Edge.",
    exporting: "Building accelerated MP4 clips on this device", exportCancel: "Stop export", downloadAgain: "Download ZIP again",
    localProof: "MEDIA SENT TO SERVER", zero: "0 B", identityNote: "Cutweave does not research identity. It only tries to find the selected character again inside this video.",
    workflowSource: "Video", workflowRefs: "References", workflowSettings: "Settings", workflowScan: "Scan", workflowReview: "Review",
    intakeKicker: "LOCAL VIDEO SOURCE", intakeTitle: "Choose the video you want to search", intakePrivacy: "The file opens in this tab. It is not uploaded, copied or sent off your device.",
    sourceReady: "VIDEO READY", referencesReady: "REFERENCES READY", settingsBody: "Choose the scene count, clip length, scan intensity and matching sensitivity before you scan.",
    removeReference: "Remove reference", referenceHint: "Move the video to the moment you want, then add a reference.",
    scanKicker: "LOCAL ANIME SCAN", scanTitle: "Searching the video for your selected character", scanKeep: "If you cancel, the video, references and every setting are preserved.", scanCancel: "Cancel scan and return to settings",
    performanceNotice: "ANIME ANALYSIS NOTICE", performanceNoticeTitle: "This tool is more demanding than standard Face Recognition.",
    performanceNoticeBody: "Anime character analysis can take substantially longer on long videos and benefits from stronger hardware. GPU processing is recommended when available; CPU processing is supported but may be significantly slower.",
    dismissNotice: "Understood", hideNoticePermanently: "Don't show again", reopenNotice: "Anime analysis notice", profileTitle: "Scan intensity",
    profileHelp: "Lower levels inspect fewer timeline frames and candidates, so they use less hardware but may miss brief appearances. The character model and match threshold stay unchanged.",
    included: "Included in ZIP", excluded: "Excluded from ZIP", includeScene: "Include scene in ZIP", excludeScene: "Exclude from ZIP", previewScene: "Play or pause clip", exportSummary: "clips to download", backToSettings: "Change settings",
    cropTitle: "Frame only the character you want", cropInstructions: "Draw a rectangle around the character, keeping the head, hairstyle and nearby upper-body detail. Keep other characters outside the selection.", cropKeyboard: "Move with the arrow keys; resize with Shift + arrow keys.", cropConfirm: "Use this crop", cropCancel: "Cancel",
    cropChecking: "Checking…", cropCheckingNote: "Checking the character in this crop on your device. This can take a few seconds.",
    engineSwitching: "Loading this mode on your device…", scene: "SCENE",
    sensitivityUnlock: "Change match sensitivity", sensitivityPromptKicker: "TUNED DEFAULT", sensitivityPromptTitle: "Change the match sensitivity?",
    sensitivityPromptBody: "was tuned through long testing and already finds the selected character. Changing it can add scenes with other characters or miss scenes where the character appears. Do you want to change it?",
    sensitivityKeep: "No, keep", sensitivityConfirm: "Yes, change it", sensitivityReset: "Reset to",
  } as const;

  const [theme, setTheme] = useState<AnimeFaceTheme>("dark");
  const workspaceRef = useRef<HTMLElement>(null);
  const performanceNoticeRef = useRef<HTMLDialogElement>(null);
  const trailCanvasRef = useRef<HTMLCanvasElement>(null);
  const trailFrame = useRef<number | null>(null);
  const trailPoints = useRef<TrailPoint[]>([]);
  const lastTrailPoint = useRef<TrailPoint | null>(null);
  /* Writing a custom property restyles the whole subtree, so only write it when it changes. */
  const lightOn = useRef(false);
  const trailTheme = useRef<AnimeFaceTheme>("dark");
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerEngineRef = useRef<AnimeFaceEngine | null>(null);
  const pendingCalls = useRef(new Map<number, PendingWorkerCall>());
  const requestIdRef = useRef(0);
  const activeJobRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const objectUrls = useRef(new Set<string>());
  const lastProgressUpdateRef = useRef(0);

  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [engine, setEngine] = useState<AnimeFaceEngine>("cpu");
  const [references, setReferences] = useState<ReferenceFrame[]>([]);
  const [referencesUpdating, setReferencesUpdating] = useState(false);
  const [referenceChecking, setReferenceChecking] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);
  const [engineSwitching, setEngineSwitching] = useState(false);
  const referenceCheckRef = useRef(false);
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null);
  const [sceneCount, setSceneCount] = useState(25);
  const [clipLength, setClipLength] = useState(5);
  const [threshold, setThreshold] = useState(DEFAULT_MATCH_THRESHOLD);
  const [sensitivityUnlocked, setSensitivityUnlocked] = useState(false);
  const [sensitivityPromptOpen, setSensitivityPromptOpen] = useState(false);
  const sensitivityPromptRef = useRef<HTMLDivElement>(null);
  const sensitivityKeepRef = useRef<HTMLButtonElement>(null);
  const sensitivityGuardRef = useRef<HTMLButtonElement>(null);
  const sensitivityInputRef = useRef<HTMLInputElement>(null);
  const [scanProfile, setScanProfile] = useState<AnimeFaceScanProfile>("balanced");
  const [performanceNoticeMode, setPerformanceNoticeMode] = useState<PerformanceNoticeMode>("checking");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [verificationProgress, setVerificationProgress] = useState<VerificationProgress>({
    reviewedCandidates: 0,
    totalCandidates: 0,
  });
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
    let restoreFrame: number | null = null;
    let noticeWasDismissed = false;
    try {
      noticeWasDismissed = window.localStorage.getItem(performanceNoticeStorageKey) === "1";
    } catch {
      // The notice remains available when browser storage is blocked.
    }
    restoreFrame = window.requestAnimationFrame(() => {
      setPerformanceNoticeMode(noticeWasDismissed ? "hidden" : "modal");
    });
    return () => {
      if (restoreFrame !== null) window.cancelAnimationFrame(restoreFrame);
    };
  }, []);

  useEffect(() => {
    if (performanceNoticeMode !== "modal") return;
    const notice = performanceNoticeRef.current;
    if (notice && !notice.open) notice.showModal();
  }, [performanceNoticeMode]);

  useEffect(() => {
    const resizeCanvas = () => {
      const canvas = trailCanvasRef.current;
      if (!canvas) return;
      /* The trail reads the same at 1x and costs far less on a viewport-sized canvas. */
      const pixelRatio = 1;
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

  function toggleTheme(event?: { currentTarget: Element }) {
    const nextTheme = theme === "light" ? "dark" : "light";
    switchSiteTheme(nextTheme, event?.currentTarget ?? null, () => setTheme(nextTheme), flushSync);
  }

  function hidePerformanceNoticePermanently() {
    try {
      window.localStorage.setItem(performanceNoticeStorageKey, "1");
    } catch {
      // Dismiss the current notice even when browser storage is unavailable.
    }
    setPerformanceNoticeMode("hidden");
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

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    context.globalCompositeOperation = "lighter";

    const palette = trailTheme.current === "dark"
      ? {
          main: "rgba(157, 232, 42, .78)",
          soft: "rgba(121, 201, 48, .16)",
          tip: "rgba(240, 255, 209, .98)",
        }
      : {
          main: "rgba(10, 133, 182, .9)",
          soft: "rgba(40, 165, 207, .2)",
          tip: "rgba(230, 250, 255, .98)",
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
      /* Glow from two wide, faint strokes instead of shadowBlur, which is very expensive per segment. */
      context.strokeStyle = palette.soft;
      context.globalAlpha = alpha * .45;
      context.lineWidth = 12 + progress * 8;
      context.stroke();
      context.globalAlpha = alpha * .8;
      context.lineWidth = 5 + progress * 4;
      context.stroke();
      context.strokeStyle = palette.main;
      context.globalAlpha = alpha * .92;
      context.lineWidth = .6 + progress * 1.5;
      context.stroke();
      context.restore();
    }

    const head = points.at(-1);
    if (head) {
      const headLife = Math.max(0, 1 - (now - head.createdAt) / lifetime);
      const pulse = 4.8 + Math.sin(now / 145) * .7;
      context.save();
      context.globalAlpha = headLife * headLife;
      context.fillStyle = palette.soft;
      context.beginPath();
      context.arc(head.x, head.y, pulse * 1.8, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = palette.tip;
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
    if (!lightOn.current) {
      workspaceRef.current?.style.setProperty("--light-opacity", "1");
      lightOn.current = true;
    }
    if (trailFrame.current === null) trailFrame.current = window.requestAnimationFrame(renderTrail);
  }

  function hidePointer() {
    workspaceRef.current?.style.setProperty("--light-opacity", "0");
    lightOn.current = false;
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

  useEffect(() => {
    if (!sensitivityPromptOpen) return;
    sensitivityKeepRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!sensitivityPromptRef.current?.contains(event.target as Node)) setSensitivityPromptOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [sensitivityPromptOpen]);

  function keepTunedSensitivity() {
    setSensitivityPromptOpen(false);
    sensitivityGuardRef.current?.focus();
  }

  function unlockSensitivity() {
    setSensitivityUnlocked(true);
    setSensitivityPromptOpen(false);
    window.requestAnimationFrame(() => sensitivityInputRef.current?.focus());
  }

  function revokeUrl(url: string | null) {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  }

  function sendWorker(message: AnimeFaceWorkerRequest, transfer: Transferable[] = []) {
    return new Promise<AnimeFaceWorkerResponse>((resolve, reject) => {
      if (!workerRef.current || !("requestId" in message)) {
        reject(new Error("The local anime character worker is not available."));
        return;
      }
      pendingCalls.current.set(message.requestId, { resolve, reject });
      workerRef.current.postMessage(message, transfer);
    });
  }

  async function ensureWorker(selectedEngine: AnimeFaceEngine, showScanStep = true) {
    if (workerRef.current && workerEngineRef.current === selectedEngine && engineBackend) return engineBackend;
    workerRef.current?.terminate();
    pendingCalls.current.forEach(({ reject }) => reject(new Error("The processing engine changed.")));
    pendingCalls.current.clear();

    const worker = new Worker(new URL("../../../workers/anime-face-recognition-analysis.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    workerEngineRef.current = selectedEngine;
    worker.onmessage = (event: MessageEvent<AnimeFaceWorkerResponse>) => {
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
      const workerError = new Error(event.message || "The local anime character worker failed.");
      pendingCalls.current.forEach(({ reject }) => reject(workerError));
      pendingCalls.current.clear();
    };

    if (showScanStep) setPhase("engine-loading");
    const requestId = ++requestIdRef.current;
    const response = await sendWorker({ type: "init", requestId, engine: selectedEngine, origin: window.location.origin });
    if (response.type !== "ready") throw new Error("The local anime character engine did not finish loading.");
    if (selectedEngine === "gpu" && response.backend !== "webgpu") {
      workerEngineRef.current = "cpu";
      setEngine("cpu");
    }
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
      const response = await sendWorker({ type: "reference", requestId, slot: reference.slot, bitmap, restore: true }, [bitmap]);
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
    setCropError(null);
  }

  async function resetReferences() {
    clearReferencesLocally();
    closeCropDraft();
    matches.forEach((match) => revokeUrl(match.thumbnailUrl ?? null));
    setMatches([]);
    setExcludedMatchIds(new Set());
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
          const response = await sendWorker({ type: "reference", requestId, slot: reference.slot, bitmap, restore: true }, [bitmap]);
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
    if (activeJobRef.current) workerRef.current?.postMessage({ type: "cancel", jobId: activeJobRef.current } satisfies AnimeFaceWorkerRequest);
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

  async function changeEngine(nextEngine: AnimeFaceEngine) {
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
    setEngineSwitching(true);
    try {
      await ensureWorker(nextEngine, false);
      const refreshed: ReferenceFrame[] = [];
      for (const reference of references) {
        const bitmap = await createImageBitmap(reference.previewBlob);
        const requestId = ++requestIdRef.current;
        const response = await sendWorker({ type: "reference", requestId, slot: reference.slot, bitmap, restore: true }, [bitmap]);
        if (response.type !== "reference-ready") throw new Error("A saved reference could not be loaded into the new engine.");
        refreshed.push({ ...reference, faceCount: response.faceCount, agreement: response.agreement });
      }
      setReferences(refreshed);
      setPhase("source-ready");
    } catch (engineError) {
      setError(engineError instanceof Error ? engineError.message : "The processing engine could not be changed.");
      setPhase("error");
    } finally {
      setEngineSwitching(false);
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

  async function confirmReferenceCrop(crop: AnimeNormalizedCrop) {
    if (!cropDraft || references.length >= 3 || referenceCheckRef.current) return;
    /* Repeated clicks while the worker reads the crop must not add extra references. */
    referenceCheckRef.current = true;
    setReferenceChecking(true);
    setCropError(null);
    setError(null);
    try {
      await ensureWorker(engine, false);
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
    } catch (referenceError) {
      /* Shown inside the open crop dialog, where the user can adjust the selection and try again. */
      setCropError(referenceError instanceof Error ? referenceError.message : "The cropped reference could not be analyzed.");
    } finally {
      referenceCheckRef.current = false;
      setReferenceChecking(false);
    }
  }

  async function submitScan(
    timestamp: number,
    jobId: string,
    identityThreshold: number,
    mode: AnimeFaceScanMode,
    captured: Awaited<ReturnType<typeof captureVideoFrame>>,
  ) {
    const { bitmap, visualHash, visualFingerprint } = captured;
    const requestId = ++requestIdRef.current;
    const response = await sendWorker({ type: "scan", requestId, jobId, timestamp, threshold: identityThreshold, mode, bitmap }, [bitmap]);
    if (response.type !== "scan-result" || response.jobId !== jobId) throw new Error("A stale anime character result was rejected.");
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

  async function scanAt(timestamp: number, jobId: string, identityThreshold: number, mode: AnimeFaceScanMode) {
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
    mode: AnimeFaceScanMode,
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
    setVerificationProgress({
      reviewedCandidates: 0,
      totalCandidates: 0,
    });
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
        let pendingDecodedFrame = decodedFrames.next();
        try {
          while (coarseIndex < sampleTimes.length) {
            let decoded: IteratorResult<DecodedFrame | null, void>;
            try {
              decoded = await pendingDecodedFrame;
            } catch {
              decodedFramesFailed = true;
              break;
            }
            if (decoded.done) break;
            pendingDecodedFrame = decodedFrames.next();
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
      setPhase("post-processing");
      const preliminaryThreshold = proposalThreshold;
      const preliminaryCount = createPreliminaryCandidateCount(sceneCount, scanProfile);
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
      let reviewedCandidates = 0;
      const verificationCache = new Map<number, ScanSample>();
      setVerificationProgress({
        reviewedCandidates: 0,
        totalCandidates: verificationCandidates.length,
      });
      for (let candidateIndex = 0; candidateIndex < verificationCandidates.length && !enoughDiverseMatches; candidateIndex += 1) {
        for (const clipStart of candidateStarts[candidateIndex]) {
          const checkTimes = checkOffsets.map((offset) => Math.max(0, Math.min(videoDuration - 0.05, clipStart + offset)));
          const checks: ScanSample[] = [];
          const missingCheckKeys = new Set<number>();
          const missingCheckTimes = checkTimes.filter((timestamp) => {
            const cacheKey = Math.round(timestamp * 50);
            if (verificationCache.has(cacheKey) || missingCheckKeys.has(cacheKey)) return false;
            missingCheckKeys.add(cacheKey);
            return true;
          });
          let decodedVerificationFrames = decodedScanner?.canvasesAtTimestamps(missingCheckTimes, "verify") ?? null;
          let pendingDecodedFrame = decodedVerificationFrames?.next();
          try {
            for (let checkIndex = 0; checkIndex < checkTimes.length; checkIndex += 1) {
              if (cancelledRef.current || activeJobRef.current !== jobId) throw new DOMException("Analysis cancelled", "AbortError");
              const cacheKey = Math.round(checkTimes[checkIndex] * 50);
              let check = verificationCache.get(cacheKey);
              if (!check) {
                if (decodedScanner && decodedVerificationFrames && pendingDecodedFrame) {
                  let frame: DecodedFrame | null = null;
                  try {
                    const decoded = await pendingDecodedFrame;
                    if (!decoded.done) {
                      frame = decoded.value;
                      pendingDecodedFrame = decodedVerificationFrames.next();
                    } else {
                      pendingDecodedFrame = undefined;
                    }
                  } catch {
                    await decodedVerificationFrames.return().catch(() => undefined);
                    decodedVerificationFrames = null;
                    pendingDecodedFrame = undefined;
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
          } finally {
            await decodedVerificationFrames?.return().catch(() => undefined);
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
        reviewedCandidates = candidateIndex + 1;
        setVerificationProgress((current) => ({
          ...current,
          reviewedCandidates,
        }));
      }
      const selected = selectSceneMatches(verified, sceneCount, clipLength, videoDuration, calibratedThreshold, {
        minimumGapSeconds: Math.max(1, clipLength * 0.95),
        contentDiversity: true,
      });
      verificationCache.clear();
      samples.length = 0;
      preliminary.length = 0;
      verificationCandidates.length = 0;
      candidateStarts.length = 0;
      verified.length = 0;
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
    workerRef.current?.postMessage({ type: "cancel", jobId: activeJobRef.current } satisfies AnimeFaceWorkerRequest);
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
  const controlsDisabled = isBusy || referencesUpdating || referenceChecking || engineSwitching;
  const sensitivityPercent = Math.round(((threshold - 0.72) / (0.94 - 0.72)) * 100);
  const defaultSensitivityPercent = Math.round(((DEFAULT_MATCH_THRESHOLD - 0.72) / (0.94 - 0.72)) * 100);
  const workflowStep = !file ? 0 : phase === "results" || phase === "exporting" ? 4 : scanInProgress ? 3 : references.length < 3 ? 1 : 2;
  const workflowLabels = [copy.workflowSource, copy.workflowRefs, copy.workflowSettings, copy.workflowScan, copy.workflowReview];

  return (
    <main
      className={styles.workspace}
      data-tool-key={tool.slug}
      onPointerEnter={followPointer}
      onPointerLeave={hidePointer}
      onPointerMove={followPointer}
      ref={workspaceRef}
    >
      <canvas className={styles.pointerLight} ref={trailCanvasRef} aria-hidden="true" />
      <header className={styles.header}>
        {/* A document navigation removes the anime-only cross-origin isolation before leaving this workspace. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="brand-mark" href="/" aria-label="Cutweave Lab home">
          <span>CUT</span>
          <span className="brand-slash" aria-hidden="true">/</span>
          <span>WEAVE</span>
          <span className="brand-lab">LAB</span>
        </a>
        <div className={styles.headerActions}>
          <nav aria-label={copy.nav}>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/lab">← {copy.allTools}</a>
            <a href="/privacy">{copy.privacy}</a>
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
        <div className={styles.heroUtility}>
          <div className={styles.noticeBeaconWrap}>
            <button
              className={styles.noticeBeacon}
              type="button"
              aria-label={copy.reopenNotice}
              aria-expanded={performanceNoticeMode === "popover"}
              aria-controls="anime-performance-notice-popover"
              onClick={() => setPerformanceNoticeMode((current) => current === "popover" ? "hidden" : "popover")}
            >
              <span aria-hidden="true">!</span>
            </button>
            {performanceNoticeMode === "popover" && (
              <aside
                className={styles.performanceNoticePopover}
                id="anime-performance-notice-popover"
                role="dialog"
                aria-labelledby="anime-performance-popover-title"
              >
                <button className={styles.performanceNoticeClose} type="button" aria-label="Dismiss notice" onClick={() => setPerformanceNoticeMode("hidden")}>×</button>
                <div className={styles.performanceNoticeBody}>
                  <small>{copy.performanceNotice}</small>
                  <strong id="anime-performance-popover-title">{copy.performanceNoticeTitle}</strong>
                  <p>{copy.performanceNoticeBody}</p>
                </div>
              </aside>
            )}
          </div>
          <div className={styles.localStatus}>
            <span><i /> {copy.local}</span>
            <strong>{copy.zero}</strong>
            <small>{copy.localProof}</small>
          </div>
        </div>
      </section>

      {performanceNoticeMode === "modal" && (
        <dialog
          ref={performanceNoticeRef}
          className={styles.performanceNotice}
          aria-labelledby="anime-performance-notice-title"
          onCancel={(event) => {
            event.preventDefault();
            setPerformanceNoticeMode("hidden");
          }}
        >
          <button className={styles.performanceNoticeClose} type="button" aria-label="Dismiss notice" onClick={() => setPerformanceNoticeMode("hidden")}>×</button>
          <div className={styles.performanceNoticeBody}>
            <small>{copy.performanceNotice}</small>
            <strong id="anime-performance-notice-title">{copy.performanceNoticeTitle}</strong>
            <p>{copy.performanceNoticeBody}</p>
          </div>
          <div className={styles.performanceNoticeActions}>
            <button className={styles.performanceNoticeAction} type="button" onClick={() => setPerformanceNoticeMode("hidden")}>{copy.dismissNotice}</button>
            <button className={`${styles.performanceNoticeAction} ${styles.performanceNoticeActionQuiet}`} type="button" onClick={hidePerformanceNoticePermanently}>{copy.hideNoticePermanently}</button>
          </div>
        </dialog>
      )}

      <WorkspaceRuler />

      <ol className={styles.workflow} aria-label="Anime character scan steps">
        {workflowLabels.map((label, index) => (
          <li className={index < workflowStep ? styles.stepComplete : index === workflowStep ? styles.stepCurrent : ""} key={label} aria-current={index === workflowStep ? "step" : undefined}>
            <span>{index < workflowStep ? "✓" : String(index + 1).padStart(2, "0")}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>

      {!file ? (
        <section className={styles.intake} aria-labelledby="anime-face-intake-title">
          <div className={styles.intakeVisual} aria-hidden="true">
            <SourceSlot kind="character" />
            <b>01</b>
          </div>
          <div className={styles.intakeCopy}>
            <p>{copy.intakeKicker}</p>
            <h2 id="anime-face-intake-title">{copy.intakeTitle}</h2>
            <span>{copy.chooseBody}</span>
            <input ref={inputRef} className="sr-only" id="anime-face-video-input" type="file" accept="video/*" onChange={chooseFile} />
            <label className={styles.primaryButton} htmlFor="anime-face-video-input">{copy.chooseButton}<span>↗</span></label>
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
              <div className={styles.animeFaceScan} aria-hidden="true">
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
                <i className={phase === "post-processing" ? styles.scanLineActive : styles.scanSweep} />
                <b className={phase === "post-processing" ? styles.scanActivityBadge : undefined}>
                  {phase === "post-processing" ? copy.verifying : `${progressPercent}%`}
                </b>
              </div>
              <h2 id="scan-title">{copy.scanTitle}</h2>
              <p className={styles.scanStage}>{activeStageLabel}</p>
              {phase === "post-processing" ? (
                <div className={styles.verificationStatus} role="status" aria-label={activeStageLabel}>
                  <div>
                    <span>{copy.candidateScenesReviewed}</span>
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

                  <div className={styles.engineChoice} role="radiogroup" aria-label={copy.engineTitle} aria-busy={engineSwitching}>
                    <button type="button" role="radio" aria-checked={engine === "gpu"} className={engine === "gpu" ? styles.engineActive : ""} disabled={!gpuAvailable || controlsDisabled} onClick={() => changeEngine("gpu")}>
                      <span>{copy.gpu}</span><strong>{engineSwitching && engine === "gpu" ? copy.engineSwitching : gpuAvailable ? copy.fast : copy.gpuMissing}</strong><i />
                    </button>
                    <button type="button" role="radio" aria-checked={engine === "cpu"} className={engine === "cpu" ? styles.engineActive : ""} disabled={controlsDisabled} onClick={() => changeEngine("cpu")}>
                      <span>{copy.cpu}</span><strong>{engineSwitching && engine === "cpu" ? copy.engineSwitching : copy.compatible}</strong><i />
                    </button>
                  </div>

                  <div className={styles.profileSetting}>
                    <div className={styles.profileHeading}>
                      <strong>{copy.profileTitle}</strong>
                      <p>{copy.profileHelp}</p>
                    </div>
                    <div className={styles.profileChoice} role="radiogroup" aria-label={copy.profileTitle}>
                      {scanProfileOptions.map((profile) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={scanProfile === profile.value}
                          className={scanProfile === profile.value ? styles.profileActive : ""}
                          disabled={controlsDisabled}
                          onClick={() => setScanProfile(profile.value)}
                          key={profile.value}
                        >
                          <span><b>{profile.title}</b><em>{profile.badge}</em></span>
                          <small>{profile.description}</small>
                          <i />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={styles.settingsGrid}>
                    <label className={styles.numberSetting}>
                      <span>{copy.sceneCount}</span>
                      <input type="number" min="1" max={MAX_SCENE_COUNT} value={sceneCount} disabled={controlsDisabled} onChange={(event) => {
                        const value = Number(event.target.value);
                        setSceneCount(Number.isFinite(value) ? Math.max(1, Math.min(MAX_SCENE_COUNT, value)) : 1);
                      }} />
                    </label>
                    <label className={styles.rangeSetting}>
                      <span><b>{copy.clipLength}</b><strong>{clipLength} {copy.seconds}</strong></span>
                      <input type="range" min="3" max="10" step="1" value={clipLength} disabled={controlsDisabled} onChange={(event) => setClipLength(Number(event.target.value))} />
                    </label>
                    <div className={styles.rangeSetting}>
                      <span>
                        <b id="sensitivity-label">{copy.threshold}</b>
                        <span className={styles.sensitivityValue}>
                          {sensitivityUnlocked && threshold !== DEFAULT_MATCH_THRESHOLD && (
                            <button type="button" className={styles.sensitivityReset} onClick={() => setThreshold(DEFAULT_MATCH_THRESHOLD)} disabled={controlsDisabled}>
                              {copy.sensitivityReset} {defaultSensitivityPercent}%
                            </button>
                          )}
                          <strong>{sensitivityPercent}%</strong>
                        </span>
                      </span>
                      <div className={styles.sensitivityControl}>
                        <input ref={sensitivityInputRef} type="range" min="0.72" max="0.94" step="0.01" value={threshold} aria-labelledby="sensitivity-label" tabIndex={sensitivityUnlocked ? undefined : -1} disabled={controlsDisabled} onChange={(event) => { if (sensitivityUnlocked) setThreshold(Number(event.target.value)); }} />
                        {/* The tuned value only changes after the user confirms in the prompt. */}
                        {!sensitivityUnlocked && (
                          <button
                            ref={sensitivityGuardRef}
                            type="button"
                            className={styles.sensitivityGuard}
                            aria-label={copy.sensitivityUnlock}
                            aria-haspopup="dialog"
                            aria-expanded={sensitivityPromptOpen}
                            disabled={controlsDisabled}
                            onClick={() => setSensitivityPromptOpen(true)}
                          />
                        )}
                      </div>
                      {sensitivityPromptOpen && (
                        <div
                          ref={sensitivityPromptRef}
                          className={styles.sensitivityPrompt}
                          role="alertdialog"
                          aria-labelledby="sensitivity-prompt-title"
                          aria-describedby="sensitivity-prompt-body"
                          onKeyDown={(event) => { if (event.key === "Escape") keepTunedSensitivity(); }}
                        >
                          <p>{copy.sensitivityPromptKicker}</p>
                          <h3 id="sensitivity-prompt-title">{copy.sensitivityPromptTitle}</h3>
                          <span id="sensitivity-prompt-body">{defaultSensitivityPercent}% {copy.sensitivityPromptBody}</span>
                          <div>
                            <button ref={sensitivityKeepRef} type="button" onClick={keepTunedSensitivity}>{copy.sensitivityKeep} {defaultSensitivityPercent}%</button>
                            <button type="button" className={styles.sensitivityConfirm} onClick={unlockSensitivity}>{copy.sensitivityConfirm}</button>
                          </div>
                        </div>
                      )}
                    </div>
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
        <section className={styles.results} aria-labelledby="anime-face-results-title">
          <div className={styles.resultsHeader}>
            <div><p>05 / {copy.workflowReview}</p><h2 id="anime-face-results-title">{copy.resultsTitle}</h2></div>
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
                      <div><small>{copy.scene} #{String(index + 1).padStart(2, "0")}</small><span className={isExcluded ? styles.sceneStatusExcluded : ""}>{isExcluded ? copy.excluded : copy.included}</span></div>
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

      {cropDraft && <AnimeFaceRecognitionReferenceCropper
        imageUrl={cropDraft.previewUrl}
        title={copy.cropTitle}
        instructions={copy.cropInstructions}
        keyboardHint={copy.cropKeyboard}
        confirmLabel={copy.cropConfirm}
        cancelLabel={copy.cropCancel}
        busy={referenceChecking}
        busyLabel={copy.cropChecking}
        busyNote={copy.cropCheckingNote}
        error={cropError}
        onConfirm={confirmReferenceCrop}
        onCancel={closeCropDraft}
      />}
    </main>
  );
}
