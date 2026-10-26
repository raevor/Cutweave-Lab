"use client";

import { flushSync } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, DragEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import darkThemeIcon from "../../../../assets/dark-theme.png";
import lightThemeIcon from "../../../../assets/light-theme.png";
import { BrandMark } from "@/components/brand-mark";
import { SourceSlot } from "@/components/source-slot";
import { WorkspaceRuler } from "@/components/workspace-ruler";
import { applyMatte, fitToPixels, subjectCoverage } from "@/lib/background-remover/alpha";
import type { RemoverEngine, RemoverWorkerRequest, RemoverWorkerResponse } from "@/lib/background-remover/types";
import { applySiteTheme, readSiteTheme, switchSiteTheme } from "@/lib/site-theme";
import type { ToolDefinition } from "@/lib/tool-catalog";
import base from "./music-bass-markers-workspace.module.css";
import styles from "./background-remover-workspace.module.css";

type Phase = "idle" | "source-ready" | "loading-model" | "processing" | "result" | "error";
type WorkspaceTheme = "light" | "dark";
type Backdrop = "transparent" | "white" | "black" | "custom";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Larger photos are scaled to this budget so the matte and export stay within browser memory. */
const MAX_PIXELS = 24_000_000;
const ACCEPTED_IMAGES = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";
const MODEL_SIZE: Record<RemoverEngine, string> = { gpu: "about 115 MB", cpu: "about 45 MB" };

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function makeJobId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `remover-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fileBase(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "cutweave-image";
}

function downloadCanvas(canvas: HTMLCanvasElement, name: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }, "image/png");
}

type Source = { width: number; height: number; scaled: boolean; pixels: Uint8ClampedArray };

export function BackgroundRemoverWorkspace({ tool }: { tool: ToolDefinition }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerKeyRef = useRef<string | null>(null);
  const activeJobRef = useRef<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const sourceRef = useRef<Source | null>(null);
  const matteRef = useRef<Uint8Array | null>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const [theme, setTheme] = useState<WorkspaceTheme>("dark");
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0, scaled: false });
  const [dragActive, setDragActive] = useState(false);
  const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null);
  const [engine, setEngine] = useState<RemoverEngine>("gpu");
  const [progress, setProgress] = useState({ completed: 0, total: 0, label: "Preparing" });
  const [edge, setEdge] = useState(25);
  const [backdrop, setBackdrop] = useState<Backdrop>("transparent");
  const [customColor, setCustomColor] = useState("#3f7cff");
  const [split, setSplit] = useState(50);
  const [stats, setStats] = useState({ seconds: 0, coverage: 0 });
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const savedTheme = readSiteTheme();
    applySiteTheme(savedTheme, false);
    const frame = window.requestAnimationFrame(() => setTheme(savedTheme));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } };
    // The GPU model is fp16, so the adapter must support shader-f16, not merely exist.
    const check = nav.gpu ? nav.gpu.requestAdapter().then((adapter) => Boolean(adapter?.features.has("shader-f16"))).catch(() => false) : Promise.resolve(false);
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

  // Redraw the cut-out whenever the edge setting changes; the model is not run again.
  useEffect(() => {
    if (phase !== "result") return;
    const source = sourceRef.current;
    const matte = matteRef.current;
    const canvas = resultCanvasRef.current;
    if (!source || !matte || !canvas) return;
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d")?.putImageData(new ImageData(applyMatte(source.pixels, matte, edge / 100), source.width, source.height), 0, 0);
  }, [edge, phase]);

  const busy = phase === "loading-model" || phase === "processing";
  const workflowStep = !file ? 0 : phase === "source-ready" || phase === "error" ? 1 : busy ? 2 : 3;
  const workflowLabels = ["Image", "Set up", "Remove", "Refine", "Export"];
  const progressPercent = progress.total > 0 ? Math.round(Math.min(1, progress.completed / progress.total) * 100) : null;
  const backdropColor = backdrop === "white" ? "#ffffff" : backdrop === "black" ? "#000000" : backdrop === "custom" ? customColor : null;

  function toggleTheme(event?: { currentTarget: Element }) {
    const nextTheme = theme === "light" ? "dark" : "light";
    switchSiteTheme(nextTheme, event?.currentTarget ?? null, () => setTheme(nextTheme), flushSync);
  }

  function discardWorker() {
    workerRef.current?.terminate();
    workerRef.current = null;
    workerKeyRef.current = null;
  }

  function reset() {
    if (activeJobRef.current) discardWorker();
    activeJobRef.current = null;
    sourceRef.current = null;
    matteRef.current = null;
    setError(null);
    setSplit(50);
  }

  async function loadFile(nextFile: File | null) {
    if (!nextFile) return;
    if (!/^image\/(png|jpeg|webp)$/.test(nextFile.type) && !/\.(png|jpe?g|webp)$/i.test(nextFile.name)) {
      setError("Choose a PNG, JPEG or WebP image.");
      setPhase("error");
      return;
    }
    if (nextFile.size > MAX_FILE_BYTES) {
      setError("This image is larger than 50 MB. Export a smaller copy and try again.");
      setPhase("error");
      return;
    }
    reset();
    try {
      const bitmap = await createImageBitmap(nextFile);
      const fit = fitToPixels(bitmap.width, bitmap.height, MAX_PIXELS);
      const canvas = document.createElement("canvas");
      canvas.width = fit.width;
      canvas.height = fit.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("This browser cannot read image pixels.");
      context.drawImage(bitmap, 0, 0, fit.width, fit.height);
      bitmap.close();
      sourceRef.current = { ...fit, pixels: context.getImageData(0, 0, fit.width, fit.height).data };
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(nextFile);
      objectUrlRef.current = url;
      setFile(nextFile);
      setImageUrl(url);
      setSize(fit);
      setPhase("source-ready");
    } catch {
      setError("This browser could not open the image. Try a PNG or JPEG copy.");
      setPhase("error");
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    void loadFile(event.target.files?.[0] ?? null);
  }

  function clearFile() {
    reset();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setFile(null);
    setImageUrl(null);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  function getWorker(key: string) {
    if (workerRef.current && workerKeyRef.current === key) return workerRef.current;
    discardWorker();
    const worker = new Worker(new URL("../../../workers/background-remover.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    workerKeyRef.current = key;
    return worker;
  }

  function removeBackground() {
    const source = sourceRef.current;
    if (!source || busy) return;
    const jobId = makeJobId();
    activeJobRef.current = jobId;
    const worker = getWorker(engine);
    setError(null);
    setPhase("loading-model");
    setProgress({ completed: 0, total: 0, label: "Preparing the background model" });
    worker.onmessage = (event: MessageEvent<RemoverWorkerResponse>) => {
      const response = event.data;
      if (response.jobId !== activeJobRef.current) return;
      if (response.type === "model-progress") {
        setProgress({ completed: response.loaded, total: response.total, label: `Downloading the background model · ${formatBytes(response.loaded)} of ${formatBytes(response.total)} · first run only` });
        return;
      }
      if (response.type === "processing") {
        setPhase("processing");
        setProgress({ completed: 0, total: 0, label: "Separating the subject on this device" });
        return;
      }
      activeJobRef.current = null;
      if (response.type === "error") {
        discardWorker();
        setError(response.message);
        setPhase("error");
        return;
      }
      const matte = new Uint8Array(response.mask);
      matteRef.current = matte;
      setStats({ seconds: response.seconds, coverage: subjectCoverage(matte) });
      setPhase("result");
      if (subjectCoverage(matte) < 0.005) setError("No clear subject was found. Try an image where the subject stands out from the background.");
    };
    worker.onerror = () => {
      if (activeJobRef.current !== jobId) return;
      activeJobRef.current = null;
      discardWorker();
      setError(engine === "gpu" ? "The GPU engine stopped unexpectedly. Switch to CPU and try again; your image is still here." : "The background engine stopped unexpectedly. Your image is still here; try again.");
      setPhase("error");
    };
    // The pixels are copied so the original stays available for the before and after view.
    const pixels = new Uint8ClampedArray(source.pixels);
    const request: RemoverWorkerRequest = { type: "remove", jobId, engine, pixels: pixels.buffer, width: source.width, height: source.height };
    worker.postMessage(request, [pixels.buffer]);
  }

  function cancel() {
    discardWorker();
    activeJobRef.current = null;
    setPhase(file ? "source-ready" : "idle");
  }

  function exportImage(kind: "transparent" | "backdrop" | "mask") {
    const source = sourceRef.current;
    const matte = matteRef.current;
    const cutout = resultCanvasRef.current;
    if (!file || !source || !matte || !cutout) return;
    const name = fileBase(file.name);
    if (kind === "transparent") {
      downloadCanvas(cutout, `${name}-cutout.png`);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    if (kind === "mask") {
      const pixels = applyMatte(new Uint8ClampedArray(source.pixels.length).fill(255), matte, edge / 100);
      // Editors read a matte as white subject on black.
      for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3];
        pixels[index] = pixels[index + 1] = pixels[index + 2] = alpha;
        pixels[index + 3] = 255;
      }
      context.putImageData(new ImageData(pixels, source.width, source.height), 0, 0);
      downloadCanvas(canvas, `${name}-mask.png`);
      return;
    }
    context.fillStyle = backdropColor ?? "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(cutout, 0, 0);
    downloadCanvas(canvas, `${name}-background.png`);
  }

  return (
    <main className={`${base.workspace} ${styles.workspace}`} data-tool-key="background-remover">
      <header className={base.header}>
        <BrandMark />
        <div className={base.headerActions}>
          <nav aria-label="Background remover tool navigation">
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
          <p className={base.eyebrow}>{tool.index} / Subject cut-out for thumbnails and comps</p>
          <h1>Background<br /><em>Remover</em></h1>
          <p className={base.heroPromise}>Lift the subject out of a photo or frame, tune the edge and download a transparent PNG, a new background or a matte for your editor.</p>
        </div>
        <div className={base.localStatus}>
          <span><i /> Runs on this device</span>
          <strong>0 B</strong>
          <small>Media sent to server</small>
        </div>
      </section>

      <WorkspaceRuler />

      <ol className={base.workflow} aria-label="Background remover workflow">
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
          onDrop={(event: DragEvent<HTMLElement>) => { event.preventDefault(); setDragActive(false); void loadFile(event.dataTransfer.files?.[0] ?? null); }}
          aria-labelledby="remover-intake-title"
        >
          <div className={base.intakeVisual} aria-hidden="true">
            <SourceSlot kind="image" />
            <div className={base.intakeGuide}><i /><strong>NO SOURCE LOADED</strong></div>
            <span>LOCAL SUBJECT CUT-OUT</span><b>05</b>
          </div>
          <div className={base.intakeCopy}>
            <p>01 / Choose the image</p>
            <h2 id="remover-intake-title">Drop the image you want to cut out</h2>
            <span>PNG, JPEG and WebP photos, stills and illustrations work. The image is read in this tab and is never uploaded.</span>
            <input ref={inputRef} className="sr-only" id="remover-image-input" type="file" accept={ACCEPTED_IMAGES} onChange={chooseFile} />
            <button className={base.primaryAction} type="button" onClick={() => inputRef.current?.click()}>Choose an image <span>↗</span></button>
            {error ? <div className={base.intakeError}><p className={base.error} role="alert">{error}</p></div> : null}
          </div>
          <aside className={base.intakeFacts}>
            <div><small>INPUT</small><strong>One local image</strong></div>
            <div><small>WORKS ON</small><strong>Photos, stills, illustrations</strong></div>
            <div><small>OUTPUT</small><strong>Transparent PNG + matte</strong></div>
            <div><small>MEDIA ROUTE</small><strong><i /> On device</strong></div>
          </aside>
        </section>
      ) : (
        <>
          <section className={base.sourceDeck} aria-label="Loaded image">
            <div className={base.sourceIdentity}>
              <p>LOCAL SOURCE / READY</p>
              <h2>{file.name}</h2>
              <span>{formatBytes(file.size)} · {size.width} × {size.height}{size.scaled ? " (scaled to fit)" : ""}</span>
            </div>
            <div className={styles.sourceNote}>
              <small>MODEL</small>
              <strong>On-device cut-out</strong>
              <span>Best on a clear main subject. Fine hair and line art may need a softer edge.</span>
            </div>
            <button className={base.removeSource} type="button" onClick={clearFile}>Remove source</button>
          </section>

          {phase !== "result" ? (
            <section className={base.analysisSetup}>
              <div className={styles.preview}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL cannot go through the image optimiser */}
                {imageUrl ? <img className={`${styles.sourceImage} ${busy ? styles.scanning : ""}`} src={imageUrl} alt="The chosen image" /> : null}
              </div>
              <div className={base.analysisControls}>
                <p>02 / Choose the engine</p>
                <h2>Remove the background</h2>
                <span>The image model runs inside this tab. The first run downloads it ({MODEL_SIZE[engine]}); later runs load it from the browser cache.</span>
                <div className={styles.engineChoice} role="radiogroup" aria-label="Background engine">
                  <button type="button" role="radio" aria-checked={engine === "gpu"} disabled={busy || gpuAvailable === false} onClick={() => setEngine("gpu")}>
                    <strong>GPU</strong>
                    <small>{gpuAvailable === false ? "Not available in this browser" : "Recommended · a few seconds"}</small>
                  </button>
                  <button type="button" role="radio" aria-checked={engine === "cpu"} disabled={busy} onClick={() => setEngine("cpu")}>
                    <strong>CPU</strong>
                    <small>Works everywhere · can take a minute</small>
                  </button>
                </div>
                {error ? <div className={base.intakeError}><p className={base.error} role="alert">{error}</p></div> : null}
                {busy ? (
                  <div className={base.progressPanel}>
                    <div className={progressPercent === null ? base.progressIndeterminate : ""}>
                      <i style={progressPercent === null ? undefined : { width: `${progressPercent}%` }} />
                    </div>
                    <span>{progress.label}</span><strong>{progressPercent === null ? "LOCAL" : `${progressPercent}%`}</strong>
                    <button type="button" onClick={cancel}>Cancel</button>
                  </div>
                ) : (
                  <button className={base.primaryAction} type="button" onClick={removeBackground}>Remove background <span>→</span></button>
                )}
              </div>
            </section>
          ) : (
            <section className={base.editor}>
              <header className={base.editorHeader}>
                <div><p>04 / Refine and export</p><h2>Check the edge</h2><span>Drag the divider to compare. Soften the edge for hair and fur, harden it for products and logos.</span></div>
                <div className={`${base.resultStats} ${base.reviewStats}`}>
                  <div><small>SUBJECT</small><strong>{Math.round(stats.coverage * 100)}%</strong></div>
                  <div><small>TIME</small><strong>{stats.seconds.toFixed(1)} s</strong></div>
                </div>
              </header>
              <div className={styles.reviewGrid}>
                <div className={styles.compare} style={{ aspectRatio: `${size.width} / ${size.height}`, maxWidth: `min(calc(100% - 40px), ${Math.round(640 * size.width / size.height)}px)` }}>
                  <div className={`${styles.layer} ${backdrop === "transparent" ? styles.checker : ""}`} style={backdropColor ? { background: backdropColor } : undefined}>
                    <canvas ref={resultCanvasRef} className={styles.layerMedia} aria-label="Image with the background removed" />
                  </div>
                  {imageUrl ? (
                    <div className={styles.layer} style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL cannot go through the image optimiser */}
                      <img className={styles.layerMedia} src={imageUrl} alt="Original image" />
                    </div>
                  ) : null}
                  <span className={styles.divider} style={{ left: `${split}%` }} aria-hidden="true"><i /></span>
                  <span className={styles.tagBefore}>BEFORE</span><span className={styles.tagAfter}>AFTER</span>
                  <input className={styles.splitInput} type="range" min="0" max="100" value={split} onChange={(event) => setSplit(Number(event.target.value))} aria-label="Compare before and after" />
                </div>
                <section className={styles.controls}>
                  <label className={styles.edgeControl}>
                    <span><strong>Edge</strong><b>{edge < 35 ? "Soft" : edge < 70 ? "Balanced" : "Hard"}</b></span>
                    <input type="range" min="0" max="100" value={edge} onChange={(event) => setEdge(Number(event.target.value))} />
                    <small>Soft keeps fine hair and blur. Hard removes halos around clean shapes.</small>
                  </label>
                  <div className={styles.backdrops} role="radiogroup" aria-label="Preview background">
                    <p>BACKGROUND</p>
                    {(["transparent", "white", "black"] as const).map((option) => (
                      <button key={option} type="button" role="radio" aria-checked={backdrop === option} onClick={() => setBackdrop(option)} className={styles[`swatch_${option}`]} aria-label={`${option} background`} />
                    ))}
                    <label className={styles.colorSwatch} aria-checked={backdrop === "custom"} role="radio">
                      <input type="color" value={customColor} aria-label="Custom background colour" onChange={(event) => { setCustomColor(event.target.value); setBackdrop("custom"); }} onClick={() => setBackdrop("custom")} />
                    </label>
                  </div>
                  <div className={styles.exports}>
                    <button className={base.primaryAction} type="button" onClick={() => exportImage("transparent")}>Download transparent PNG<span>↓</span></button>
                    <button type="button" onClick={() => exportImage("backdrop")} disabled={!backdropColor}>PNG with this background</button>
                    <button type="button" onClick={() => exportImage("mask")}>Matte (mask) PNG</button>
                  </div>
                  <button className={base.textAction} type="button" onClick={() => { setError(null); setPhase("source-ready"); }}>Run again with another engine</button>
                  {error ? <p className={base.error} role="alert">{error}</p> : null}
                </section>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
