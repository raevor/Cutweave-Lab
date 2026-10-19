"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import darkThemeIcon from "../../../../assets/dark-theme.png";
import lightThemeIcon from "../../../../assets/light-theme.png";
import { BrandMark } from "@/components/brand-mark";
import { selectMusicMarkers } from "@/lib/music-bass-markers/analysis";
import { chooseAnalysisChannel, createAnalysisResampler } from "@/lib/music-bass-markers/signal";
import {
  createMarkerCsv,
  createMarkerJson,
  createMarkerRichWav,
  createMarkerXmp,
  formatTimecode,
  type MarkerFrameRate,
} from "@/lib/music-bass-markers/exports";
import type {
  MusicAnalysisResult,
  MusicAnalysisWorkerRequest,
  MusicAnalysisWorkerResponse,
  MusicMarker,
} from "@/lib/music-bass-markers/types";
import { applySiteTheme, readSiteTheme } from "@/lib/site-theme";
import type { ToolDefinition } from "@/lib/tool-catalog";
import styles from "./music-bass-markers-workspace.module.css";

type Phase = "idle" | "source-ready" | "decoding" | "analyzing" | "results" | "export-ready" | "exporting" | "error";
type WorkspaceTheme = "light" | "dark";

const ANALYSIS_SAMPLE_RATE = 12_000;
const MAX_AUDIO_DURATION_SECONDS = 2 * 60 * 60;
const MAX_FILE_BYTES = 750 * 1024 * 1024;
const ACCEPTED_AUDIO = "audio/*,.mp3,.wav,.wave,.m4a,.aac,.ogg,.opus,.flac,.aif,.aiff";
const EXPORT_FRAME_RATES: ReadonlyArray<{ key: string; label: string; rate: MarkerFrameRate }> = [
  { key: "23.976", label: "23.976 fps", rate: { numerator: 24_000, denominator: 1_001 } },
  { key: "24", label: "24 fps", rate: { numerator: 24, denominator: 1 } },
  { key: "25", label: "25 fps", rate: { numerator: 25, denominator: 1 } },
  { key: "29.97", label: "29.97 fps", rate: { numerator: 30_000, denominator: 1_001 } },
  { key: "30", label: "30 fps", rate: { numerator: 30, denominator: 1 } },
  { key: "50", label: "50 fps", rate: { numerator: 50, denominator: 1 } },
  { key: "59.94", label: "59.94 fps", rate: { numerator: 60_000, denominator: 1_001 } },
  { key: "60", label: "60 fps", rate: { numerator: 60, denominator: 1 } },
  { key: "120", label: "120 fps", rate: { numerator: 120, denominator: 1 } },
];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPlaybackTime(seconds: number) {
  return formatTimecode(seconds).slice(0, 8);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function makeJobId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `music-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fileBase(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "cutweave-audio";
}

function canOpenAudio(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("audio/") || ["mp3", "wav", "wave", "m4a", "aac", "ogg", "opus", "flac", "aif", "aiff"].includes(extension);
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

async function prepareAnalysisSamples(
  audio: AudioBuffer,
  onProgress: (fraction: number) => void,
  shouldContinue: () => boolean,
) {
  const outputLength = Math.max(1, Math.floor(audio.duration * ANALYSIS_SAMPLE_RATE));
  const output = new Float32Array(outputLength);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel));
  const chunkSize = 48_000;
  const channel = chooseAnalysisChannel(channels);
  let nativeResampling = typeof OfflineAudioContext !== "undefined";
  const fallback = createAnalysisResampler(channels, audio.sampleRate, ANALYSIS_SAMPLE_RATE);

  for (let chunkStart = 0; chunkStart < outputLength; chunkStart += chunkSize) {
    if (!shouldContinue()) throw new DOMException("Analysis cancelled", "AbortError");
    const chunkEnd = Math.min(outputLength, chunkStart + chunkSize);
    if (nativeResampling) {
      // Padding prevents filter resets at chunk boundaries from making fake hits.
      const contextStart = Math.max(0, chunkStart - 600);
      const contextEnd = Math.min(outputLength, chunkEnd + 600);
      let source: AudioBufferSourceNode | undefined;
      try {
        const context = new OfflineAudioContext(1, contextEnd - contextStart, ANALYSIS_SAMPLE_RATE);
        source = context.createBufferSource();
        source.buffer = audio;
        if (channel === null) source.connect(context.destination);
        else {
          const splitter = context.createChannelSplitter(audio.numberOfChannels);
          source.connect(splitter); splitter.connect(context.destination, channel);
        }
        source.start(0, contextStart / ANALYSIS_SAMPLE_RATE);
        const rendered = await context.startRendering();
        if (!shouldContinue()) throw new DOMException("Analysis cancelled", "AbortError");
        output.set(rendered.getChannelData(0).subarray(chunkStart - contextStart, chunkEnd - contextStart), chunkStart);
      } catch (error) {
        if (!shouldContinue() || (error instanceof DOMException && error.name === "AbortError")) throw error;
        nativeResampling = false;
        // Restart consistently rather than joining signals from two resamplers.
        for (let restart = 0; restart < chunkEnd; restart += chunkSize) {
          if (!shouldContinue()) throw new DOMException("Analysis cancelled", "AbortError");
          fallback(output, restart, Math.min(chunkEnd, restart + chunkSize));
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      } finally {
        source?.disconnect();
      }
    } else {
      fallback(output, chunkStart, chunkEnd);
    }
    onProgress(chunkEnd / outputLength);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  return output;
}

function WaveformCanvas({
  waveform,
  bins,
  theme,
  duration,
  viewStart,
  viewEnd,
}: {
  waveform: Float32Array;
  bins: number;
  theme: WorkspaceTheme;
  duration: number;
  viewStart: number;
  viewEnd: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bins) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      context.strokeStyle = theme === "dark" ? "rgba(138, 190, 154, .92)" : "rgba(0, 103, 155, .88)";
      context.lineWidth = Math.max(1, rect.width / bins * 0.62);
      context.beginPath();
      const middle = rect.height / 2;
      for (let pixel = 0; pixel < Math.ceil(rect.width); pixel += 1) {
        const time = viewStart + (pixel / rect.width) * (viewEnd - viewStart);
        const bin = Math.min(bins - 1, Math.max(0, Math.floor((time / Math.max(duration, 0.001)) * bins)));
        const minimum = waveform[bin * 2] ?? 0;
        const maximum = waveform[bin * 2 + 1] ?? 0;
        context.moveTo(pixel + 0.5, middle + minimum * middle * 0.88);
        context.lineTo(pixel + 0.5, middle + maximum * middle * 0.88);
      }
      context.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [bins, duration, theme, viewEnd, viewStart, waveform]);

  return <canvas className={styles.waveformCanvas} ref={canvasRef} aria-hidden="true" />;
}

function MarkerPin({
  marker,
  duration,
  viewStart,
  viewEnd,
  onMove,
  onSeek,
}: {
  marker: MusicMarker;
  duration: number;
  viewStart: number;
  viewEnd: number;
  onMove: (id: string, time: number) => void;
  onSeek: (time: number) => void;
}) {
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const previewTimeRef = useRef<number | null>(null);
  const [previewTime, setPreviewTime] = useState<number | null>(null);

  function timeFromPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const track = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!track) return marker.time;
    return clamp(viewStart + ((event.clientX - track.left) / track.width) * (viewEnd - viewStart), viewStart, viewEnd);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    dragging.current = true;
    dragStartX.current = event.clientX;
    previewTimeRef.current = null;
    setPreviewTime(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragging.current || Math.abs(event.clientX - dragStartX.current) < 3) return;
    const nextTime = timeFromPointer(event);
    previewTimeRef.current = nextTime;
    setPreviewTime(nextTime);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const nextTime = previewTimeRef.current;
    previewTimeRef.current = null;
    setPreviewTime(null);
    if (nextTime !== null) onMove(marker.id, nextTime);
    onSeek(nextTime ?? marker.time);
  }

  function onPointerCancel() {
    dragging.current = false;
    previewTimeRef.current = null;
    setPreviewTime(null);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 0.1 : 0.01;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      onMove(marker.id, clamp(marker.time + (event.key === "ArrowLeft" ? -step : step), 0, duration));
    }
    if (event.key === "Enter" || event.key === " ") onSeek(marker.time);
  }

  return (
    <button
      className={`${styles.markerPin} ${styles[`markerPin${marker.kind[0].toUpperCase()}${marker.kind.slice(1)}`]}`}
      type="button"
      style={{ left: `${viewEnd > viewStart ? (((previewTime ?? marker.time) - viewStart) / (viewEnd - viewStart)) * 100 : 0}%` }}
      aria-label={`${marker.kind} marker at ${formatTimecode(marker.time)}. Drag or use arrow keys to move.`}
      title={`${marker.kind.toUpperCase()} · ${formatTimecode(marker.time)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
    >
      <i />
    </button>
  );
}

export function MusicBassMarkersWorkspace({ tool }: { tool: ToolDefinition }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLButtonElement>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const scrubAudioContextRef = useRef<AudioContext | null>(null);
  const scrubAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playheadDragActiveRef = useRef(false);
  const playheadDragPointerRef = useRef<number | null>(null);
  const playheadDragTimeRef = useRef(0);
  const lastScrubPreviewRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const activeJobRef = useRef<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [theme, setTheme] = useState<WorkspaceTheme>("dark");
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, label: "Preparing audio" });
  const [analysis, setAnalysis] = useState<MusicAnalysisResult | null>(null);
  const [sensitivity, setSensitivity] = useState(68);
  const [minimumSpacing, setMinimumSpacing] = useState(0.16);
  const [removedMarkerIds, setRemovedMarkerIds] = useState<Set<string>>(() => new Set());
  const [manualMarkers, setManualMarkers] = useState<MusicMarker[]>([]);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [analysisStart, setAnalysisStart] = useState(0);
  const [analysisEnd, setAnalysisEnd] = useState(0);
  const [timelineView, setTimelineView] = useState({ zoom: 1, start: 0 });
  const [exportFrameRateKey, setExportFrameRateKey] = useState("30");
  const [error, setError] = useState<string | null>(null);

  const stopScrubPreview = useCallback(() => {
    const source = scrubAudioSourceRef.current;
    scrubAudioSourceRef.current = null;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // The short preview may already have ended.
    }
    source.disconnect();
  }, []);

  const closeScrubPreview = useCallback(() => {
    stopScrubPreview();
    const context = scrubAudioContextRef.current;
    scrubAudioContextRef.current = null;
    if (context && context.state !== "closed") void context.close();
  }, [stopScrubPreview]);

  useLayoutEffect(() => {
    const savedTheme = readSiteTheme();
    applySiteTheme(savedTheme, false);
    const frame = window.requestAnimationFrame(() => setTheme(savedTheme));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => {
    workerRef.current?.terminate();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    closeScrubPreview();
  }, [closeScrubPreview]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || phase !== "results" || !duration) return;

    function handleTimelineWheel(event: WheelEvent) {
      event.preventDefault();
      const deltaY = event.deltaY;
      const shiftKey = event.shiftKey;
      const rect = timeline!.getBoundingClientRect();
      const pointerRatio = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);

      setTimelineView((current) => {
        const currentVisible = duration / current.zoom;
        if (shiftKey && current.zoom > 1) {
          const nextStart = clamp(
            current.start + (deltaY / 650) * currentVisible,
            0,
            Math.max(0, duration - currentVisible),
          );
          return { ...current, start: nextStart };
        }

        const nextZoom = clamp(current.zoom * Math.exp(-deltaY * 0.0017), 1, 24);
        const nextVisible = duration / nextZoom;
        const anchorTime = current.start + pointerRatio * currentVisible;
        return {
          zoom: nextZoom,
          start: clamp(anchorTime - pointerRatio * nextVisible, 0, Math.max(0, duration - nextVisible)),
        };
      });
    }

    timeline.addEventListener("wheel", handleTimelineWheel, { passive: false });
    return () => timeline.removeEventListener("wheel", handleTimelineWheel);
  }, [duration, phase]);

  const automaticMarkers = useMemo(() => {
    if (!analysis) return [];
    return selectMusicMarkers(analysis.candidates, sensitivity / 100, minimumSpacing)
      .filter((marker) => !removedMarkerIds.has(marker.id));
  }, [analysis, minimumSpacing, removedMarkerIds, sensitivity]);

  const markers = useMemo(
    () => [...automaticMarkers, ...manualMarkers].sort((a, b) => a.time - b.time),
    [automaticMarkers, manualMarkers],
  );
  const markersInExport = useMemo(
    () => markers.filter((marker) => marker.time >= trimStart && marker.time <= trimEnd),
    [markers, trimEnd, trimStart],
  );
  const exportFrameRate = EXPORT_FRAME_RATES.find((option) => option.key === exportFrameRateKey)?.rate
    ?? { numerator: 30, denominator: 1 };
  const viewDuration = duration ? duration / timelineView.zoom : 0;
  const viewStart = clamp(timelineView.start, 0, Math.max(0, duration - viewDuration));
  const viewEnd = Math.min(duration, viewStart + viewDuration);
  const visibleMarkers = useMemo(
    () => markers.filter((marker) => marker.time >= viewStart && marker.time <= viewEnd),
    [markers, viewEnd, viewStart],
  );
  const timeToViewPercent = useCallback((time: number) => (
    viewEnd > viewStart ? ((time - viewStart) / (viewEnd - viewStart)) * 100 : 0
  ), [viewEnd, viewStart]);
  const paintPlayhead = useCallback((time: number) => {
    const playhead = playheadRef.current;
    const timeline = timelineRef.current;
    if (!playhead || !timeline || viewEnd <= viewStart) return;
    const visible = time >= viewStart && time <= viewEnd;
    playhead.style.opacity = visible ? "1" : "0";
    if (!visible) return;
    const ratio = clamp((time - viewStart) / (viewEnd - viewStart), 0, 1);
    playhead.style.transform = `translate3d(${ratio * timeline.clientWidth}px, 0, 0)`;
  }, [viewEnd, viewStart]);

  const playScrubPreview = useCallback((time: number) => {
    const buffer = audioBufferRef.current;
    if (!buffer || buffer.duration <= 0) return;
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;

    let context = scrubAudioContextRef.current;
    if (!context || context.state === "closed") {
      context = new AudioContextClass();
      scrubAudioContextRef.current = context;
    }
    if (context.state === "suspended") void context.resume();

    stopScrubPreview();
    const offset = clamp(time, 0, Math.max(0, buffer.duration - 0.001));
    const previewDuration = Math.min(0.11, buffer.duration - offset);
    if (previewDuration <= 0) return;

    const source = context.createBufferSource();
    const gain = context.createGain();
    const now = context.currentTime;
    const fadeInEnd = now + Math.min(0.008, previewDuration * 0.2);
    const fadeOutStart = now + Math.max(fadeInEnd - now, previewDuration - 0.035);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.72, fadeInEnd);
    gain.gain.setValueAtTime(0.72, fadeOutStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + previewDuration);
    source.buffer = buffer;
    source.connect(gain).connect(context.destination);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (scrubAudioSourceRef.current === source) scrubAudioSourceRef.current = null;
    };
    scrubAudioSourceRef.current = source;
    source.start(0, offset, previewDuration);
  }, [stopScrubPreview]);

  useLayoutEffect(() => {
    paintPlayhead(audioRef.current?.currentTime ?? currentTime);
  }, [currentTime, paintPlayhead, phase]);

  useEffect(() => {
    if (!isPlaying || phase !== "results") return;
    let animationFrame = 0;
    const animate = () => {
      const player = audioRef.current;
      if (player) paintPlayhead(player.currentTime);
      animationFrame = window.requestAnimationFrame(animate);
    };
    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [isPlaying, paintPlayhead, phase]);
  const progressPercent = progress.total > 0
    ? Math.round(clamp(progress.completed / progress.total, 0, 1) * 100)
    : null;
  const busy = phase === "decoding" || phase === "analyzing" || phase === "exporting";
  const workflowStep = !file ? 0 : phase === "source-ready" || phase === "error" ? 1 : phase === "decoding" || phase === "analyzing" ? 2 : phase === "results" ? 3 : 4;
  const workflowLabels = ["Audio", "Choose range", "Analyze", "Review", "Export"];

  const seek = useCallback((time: number) => {
    const nextTime = clamp(time, 0, duration);
    setCurrentTime(nextTime);
    if (audioRef.current) audioRef.current.currentTime = nextTime;
    setTimelineView((current) => {
      const visibleDuration = duration / current.zoom;
      if (nextTime >= current.start && nextTime <= current.start + visibleDuration) return current;
      return { ...current, start: clamp(nextTime - visibleDuration / 2, 0, Math.max(0, duration - visibleDuration)) };
    });
  }, [duration]);

  function playheadTimeFromPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return playheadDragTimeRef.current;
    return clamp(viewStart + ((event.clientX - rect.left) / rect.width) * viewDuration, viewStart, viewEnd);
  }

  function updatePlayheadDrag(time: number, previewAudio: boolean, eventTime: number) {
    const nextTime = clamp(time, viewStart, viewEnd);
    playheadDragTimeRef.current = nextTime;
    const player = audioRef.current;
    if (player && Math.abs(player.currentTime - nextTime) > 0.001) player.currentTime = nextTime;
    paintPlayhead(nextTime);
    setCurrentTime((current) => Math.floor(current) === Math.floor(nextTime) ? current : nextTime);

    if (!previewAudio) {
      stopScrubPreview();
      return;
    }
    if (eventTime - lastScrubPreviewRef.current < 42) return;
    lastScrubPreviewRef.current = eventTime;
    playScrubPreview(nextTime);
  }

  function onPlayheadPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    audioRef.current?.pause();
    playheadDragActiveRef.current = true;
    playheadDragPointerRef.current = event.pointerId;
    lastScrubPreviewRef.current = 0;
    setIsScrubbing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePlayheadDrag(playheadTimeFromPointer(event), event.ctrlKey, event.timeStamp);
  }

  function onPlayheadPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!playheadDragActiveRef.current || playheadDragPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updatePlayheadDrag(playheadTimeFromPointer(event), event.ctrlKey, event.timeStamp);
  }

  function finishPlayheadDrag(event?: ReactPointerEvent<HTMLButtonElement>) {
    if (!playheadDragActiveRef.current) return;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }
    playheadDragActiveRef.current = false;
    playheadDragPointerRef.current = null;
    stopScrubPreview();
    const finalTime = playheadDragTimeRef.current;
    if (audioRef.current) audioRef.current.currentTime = finalTime;
    setCurrentTime(finalTime);
    paintPlayhead(finalTime);
    setIsScrubbing(false);
  }

  function onPlayheadKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      void togglePlayback();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const playerTime = audioRef.current?.currentTime ?? currentTime;
    const step = event.shiftKey ? 0.1 : 0.01;
    const nextTime = clamp(playerTime + (event.key === "ArrowLeft" ? -step : step), 0, duration);
    seek(nextTime);
    if (event.ctrlKey) playScrubPreview(nextTime);
  }

  function toggleTheme() {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    applySiteTheme(nextTheme);
  }

  function resetAnalysis() {
    workerRef.current?.terminate();
    workerRef.current = null;
    activeJobRef.current = null;
    audioBufferRef.current = null;
    setAnalysis(null);
    setRemovedMarkerIds(new Set());
    setManualMarkers([]);
    setCurrentTime(0);
    setTimelineView({ zoom: 1, start: 0 });
    setError(null);
  }

  function loadFile(nextFile: File | null) {
    if (!nextFile) return;
    if (!canOpenAudio(nextFile)) {
      setError("Choose an audio file such as MP3, WAV, M4A, AAC, OGG, FLAC or AIFF.");
      setPhase("error");
      return;
    }
    if (nextFile.size > MAX_FILE_BYTES) {
      setError("This file is too large to decode safely in one browser tab. Choose an audio file under 750 MB.");
      setPhase("error");
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    resetAnalysis();
    const url = URL.createObjectURL(nextFile);
    objectUrlRef.current = url;
    setFile(nextFile);
    setMediaUrl(url);
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setAnalysisStart(0);
    setAnalysisEnd(0);
    setPhase("source-ready");
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    loadFile(event.target.files?.[0] ?? null);
  }

  function clearFile() {
    resetAnalysis();
    audioRef.current?.pause();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setFile(null);
    setMediaUrl(null);
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setAnalysisStart(0);
    setAnalysisEnd(0);
    setIsPlaying(false);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  function onMetadata() {
    const nextDuration = audioRef.current?.duration ?? 0;
    if (!Number.isFinite(nextDuration) || nextDuration <= 0) return;
    setDuration(nextDuration);
    setTrimEnd(nextDuration);
    setAnalysisEnd(nextDuration);
    if (nextDuration > MAX_AUDIO_DURATION_SECONDS) {
      setError("This audio is longer than two hours. Shorter sources keep browser memory bounded and reliable.");
      setPhase("error");
    }
  }

  async function runAnalysis() {
    if (!file || busy) return;
    if (!duration || duration > MAX_AUDIO_DURATION_SECONDS) {
      setError("Wait for the audio duration to load, or choose a source under two hours.");
      setPhase("error");
      return;
    }
    if (analysisEnd - analysisStart < 0.1) {
      setError("Choose at least 0.1 seconds to analyze.");
      return;
    }

    resetAnalysis();
    const jobId = makeJobId();
    activeJobRef.current = jobId;
    setPhase("decoding");
    setProgress({ completed: 0, total: 0, label: "Decoding the local audio" });

    try {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) throw new Error("This browser does not provide the Web Audio decoder required for local analysis.");
      const context = new AudioContextClass();
      let decoded: AudioBuffer;
      try {
        const sourceBytes = await file.arrayBuffer();
        if (activeJobRef.current !== jobId) return;
        decoded = await context.decodeAudioData(sourceBytes);
      } finally {
        await context.close();
      }
      if (activeJobRef.current !== jobId) return;
      if (decoded.duration > MAX_AUDIO_DURATION_SECONDS) {
        throw new Error("This audio is longer than two hours. Shorter sources keep browser memory bounded and reliable.");
      }
      audioBufferRef.current = decoded;
      setDuration(decoded.duration);
      setTrimStart(0);
      setTrimEnd(decoded.duration);
      setProgress({ completed: 0, total: 1, label: "Preparing a bounded analysis signal" });
      const samples = await prepareAnalysisSamples(
        decoded,
        (fraction) => {
          if (activeJobRef.current === jobId) setProgress({ completed: fraction, total: 1, label: "Preparing a bounded analysis signal" });
        },
        () => activeJobRef.current === jobId,
      );
      if (activeJobRef.current !== jobId) return;

      const worker = new Worker(new URL("../../../workers/music-bass-analysis.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      setPhase("analyzing");
      setProgress({ completed: 0, total: 1, label: "Finding impacts and bass entries" });
      worker.onmessage = (event: MessageEvent<MusicAnalysisWorkerResponse>) => {
        const response = event.data;
        if (response.jobId !== activeJobRef.current || response.jobId !== jobId) return;
        if (response.type === "progress") {
          setProgress({ completed: response.completed, total: response.total, label: "Finding impacts and bass entries" });
          return;
        }
        worker.terminate();
        workerRef.current = null;
        activeJobRef.current = null;
        if (response.type === "error") {
          setError(response.message);
          setPhase("error");
          return;
        }
        setAnalysis({
          candidates: response.candidates,
          waveform: response.waveform,
          waveformBins: response.waveformBins,
          bpm: response.bpm,
          bpmConfidence: response.bpmConfidence,
          peakDb: response.peakDb,
        });
        setProgress({ completed: 1, total: 1, label: "Markers ready for review" });
        setPhase("results");
      };
      worker.onerror = () => {
        if (activeJobRef.current !== jobId) return;
        worker.terminate();
        workerRef.current = null;
        activeJobRef.current = null;
        setError("The local analysis worker stopped unexpectedly. Your source is still available; try again.");
        setPhase("error");
      };
      const request: MusicAnalysisWorkerRequest = {
        type: "analyze",
        jobId,
        samples: samples.buffer,
        sampleRate: ANALYSIS_SAMPLE_RATE,
        duration: decoded.duration,
        analysisStart: clamp(analysisStart, 0, decoded.duration),
        analysisEnd: clamp(analysisEnd, 0, decoded.duration),
      };
      worker.postMessage(request, [samples.buffer]);
    } catch (caught) {
      if (activeJobRef.current !== jobId) return;
      workerRef.current?.terminate();
      workerRef.current = null;
      activeJobRef.current = null;
      audioBufferRef.current = null;
      setError(caught instanceof Error ? caught.message : "This audio could not be analyzed in the browser.");
      setPhase("error");
    }
  }

  function cancelAnalysis() {
    workerRef.current?.terminate();
    workerRef.current = null;
    activeJobRef.current = null;
    audioBufferRef.current = null;
    setProgress({ completed: 0, total: 0, label: "Analysis cancelled" });
    setPhase(file ? "source-ready" : "idle");
  }

  async function togglePlayback() {
    const player = audioRef.current;
    if (!player) return;
    if (!player.paused) {
      player.pause();
      return;
    }
    if (player.currentTime < trimStart || player.currentTime >= trimEnd) seek(trimStart);
    try {
      await player.play();
    } catch {
      setError("Playback could not start. Click the play control again or check this browser's audio permission.");
    }
  }

  function addMarker(time?: number) {
    const nextTime = clamp(time ?? audioRef.current?.currentTime ?? currentTime, 0, duration);
    setManualMarkers((current) => [...current, {
      id: `manual-${makeJobId()}`,
      time: nextTime,
      confidence: 1,
      strength: 1,
      kind: "manual",
      source: "manual",
    }]);
  }

  function removeMarker(marker: MusicMarker) {
    if (marker.source === "manual") {
      setManualMarkers((current) => current.filter((item) => item.id !== marker.id));
    } else {
      setRemovedMarkerIds((current) => new Set(current).add(marker.id));
    }
  }

  function moveMarker(id: string, time: number) {
    const marker = markers.find((item) => item.id === id);
    if (!marker) return;
    if (marker.source === "manual") {
      setManualMarkers((current) => current.map((item) => item.id === id ? { ...item, time } : item));
      return;
    }
    setRemovedMarkerIds((current) => new Set(current).add(id));
    setManualMarkers((current) => {
      const movedId = `moved-${id}`;
      const moved: MusicMarker = { ...marker, id: movedId, time, source: "manual", kind: "manual", confidence: 1 };
      return [...current.filter((item) => item.id !== movedId), moved];
    });
  }

  function timelinePointer(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    seek(viewStart + ((event.clientX - rect.left) / rect.width) * viewDuration);
  }

  function timelineDoubleClick(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    addMarker(viewStart + ((event.clientX - rect.left) / rect.width) * viewDuration);
  }

  function timelineKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const zoomIn = event.key === "+" || event.key === "=";
    const zoomOut = event.key === "-" || event.key === "_";
    const panDirection = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!zoomIn && !zoomOut && !panDirection) return;
    event.preventDefault();

    setTimelineView((current) => {
      const currentVisible = duration / current.zoom;
      if (panDirection && current.zoom > 1) {
        return {
          ...current,
          start: clamp(current.start + panDirection * currentVisible * 0.12, 0, Math.max(0, duration - currentVisible)),
        };
      }
      const nextZoom = clamp(current.zoom * (zoomIn ? 1.5 : 1 / 1.5), 1, 24);
      const nextVisible = duration / nextZoom;
      const playbackTime = audioRef.current?.currentTime ?? currentTime;
      const anchorTime = playbackTime >= current.start && playbackTime <= current.start + currentVisible
        ? playbackTime
        : current.start + currentVisible / 2;
      const anchorRatio = clamp((anchorTime - current.start) / Math.max(currentVisible, 0.001), 0, 1);
      return {
        zoom: nextZoom,
        start: clamp(anchorTime - anchorRatio * nextVisible, 0, Math.max(0, duration - nextVisible)),
      };
    });
  }

  async function exportWav() {
    const audio = audioBufferRef.current;
    if (!audio || !file || phase === "exporting") return;
    setPhase("exporting");
    setError(null);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      const blob = createMarkerRichWav(audio, markersInExport, trimStart, trimEnd, exportFrameRate);
      downloadBlob(blob, `${fileBase(file.name)}-cutweave-marked.wav`);
      setPhase("export-ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The marker-rich WAV could not be created.");
      setPhase("export-ready");
    }
  }

  function exportText(kind: "xmp" | "json" | "csv") {
    if (!file || !audioBufferRef.current) return;
    const base = fileBase(file.name);
    if (kind === "xmp") {
      downloadBlob(new Blob([createMarkerXmp(markersInExport, audioBufferRef.current.sampleRate, 0, duration, exportFrameRate)], { type: "application/rdf+xml" }), `${file.name}.xmp`);
    } else if (kind === "json") {
      downloadBlob(new Blob([createMarkerJson(markersInExport, file.name, trimStart, trimEnd, exportFrameRate)], { type: "application/json" }), `${base}-markers.json`);
    } else {
      downloadBlob(new Blob([createMarkerCsv(markersInExport, trimStart, trimEnd, exportFrameRate)], { type: "text/csv;charset=utf-8" }), `${base}-markers.csv`);
    }
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.header}>
        <BrandMark />
        <div className={styles.headerActions}>
          <nav aria-label="Music marker tool navigation">
            <Link href="/lab">← All tools</Link>
            <Link href="/privacy">Privacy</Link>
          </nav>
          <button className={styles.themeToggle} type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}>
            <Image src={theme === "dark" ? darkThemeIcon : lightThemeIcon} alt="" width={24} height={24} priority />
          </button>
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{tool.index} / Music analysis and edit points</p>
          <h1>Music &amp;<br /><em>Bass Markers</em></h1>
          <p className={styles.heroPromise}>Find the impacts worth cutting on, correct every marker, trim the source and carry the timing into your edit.</p>
        </div>
        <div className={styles.localStatus}>
          <span><i /> Runs on this device</span>
          <strong>0 B</strong>
          <small>Media sent to server</small>
        </div>
      </section>

      <ol className={styles.workflow} aria-label="Music marker workflow">
        {workflowLabels.map((label, index) => (
          <li className={index < workflowStep ? styles.stepComplete : index === workflowStep ? styles.stepCurrent : ""} key={label} aria-current={index === workflowStep ? "step" : undefined}>
            <span>{index < workflowStep ? "✓" : String(index + 1).padStart(2, "0")}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>

      {!file ? (
        <section
          className={`${styles.intake} ${dragActive ? styles.intakeDragging : ""}`}
          onDragEnter={(event: DragEvent<HTMLElement>) => { event.preventDefault(); setDragActive(true); }}
          onDragOver={(event: DragEvent<HTMLElement>) => event.preventDefault()}
          onDragLeave={(event: DragEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
          onDrop={(event: DragEvent<HTMLElement>) => { event.preventDefault(); setDragActive(false); loadFile(event.dataTransfer.files?.[0] ?? null); }}
          aria-labelledby="music-intake-title"
        >
          <div className={styles.intakeVisual} aria-hidden="true">
            <div className={styles.intakeGuide}><i /><strong>NO SOURCE LOADED</strong></div>
            <span>LOCAL EDIT POINTS</span><b>03</b>
          </div>
          <div className={styles.intakeCopy}>
            <p>01 / Choose the source</p>
            <h2 id="music-intake-title">Drop the track you want to mark</h2>
            <span>MP3, WAV, M4A, AAC, OGG, Opus, FLAC and AIFF are accepted when your browser can decode them. The file never leaves this tab.</span>
            <input ref={inputRef} className="sr-only" id="music-audio-input" type="file" accept={ACCEPTED_AUDIO} onChange={chooseFile} />
            <button className={styles.primaryAction} type="button" onClick={() => inputRef.current?.click()}>Choose audio <span>↗</span></button>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </div>
          <aside className={styles.intakeFacts}>
            <div><small>INPUT</small><strong>One local audio file</strong></div>
            <div><small>ANALYSIS</small><strong>Impacts + bass entries</strong></div>
            <div><small>OUTPUT</small><strong>Marker-rich WAV + data</strong></div>
            <div><small>MEDIA ROUTE</small><strong><i /> On device</strong></div>
          </aside>
        </section>
      ) : (
        <>
          <audio
            ref={audioRef}
            className="sr-only"
            src={mediaUrl ?? undefined}
            preload="metadata"
            onLoadedMetadata={onMetadata}
            onError={() => {
              setError("This browser could not decode the selected audio. Try WAV, MP3 or another format supported by this browser.");
              setPhase("error");
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={(event) => {
              setIsPlaying(false);
              setCurrentTime(event.currentTarget.currentTime);
            }}
            onEnded={(event) => {
              setIsPlaying(false);
              setCurrentTime(event.currentTarget.currentTime);
            }}
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime;
              setCurrentTime((current) => Math.floor(current) === Math.floor(time) ? current : time);
              if (trimEnd > trimStart && time >= trimEnd) {
                event.currentTarget.pause();
                event.currentTarget.currentTime = trimStart;
                setCurrentTime(trimStart);
              }
            }}
          />

          <section className={styles.sourceDeck} aria-label="Loaded audio source">
            <div className={styles.sourceIdentity}>
              <p>LOCAL SOURCE / READY</p>
              <h2>{file.name}</h2>
              <span>{formatBytes(file.size)} · {duration ? formatPlaybackTime(duration) : "Reading duration"}</span>
            </div>
            <div className={styles.transport}>
              <button type="button" onClick={() => seek((audioRef.current?.currentTime ?? currentTime) - 5)} aria-label="Back five seconds">−5</button>
              <button className={styles.playButton} type="button" onClick={togglePlayback}>{isPlaying ? "Pause" : "Play"}</button>
              <button type="button" onClick={() => seek((audioRef.current?.currentTime ?? currentTime) + 5)} aria-label="Forward five seconds">+5</button>
              <strong>{formatPlaybackTime(currentTime)}</strong>
              <input aria-label="Audio position" type="range" min={0} max={Math.max(duration, 0.01)} step="0.001" value={Math.min(currentTime, duration || 0)} onChange={(event) => seek(Number(event.target.value))} />
            </div>
            <button className={styles.removeSource} type="button" onClick={clearFile} disabled={busy}>Remove source</button>
          </section>

          {!analysis ? (
            <section className={styles.analysisSetup}>
              <div className={styles.rangePreview}>
                <p>THE PART TO MARK</p>
                <div className={styles.rangePreviewTrack} aria-hidden="true">
                  <span style={{ left: `${duration ? (analysisStart / duration) * 100 : 0}%`, right: `${duration ? 100 - (analysisEnd / duration) * 100 : 100}%` }} />
                </div>
                <div className={styles.rangePreviewTimes}><span>0:00</span><strong>{formatPlaybackTime(analysisEnd - analysisStart)} selected</strong><span>{formatPlaybackTime(duration)}</span></div>
                <p className={styles.rangePreviewNote}>Only the highlighted part gets automatic markers. The full song stays intact.</p>
              </div>
              <div className={styles.analysisControls}>
                <p>02 / Choose where markers go</p>
                <h2>Which part do you want to mark?</h2>
                <span>Play the track, then set the start and end of the section you need. Leave it on the full song if you want markers everywhere.</span>
                <div className={styles.analysisRangeControls}>
                  <div className={styles.rangeField}>
                    <div><label htmlFor="music-range-start">Start</label><strong>{formatPlaybackTime(analysisStart)}</strong></div>
                    <input id="music-range-start" type="range" min="0" max={Math.max(duration, 0.01)} step="0.01" value={analysisStart} disabled={busy || !duration} onChange={(event) => setAnalysisStart(Math.min(Number(event.target.value), analysisEnd - 0.1))} />
                    <button type="button" disabled={busy || !duration} onClick={() => setAnalysisStart(Math.min(audioRef.current?.currentTime ?? currentTime, analysisEnd - 0.1))}>Start at playhead</button>
                  </div>
                  <div className={styles.rangeField}>
                    <div><label htmlFor="music-range-end">End</label><strong>{formatPlaybackTime(analysisEnd)}</strong></div>
                    <input id="music-range-end" type="range" min="0" max={Math.max(duration, 0.01)} step="0.01" value={analysisEnd} disabled={busy || !duration} onChange={(event) => setAnalysisEnd(Math.max(Number(event.target.value), analysisStart + 0.1))} />
                    <button type="button" disabled={busy || !duration} onClick={() => setAnalysisEnd(Math.max(audioRef.current?.currentTime ?? currentTime, analysisStart + 0.1))}>End at playhead</button>
                  </div>
                </div>
                <button className={styles.textAction} type="button" disabled={busy || !duration} onClick={() => { setAnalysisStart(0); setAnalysisEnd(duration); }}>Use the full song</button>
                {error ? <p className={styles.error} role="alert">{error}</p> : null}
                {busy ? (
                  <div className={styles.progressPanel}>
                    <div className={progressPercent === null ? styles.progressIndeterminate : ""}>
                      <i style={progressPercent === null ? undefined : { width: `${progressPercent}%` }} />
                    </div>
                    <span>{progress.label}</span><strong>{progressPercent === null ? "LOCAL" : `${progressPercent}%`}</strong>
                    <button type="button" onClick={cancelAnalysis}>Cancel analysis</button>
                  </div>
                ) : (
                  <button className={styles.primaryAction} type="button" onClick={runAnalysis} disabled={!duration || duration > MAX_AUDIO_DURATION_SECONDS || analysisEnd - analysisStart < 0.1}>Find markers in this part <span>→</span></button>
                )}
              </div>
            </section>
          ) : phase === "export-ready" || phase === "exporting" ? (
            <section className={styles.exportStage}>
              <header className={styles.exportStageHeader}>
                <div><p>05 / Export</p><h2>Take the timing into your edit</h2></div>
                <div className={styles.resultStats}>
                  <div><small>MARKERS</small><strong>{markersInExport.length}</strong></div>
                  <div><small>RANGE</small><strong>{formatTimecode(trimEnd - trimStart)}</strong></div>
                  <div><small>SOURCE</small><strong>{file.name.split(".").pop()?.toUpperCase() ?? "AUDIO"}</strong></div>
                </div>
              </header>
              <section className={styles.exportPanel}>
                <div>
                  <p>REVIEW COMPLETE</p>
                  <h2>Choose your export</h2>
                  <span>The WAV contains the trimmed audio and unnamed edit markers. Marker times snap to your selected composition frame rate so the After Effects playhead can land on every one.</span>
                </div>
                <div className={styles.exportControls}>
                  <label className={styles.frameRateControl}>
                    <span><small>COMPOSITION FRAME RATE</small><strong>Match After Effects</strong></span>
                    <select value={exportFrameRateKey} onChange={(event) => setExportFrameRateKey(event.target.value)}>
                      {EXPORT_FRAME_RATES.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}
                    </select>
                    <small>Choose the same FPS as your AE or Premiere composition before downloading.</small>
                  </label>
                  <div className={styles.exportActions}>
                    <button className={styles.primaryAction} type="button" onClick={exportWav} disabled={!markersInExport.length || phase === "exporting"}>{phase === "exporting" ? "Building WAV…" : "Download marker-rich WAV"}<span>↓</span></button>
                    <button type="button" onClick={() => exportText("xmp")} disabled={!markersInExport.length || phase === "exporting"}>Source XMP sidecar</button>
                    <button type="button" onClick={() => exportText("json")} disabled={!markersInExport.length || phase === "exporting"}>Marker JSON</button>
                    <button type="button" onClick={() => exportText("csv")} disabled={!markersInExport.length || phase === "exporting"}>Marker CSV</button>
                  </div>
                </div>
                {error ? <p className={styles.error} role="alert">{error}</p> : null}
                <small className={styles.exportNote}>Frame snapping changes only exported marker timing, never the detector or your reviewed markers. Existing files must be exported again with the matching composition FPS.</small>
              </section>
              <button className={styles.backToMarkers} type="button" onClick={() => { setError(null); setPhase("results"); }}>← Back to marker review</button>
            </section>
          ) : (
            <section className={styles.editor}>
              <header className={styles.editorHeader}>
                <div><p>04 / Review the timing</p><h2>Review your markers</h2><span>Listen, remove anything that does not fit, or add your own marker before export.</span></div>
                <div className={`${styles.resultStats} ${styles.reviewStats}`}>
                  <div><small>MARKERS TO REVIEW</small><strong>{markers.length}</strong></div>
                  <div><small>ANALYZED PART</small><strong>{formatPlaybackTime(analysisEnd - analysisStart)}</strong></div>
                </div>
              </header>

              <div className={styles.timelinePanel}>
                <div className={styles.timelineHead}>
                  <span>REAL AUDIO WAVEFORM · {timelineView.zoom.toFixed(1)}×</span>
                  <span>WHEEL TO ZOOM · DRAG PLAYHEAD · CTRL + DRAG TO HEAR · DOUBLE-CLICK TO ADD</span>
                </div>
                <div
                  ref={timelineRef}
                  className={styles.timeline}
                  onPointerDown={timelinePointer}
                  onDoubleClick={timelineDoubleClick}
                  onKeyDown={timelineKeyDown}
                  role="group"
                  aria-label={`Audio waveform from ${formatTimecode(viewStart)} to ${formatTimecode(viewEnd)}. Use the mouse wheel or plus and minus keys to zoom; use Shift plus wheel or arrow keys to move.`}
                  tabIndex={0}
                >
                  <WaveformCanvas waveform={analysis.waveform} bins={analysis.waveformBins} theme={theme} duration={duration} viewStart={viewStart} viewEnd={viewEnd} />
                  <span className={styles.trimShade} style={{ left: 0, width: `${clamp(timeToViewPercent(trimStart), 0, 100)}%` }} />
                  <span className={styles.trimShade} style={{ left: `${clamp(timeToViewPercent(trimEnd), 0, 100)}%`, right: 0 }} />
                  {trimStart >= viewStart && trimStart <= viewEnd ? <span className={styles.inLine} style={{ left: `${timeToViewPercent(trimStart)}%` }}><b>IN</b></span> : null}
                  {trimEnd >= viewStart && trimEnd <= viewEnd ? <span className={styles.outLine} style={{ left: `${timeToViewPercent(trimEnd)}%` }}><b>OUT</b></span> : null}
                  {visibleMarkers.map((marker) => <MarkerPin marker={marker} duration={duration} viewStart={viewStart} viewEnd={viewEnd} onMove={moveMarker} onSeek={seek} key={marker.id} />)}
                  <button
                    ref={playheadRef}
                    className={`${styles.playhead} ${isScrubbing ? styles.playheadScrubbing : ""}`}
                    type="button"
                    aria-label={`Playhead at ${formatTimecode(currentTime)}. Drag to seek; hold Control while dragging to hear the audio.`}
                    title="Drag to seek · Ctrl + drag to hear audio"
                    onPointerDown={onPlayheadPointerDown}
                    onPointerMove={onPlayheadPointerMove}
                    onPointerUp={finishPlayheadDrag}
                    onPointerCancel={finishPlayheadDrag}
                    onLostPointerCapture={() => finishPlayheadDrag()}
                    onKeyDown={onPlayheadKeyDown}
                  />
                </div>
                <div className={styles.timelineAxis}><span>{formatTimecode(viewStart)}</span><span>{formatTimecode(viewStart + viewDuration * 0.25)}</span><span>{formatTimecode(viewStart + viewDuration * 0.5)}</span><span>{formatTimecode(viewStart + viewDuration * 0.75)}</span><span>{formatTimecode(viewEnd)}</span></div>
                {timelineView.zoom > 1.01 ? (
                  <label className={styles.timelineNavigator}>
                    <span>VISIBLE WINDOW</span>
                    <input
                      aria-label="Visible timeline position"
                      type="range"
                      min="0"
                      max={Math.max(0, duration - viewDuration)}
                      step="0.01"
                      value={viewStart}
                      onChange={(event) => setTimelineView((current) => ({ ...current, start: Number(event.target.value) }))}
                    />
                  </label>
                ) : null}
              </div>

              <div className={styles.editorGrid}>
                <section className={styles.markerListPanel}>
                  <div className={styles.markerListHead}><div><p>SUGGESTED EDIT POINTS</p><span>Click a time to listen there. Remove any point you do not want.</span></div><strong>{markers.length}</strong></div>
                  <div className={styles.markerList}>
                    {markers.length ? markers.map((marker, index) => (
                      <article className={marker.time < trimStart || marker.time > trimEnd ? styles.markerOutside : ""} key={marker.id}>
                        <button type="button" onClick={() => seek(marker.time)}><span>{String(index + 1).padStart(3, "0")}</span><strong>{formatTimecode(marker.time)}</strong></button>
                        <div><b>{marker.source === "manual" ? "Your marker" : "Suggested"}</b></div>
                        <button className={styles.deleteMarker} type="button" onClick={() => removeMarker(marker)} aria-label={`Remove marker at ${formatTimecode(marker.time)}`}>×</button>
                      </article>
                    )) : <p className={styles.emptyMarkers}>No markers found in this range. Open “Fine-tune suggestions” or add one at the playhead.</p>}
                  </div>
                </section>
                <div className={styles.reviewTools}>
                  <button className={styles.secondaryAction} type="button" onClick={() => addMarker()}>+ Add marker at playhead</button>
                  <button className={styles.textAction} type="button" onClick={() => { resetAnalysis(); setPhase("source-ready"); }}>Change analyzed part</button>
                  <details className={styles.tuningPanel}>
                  <summary>Fine-tune suggestions</summary>
                  <label>
                    <span><strong>Number of suggestions</strong><b>{sensitivity}%</b></span>
                    <input type="range" min="15" max="100" value={sensitivity} onChange={(event) => setSensitivity(Number(event.target.value))} />
                    <small>Lower = fewer, stronger hits. Higher = more possible edit points.</small>
                  </label>
                  <label>
                    <span><strong>Minimum marker gap</strong><b>{minimumSpacing.toFixed(2)} s</b></span>
                    <input type="range" min="0.08" max="1.5" step="0.01" value={minimumSpacing} onChange={(event) => setMinimumSpacing(Number(event.target.value))} />
                    <small>Prevents one impact or bass tail from becoming several nearby markers.</small>
                  </label>
                  </details>

                <details className={styles.trimPanel}>
                  <summary>Optional: trim exported audio</summary>
                  <p className={styles.trimExplanation}>This cuts the downloaded WAV. It does not change which part was analyzed.</p>
                  <div className={styles.trimReadout}><div><small>IN</small><strong>{formatTimecode(trimStart)}</strong></div><div><small>OUT</small><strong>{formatTimecode(trimEnd)}</strong></div></div>
                  <div className={styles.trimRange}>
                    <span className={styles.trimRangeRail} />
                    <span className={styles.trimRangeSelection} style={{ left: `${duration ? (trimStart / duration) * 100 : 0}%`, right: `${duration ? 100 - (trimEnd / duration) * 100 : 0}%` }} />
                    <input
                      className={styles.trimRangeStart}
                      aria-label="Trim start"
                      type="range"
                      min="0"
                      max={Math.max(duration, 0.01)}
                      step="0.01"
                      value={trimStart}
                      onChange={(event) => setTrimStart(Math.min(Number(event.target.value), trimEnd - 0.05))}
                    />
                    <input
                      className={styles.trimRangeEnd}
                      aria-label="Trim end"
                      type="range"
                      min="0"
                      max={Math.max(duration, 0.01)}
                      step="0.01"
                      value={trimEnd}
                      onChange={(event) => setTrimEnd(Math.max(Number(event.target.value), trimStart + 0.05))}
                    />
                  </div>
                  <div className={styles.trimRangeLabels}><span>DRAG IN</span><span>DRAG OUT</span></div>
                  <button className={styles.textAction} type="button" onClick={() => { setTrimStart(0); setTrimEnd(duration); }}>Reset to full track</button>
                </details>
                </div>
              </div>

              {error ? <p className={styles.error} role="alert">{error}</p> : null}

              <section className={styles.continuePanel}>
                <div><p>MARKERS REVIEWED</p><strong>{markersInExport.length} markers inside the selected range</strong></div>
                <button className={styles.primaryAction} type="button" disabled={!markersInExport.length} onClick={() => { setError(null); setPhase("export-ready"); }}>Continue to export <span>→</span></button>
              </section>
            </section>
          )}
        </>
      )}
    </main>
  );
}
