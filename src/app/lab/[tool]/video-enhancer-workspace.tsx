"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import darkThemeIcon from "../../../../assets/dark-theme.png";
import lightThemeIcon from "../../../../assets/light-theme.png";
import { BrandMark } from "@/components/brand-mark";
import { applySiteTheme, readSiteTheme, type SiteTheme } from "@/lib/site-theme";
import type { ToolDefinition } from "@/lib/tool-catalog";
import { DEFAULT_ENHANCER_SETTINGS } from "@/lib/video-enhancer/filter";
import { enhancedOutputSize } from "@/lib/video-enhancer/output";
import type { EnhancerDevice, EnhancerSettings, EnhancerWorkerRequest, EnhancerWorkerResponse } from "@/lib/video-enhancer/types";
import styles from "./video-enhancer-workspace.module.css";

type Source = { file: File; url: string; duration: number; width: number; height: number };
type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;
type Preview = { id: string; revision: number; time: number };
const PROCESSOR_START_ERROR="Local processing could not start. Reload or try a current Chrome or Edge browser. The original video remains viewable.";
function formatTime(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return [Math.floor(value / 3600), Math.floor(value % 3600 / 60), value % 60].slice(value >= 3600 ? 0 : 1).map((part) => String(part).padStart(2, "0")).join(":");
}

export function VideoEnhancerWorkspace({ tool }: { tool: ToolDefinition }) {
  const [theme, setTheme] = useState<SiteTheme>("dark");
  const [source, setSource] = useState<Source | null>(null);
  const [device, setDevice] = useState<EnhancerDevice>("gpu");
  const [settings, setSettings] = useState<EnhancerSettings>(DEFAULT_ENHANCER_SETTINGS);
  const [capabilities, setCapabilities] = useState({ gpu: false, cpu: false, export: false });
  const [canStreamSave, setCanStreamSave] = useState(false);
  const [split, setSplit] = useState(50);
  const [zoom, setZoom] = useState<1 | 2>(1);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportActivity,setExportActivity]=useState("");
  const [cpuHintDismissed,setCpuHintDismissed]=useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewMs, setPreviewMs] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const afterRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const processorFailureRef=useRef("");
  const sourceRef = useRef<Source | null>(null);
  const urlRef = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  const deviceRef = useRef(device);
  const revisionRef = useRef(0);
  const previewRef = useRef<Preview | null>(null);
  const exportRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureRef = useRef<OffscreenCanvas | null>(null);
  const refreshRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const saved = readSiteTheme(); applySiteTheme(saved, false);
    const frame = requestAnimationFrame(() => setTheme(saved));
    return () => cancelAnimationFrame(frame);
  }, []);

  const invalidatePreview = useCallback(() => {
    revisionRef.current++;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (previewRef.current) workerRef.current?.postMessage({ type: "cancel", jobId: previewRef.current.id } satisfies EnhancerWorkerRequest);
    previewRef.current = null;
    setPreviewReady(false);
    setPreviewMs(null);
  }, []);

  const requestPreview = useCallback(async () => {
    const video = videoRef.current, current = sourceRef.current, worker = workerRef.current;
    if (!video || !current || !worker || exportRef.current || previewRef.current || !video.paused || video.seeking || video.readyState < 2) return;
    const job: Preview = { id: crypto.randomUUID(), revision: revisionRef.current, time: video.currentTime };
    previewRef.current = job;
    const chosenDevice = deviceRef.current, chosenSettings = settingsRef.current;
    // Bound capture as well as processing memory, including for very large source videos.
    const ratio = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(2, Math.round(video.videoWidth * ratio / 2) * 2);
    const height = Math.max(2, Math.round(video.videoHeight * ratio / 2) * 2);
    try {
      const capture = captureRef.current ??= new OffscreenCanvas(width, height);
      if (capture.width !== width || capture.height !== height) { capture.width = width; capture.height = height; }
      const context = capture.getContext("2d", { alpha: false });
      if (!context) throw new Error("Local frame capture is unavailable.");
      // VideoFrame captures the decoded picture directly, including the first paused frame.
      // Canvas drawing remains the fallback for browsers without VideoFrame.
      if (typeof VideoFrame !== "undefined") {
        const frame = new VideoFrame(video);
        try { context.drawImage(frame, 0, 0, width, height); } finally { frame.close(); }
      } else context.drawImage(video, 0, 0, width, height);
      const bitmap = await createImageBitmap(capture);
      if (previewRef.current !== job || revisionRef.current !== job.revision || sourceRef.current !== current || video.seeking || !video.paused || Math.abs(video.currentTime - job.time) > 0.025) {
        bitmap.close();
        if (previewRef.current === job) previewRef.current = null;
        refreshRef.current();
        return;
      }
      const size=enhancedOutputSize(current.width,current.height,chosenSettings.scale,chosenDevice,
        typeof (window as Window & {showSaveFilePicker?: SavePicker}).showSaveFilePicker !== "function");
      const outputRatio=Math.min(2,size.width/current.width);
      const outputWidth=Math.max(2,Math.round(width*outputRatio/2)*2),outputHeight=Math.max(2,Math.round(height*outputRatio/2)*2);
      worker.postMessage({ type: "preview", jobId: job.id, bitmap, device: chosenDevice, settings: chosenSettings, width:outputWidth, height:outputHeight, frameKey:`${current.url}:${job.time}` } satisfies EnhancerWorkerRequest, [bitmap]);
    } catch (err) {
      if (previewRef.current === job) {
        previewRef.current = null;
        setError(err instanceof Error ? err.message : "This frame could not be captured. Try another position.");
      }
    }
  }, []);

  const refreshPreview = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; void requestPreview(); }, 75);
  }, [requestPreview]);
  useEffect(() => { refreshRef.current = refreshPreview; }, [refreshPreview]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setCanStreamSave(typeof (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker === "function"));
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
      const unsupported = requestAnimationFrame(() => setError("Local enhancement needs a browser with worker and canvas support. You can still view the original video."));
      return () => { cancelAnimationFrame(frame); cancelAnimationFrame(unsupported); };
    }
    // Version the entry when isolation requirements change: an immutable cached
    // response without COEP is rejected before the worker can answer its probe.
    const worker = new Worker(new URL("../../../workers/video-enhancer.worker.ts?isolated=native-detail-v16", import.meta.url), { type: "module" });
    workerRef.current = worker;
    processorFailureRef.current="";
    const startupTimer=setTimeout(()=>{
      worker.terminate();if(workerRef.current===worker)workerRef.current=null;
      previewRef.current=null;processorFailureRef.current=PROCESSOR_START_ERROR;setError(PROCESSOR_START_ERROR);
    },20_000);
    worker.onmessage = (event: MessageEvent<EnhancerWorkerResponse>) => {
      const message = event.data;
      if (message.type === "capabilities") {
        clearTimeout(startupTimer);
        setCapabilities(message);
        if (!message.gpu) setError("Video enhancement requires a compatible hardware GPU with WebGPU support. Try the latest Chrome or Edge. You can still view the original video.");
        refreshRef.current();
        return;
      }
      if (message.type === "preview") {
        const job = previewRef.current, video = videoRef.current;
        if (!job || message.jobId !== job.id) { message.bitmap.close(); return; }
        previewRef.current = null;
        if (job.revision !== revisionRef.current || !video || !video.paused || video.seeking || Math.abs(video.currentTime - job.time) > 0.025) {
          message.bitmap.close(); refreshRef.current(); return;
        }
        const canvas = afterRef.current;
        if (canvas) {
          canvas.width = message.bitmap.width; canvas.height = message.bitmap.height;
          const context = canvas.getContext("2d", {alpha: false});
          if (context) { context.drawImage(message.bitmap, 0, 0); setPreviewReady(true); setPreviewMs(message.elapsedMs); }
          else setError("The processed preview could not be displayed.");
        }
        message.bitmap.close();
        return;
      }
      if(message.type==="activity"&&message.jobId===exportRef.current) {
        const {activity,frame}=message;
        setExportActivity(activity.stage==="preparing" ? `Preparing ${deviceRef.current.toUpperCase()} engine…`
          : activity.stage==="finishing" ? `Finishing frame ${frame}`
          : `Restoring frame ${frame} · part ${activity.completedTiles??0}/${activity.totalTiles??0}`);
      }
      if (message.type === "progress" && message.jobId === exportRef.current) setProgress(message.fraction);
      if (message.type === "complete" && message.jobId === exportRef.current) {
        exportRef.current = null; setWorking(false); setProgress(1);
        if (message.buffer) {
          const url = URL.createObjectURL(new Blob([message.buffer], { type: "video/mp4" }));
          const link = document.createElement("a"); link.href = url; link.download = `${sourceRef.current?.file.name.replace(/\.[^.]+$/, "") || "cutweave"}-enhanced.mp4`; link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
        setNotice(message.elapsedMs ? `Enhanced MP4 saved in ${(message.elapsedMs/1000).toFixed(1)} s. Your original is unchanged.` : "Enhanced MP4 saved. Your original is unchanged."); refreshRef.current();
      }
      if (message.type === "cancelled" && message.jobId === exportRef.current) {
        exportRef.current = null; setWorking(false); setNotice("Export cancelled. Your original is unchanged."); refreshRef.current();
      }
      if (message.type === "error") {
        if (message.jobId === exportRef.current) { exportRef.current = null; setWorking(false); setError(message.message); refreshRef.current(); }
        else if (message.jobId === previewRef.current?.id) {
          previewRef.current = null;
          if (deviceRef.current === "gpu") {
            setError(`GPU processing could not run: ${message.message} Try the latest Chrome or Edge with hardware acceleration enabled.`);
          } else setError(message.message);
        }
      }
    };
    worker.onerror = (event) => { console.error("Video processor failed to start or run:",event.message||event.type);clearTimeout(startupTimer);worker.terminate();if(workerRef.current===worker)workerRef.current=null;previewRef.current = null; exportRef.current = null; setWorking(false);processorFailureRef.current="The local processor stopped. Reload to restart it.";setError(processorFailureRef.current); };
    worker.postMessage({type: "capabilities"} satisfies EnhancerWorkerRequest);
    return () => {
      cancelAnimationFrame(frame); if (timerRef.current) clearTimeout(timerRef.current);
      clearTimeout(startupTimer);
      worker.terminate(); workerRef.current = null; previewRef.current = null;
    };
  }, []);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  useEffect(() => {
    if (!source) return;
    const video = videoRef.current;
    if (!video) return;
    let animation = 0;
    const tick = () => { setTime(video.currentTime); if (!video.paused) animation = requestAnimationFrame(tick); };
    const play = () => { setPlaying(true); invalidatePreview(); animation = requestAnimationFrame(tick); };
    const pause = () => { setPlaying(false); cancelAnimationFrame(animation); setTime(video.currentTime); refreshPreview(); };
    const seeking = () => { invalidatePreview(); setTime(video.currentTime); };
    const refresh = () => { setTime(video.currentTime); refreshPreview(); };
    video.addEventListener("play", play); video.addEventListener("pause", pause); video.addEventListener("seeking", seeking);
    video.addEventListener("seeked", refresh); video.addEventListener("loadeddata", refresh); video.addEventListener("error", pause);
    refresh();
    return () => {
      cancelAnimationFrame(animation);
      video.removeEventListener("play", play); video.removeEventListener("pause", pause); video.removeEventListener("seeking", seeking);
      video.removeEventListener("seeked", refresh); video.removeEventListener("loadeddata", refresh); video.removeEventListener("error", pause);
    };
  }, [source, invalidatePreview, refreshPreview]);

  const updateSettings = (next: EnhancerSettings) => { settingsRef.current = next; setSettings(next); invalidatePreview(); setError(processorFailureRef.current); refreshPreview(); };
  const updateDevice = (next: EnhancerDevice) => { if(next!=="gpu")return;deviceRef.current = next; setDevice(next); invalidatePreview(); setError(processorFailureRef.current); refreshPreview(); };
  const changeVideo = useCallback(() => {
    invalidatePreview(); sourceRef.current = null; setSource(null); setTime(0); setPlaying(false); setZoom(1); setError(processorFailureRef.current); setNotice("");
    if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null;
  }, [invalidatePreview]);
  const loadFile = useCallback((file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name)) { setError("Choose a video file your browser can decode."); return; }
    changeVideo();
    const url = URL.createObjectURL(file); urlRef.current = url;
    const probe = document.createElement("video"); probe.preload = "metadata";
    const release = () => { probe.removeAttribute("src"); probe.load(); };
    probe.onloadedmetadata = () => {
      if (urlRef.current !== url) { release(); return; }
      if (!Number.isFinite(probe.duration) || probe.duration <= 0 || probe.duration > 3600 || !probe.videoWidth || !probe.videoHeight) setError("Choose a readable video up to one hour long.");
      else {
        const next = {file, url, duration: probe.duration, width: probe.videoWidth, height: probe.videoHeight};
        sourceRef.current = next; setSource(next);
      }
      release();
    };
    probe.onerror = () => { if (urlRef.current === url) setError("This browser cannot open that video. Try MP4 or WebM."); release(); };
    probe.src = url;
  }, [changeVideo]);
  const startExport = async () => {
    const current = sourceRef.current;
    if (!current || exportRef.current || !workerRef.current) return;
    if (!capabilities.export) { setError("MP4 export needs local video encoding support. Try Chrome or Edge."); return; }
    const picker = (window as Window & {showSaveFilePicker?: SavePicker}).showSaveFilePicker;
    if (!picker && (current.duration > 20 || current.file.size > 100 * 1024 * 1024)) { setError("Use Chrome or Edge to stream longer exports to a file. This browser supports clips up to 20 seconds / 100 MB."); return; }
    let fileHandle: FileSystemFileHandle | undefined;
    const capturedSettings = settingsRef.current, capturedDevice = deviceRef.current;
    const size = enhancedOutputSize(current.width, current.height, capturedSettings.scale, capturedDevice, !picker);
    if (picker) {
      try { fileHandle = await picker({suggestedName: `${current.file.name.replace(/\.[^.]+$/, "")}-enhanced.mp4`, types: [{description: "MP4 video", accept: {"video/mp4": [".mp4"]}}]}); }
      catch (err) { if (!(err instanceof DOMException && err.name === "AbortError")) setError("Could not choose the output file. Check browser file permissions."); return; }
    }
    if (sourceRef.current !== current || exportRef.current) return;
    videoRef.current?.pause(); invalidatePreview(); setError(""); setNotice(""); setWorking(true); setProgress(0); setExportActivity(`Preparing ${capturedDevice.toUpperCase()} engine…`);
    const id = crypto.randomUUID(); exportRef.current = id;
    workerRef.current?.postMessage({type: "export", jobId: id, file: current.file, device: capturedDevice, settings: capturedSettings, width: size.width, height: size.height, fileHandle} satisfies EnhancerWorkerRequest);
  };
  const size = source ? enhancedOutputSize(source.width, source.height, settings.scale, device, !canStreamSave) : null;
  const splitFromPointer = (event: PointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); setSplit(Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100))); };
  const available = device === "gpu" ? capabilities.gpu : capabilities.cpu;

  return <main className={`${styles.workspace} ${source ? styles.loaded : ""}`}>
    <header className={styles.header}><BrandMark /><nav className={styles.headerActions} aria-label="Page navigation"><Link href="/lab">← All tools</Link><Link href="/privacy">Privacy</Link><button className={styles.themeToggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => { const next = theme === "dark" ? "light" : "dark"; applySiteTheme(next); setTheme(next); }}><Image src={theme === "dark" ? darkThemeIcon : lightThemeIcon} alt="" width={22} height={22} /></button></nav></header>
    <section className={styles.hero}><div><p className={styles.eyebrow}>04 / PICTURE / LOCAL ENHANCEMENT</p><h1>{tool.title}</h1><p className={styles.lead}>Less noise. Clearer edges. Your video, enhanced on your device.</p></div><div className={styles.localBadge}><span className={styles.dot} /> RUNS ON THIS DEVICE <small>VIDEO SENT TO SERVER: 0 B</small></div></section>
    {!source ? <section className={styles.upload}><div className={styles.uploadArt}><span>LOCAL VIDEO</span><strong>01</strong><i /></div><div className={styles.uploadBody}><p className={styles.eyebrow}>01 / CHOOSE A SOURCE</p><h2>A cleaner picture.<br />One local video.</h2><p>Choose a clip. CUT/WEAVE prepares a real comparison with balanced settings. GPU-powered restoration. Your video stays on this device.</p><button className={styles.primaryButton} onClick={() => inputRef.current?.click()}>Choose a video ↗</button><small>MP4, MOV and WebM when supported by your browser. Up to 1 hour. Nothing is uploaded.</small></div></section> : <>
      <section className={styles.sourceStrip}><div><small>SOURCE</small><strong title={source.file.name}>{source.file.name}</strong></div><div><small>INPUT</small><strong>{source.width} × {source.height} · {formatTime(source.duration)}</strong></div><button disabled={working} onClick={changeVideo}>Change video</button></section>
      <div className={styles.workbench}>
        <section className={styles.previewSection} aria-label="Video comparison">
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>01 / COMPARE</p><h2>See the difference</h2></div><span className={styles.previewTiming}>{previewReady && previewMs !== null ? `${device.toUpperCase()} · ${Math.round(previewMs)} ms / preview frame` : "LOCAL PREVIEW"}</span></div>
          <div className={styles.comparison} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); splitFromPointer(event); }} onPointerMove={(event) => { if (event.buttons) splitFromPointer(event); }}>
            <video ref={videoRef} src={source.url} muted playsInline preload="auto" className={styles.beforeVideo} style={{transform:`scale(${zoom})`}} aria-label="Original video" onError={() => setError("This video could not be decoded for preview. Try an MP4 or WebM source.")} />
            <div className={styles.afterLayer} style={{clipPath: `inset(0 ${100 - split}% 0 0)`, visibility: previewReady ? "visible" : "hidden"}}><canvas ref={afterRef} style={{transform:`scale(${zoom})`}} aria-label="Processed preview frame" /></div>
            <span className={styles.beforeLabel}>ORIGINAL</span>
            {previewReady && <><span className={styles.afterLabel}>ENHANCED</span><div className={styles.divider} style={{left: `${split}%`}}><span>↔</span></div></>}
            {!previewReady && <p className={styles.previewStatus} role="status">{working ? "Exporting your enhanced video…" : playing ? "Original playback · pause to compare" : error ? "Original shown · preview unavailable" : "Original shown · processing this frame…"}</p>}
          </div>
          <div className={styles.playback}><button disabled={working} onClick={() => { const video = videoRef.current; if (!video) return; if (video.paused) void video.play().catch(() => setError("Playback could not start. Try another position.")); else video.pause(); }}>{playing ? "Pause" : "Play"}</button><span>{formatTime(time)}</span><input disabled={working} type="range" min={0} max={source.duration} step="0.01" value={time} aria-label="Video position" onChange={(event) => { invalidatePreview(); const next = Number(event.target.value); if (videoRef.current) videoRef.current.currentTime = next; setTime(next); refreshPreview(); }} /><span>{formatTime(source.duration)}</span></div>
          <label className={styles.splitRange}>Comparison <input type="range" min="0" max="100" value={split} onChange={(event) => setSplit(Number(event.target.value))} aria-label="Before and after comparison divider" /><span>Drag to inspect · pause on any frame</span></label>
          <div className={styles.detailView} role="group" aria-label="Comparison zoom"><button aria-pressed={zoom===1} onClick={()=>setZoom(1)}>Fit video</button><button aria-pressed={zoom===2} onClick={()=>setZoom(2)}>2× detail view</button><small>Matched zoom · large previews are reduced; export uses the displayed output size</small></div>
        </section>
        <aside className={styles.controls} aria-label="Enhancement settings">
          <div className={styles.controlIntro}><p className={styles.eyebrow}>02 / ENHANCE</p><h2>Make it clearer</h2><p>Restore edges and fine lines.<br />Keep the original lighting and color.</p></div>
          <div className={styles.controlBody}>
            <div className={styles.deviceChoices} role="group" aria-label="Processing device"><button aria-pressed={device === "gpu"} className={device === "gpu" ? styles.selected : ""} disabled={!capabilities.gpu || working} onClick={() => updateDevice("gpu")}><strong>GPU</strong><small>CPU-assisted export</small></button><span className={styles.cpuUnavailable} data-dismissed={cpuHintDismissed}><button type="button" aria-disabled="true" aria-describedby="enhancer-cpu-hint" onClick={event=>event.preventDefault()} onFocus={()=>setCpuHintDismissed(false)} onPointerEnter={()=>setCpuHintDismissed(false)} onKeyDown={event=>{if(event.key==="Escape")setCpuHintDismissed(true);}}><strong>CPU</strong><small>Unavailable</small></button><span id="enhancer-cpu-hint" role="tooltip" className={styles.cpuHint}><strong>GPU required</strong>Video restoration is computationally intensive. CPU-only processing is disabled to avoid excessively long export times. Your CPU still assists with video preparation and export.</span></span></div>
            <div className={styles.sliders}><label>Noise cleanup <output>{Math.round(settings.denoise * 100)}%</output><input disabled={working} type="range" aria-label="Noise cleanup" min="0" max="1" step="0.01" value={settings.denoise} onChange={(event) => updateSettings({...settings, denoise: Number(event.target.value)})} /></label><label>Restoration strength <output>{Math.round(settings.detail * 100)}%</output><input disabled={working} type="range" aria-label="Restoration strength" min="0" max="1" step="0.01" value={settings.detail} onChange={(event) => updateSettings({...settings, detail: Number(event.target.value)})} /></label><label>Sharpen <output>{Math.round((settings.sharpen ?? 0) * 100)}%</output><input disabled={working} type="range" aria-label="Sharpen" min="0" max="1" step="0.01" value={settings.sharpen ?? 0} onChange={(event) => updateSettings({...settings, sharpen: Number(event.target.value)})} /></label><small>Restoration rebuilds detail; Sharpen adds controlled local definition. Model: {settings.scale === 1 ? <a href="https://github.com/TNTwise/Models/releases/tag/DeH264_V1_Batch" target="_blank" rel="noreferrer">Native restoration · TNTwise</a> : <a href="https://huggingface.co/Phips/2xNomosUni_span_multijpg" target="_blank" rel="noreferrer">2× reconstruction · Philip Hofmann</a>} · Local processing</small></div>
            <div className={styles.scaleChoices}><span>Output size</span><div role="group" aria-label="Output size"><button aria-pressed={settings.scale === 1} className={settings.scale === 1 ? styles.selected : ""} disabled={working} onClick={() => updateSettings({...settings, scale: 1})}>Source size</button><button aria-pressed={settings.scale === 2} className={settings.scale === 2 ? styles.selected : ""} disabled={working} onClick={() => updateSettings({...settings, scale: 2})}>2× size</button></div><strong>{size?.width} × {size?.height} <small>MP4</small></strong><small>{canStreamSave ? device === "gpu" ? "Up to 4K · GPU" : "Up to 1080p · CPU" : "Up to 720p · this browser"}{size && (size.width < source.width * settings.scale || size.height < source.height * settings.scale) ? " · output capped" : ""}</small></div>
            <button className={styles.resetButton} disabled={working} onClick={() => updateSettings(DEFAULT_ENHANCER_SETTINGS)}>Reset recommended</button>
          </div>
          <div className={styles.exportAction}>{working ? <><div className={styles.progressHeading}><strong>Enhancing video</strong><output>{progress>0&&progress<.01 ? (progress*100).toFixed(2) : Math.round(progress*100)}%</output></div><progress aria-label="Export progress" max={1} value={progress} /><small role="status" aria-live="polite">{exportActivity}</small><button onClick={() => { if (exportRef.current) workerRef.current?.postMessage({type: "cancel", jobId: exportRef.current} satisfies EnhancerWorkerRequest); setNotice("Stopping the export…"); }}>Cancel export</button></> : <button className={styles.primaryButton} disabled={!available || !capabilities.export} onClick={() => void startExport()}>Enhance & save MP4 ↗</button>}<small>{canStreamSave ? "Local file · supported audio retained." : "Local download · 20 s / 100 MB limit. Supported audio retained."}</small></div>
        </aside>
      </div>
    </>}
    <input ref={inputRef} className={styles.hiddenInput} type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv" onChange={(event) => { loadFile(event.target.files?.[0]); event.target.value = ""; }} />
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
  </main>;
}
