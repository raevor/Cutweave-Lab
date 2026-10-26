"use client";

import { flushSync } from "react-dom";
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
  type SyntheticEvent,
} from "react";
import darkThemeIcon from "../../../../assets/dark-theme.png";
import lightThemeIcon from "../../../../assets/light-theme.png";
import { BrandMark } from "@/components/brand-mark";
import { SourceSlot } from "@/components/source-slot";
import { WorkspaceRuler } from "@/components/workspace-ruler";
import { createAfterEffectsScript } from "@/lib/auto-subtitles/after-effects";
import { decodeSpeechAudio, WHISPER_SAMPLE_RATE } from "@/lib/auto-subtitles/audio";
import { cleanSegmentText, createSrt, createTranscript, createVtt, formatCueTime, segmentsToCues, wrapCueText } from "@/lib/auto-subtitles/cues";
import type { SpeechSegment, SubtitleCue, SubtitleEngine, SubtitleWorkerRequest, SubtitleWorkerResponse } from "@/lib/auto-subtitles/types";
import { applySiteTheme, readSiteTheme, switchSiteTheme } from "@/lib/site-theme";
import type { ToolDefinition } from "@/lib/tool-catalog";
import base from "./music-bass-markers-workspace.module.css";
import styles from "./auto-subtitles-workspace.module.css";

type Phase = "idle" | "source-ready" | "decoding" | "loading-model" | "transcribing" | "results" | "export-ready" | "error";
type WorkspaceTheme = "light" | "dark";

const MAX_DURATION_SECONDS = 30 * 60;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const ACCEPTED_MEDIA = "video/*,audio/*,.mp4,.webm,.mov,.mkv,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac";
const MODEL_SIZE: Record<SubtitleEngine, string> = { gpu: "about 210 MB", cpu: "about 80 MB" };

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatClock(seconds: number) {
  return formatCueTime(seconds, ".").slice(0, 8);
}

function makeJobId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `subtitles-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fileBase(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "cutweave-subtitles";
}

function canOpenMedia(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("video/") || file.type.startsWith("audio/")
    || ["mp4", "webm", "mov", "mkv", "mp3", "wav", "m4a", "aac", "ogg", "opus", "flac"].includes(extension);
}

function downloadText(text: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function AutoSubtitlesWorkspace({ tool }: { tool: ToolDefinition }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerEngineRef = useRef<SubtitleEngine | null>(null);
  const activeJobRef = useRef<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<WorkspaceTheme>("dark");
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null);
  const [engine, setEngine] = useState<SubtitleEngine>("gpu");
  const [progress, setProgress] = useState({ completed: 0, total: 0, label: "Reading the soundtrack" });
  const [liveSegments, setLiveSegments] = useState<SpeechSegment[]>([]);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [transcribedRange, setTranscribedRange] = useState<{ start: number; end: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const savedTheme = readSiteTheme();
    applySiteTheme(savedTheme, false);
    const frame = window.requestAnimationFrame(() => setTheme(savedTheme));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    // navigator.gpu alone is not enough: some browsers expose it without a usable adapter.
    const check = gpu ? gpu.requestAdapter().then((adapter) => Boolean(adapter)).catch(() => false) : Promise.resolve(false);
    void check.then((available) => {
      if (cancelled) return;
      setGpuAvailable(available);
      if (!available) setEngine("cpu");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    workerRef.current?.terminate();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const isAudio = Boolean(file && (file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|opus|flac)$/i.test(file.name)));
  const busy = phase === "decoding" || phase === "loading-model" || phase === "transcribing";
  const workflowStep = !file ? 0 : phase === "source-ready" || phase === "error" ? 1 : busy ? 2 : phase === "results" ? 3 : 4;
  const workflowLabels = ["Source", "Set up", "Transcribe", "Review", "Export"];
  const selectedEnd = rangeEnd > rangeStart ? rangeEnd : duration;
  const isPartial = duration > 0 && (rangeStart > 0.05 || selectedEnd < duration - 0.05);
  const progressPercent = progress.total > 0 ? Math.round(Math.min(1, progress.completed / progress.total) * 100) : null;
  const activeCue = useMemo(
    () => cues.find((cue) => currentTime >= cue.start && currentTime < cue.end) ?? null,
    [cues, currentTime],
  );
  const wordCount = useMemo(() => cues.reduce((sum, cue) => sum + (cue.text.trim() ? cue.text.trim().split(/\s+/).length : 0), 0), [cues]);

  useEffect(() => {
    if (phase !== "results") return;
    let frame = 0;
    const tick = () => {
      const media = mediaRef.current;
      if (media && !media.paused) setCurrentTime(media.currentTime);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    if (!activeCue || phase !== "results") return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-cue-id="${activeCue.id}"]`);
    if (row && mediaRef.current && !mediaRef.current.paused) row.scrollIntoView({ block: "nearest" });
  }, [activeCue, phase]);

  function toggleTheme(event?: { currentTarget: Element }) {
    const nextTheme = theme === "light" ? "dark" : "light";
    switchSiteTheme(nextTheme, event?.currentTarget ?? null, () => setTheme(nextTheme), flushSync);
  }

  const stopJob = useCallback(() => {
    // The worker keeps its model between runs; only a cancelled run discards it.
    activeJobRef.current = null;
  }, []);

  function discardWorker() {
    workerRef.current?.terminate();
    workerRef.current = null;
    workerEngineRef.current = null;
  }

  function loadFile(nextFile: File | null) {
    if (!nextFile) return;
    if (!canOpenMedia(nextFile)) {
      setError("Choose a video or audio file such as MP4, WebM, MOV, MP3, WAV or M4A.");
      setPhase("error");
      return;
    }
    if (nextFile.size > MAX_FILE_BYTES) {
      setError("This file is larger than 1 GB. Export a shorter part or an audio-only copy and try again.");
      setPhase("error");
      return;
    }
    if (activeJobRef.current) discardWorker();
    stopJob();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(nextFile);
    objectUrlRef.current = url;
    setFile(nextFile);
    setMediaUrl(url);
    setMediaLoading(true);
    setDuration(0);
    setRangeStart(0);
    setRangeEnd(0);
    setTranscribedRange(null);
    setCurrentTime(0);
    setCues([]);
    setLiveSegments([]);
    setError(null);
    setPhase("source-ready");
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    loadFile(event.target.files?.[0] ?? null);
  }

  function clearFile() {
    if (activeJobRef.current) discardWorker();
    stopJob();
    mediaRef.current?.pause();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setFile(null);
    setMediaUrl(null);
    setDuration(0);
    setRangeStart(0);
    setRangeEnd(0);
    setTranscribedRange(null);
    setCurrentTime(0);
    setCues([]);
    setLiveSegments([]);
    setError(null);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  function onMetadata(event: SyntheticEvent<HTMLMediaElement>) {
    setMediaLoading(false);
    const nextDuration = event.currentTarget.duration;
    if (!Number.isFinite(nextDuration) || nextDuration <= 0) return;
    setDuration(nextDuration);
    const media = event.currentTarget as HTMLVideoElement;
    setVideoSize({ width: media.videoWidth ?? 0, height: media.videoHeight ?? 0 });
    // The player remounts between steps; only a newly loaded file starts with the full range.
    setRangeEnd((current) => current > 0 ? current : nextDuration);
    if (nextDuration > MAX_DURATION_SECONDS) {
      setError("This source is longer than 30 minutes. Trim it first so transcription stays fast and memory stays bounded.");
      setPhase("error");
    }
  }

  function onMediaError(event: SyntheticEvent<HTMLMediaElement>) {
    const code = event.currentTarget.error?.code;
    if (code !== 3 && code !== 4) return;
    setMediaLoading(false);
    setError("This browser cannot play this file. Chrome and Edge play MP4 (H.264); other builds may need WebM. The soundtrack may still be readable, so you can try to create subtitles.");
  }

  function getWorker(nextEngine: SubtitleEngine) {
    if (workerRef.current && workerEngineRef.current === nextEngine) return workerRef.current;
    discardWorker();
    const worker = new Worker(new URL("../../../workers/auto-subtitles.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    workerEngineRef.current = nextEngine;
    return worker;
  }

  async function createSubtitles() {
    if (!file || busy) return;
    if (duration > MAX_DURATION_SECONDS) return;
    const jobId = makeJobId();
    activeJobRef.current = jobId;
    setError(null);
    setCues([]);
    setLiveSegments([]);
    setPhase("decoding");
    setProgress({ completed: 0, total: 0, label: "Reading the soundtrack on this device" });

    try {
      const { samples, duration: audioDuration } = await decodeSpeechAudio(file, () => activeJobRef.current === jobId);
      if (activeJobRef.current !== jobId) return;
      if (audioDuration > MAX_DURATION_SECONDS) throw new Error("This source is longer than 30 minutes. Trim it first so transcription stays fast and memory stays bounded.");
      if (!duration) setDuration(audioDuration);
      // Only the chosen part goes to the worker; times stay relative to the full source.
      const partStart = Math.min(rangeStart, audioDuration);
      const partEnd = Math.min(rangeEnd > partStart ? rangeEnd : audioDuration, audioDuration);
      if (partEnd - partStart < 1) throw new Error("Choose a part that is at least one second long.");
      const part = partStart > 0 || partEnd < audioDuration
        ? samples.slice(Math.floor(partStart * WHISPER_SAMPLE_RATE), Math.ceil(partEnd * WHISPER_SAMPLE_RATE))
        : samples;

      const worker = getWorker(engine);
      setPhase("loading-model");
      setProgress({ completed: 0, total: 0, label: "Preparing the speech model" });
      worker.onmessage = (event: MessageEvent<SubtitleWorkerResponse>) => {
        const response = event.data;
        if (response.jobId !== activeJobRef.current) return;
        if (response.type === "model-progress") {
          setProgress({ completed: response.loaded, total: response.total, label: `Downloading the speech model · ${formatBytes(response.loaded)} of ${formatBytes(response.total)} · first run only` });
          return;
        }
        if (response.type === "model-ready") {
          setPhase("transcribing");
          setProgress({ completed: 0, total: 0, label: "Listening to the speech" });
          return;
        }
        if (response.type === "progress") {
          setPhase("transcribing");
          setProgress({ completed: response.completed, total: response.total, label: `Transcribing · part ${Math.min(response.completed + 1, response.total)} of ${response.total}` });
          if (response.segments.length) setLiveSegments((current) => [...current, ...response.segments]);
          return;
        }
        activeJobRef.current = null;
        if (response.type === "error") {
          discardWorker();
          setError(response.message);
          setPhase("error");
          return;
        }
        const nextCues = segmentsToCues(response.segments);
        setCues(nextCues);
        setTranscribedRange({ start: partStart, end: partEnd });
        setLiveSegments([]);
        setCurrentTime(mediaRef.current?.currentTime ?? 0);
        setPhase("results");
        if (!nextCues.length) setError("No English speech was found in this part. Check that it has spoken English and that the soundtrack is not silent.");
      };
      worker.onerror = () => {
        if (activeJobRef.current !== jobId) return;
        activeJobRef.current = null;
        discardWorker();
        setError(engine === "gpu"
          ? "The GPU speech engine stopped unexpectedly. Switch to CPU and try again; your file is still here."
          : "The speech engine stopped unexpectedly. Your file is still here; try again.");
        setPhase("error");
      };
      const request: SubtitleWorkerRequest = { type: "transcribe", jobId, engine, samples: part.buffer, sampleRate: WHISPER_SAMPLE_RATE, offset: partStart };
      worker.postMessage(request, [part.buffer]);
    } catch (caught) {
      if (activeJobRef.current !== jobId) return;
      activeJobRef.current = null;
      setError(caught instanceof Error ? caught.message : "The soundtrack could not be read in this browser.");
      setPhase("error");
    }
  }

  function cancelTranscription() {
    // Terminating is the only way to stop a model call that is already running.
    discardWorker();
    stopJob();
    setLiveSegments([]);
    setProgress({ completed: 0, total: 0, label: "Cancelled" });
    setPhase(file ? "source-ready" : "idle");
  }

  function seek(time: number) {
    const media = mediaRef.current;
    const next = Math.max(0, Math.min(time, duration || time));
    if (media) media.currentTime = next;
    setCurrentTime(next);
  }

  function updateCueText(id: string, text: string) {
    setCues((current) => current.map((cue) => cue.id === id ? { ...cue, text } : cue));
  }

  function removeCue(id: string) {
    setCues((current) => current.filter((cue) => cue.id !== id));
  }

  function exportFile(kind: "srt" | "vtt" | "txt" | "jsx") {
    if (!file) return;
    const name = fileBase(file.name);
    if (kind === "srt") downloadText(createSrt(cues), "application/x-subrip;charset=utf-8", `${name}.en.srt`);
    else if (kind === "vtt") downloadText(createVtt(cues), "text/vtt;charset=utf-8", `${name}.en.vtt`);
    else if (kind === "txt") downloadText(createTranscript(cues), "text/plain;charset=utf-8", `${name}-transcript.txt`);
    else {
      // The frame rate is not exposed by the browser; 30 fps is used only when a new composition is created.
      const script = createAfterEffectsScript(cues, {
        name: file.name.replace(/\.[^.]+$/, ""),
        width: videoSize.width || 1920,
        height: videoSize.height || 1080,
        frameRate: 30,
        duration,
      });
      downloadText(script, "application/javascript;charset=utf-8", `${name}.en.subtitles.jsx`);
    }
  }

  const mediaElement = mediaUrl ? (
    isAudio ? (
      <audio
        ref={mediaRef}
        className={styles.audioPlayer}
        src={mediaUrl}
        controls
        preload="metadata"
        onLoadedMetadata={onMetadata}
        onError={onMediaError}
        onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPause={(event) => setCurrentTime(event.currentTarget.currentTime)}
      />
    ) : (
      <video
        ref={mediaRef}
        className={styles.video}
        src={mediaUrl}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={onMetadata}
        onError={onMediaError}
        onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPause={(event) => setCurrentTime(event.currentTarget.currentTime)}
      />
    )
  ) : null;

  return (
    <main className={`${base.workspace} ${styles.workspace}`} data-tool-key="auto-subtitles">
      <header className={base.header}>
        <BrandMark />
        <div className={base.headerActions}>
          <nav aria-label="Auto subtitles tool navigation">
            <Link href="/lab">← All tools</Link>
            <Link href="/privacy">Privacy</Link>
          </nav>
          <button className={base.themeToggle} type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}>
            <Image src={theme === "dark" ? darkThemeIcon : lightThemeIcon} alt="" width={24} height={24} priority />
          </button>
        </div>
      </header>

      <section className={base.hero}>
        <div>
          <p className={base.eyebrow}>{tool.index} / English speech to subtitle file</p>
          <h1>Auto<br /><em>Subtitles</em></h1>
          <p className={base.heroPromise}>Turn spoken English into timed subtitle lines, fix any word by hand, and download SRT or VTT for your editor or player.</p>
        </div>
        <div className={base.localStatus}>
          <span><i /> Runs on this device</span>
          <strong>0 B</strong>
          <small>Media sent to server</small>
        </div>
      </section>

      <WorkspaceRuler />

      <ol className={base.workflow} aria-label="Auto subtitles workflow">
        {workflowLabels.map((label, index) => (
          <li className={index < workflowStep ? base.stepComplete : index === workflowStep ? base.stepCurrent : ""} key={label} aria-current={index === workflowStep ? "step" : undefined}>
            <span>{index < workflowStep ? "✓" : String(index + 1).padStart(2, "0")}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>

      {!file ? (
        <section
          className={`${base.intake} ${dragActive ? base.intakeDragging : ""}`}
          onDragEnter={(event: DragEvent<HTMLElement>) => { event.preventDefault(); setDragActive(true); }}
          onDragOver={(event: DragEvent<HTMLElement>) => event.preventDefault()}
          onDragLeave={(event: DragEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
          onDrop={(event: DragEvent<HTMLElement>) => { event.preventDefault(); setDragActive(false); loadFile(event.dataTransfer.files?.[0] ?? null); }}
          aria-labelledby="subtitles-intake-title"
        >
          <div className={base.intakeVisual} aria-hidden="true">
            <SourceSlot kind="subtitles" />
            <div className={base.intakeGuide}><i /><strong>NO SOURCE LOADED</strong></div>
            <span>LOCAL SPEECH TO TEXT</span><b>04</b>
          </div>
          <div className={base.intakeCopy}>
            <p>01 / Choose the source</p>
            <h2 id="subtitles-intake-title">Drop the video you want subtitled</h2>
            <span>Videos and audio files with spoken English work best. The file is read in this tab and is never uploaded.</span>
            <input ref={inputRef} className="sr-only" id="subtitles-media-input" type="file" accept={ACCEPTED_MEDIA} onChange={chooseFile} />
            <button className={base.primaryAction} type="button" onClick={() => inputRef.current?.click()}>Choose video or audio <span>↗</span></button>
            {/* Wrapped so the intake's eyebrow style for direct paragraphs does not apply. */}
            {error ? <div className={base.intakeError}><p className={base.error} role="alert">{error}</p></div> : null}
          </div>
          <aside className={base.intakeFacts}>
            <div><small>INPUT</small><strong>One local video or audio file</strong></div>
            <div><small>LANGUAGE</small><strong>English speech</strong></div>
            <div><small>OUTPUT</small><strong>SRT, VTT + transcript</strong></div>
            <div><small>MEDIA ROUTE</small><strong><i /> On device</strong></div>
          </aside>
        </section>
      ) : (
        <>
          <section className={base.sourceDeck} aria-label="Loaded source">
            <div className={base.sourceIdentity}>
              <p>LOCAL SOURCE / {mediaLoading ? "LOADING" : "READY"}</p>
              <h2>{file.name}</h2>
              <span>{formatBytes(file.size)} · {duration ? formatClock(duration) : "Reading duration"}</span>
            </div>
            <div className={styles.sourceNote}>
              <small>LANGUAGE</small>
              <strong>English only</strong>
              <span>Other languages are not supported in this version and will produce poor text.</span>
            </div>
            <button className={base.removeSource} type="button" onClick={clearFile}>Remove source</button>
          </section>

          {phase !== "results" && phase !== "export-ready" ? (
            <section className={base.analysisSetup}>
              <div className={styles.preview}>
                {mediaElement}
                {busy && liveSegments.length ? (
                  <div className={styles.liveFeed} aria-live="polite">
                    <p>HEARD SO FAR</p>
                    {liveSegments.slice(-4).map((segment) => (
                      <div key={`${segment.start}-${segment.text}`}><span>{formatClock(segment.start)}</span>{segment.text}</div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className={base.analysisControls}>
                <p>02 / Choose the part and engine</p>
                <h2>Create English subtitles</h2>
                <span>A Whisper speech model runs inside this tab. The first run downloads the model ({MODEL_SIZE[engine]}); later runs load it from the browser cache.</span>
                <div className={styles.rangeBlock}>
                  <div className={styles.rangeHead}>
                    <small>PART TO SUBTITLE</small>
                    <strong>{formatClock(rangeStart)} – {formatClock(selectedEnd)}</strong>
                    <span>{isPartial ? `${formatClock(selectedEnd - rangeStart)} selected` : "Full source"}</span>
                  </div>
                  <div className={base.rangePreviewTrack} aria-hidden="true">
                    <span style={{ left: `${duration ? (rangeStart / duration) * 100 : 0}%`, right: `${duration ? 100 - (selectedEnd / duration) * 100 : 0}%` }} />
                  </div>
                  <div className={base.analysisRangeControls}>
                    <div className={base.rangeField}>
                      <div><label htmlFor="subtitles-range-start">Start</label><strong>{formatClock(rangeStart)}</strong></div>
                      <input id="subtitles-range-start" type="range" min="0" max={Math.max(duration, 0.01)} step="0.1" value={rangeStart} disabled={busy || !duration} onChange={(event) => setRangeStart(Math.min(Number(event.target.value), selectedEnd - 1))} />
                      <button type="button" disabled={busy || !duration} onClick={() => setRangeStart(Math.max(0, Math.min(mediaRef.current?.currentTime ?? 0, selectedEnd - 1)))}>Start at playhead</button>
                    </div>
                    <div className={base.rangeField}>
                      <div><label htmlFor="subtitles-range-end">End</label><strong>{formatClock(selectedEnd)}</strong></div>
                      <input id="subtitles-range-end" type="range" min="0" max={Math.max(duration, 0.01)} step="0.1" value={selectedEnd} disabled={busy || !duration} onChange={(event) => setRangeEnd(Math.max(Number(event.target.value), rangeStart + 1))} />
                      <button type="button" disabled={busy || !duration} onClick={() => setRangeEnd(Math.min(duration, Math.max(mediaRef.current?.currentTime ?? duration, rangeStart + 1)))}>End at playhead</button>
                    </div>
                  </div>
                  {isPartial ? <button className={base.textAction} type="button" disabled={busy} onClick={() => { setRangeStart(0); setRangeEnd(duration); }}>Use the full source</button> : null}
                </div>
                <div className={styles.engineChoice} role="radiogroup" aria-label="Speech engine">
                  <button type="button" role="radio" aria-checked={engine === "gpu"} disabled={busy || gpuAvailable === false} onClick={() => setEngine("gpu")}>
                    <strong>GPU</strong>
                    <small>{gpuAvailable === false ? "Not available in this browser" : "Recommended · fastest"}</small>
                  </button>
                  <button type="button" role="radio" aria-checked={engine === "cpu"} disabled={busy} onClick={() => setEngine("cpu")}>
                    <strong>CPU</strong>
                    <small>Works everywhere · slower</small>
                  </button>
                </div>
                {error ? <p className={base.error} role="alert">{error}</p> : null}
                {busy ? (
                  <div className={base.progressPanel}>
                    <div className={progressPercent === null ? base.progressIndeterminate : ""}>
                      <i style={progressPercent === null ? undefined : { width: `${progressPercent}%` }} />
                    </div>
                    <span>{progress.label}</span><strong>{progressPercent === null ? "LOCAL" : `${progressPercent}%`}</strong>
                    <button type="button" onClick={cancelTranscription}>Cancel</button>
                  </div>
                ) : (
                  <button className={base.primaryAction} type="button" onClick={createSubtitles} disabled={!duration && !isAudio && mediaLoading}>Create subtitles <span>→</span></button>
                )}
              </div>
            </section>
          ) : phase === "export-ready" ? (
            <section className={base.exportStage}>
              <header className={base.exportStageHeader}>
                <div><p>05 / Export</p><h2>Take the subtitles with you</h2></div>
                <div className={base.resultStats}>
                  <div><small>LINES</small><strong>{cues.length}</strong></div>
                  <div><small>WORDS</small><strong>{wordCount}</strong></div>
                  <div><small>LANGUAGE</small><strong>EN</strong></div>
                </div>
              </header>
              <section className={base.exportPanel}>
                <div>
                  <p>REVIEW COMPLETE</p>
                  <h2>Choose a format</h2>
                  <span>SRT imports into Premiere Pro, DaVinci Resolve, Final Cut Pro and most players. After Effects cannot import SRT, so it gets a script instead. VTT is the web format for HTML video. The transcript lists one line per row, without times.</span>
                </div>
                <div className={base.exportControls}>
                  <div className={base.exportActions}>
                    <button className={base.primaryAction} type="button" onClick={() => exportFile("srt")} disabled={!cues.length}>Download SRT<span>↓</span></button>
                    <button type="button" onClick={() => exportFile("jsx")} disabled={!cues.length}>After Effects</button>
                    <button type="button" onClick={() => exportFile("vtt")} disabled={!cues.length}>WebVTT</button>
                    <button type="button" onClick={() => exportFile("txt")} disabled={!cues.length}>Transcript</button>
                  </div>
                  <p className={styles.aeHint}><strong>After Effects:</strong> File › Scripts › Run Script File, then choose the .jsx file. Subtitles are added as one text layer to the open composition, starting at 0:00, or to a new composition sized like your video.</p>
                </div>
                <small className={base.exportNote}>Files are created in this tab from your reviewed lines. Lines longer than 42 characters are split over two lines. Times are measured from the start of the source, so the file lines up with the original video.</small>
              </section>
              <button className={base.backToMarkers} type="button" onClick={() => setPhase("results")}>← Back to subtitle review</button>
            </section>
          ) : (
            <section className={base.editor}>
              <header className={base.editorHeader}>
                <div><p>04 / Review the text</p><h2>Check every line</h2><span>Play the source and read along. Click a time to jump there, type to fix a word, or remove a line.{transcribedRange && duration && (transcribedRange.start > 0.05 || transcribedRange.end < duration - 0.05) ? ` These subtitles cover ${formatClock(transcribedRange.start)} – ${formatClock(transcribedRange.end)}.` : ""}</span></div>
                <div className={`${base.resultStats} ${base.reviewStats}`}>
                  <div><small>SUBTITLE LINES</small><strong>{cues.length}</strong></div>
                  <div><small>WORDS</small><strong>{wordCount}</strong></div>
                </div>
              </header>
              <div className={styles.reviewGrid}>
                <div className={styles.stage}>
                  <div className={styles.stageFrame}>
                    {mediaElement}
                    <p className={styles.caption}>{activeCue ? <span>{wrapCueText(cleanSegmentText(activeCue.text))}</span> : null}</p>
                  </div>
                  <span className={styles.stageNote}>PREVIEW · {formatClock(currentTime)}{activeCue ? ` · LINE ${cues.indexOf(activeCue) + 1}` : ""}</span>
                </div>
                <section className={styles.cuePanel} aria-label="Subtitle lines">
                  <div className={base.markerListHead}><div><p>SUBTITLE LINES</p><span>Edits are kept in this tab until you leave the page.</span></div><strong>{cues.length}</strong></div>
                  <div className={styles.cueList} ref={listRef}>
                    {cues.length ? cues.map((cue, index) => (
                      <article key={cue.id} data-cue-id={cue.id} className={activeCue?.id === cue.id ? styles.cueActive : ""}>
                        <button type="button" onClick={() => seek(cue.start)} aria-label={`Play from line ${index + 1} at ${formatClock(cue.start)}`}>
                          <span>{String(index + 1).padStart(3, "0")}</span>
                          <strong>{formatCueTime(cue.start, ".").slice(3, 10)}</strong>
                          <small>{(cue.end - cue.start).toFixed(1)} s</small>
                        </button>
                        <textarea aria-label={`Text of line ${index + 1}`} value={cue.text} rows={1} onChange={(event) => updateCueText(cue.id, event.target.value)} />
                        <button className={base.deleteMarker} type="button" onClick={() => removeCue(cue.id)} aria-label={`Remove line ${index + 1}`}>×</button>
                      </article>
                    )) : <p className={base.emptyMarkers}>No subtitle lines. Try another file with clear English speech.</p>}
                  </div>
                  <button className={base.textAction} type="button" onClick={() => { setCues([]); setError(null); setPhase("source-ready"); }}>Transcribe again</button>
                </section>
              </div>
              {error ? <p className={base.error} role="alert">{error}</p> : null}
              <section className={base.continuePanel}>
                <div><p>LINES REVIEWED</p><strong>{cues.length} subtitle lines ready</strong></div>
                <button className={base.primaryAction} type="button" disabled={!cues.length} onClick={() => { setError(null); mediaRef.current?.pause(); setPhase("export-ready"); }}>Continue to export <span>→</span></button>
              </section>
            </section>
          )}
        </>
      )}
    </main>
  );
}
