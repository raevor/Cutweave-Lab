"use client";

import { useEffect, useRef } from "react";
import { OUTFIT_COUNT, PORTRAIT_BOX, portraitSrc, type CharacterVariant } from "./character-portraits";
import styles from "./timeline-backdrop.module.css";

type TimelineBackdropProps = {
  className?: string;
  /** Element whose pointer movement scrubs the playhead. Defaults to the canvas wrapper. */
  scrubTarget?: React.RefObject<HTMLElement | null>;
};

type Palette = {
  face: string;
  anime: string;
  bass: string;
  playhead: string;
  ink: string;
  muted: string;
  line: string;
  clip: string;
  bg: string;
  reject: string;
  mono: string;
  sans: string;
};

type Clip = { start: number; length: number; match: boolean; seed: number; who: 0 | 1 | 2 };

const FPS = 25;
const PX_PER_SECOND = 46;

/* Deterministic pseudo-random so the timeline looks the same on every load. */
function rand(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const LOOP_SECONDS = 120;

/* Clips never overlap, and the last clip ends before the loop wraps. */
function buildClips(seedBase: number, minLen: number, maxLen: number, matchRate: number): Clip[] {
  const clips: Clip[] = [];
  let t = 0;
  for (let i = 0; ; i += 1) {
    const gap = 0.35 + rand(seedBase + i * 3.1) * 1.3;
    const length = minLen + rand(seedBase + i * 7.7) * (maxLen - minLen);
    if (t + gap + length > LOOP_SECONDS - 0.4) break;
    const match = rand(seedBase + i * 5.3) < matchRate;
    clips.push({ start: t + gap, length, match, seed: seedBase + i, who: match ? 0 : rand(seedBase + i * 2.9) < 0.5 ? 1 : 2 });
    t += gap + length;
  }
  return clips;
}

const FACE_CLIPS = buildClips(11, 2.4, 5.4, 0.45);
const ANIME_CLIPS = buildClips(53, 2, 4.6, 0.42);

/* Portrait images shared by every timeline on the page; each loads once. */
const imageCache = new Map<string, HTMLImageElement>();
function portraitImage(src: string, onLoad: () => void) {
  let image = imageCache.get(src);
  if (!image) {
    image = new Image();
    image.decoding = "async";
    image.src = src;
    imageCache.set(src, image);
  }
  if (!image.complete) image.addEventListener("load", onLoad, { once: true });
  return image;
}

/*
 * Each character is rendered once into its own small canvas and then drawn as
 * an image, so rejected clips can be greyed without touching the source.
 * Returns null until the portrait has loaded; onLoad asks for a redraw.
 */
const spriteCache = new Map<string, HTMLCanvasElement>();
function characterSprite(kind: "face" | "anime", who: CharacterVariant, outfit: number | undefined, scale: number, dpr: number, gray: boolean, onLoad: () => void) {
  const key = `${kind}:${who}:${outfit ?? "-"}:${scale.toFixed(3)}:${dpr}:${gray ? 1 : 0}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const image = portraitImage(portraitSrc(kind === "face" ? "person" : "character", who, outfit, true), onLoad);
  if (!image.complete || image.naturalWidth === 0) return null;
  if (spriteCache.size > 64) spriteCache.clear();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(100 * scale * dpr);
  canvas.height = Math.ceil(120 * scale * dpr);
  const g = canvas.getContext("2d");
  if (g) {
    g.scale(scale * dpr, scale * dpr);
    g.drawImage(image, PORTRAIT_BOX.x, PORTRAIT_BOX.y, PORTRAIT_BOX.width, PORTRAIT_BOX.height);
    if (gray) {
      const data = g.getImageData(0, 0, canvas.width, canvas.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const l = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
        px[i] = px[i + 1] = px[i + 2] = l * 0.7 + 60;
      }
      g.putImageData(data, 0, 0);
    }
  }
  spriteCache.set(key, canvas);
  return canvas;
}

/* Kick positions on a 118 BPM grid with a few syncopated hits. */
const BEAT = 60 / 118;
const KICKS: number[] = [];
for (let i = 0; i * BEAT < LOOP_SECONDS; i += 2) {
  /* Kicks on beats one and three, with an occasional pushed hit for groove. */
  if (i % 8 === 6 && rand(i) > 0.5) KICKS.push(i * BEAT + BEAT * 1.5);
  else if (rand(i * 1.7) > 0.12) KICKS.push(i * BEAT);
}

function timecode(seconds: number) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const f = Math.floor((total % 1) * FPS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    face: v("--tl-face", "#9b87f5"),
    anime: v("--tl-anime", "#5fd6b7"),
    bass: v("--tl-bass", "#f0806a"),
    playhead: v("--tl-playhead", "#f4b443"),
    ink: v("--tl-ink", "#e9ecf5"),
    muted: v("--tl-muted", "#8e95ab"),
    line: v("--tl-line", "#2c3346"),
    clip: v("--tl-clip", "#1d2333"),
    bg: v("--tl-bg", "#141926"),
    reject: v("--tl-reject", "#e5534b"),
    mono: v("--font-jetbrains", "ui-monospace") + ", ui-monospace, monospace",
    sans: v("--font-archivo", "Arial") + ", Arial, sans-serif",
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawReticle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, progress: number) {
  const arm = Math.min(w, h) * 0.32 * progress;
  ctx.beginPath();
  ctx.moveTo(x, y + arm); ctx.lineTo(x, y); ctx.lineTo(x + arm, y);
  ctx.moveTo(x + w - arm, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + arm);
  ctx.moveTo(x + w, y + h - arm); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - arm, y + h);
  ctx.moveTo(x + arm, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - arm);
  ctx.stroke();
}

function waveform(t: number) {
  let nearest = Infinity;
  for (const k of KICKS) {
    const d = t - k;
    if (d >= 0 && d < nearest) nearest = d;
  }
  const kick = nearest < 0.45 ? Math.exp(-nearest * 9) : 0;
  const bed = 0.16 + 0.08 * Math.sin(t * 2.1) * Math.sin(t * 0.37 + 1);
  const texture = 0.07 * Math.sin(t * 47) * Math.sin(t * 13.3);
  return Math.min(1, bed + Math.abs(texture) + kick * 0.85);
}

export function TimelineBackdrop({ className, scrubTarget }: TimelineBackdropProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let palette = readPalette(wrap);
    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame: number | null = null;
    let visible = true;
    let last = performance.now();
    let clock = 14.2;
    let scrubX: number | null = null;
    let playheadFrac = 0.62;

    /* Horizontal position only changes on resize, so pointer moves never force a layout. */
    let wrapLeft = 0;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      wrapLeft = rect.left;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (reducedMotion.matches || !frame) draw();
    };

    /* Portraits load asynchronously; a paused or reduced-motion timeline redraws once they arrive. */
    const requestRedraw = () => {
      if (reducedMotion.matches || !frame) draw();
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const compact = width < 720;
      const pps = PX_PER_SECOND * (compact ? 0.78 : 1);
      const headX = width * playheadFrac;
      const headTime = clock;
      const xOf = (t: number) => headX + (t - headTime) * pps;
      const tOf = (x: number) => headTime + (x - headX) / pps;

      const rulerH = 26;
      const laneH = Math.min(62, Math.max(40, height * 0.07));
      const laneGap = 10;
      const stackH = rulerH + laneH * 3 + laneGap * 3;
      const top = height - stackH - Math.min(44, height * 0.05);
      const labelW = compact ? 0 : 118;

      /* Vertical frame grid across the whole surface, fading upward for the hero. */
      const t0 = Math.floor(tOf(0));
      const t1 = Math.ceil(tOf(width));
      /* One gradient and two batched paths per frame instead of one per line. */
      const gridStyle = ctx.createLinearGradient(0, 0, 0, top + stackH);
      if (typeof gridStyle !== "string") {
        gridStyle.addColorStop(0, "transparent");
        gridStyle.addColorStop(0.55, palette.line);
        gridStyle.addColorStop(1, palette.line);
      }
      ctx.strokeStyle = gridStyle;
      ctx.lineWidth = 1;
      for (const major of [false, true]) {
        ctx.globalAlpha = major ? 0.55 : 0.22;
        ctx.beginPath();
        for (let s = t0; s <= t1; s += 1) {
          if ((s % 5 === 0) !== major) continue;
          const x = Math.round(xOf(s)) + 0.5;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, top + stackH);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      /* Ruler with frame ticks and timecodes. */
      ctx.fillStyle = palette.muted;
      ctx.font = `10px ${palette.mono}`;
      ctx.textBaseline = "middle";
      for (let s = t0; s <= t1; s += 1) {
        const x = xOf(s);
        ctx.globalAlpha = 0.85;
        if (s % 5 === 0 && x > labelW + 6) ctx.fillText(timecode(s).slice(3), x + 5, top + rulerH / 2);
        for (let f = 0; f < 5; f += 1) {
          const fx = x + (f / 5) * pps;
          ctx.globalAlpha = f === 0 ? 0.8 : 0.3;
          ctx.fillRect(Math.round(fx), top + rulerH - (f === 0 ? 8 : 4), 1, f === 0 ? 8 : 4);
        }
      }
      ctx.globalAlpha = 1;

      const lanes: Array<{ key: "face" | "anime" | "bass"; label: string; color: string }> = [
        { key: "face", label: "Face", color: palette.face },
        { key: "anime", label: "Anime", color: palette.anime },
        { key: "bass", label: "Bass", color: palette.bass },
      ];

      lanes.forEach((lane, index) => {
        const y = top + rulerH + laneGap + index * (laneH + laneGap);
        ctx.save();
        ctx.beginPath();
        ctx.rect(labelW, y, width - labelW, laneH);
        ctx.clip();

        if (lane.key === "bass") {
          /* Waveform body. */
          const mid = y + laneH / 2;
          ctx.fillStyle = lane.color;
          ctx.globalAlpha = 0.1;
          roundRect(ctx, labelW, y, width - labelW, laneH, 6);
          ctx.fill();
          ctx.globalAlpha = 0.85;
          const step = compact ? 4 : 3;
          for (let x = labelW; x < width; x += step) {
            const t = tOf(x);
            const loopT = ((t % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
            const a = waveform(loopT) * (laneH * 0.36);
            const passed = x < headX;
            ctx.globalAlpha = passed ? 0.55 : 0.24;
            ctx.fillRect(x, mid - a, step - 1, a * 2);
          }
          /* Markers on the kicks. */
          const loopBase = Math.floor(tOf(labelW) / LOOP_SECONDS) * LOOP_SECONDS;
          for (let base = loopBase; base < tOf(width) + LOOP_SECONDS; base += LOOP_SECONDS) {
            for (const k of KICKS) {
              const kt = base + k;
              const x = xOf(kt);
              if (x < labelW - 10 || x > width + 10) continue;
              const placed = kt <= headTime;
              const since = headTime - kt;
              ctx.globalAlpha = placed ? 1 : 0.5;
              ctx.fillStyle = placed ? palette.playhead : lane.color;
              ctx.beginPath();
              ctx.moveTo(x - 6, y + 1);
              ctx.lineTo(x + 6, y + 1);
              ctx.lineTo(x, y + 10);
              ctx.closePath();
              ctx.fill();
              ctx.globalAlpha = placed ? 0.8 : 0.3;
              ctx.fillRect(Math.round(x) - (placed ? 0.5 : 0), y + 9, placed ? 2 : 1, laneH - 10);
              if (placed && since < 0.5) {
                ctx.globalAlpha = (0.5 - since) * 1.6;
                ctx.strokeStyle = palette.playhead;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(x, y + 6, 6 + since * 34, 0, Math.PI * 2);
                ctx.stroke();
              }
            }
          }
        } else {
          const clips = lane.key === "face" ? FACE_CLIPS : ANIME_CLIPS;
          const loopBase = Math.floor(tOf(labelW) / LOOP_SECONDS) * LOOP_SECONDS;
          for (let base = loopBase - LOOP_SECONDS; base < tOf(width) + LOOP_SECONDS; base += LOOP_SECONDS) {
            for (const clip of clips) {
              const cs = base + clip.start;
              const x = xOf(cs);
              const w = clip.length * pps;
              if (x > width || x + w < labelW) continue;
              const reached = headTime >= cs + Math.min(clip.length * 0.5, 0.8);

              ctx.globalAlpha = 1;
              ctx.fillStyle = palette.clip;
              roundRect(ctx, x + 1, y, w - 2, laneH, 6);
              ctx.fill();
              ctx.fillStyle = lane.color;
              ctx.globalAlpha = clip.match && reached ? 0.34 : 0.14;
              ctx.fill();
              ctx.globalAlpha = 0.9;
              ctx.fillRect(x + 1, y, w - 2, 2);

              if (w > 40) {
                /* Thumbnails: the clip's character repeated like an NLE filmstrip, clipped to the clip. */
                const scale = (laneH * 1.05) / 120;
                const thumbW = 100 * scale;
                const step = thumbW * 0.92;
                const count = Math.max(1, Math.floor((w - 10) / step));
                const rejected = !clip.match && reached;
                /* Matched clips show the reference character in one of its outfits, varied per clip. */
                const look = clip.seed % (OUTFIT_COUNT + 1);
                const outfit = clip.who === 0 && look < OUTFIT_COUNT ? look : undefined;
                const sprite = characterSprite(lane.key, clip.who, outfit, scale, dpr, rejected, requestRedraw);
                if (sprite) {
                  ctx.save();
                  roundRect(ctx, x + 1, y, w - 2, laneH, 6);
                  ctx.clip();
                  ctx.globalAlpha = clip.match ? (reached ? 1 : 0.88) : rejected ? 0.5 : 0.85;
                  for (let i = 0; i < count; i += 1) {
                    ctx.drawImage(sprite, x + 5 + i * step, y + laneH - 120 * scale + 3, 100 * scale, 120 * scale);
                  }
                  ctx.restore();
                }
                if (!clip.match && reached) {
                  /* Rejected: a small cross in the clip's corner. */
                  const bx = x + w - 12;
                  const by = y + 11;
                  ctx.globalAlpha = 0.9;
                  ctx.fillStyle = palette.reject;
                  ctx.beginPath();
                  ctx.arc(bx, by, 7, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.strokeStyle = "#fff";
                  ctx.lineWidth = 1.8;
                  ctx.beginPath();
                  ctx.moveTo(bx - 2.8, by - 2.8); ctx.lineTo(bx + 2.8, by + 2.8);
                  ctx.moveTo(bx + 2.8, by - 2.8); ctx.lineTo(bx - 2.8, by + 2.8);
                  ctx.stroke();
                }
              }

              if (clip.match && reached) {
                const lock = Math.min(1, (headTime - cs) * 2.4);
                ctx.globalAlpha = 1;
                ctx.strokeStyle = palette.playhead;
                ctx.lineWidth = 2;
                /* The lock frames the first face only. */
                const scale = (laneH * 1.05) / 120;
                const faceTop = Math.max(y + 3, y + laneH - 120 * scale + 3 + 14 * scale);
                drawReticle(ctx, x + 5 + 25 * scale, faceTop, 50 * scale, Math.min(y + laneH - 3 - faceTop, 62 * scale), lock);
              }
            }
          }
        }
        ctx.restore();

        if (labelW) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = lane.color;
          ctx.fillRect(14, y + 10, 4, laneH - 20);
          ctx.fillStyle = palette.ink;
          ctx.font = `600 13px ${palette.sans}`;
          ctx.textBaseline = "middle";
          ctx.fillText(lane.label, 28, y + laneH / 2);
        }
      });

      /* Lanes the headline is pointing at stay bright; the others step back. */
      const focus = (scrubTarget?.current ?? wrap).dataset.laneFocus;
      if (focus) {
        lanes.forEach((lane, index) => {
          if (focus.split(",").includes(lane.key)) return;
          const y = top + rulerH + laneGap + index * (laneH + laneGap);
          ctx.globalAlpha = 0.72;
          ctx.fillStyle = palette.bg;
          ctx.fillRect(0, y - laneGap / 2, width, laneH + laneGap);
        });
        ctx.globalAlpha = 1;
      }

      /* Playhead. */
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.playhead;
      ctx.fillRect(Math.round(headX) - 1, top, 2, stackH);
      /* Soft glow without shadowBlur, which is costly on a large canvas. */
      ctx.globalAlpha = 0.18;
      ctx.fillRect(Math.round(headX) - 5, top + rulerH, 10, stackH - rulerH);
      ctx.globalAlpha = 0.1;
      ctx.fillRect(Math.round(headX) - 10, top + rulerH, 20, stackH - rulerH);
      ctx.globalAlpha = 1;
      const label = timecode(headTime);
      ctx.font = `600 12px ${palette.mono}`;
      const tw = ctx.measureText(label).width + 16;
      const lx = Math.min(width - tw - 6, Math.max(6, headX - tw / 2));
      roundRect(ctx, lx, top - 30, tw, 22, 4);
      ctx.fill();
      ctx.fillStyle = palette.bg;
      ctx.textBaseline = "middle";
      ctx.fillText(label, lx + 8, top - 19);
      ctx.fillStyle = palette.playhead;
      ctx.beginPath();
      ctx.moveTo(headX - 6, top - 8);
      ctx.lineTo(headX + 6, top - 8);
      ctx.lineTo(headX, top);
      ctx.closePath();
      ctx.fill();
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = scrubX !== null ? Math.min(0.88, Math.max(0.18, scrubX / width)) : 0.62;
      const before = playheadFrac;
      playheadFrac += (target - playheadFrac) * Math.min(1, dt * 6);
      /* Moving the playhead across the frame scrubs time, like dragging it in an editor. */
      clock += dt + ((playheadFrac - before) * width) / PX_PER_SECOND;
      draw();
      frame = visible && !document.hidden ? requestAnimationFrame(tick) : null;
    };

    const start = () => {
      if (reducedMotion.matches) { draw(); return; }
      if (frame === null && visible && !document.hidden) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start(); else stop();
    });
    io.observe(wrap);
    const themeWatch = new MutationObserver(() => {
      palette = readPalette(wrap);
      draw();
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const target = scrubTarget?.current ?? wrap;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      scrubX = event.clientX - wrapLeft;
      if (reducedMotion.matches) {
        /* No autoplay, but the pointer still scrubs the timeline directly. */
        const before = playheadFrac;
        playheadFrac = Math.min(0.88, Math.max(0.18, scrubX / width));
        clock += ((playheadFrac - before) * width) / PX_PER_SECOND;
        draw();
      }
    };
    const onLeave = () => { scrubX = null; };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerleave", onLeave);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    const onMotion = () => (reducedMotion.matches ? (stop(), draw()) : start());
    reducedMotion.addEventListener("change", onMotion);

    resize();
    start();

    return () => {
      stop();
      observer.disconnect();
      io.disconnect();
      themeWatch.disconnect();
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      reducedMotion.removeEventListener("change", onMotion);
    };
  }, [scrubTarget]);

  return (
    <div ref={wrapRef} className={`${styles.backdrop} ${className ?? ""}`} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
