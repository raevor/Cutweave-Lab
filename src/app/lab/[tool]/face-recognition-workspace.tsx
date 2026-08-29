"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/i18n/language-provider";
import { canRenderSceneClips, exportScenePackage } from "@/lib/face-recognition/export-clips";
import {
  MAX_VIDEO_DURATION_SECONDS,
  calibrateIdentityThreshold,
  captureVideoFrame,
  createCandidateClipStarts,
  createClipCheckOffsets,
  createSampleTimes,
  createVerifiedClipSample,
  formatTimecode,
  seekVideo,
  selectSceneMatches,
  samplePassesIdentity,
} from "@/lib/face-recognition/pipeline";
import type {
  FaceEngine,
  FaceWorkerRequest,
  FaceWorkerResponse,
  ScanSample,
  SceneMatch,
} from "@/lib/face-recognition/types";
import type { ToolDefinition } from "@/lib/tool-catalog";
import { ReferenceCropper, type NormalizedCrop } from "./reference-cropper";

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

type Phase = "idle" | "source-ready" | "engine-loading" | "analyzing" | "post-processing" | "results" | "exporting" | "cancelled" | "error";

const subscribeToCapabilities = () => () => undefined;

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

export function FaceRecognitionWorkspace({ tool }: { tool: ToolDefinition }) {
  const { locale, text } = useLanguage();
  const isTurkish = locale === "tr";
  const copy = useMemo(() => isTurkish ? {
    nav: "Araç menüsü", allTools: "Tüm araçlar", privacy: "Dosyaların", local: "Bu cihazda çalışır",
    input: "SEN EKLERSİN", output: "SEN ALIRSIN", boundary: "DOSYAN", stays: "BURADA KALIR",
    noUpload: "Video, kareler, yüz kırpmaları ve yüz verisi cihazından çıkmaz.", preflight: "ÇALIŞMA PLANI",
    choose: "BAŞLAMAK İÇİN VİDEO SEÇ", stageIdle: "YEREL MOTOR HAZIR", chooseStep: "ADIM 01 / KAYNAK",
    chooseTitle: "Videonu burada aç", chooseBody: "En fazla 3 saatlik bir video seç. Dosya bu sekmede açılır; Cutweave'e yüklenmez.",
    chooseButton: "Bir video seç", file: "DOSYA", size: "BOYUT", duration: "SÜRE", remove: "Dosyayı kaldır",
    limitError: "Bu sürüm en fazla 3 saatlik videoları işler. Lütfen videoyu bölüp yeniden seç.",
    engineTitle: "ADIM 02 / İŞLEME MOTORU", gpu: "GPU / WebGPU", cpu: "CPU / WASM", fast: "Daha hızlı",
    compatible: "Daha uyumlu, daha yavaş", gpuMissing: "Bu tarayıcıda WebGPU bulunamadı.",
    refsTitle: "ADIM 03 / ÜÇ REFERANS KARE", refsBody: "Yüzün net göründüğü bir ana git, kareyi yakala ve ekran alıntısı gibi yalnız istediğin kişiyi kırp.",
    capture: "Kareyi yakala ve kırp", resetRefs: "Referansları sıfırla", emptyRef: "REFERANS",
    faceFound: "yüz · referans uyumu", settingsTitle: "ADIM 04 / SONUÇ AYARLARI",
    sceneCount: "İstenen sahne", clipLength: "Klip süresi", threshold: "Kimlik skoru eşiği", auto: "otomatik",
    seconds: "saniye", run: "Yüzü videoda bul", cancel: "Analizi durdur", preparing: "Yerel yüz motoru hazırlanıyor",
    analyzing: "Video cihazında daha sık aralıklarla taranıyor", post: "Hedef yüzle başlayan klipler doğrulanıyor; tekrarlar eleniyor", processed: "işlenen kare",
    noResults: "Bu eşikte yeterli eşleşme bulunamadı. Daha net referans kareler seç veya eşleşme eşiğini düşür.",
    resultsTitle: "BULUNAN SAHNELER", resultsBody: "Her klip hedef yüz görünürken başlar; sonuçlar videonun farklı bölümlerine dağıtıldı ve yakın tekrarlar elendi.",
    match: "kimlik skoru", checks: "yüz kontrolü", strong: "güçlü", likely: "olası", review: "kontrol et", removeScene: "Sahneyi çıkar", export: "Klipleri ZIP olarak hazırla", exportFallback: "Bu tarayıcı klip üretemiyor; Chrome veya Edge kullan.",
    exporting: "Klipler gerçek zamanlı hazırlanıyor", exportCancel: "Dışa aktarmayı durdur", downloadAgain: "ZIP'i yeniden indir",
    localProof: "SUNUCUYA GÖNDERİLEN MEDYA", zero: "0 B", identityNote: "Cutweave kişinin kimliğini araştırmaz. Yalnızca seçtiğin yüzü bu videonun içinde yeniden bulmaya çalışır.",
    cropTitle: "Yalnız istediğin yüzü çerçevele", cropInstructions: "Yüzü ve baş çevresini içine alan bir dikdörtgen çiz. Arka plandaki diğer kişileri çerçevenin dışında bırak.", cropKeyboard: "Seçimi ok tuşlarıyla taşı; Shift + ok tuşlarıyla boyutlandır.", cropConfirm: "Bu kırpmayı kullan", cropCancel: "İptal",
  } : {
    nav: "Tool navigation", allTools: "All tools", privacy: "Your files", local: "Runs on this device",
    input: "YOU ADD", output: "YOU GET", boundary: "YOUR FILE", stays: "STAYS HERE",
    noUpload: "Video, frames, face crops and face data never leave your device.", preflight: "EXECUTION PLAN",
    choose: "CHOOSE A VIDEO TO START", stageIdle: "LOCAL ENGINE READY", chooseStep: "STEP 01 / SOURCE",
    chooseTitle: "Open your video here", chooseBody: "Choose a video up to 3 hours long. It opens in this tab and is never uploaded to Cutweave.",
    chooseButton: "Choose a video", file: "FILE", size: "SIZE", duration: "DURATION", remove: "Remove video",
    limitError: "This build processes videos up to 3 hours. Split this file and choose it again.",
    engineTitle: "STEP 02 / PROCESSING ENGINE", gpu: "GPU / WebGPU", cpu: "CPU / WASM", fast: "Faster",
    compatible: "More compatible, slower", gpuMissing: "WebGPU is not available in this browser.",
    refsTitle: "STEP 03 / THREE REFERENCE FRAMES", refsBody: "Seek to a clear view, capture the frame, then crop only the intended person like a screenshot selection.",
    capture: "Capture and crop frame", resetRefs: "Reset references", emptyRef: "REFERENCE",
    faceFound: "face · reference agreement", settingsTitle: "STEP 04 / RESULT SETTINGS",
    sceneCount: "Scenes wanted", clipLength: "Clip length", threshold: "Identity score threshold", auto: "automatic",
    seconds: "seconds", run: "Find this face", cancel: "Stop analysis", preparing: "Preparing the local face engine",
    analyzing: "Scanning the video more frequently on this device", post: "Verifying clips that open on the target face and removing repeats", processed: "frames processed",
    noResults: "No reliable matches were found at this threshold. Choose clearer references or lower the match threshold.",
    resultsTitle: "MATCHED SCENES", resultsBody: "Every clip opens with the target face; results were spread across the timeline and nearby repeats were removed.",
    match: "identity score", checks: "face checks", strong: "strong", likely: "likely", review: "review", removeScene: "Remove scene", export: "Build clip ZIP", exportFallback: "This browser cannot render clips; use Chrome or Edge.",
    exporting: "Rendering clips in real time", exportCancel: "Stop export", downloadAgain: "Download ZIP again",
    localProof: "MEDIA SENT TO SERVER", zero: "0 B", identityNote: "Cutweave does not research identity. It only tries to find the selected face again inside this video.",
    cropTitle: "Frame only the face you want", cropInstructions: "Draw a rectangle around the face and nearby head area. Keep other people in the background outside the selection.", cropKeyboard: "Move with the arrow keys; resize with Shift + arrow keys.", cropConfirm: "Use this crop", cropCancel: "Cancel",
  }, [isTurkish]);

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

  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [engine, setEngine] = useState<FaceEngine>("cpu");
  const [references, setReferences] = useState<ReferenceFrame[]>([]);
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null);
  const [sceneCount, setSceneCount] = useState(25);
  const [clipLength, setClipLength] = useState(5);
  const [threshold, setThreshold] = useState(0.38);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [matches, setMatches] = useState<SceneMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [engineBackend, setEngineBackend] = useState<string | null>(null);
  const capabilityMask = useSyncExternalStore(subscribeToCapabilities, getCapabilityMask, () => 0);
  const gpuAvailable = Boolean(capabilityMask & 1);
  const clipExportAvailable = Boolean(capabilityMask & 2);

  const isBusy = phase === "engine-loading" || phase === "analyzing" || phase === "post-processing" || phase === "exporting";
  const progressPercent = progress.total ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;
  const referenceAgreement = references.at(-1)?.agreement ?? 1;
  const effectiveThreshold = calibrateIdentityThreshold(threshold, referenceAgreement);

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
    allSamplesRef.current = [];
    if (workerRef.current) {
      const requestId = ++requestIdRef.current;
      await sendWorker({ type: "clear-references", requestId }).catch(() => undefined);
    }
    setPhase(file ? "source-ready" : "idle");
    setError(null);
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

  async function scanAt(timestamp: number, jobId: string, identityThreshold: number) {
    const video = videoRef.current;
    if (!video) throw new Error("The video preview is no longer available.");
    await seekVideo(video, timestamp);
    const { bitmap, visualHash } = await captureVideoFrame(video, false, 1280);
    const requestId = ++requestIdRef.current;
    const response = await sendWorker({ type: "scan", requestId, jobId, timestamp, threshold: identityThreshold, bitmap }, [bitmap]);
    if (response.type !== "scan-result" || response.jobId !== jobId) throw new Error("A stale face result was rejected.");
    return {
      timestamp: response.timestamp,
      similarity: response.similarity,
      weakestSimilarity: response.weakestSimilarity,
      referenceHits: response.referenceHits,
      faceCount: response.faceCount,
      faceQuality: response.faceQuality,
      visualHash,
    } satisfies ScanSample;
  }

  async function createThumbnails(scenes: SceneMatch[], jobId: string) {
    const video = videoRef.current;
    if (!video) return scenes;
    const completed: SceneMatch[] = [];
    for (const scene of scenes) {
      if (cancelledRef.current || activeJobRef.current !== jobId) return completed;
      await seekVideo(video, scene.center);
      const { bitmap, previewBlob } = await captureVideoFrame(video, true);
      bitmap.close();
      if (previewBlob) {
        const thumbnailUrl = URL.createObjectURL(previewBlob);
        objectUrls.current.add(thumbnailUrl);
        completed.push({ ...scene, thumbnailUrl });
      } else {
        completed.push(scene);
      }
      setProgress({ completed: completed.length, total: scenes.length });
    }
    return completed;
  }

  async function analyzeVideo() {
    const video = videoRef.current;
    if (!video || references.length !== 3 || !videoDuration || videoDuration > MAX_VIDEO_DURATION_SECONDS) return;
    matches.forEach((match) => revokeUrl(match.thumbnailUrl ?? null));
    revokeUrl(exportUrl);
    setExportUrl(null);
    setMatches([]);
    setError(null);
    cancelledRef.current = false;
    const jobId = makeJobId();
    activeJobRef.current = jobId;

    try {
      await ensureWorker(engine);
      if (activeJobRef.current !== jobId || cancelledRef.current) return;
      const calibratedThreshold = calibrateIdentityThreshold(threshold, references.at(-1)?.agreement ?? 1);
      const sampleTimes = createSampleTimes(videoDuration, clipLength);
      const samples: ScanSample[] = [];
      setPhase("analyzing");
      setProgress({ completed: 0, total: sampleTimes.length });
      video.pause();

      for (let index = 0; index < sampleTimes.length; index += 1) {
        if (cancelledRef.current || activeJobRef.current !== jobId) throw new DOMException("Analysis cancelled", "AbortError");
        const timestamp = sampleTimes[index];
        samples.push(await scanAt(timestamp, jobId, calibratedThreshold));
        setProgress({ completed: index + 1, total: sampleTimes.length });
      }

      if (activeJobRef.current !== jobId || cancelledRef.current) return;
      allSamplesRef.current = samples;
      setPhase("post-processing");
      const preliminaryThreshold = Math.max(0.22, calibratedThreshold - 0.04);
      const preliminaryCount = Math.min(Math.ceil(sceneCount * 6), 120);
      const preliminaryWindow = Math.max(15, videoDuration / Math.max(1, preliminaryCount));
      const preliminary = selectSceneMatches(
        samples,
        preliminaryCount,
        clipLength,
        videoDuration,
        preliminaryThreshold,
        {
          minimumGapSeconds: Math.max(4, clipLength, preliminaryWindow * 0.35),
          maximumVisualHashDistance: 14,
          visualDuplicateWindowSeconds: Math.max(90, preliminaryWindow * 3),
          timelineBucketSeconds: preliminaryWindow,
          maximumMatchesPerTimelineBucket: 1,
        },
      );
      const verified: ScanSample[] = [];
      const checkOffsets = createClipCheckOffsets(clipLength);
      const candidateStarts = preliminary.map((candidate) => createCandidateClipStarts(candidate.start, clipLength, videoDuration));
      const plannedVerificationFrames = candidateStarts.reduce((total, starts) => total + starts.length * checkOffsets.length, 0);
      setProgress({ completed: 0, total: plannedVerificationFrames });
      let verifiedFrames = 0;
      for (let candidateIndex = 0; candidateIndex < preliminary.length; candidateIndex += 1) {
        for (const clipStart of candidateStarts[candidateIndex]) {
          const checkTimes = checkOffsets.map((offset) => Math.max(0, Math.min(videoDuration - 0.05, clipStart + offset)));
          const checks: ScanSample[] = [];
          for (let checkIndex = 0; checkIndex < checkTimes.length; checkIndex += 1) {
            if (cancelledRef.current || activeJobRef.current !== jobId) throw new DOMException("Analysis cancelled", "AbortError");
            const check = await scanAt(checkTimes[checkIndex], jobId, calibratedThreshold);
            checks.push(check);
            verifiedFrames += 1;
            setProgress({ completed: verifiedFrames, total: plannedVerificationFrames });
            if (checkIndex < 2 && !samplePassesIdentity(check, calibratedThreshold)) break;
          }
          const verifiedSample = createVerifiedClipSample(checks, calibratedThreshold, clipStart);
          if (verifiedSample) {
            verified.push(verifiedSample);
            break;
          }
        }
      }
      const timelineWindow = Math.max(30, videoDuration / Math.max(1, sceneCount));
      const selected = selectSceneMatches(verified, sceneCount, clipLength, videoDuration, calibratedThreshold, {
        minimumGapSeconds: Math.max(12, clipLength * 2.4, timelineWindow * 0.55),
        maximumVisualHashDistance: 18,
        visualDuplicateWindowSeconds: Math.max(180, timelineWindow * 2),
        timelineBucketSeconds: timelineWindow,
        maximumMatchesPerTimelineBucket: 1,
      });
      setProgress({ completed: 0, total: selected.length });
      const withThumbnails = await createThumbnails(selected, jobId);
      if (activeJobRef.current !== jobId || cancelledRef.current) return;
      setMatches(withThumbnails);
      setPhase("results");
    } catch (analysisError) {
      if (analysisError instanceof DOMException && analysisError.name === "AbortError") {
        setPhase("cancelled");
      } else {
        setError(analysisError instanceof Error ? analysisError.message : "Local analysis stopped unexpectedly.");
        setPhase("error");
      }
    } finally {
      if (activeJobRef.current === jobId) activeJobRef.current = null;
    }
  }

  function cancelActiveWork() {
    cancelledRef.current = true;
    if (activeJobRef.current) workerRef.current?.postMessage({ type: "cancel", jobId: activeJobRef.current } satisfies FaceWorkerRequest);
  }

  function removeMatch(id: string) {
    setMatches((current) => {
      const removed = current.find((match) => match.id === id);
      revokeUrl(removed?.thumbnailUrl ?? null);
      return current.filter((match) => match.id !== id);
    });
  }

  async function exportMatches() {
    if (!mediaUrl || !file || !matches.length || !clipExportAvailable) return;
    cancelledRef.current = false;
    setError(null);
    setPhase("exporting");
    setProgress({ completed: 0, total: matches.length });
    try {
      const blob = await exportScenePackage(mediaUrl, file.name, matches, () => cancelledRef.current, (completed, total) => {
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

  return (
    <main className="focused-tool focused-tool--rust face-workspace">
      <header className="focused-tool-header">
        <BrandMark />
        <div className="focused-header-actions">
          <LanguageSwitcher />
          <nav aria-label={copy.nav}><Link href="/lab">← {copy.allTools}</Link><Link href="/privacy">{copy.privacy}</Link></nav>
        </div>
      </header>

      <section className="focused-tool-title face-tool-title">
        <div><p className="eyebrow"><span>{tool.index} / {text.tools[tool.slug].eyebrow}</span><span>{copy.local}</span></p><h1>{text.tools[tool.slug].title}</h1></div>
        <p>{text.tools[tool.slug].promise}</p>
      </section>

      <section className="focused-tool-layout face-tool-layout">
        <aside className="tool-brief">
          <div className="tool-brief-block"><small>{copy.input}</small><strong>{text.tools[tool.slug].input}</strong></div>
          <div className="tool-brief-block"><small>{copy.output}</small><strong>{isTurkish ? "Klip ZIP + zaman kodları" : "Clip ZIP + timecodes"}</strong></div>
          <div className="tool-brief-block tool-brief-status"><small>{copy.boundary}</small><strong><i /> {copy.stays}</strong><p>{copy.noUpload}</p></div>
          <div className="tool-capability"><span>{copy.preflight}</span><strong>{engine === "gpu" ? "WEBGPU" : "WASM"}</strong></div>
          <div className="face-privacy-proof"><small>{copy.localProof}</small><strong>{copy.zero}</strong></div>
        </aside>

        <div className="focused-tool-stage">
          <div className="focused-stage-head"><span>{activeStageLabel}</span><b>{engineBackend ? engineBackend.toUpperCase() : engine.toUpperCase()}</b></div>

          {!file ? (
            <div className="face-intake">
              <div className="face-intake-mark" aria-hidden="true"><span>01</span><i /><i /><i /><b>LOCAL<br />FACE<br />THREAD</b></div>
              <div className="tool-intake-copy">
                <small>{copy.chooseStep}</small><h2>{copy.chooseTitle}</h2><p>{copy.chooseBody}</p>
                <input ref={inputRef} className="sr-only" id="face-video-input" type="file" accept="video/*" onChange={chooseFile} />
                <label className="button button--tool" htmlFor="face-video-input">{copy.chooseButton} <span>↗</span></label>
              </div>
            </div>
          ) : (
            <div className="face-configurator">
              <div className="face-video-column">
                <div className="focused-media-viewer face-media-viewer">
                  <video ref={videoRef} src={mediaUrl ?? undefined} controls playsInline preload="metadata" onLoadedMetadata={readMetadata} />
                </div>
                <div className="face-source-meta">
                  <div><small>{copy.file}</small><strong>{file.name}</strong></div>
                  <div><small>{copy.size}</small><strong>{formatBytes(file.size)}</strong></div>
                  <div><small>{copy.duration}</small><strong>{videoDuration ? formatTimecode(videoDuration) : "--:--:--"}</strong></div>
                  <button type="button" onClick={clearSource} disabled={isBusy}>{copy.remove}</button>
                </div>
              </div>

              <div className="face-control-column">
                <section className="face-step" aria-labelledby="engine-title">
                  <p id="engine-title">{copy.engineTitle}</p>
                  <div className="engine-choice" role="radiogroup" aria-label={copy.engineTitle}>
                    <button type="button" role="radio" aria-checked={engine === "gpu"} className={engine === "gpu" ? "is-active" : ""} disabled={!gpuAvailable || isBusy} onClick={() => changeEngine("gpu")}><strong>{copy.gpu}</strong><span>{gpuAvailable ? copy.fast : copy.gpuMissing}</span></button>
                    <button type="button" role="radio" aria-checked={engine === "cpu"} className={engine === "cpu" ? "is-active" : ""} disabled={isBusy} onClick={() => changeEngine("cpu")}><strong>{copy.cpu}</strong><span>{copy.compatible}</span></button>
                  </div>
                </section>

                <section className="face-step" aria-labelledby="references-title">
                  <div className="face-step-heading"><div><p id="references-title">{copy.refsTitle}</p><span>{copy.refsBody}</span></div><b>{references.length}/3</b></div>
                  <div className="reference-strip">
                    {[0, 1, 2].map((slot) => {
                      const reference = references[slot];
                      return reference ? (
                        <button type="button" className="reference-frame is-filled" key={reference.previewUrl} onClick={() => videoRef.current && seekVideo(videoRef.current, reference.timestamp)} disabled={isBusy}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={reference.previewUrl} alt={`${copy.emptyRef} ${slot + 1}`} />
                          <span>{formatTimecode(reference.timestamp)}</span><small>{reference.faceCount} {copy.faceFound} {reference.agreement.toFixed(2)}</small>
                        </button>
                      ) : <div className="reference-frame" key={slot}><b>0{slot + 1}</b><span>{copy.emptyRef}</span></div>;
                    })}
                  </div>
                  <div className="reference-actions">
                    <button type="button" className="face-action" onClick={captureReference} disabled={references.length >= 3 || isBusy || !videoDuration || videoDuration > MAX_VIDEO_DURATION_SECONDS}>{copy.capture}</button>
                    {references.length > 0 && <button type="button" className="face-text-action" onClick={resetReferences} disabled={isBusy}>{copy.resetRefs}</button>}
                  </div>
                </section>

                <section className="face-step face-settings" aria-labelledby="settings-title">
                  <p id="settings-title">{copy.settingsTitle}</p>
                  <label><span>{copy.sceneCount}</span><input type="number" min="1" max="30" value={sceneCount} disabled={isBusy} onChange={(event) => setSceneCount(Math.max(1, Math.min(30, Number(event.target.value))))} /></label>
                  <label><span>{copy.clipLength}</span><div><input type="range" min="3" max="10" step="1" value={clipLength} disabled={isBusy} onChange={(event) => setClipLength(Number(event.target.value))} /><b>{clipLength} {copy.seconds}</b></div></label>
                  <label><span>{copy.threshold}</span><div><input type="range" min="0.26" max="0.62" step="0.01" value={threshold} disabled={isBusy} onChange={(event) => setThreshold(Number(event.target.value))} /><b>{effectiveThreshold.toFixed(2)} <small>{copy.auto}</small></b></div></label>
                </section>

                {error && <div className="face-error" role="alert">{error}</div>}
                <div className="face-run-row">
                  {phase === "analyzing" || phase === "engine-loading" || phase === "post-processing"
                    ? <button type="button" className="face-action face-action--stop" onClick={cancelActiveWork}>{copy.cancel}</button>
                    : <button type="button" className="face-action" onClick={analyzeVideo} disabled={references.length !== 3 || !videoDuration || videoDuration > MAX_VIDEO_DURATION_SECONDS || isBusy}>{copy.run} <span>↗</span></button>}
                  {(phase === "engine-loading" || phase === "analyzing" || phase === "post-processing") && <div className="face-progress"><div><i style={{ width: `${progressPercent}%` }} /></div><span>{phase === "analyzing" ? `${progress.completed}/${progress.total} ${copy.processed}` : activeStageLabel}</span></div>}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <p className="face-identity-note">{copy.identityNote}</p>

      {(phase === "results" || phase === "exporting") && (
        <section className="face-results" aria-labelledby="face-results-title">
          <div className="face-results-head"><div><p className="eyebrow">{matches.length}/{sceneCount}</p><h2 id="face-results-title">{copy.resultsTitle}</h2></div><p>{matches.length ? copy.resultsBody : copy.noResults}</p></div>
          {matches.length > 0 && <div className="scene-grid">{matches.map((match, index) => (
            <article className="scene-result" key={match.id}>
              <div className="scene-thumbnail">
                {match.thumbnailUrl && <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={match.thumbnailUrl} alt="" />
                  <button type="button" aria-label={`${copy.removeScene} ${index + 1}`} onClick={() => removeMatch(match.id)} disabled={phase === "exporting"}>×</button>
                </>}
                <span>#{String(index + 1).padStart(2, "0")}</span>
              </div>
              <div className="scene-result-meta"><strong>{formatTimecode(match.start)} → {formatTimecode(match.end)}</strong><span>{match.similarity >= 0.5 ? copy.strong : match.similarity >= 0.38 ? copy.likely : copy.review} · {match.similarity.toFixed(2)} {copy.match} · {match.verificationCount ?? 0}/{match.verificationTotal ?? 0} {copy.checks}</span></div>
            </article>
          ))}</div>}
          {matches.length > 0 && <div className="face-export-row">
            {phase === "exporting" ? <>
              <button type="button" className="face-action face-action--stop" onClick={cancelActiveWork}>{copy.exportCancel}</button>
              <div className="face-progress"><div><i style={{ width: `${progressPercent}%` }} /></div><span>{progress.completed}/{progress.total} · {copy.exporting}</span></div>
            </> : <>
              <button type="button" className="face-action" onClick={exportMatches} disabled={!clipExportAvailable}>{copy.export} <span>↓</span></button>
              {!clipExportAvailable && <p>{copy.exportFallback}</p>}
              {exportUrl && <a className="face-download" href={exportUrl} download={`${file?.name.replace(/\.[^.]+$/, "") ?? "cutweave"}-scenes.zip`}>{copy.downloadAgain}</a>}
            </>}
          </div>}
        </section>
      )}

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
