"use client";

import { useEffect, useRef } from "react";
import { preload } from "react-dom";
import { namedPortraitSrc, OUTFIT_COUNT, PORTRAIT_BOX, portraitSrc, SUBTITLE_SPEAKER, type CharacterVariant } from "./character-portraits";
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
  subs: string;
  cut: string;
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

/* Every lane shares one grid of equal clips, so the tracks line up like an edit. */
const CLIP_LENGTH = 4.2;
const CLIP_GAP = 0.8;

function buildClips(seedBase: number, matchRate: number): Clip[] {
  const clips: Clip[] = [];
  for (let i = 0, t = CLIP_GAP; t + CLIP_LENGTH <= LOOP_SECONDS; i += 1, t += CLIP_LENGTH + CLIP_GAP) {
    const match = rand(seedBase + i * 5.3) < matchRate;
    clips.push({ start: t, length: CLIP_LENGTH, match, seed: seedBase + i, who: match ? 0 : rand(seedBase + i * 2.9) < 0.5 ? 1 : 2 });
  }
  return clips;
}

const FACE_CLIPS = buildClips(11, 0.45);
const ANIME_CLIPS = buildClips(53, 0.42);
/* Subtitle blocks: every block is speech, so all of them get written. */
const SUB_CLIPS = buildClips(97, 1);
/* Cut-out clips: stills whose background is keyed out as the playhead crosses them. */
const CUT_CLIPS = buildClips(131, 1);
/* One subject per still. Backdrops step by 3 through 8, cast by 1 through 4, so pairs keep changing. */
const CUT_CAST = ["kian", "noor", "theo", "yara"];
type Backdrop = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;

function gradient(ctx: CanvasRenderingContext2D, y: number, h: number, stops: string[]) {
  const fill = ctx.createLinearGradient(0, y, 0, y + h);
  stops.forEach((color, index) => fill.addColorStop(index / (stops.length - 1), color));
  return fill;
}

function ridge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, low: number, high: number, step: number) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  for (let px = 0; px <= w + step; px += step) ctx.lineTo(x + px, y + h * ((px / step) % 2 ? high : low));
  ctx.lineTo(x + w + step, y + h);
  ctx.closePath();
  ctx.fill();
}

const CUT_BACKDROPS: Backdrop[] = [
  /* Dusk mountains. */
  (ctx, x, y, w, h) => {
    ctx.fillStyle = gradient(ctx, y, h, ["#36447e", "#d9826f", "#f6c48a"]);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#ffe7b4";
    ctx.beginPath(); ctx.arc(x + w * 0.8, y + h * 0.42, h * 0.15, 0, Math.PI * 2); ctx.fill();
    ridge(ctx, x, y, w, h, "#7a6aa0", 0.62, 0.4, 30);
    ctx.fillStyle = "#4f7d6a"; ctx.fillRect(x, y + h * 0.82, w, h * 0.18);
  },
  /* City at night with lit windows. */
  (ctx, x, y, w, h) => {
    ctx.fillStyle = gradient(ctx, y, h, ["#0f1633", "#2a2f5e", "#4a3f73"]);
    ctx.fillRect(x, y, w, h);
    for (let bx = 0, i = 0; bx < w; bx += 14 + (i % 3) * 6, i += 1) {
      const bh = h * (0.35 + rand(i * 3.7) * 0.45);
      const bw = 12 + (i % 3) * 6;
      ctx.fillStyle = "#1a1f3d";
      ctx.fillRect(x + bx, y + h - bh, bw, bh);
      ctx.fillStyle = "#f7d27a";
      for (let wy = y + h - bh + 4; wy < y + h - 3; wy += 6) if (rand(bx * 1.3 + wy) > 0.55) ctx.fillRect(x + bx + 3, wy, 2, 2);
    }
  },
  /* Beach: sky, sea and sand. */
  (ctx, x, y, w, h) => {
    ctx.fillStyle = gradient(ctx, y, h, ["#7cc4ea", "#c8ecf6"]);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#2f8fb8"; ctx.fillRect(x, y + h * 0.55, w, h * 0.2);
    ctx.fillStyle = "#e9d4a4"; ctx.fillRect(x, y + h * 0.75, w, h * 0.25);
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)"; ctx.fillRect(x, y + h * 0.74, w, 1.5);
  },
  /* Studio backdrop with soft light spots. */
  (ctx, x, y, w, h) => {
    ctx.fillStyle = gradient(ctx, y, h, ["#5b3f86", "#b45a8c"]);
    ctx.fillRect(x, y, w, h);
    for (let i = 0; i < 6; i += 1) {
      ctx.fillStyle = `rgba(255, 220, 240, ${0.12 + rand(i * 5.1) * 0.15})`;
      ctx.beginPath(); ctx.arc(x + rand(i * 2.3) * w, y + rand(i * 7.9) * h, h * (0.12 + rand(i) * 0.12), 0, Math.PI * 2); ctx.fill();
    }
  },
  /* Pine forest. */
  (ctx, x, y, w, h) => {
    ctx.fillStyle = gradient(ctx, y, h, ["#a9d6c2", "#5f9a7d"]);
    ctx.fillRect(x, y, w, h);
    for (let tx = -6, i = 0; tx < w + 10; tx += 16, i += 1) {
      const th = h * (0.45 + rand(i * 4.4) * 0.35);
      ctx.fillStyle = i % 2 ? "#2f5f47" : "#3d7458";
      ctx.beginPath(); ctx.moveTo(x + tx, y + h - th); ctx.lineTo(x + tx + 10, y + h); ctx.lineTo(x + tx - 10, y + h); ctx.closePath(); ctx.fill();
    }
  },
  /* Desert dunes under a warm sky. */
  (ctx, x, y, w, h) => {
    ctx.fillStyle = gradient(ctx, y, h, ["#f3b06b", "#f7d9a0"]);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#fff1c9";
    ctx.beginPath(); ctx.arc(x + w * 0.25, y + h * 0.35, h * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#d9944f";
    ctx.beginPath(); ctx.ellipse(x + w * 0.3, y + h, w * 0.5, h * 0.36, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "#c27a3c";
    ctx.beginPath(); ctx.ellipse(x + w * 0.85, y + h, w * 0.45, h * 0.28, 0, Math.PI, 0); ctx.fill();
  },
  /* Snowy peaks. */
  (ctx, x, y, w, h) => {
    ctx.fillStyle = gradient(ctx, y, h, ["#9fbfe0", "#e4eef7"]);
    ctx.fillRect(x, y, w, h);
    ridge(ctx, x, y, w, h, "#7f93ad", 0.7, 0.3, 26);
    ridge(ctx, x, y, w, h, "#f4f8fc", 0.92, 0.6, 20);
  },
  /* Aurora night. */
  (ctx, x, y, w, h) => {
    ctx.fillStyle = gradient(ctx, y, h, ["#081329", "#13284a"]);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    for (let i = 0; i < 10; i += 1) ctx.fillRect(x + rand(i * 9.1) * w, y + rand(i * 3.3) * h * 0.5, 1.2, 1.2);
    ctx.strokeStyle = "rgba(110, 240, 180, 0.45)";
    ctx.lineWidth = h * 0.12;
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.45);
    ctx.bezierCurveTo(x + w * 0.3, y + h * 0.1, x + w * 0.6, y + h * 0.6, x + w, y + h * 0.25);
    ctx.stroke();
    ridge(ctx, x, y, w, h, "#0b1a2e", 0.85, 0.7, 24);
  },
];
const SUB_LINES = [
  "We start by the river.", "Keep the camera low.", "Then cut to the bridge.", "That's our opening shot.",
  "Hold on her face.", "One more take.", "Let the music breathe.", "Now we are rolling.",
  "Bring it in slowly.", "Cut on the beat.", "Again, from the top.", "That's a wrap.",
];

/* Portrait images shared by every timeline on the page; each loads once. */
const imageCache = new Map<string, HTMLImageElement>();
/*
 * Portraits load and decode off the main thread. A sprite is only built from a
 * decoded image, so drawing it never stalls a frame on a synchronous decode.
 */
const decodedImages = new WeakSet<HTMLImageElement>();

function portraitImage(src: string, onLoad: () => void) {
  let image = imageCache.get(src);
  if (!image) {
    const created = new Image();
    created.decoding = "async";
    created.src = src;
    created.decode().then(() => decodedImages.add(created), () => undefined).finally(onLoad);
    imageCache.set(src, created);
    image = created;
  }
  return decodedImages.has(image) ? image : null;
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
  if (!image) return null;
  if (spriteCache.size > 64) spriteCache.clear();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(100 * scale * dpr);
  canvas.height = Math.ceil(120 * scale * dpr);
  const g = canvas.getContext("2d");
  if (g) {
    g.scale(scale * dpr, scale * dpr);
    /* A filter greys the sprite on the GPU; reading pixels back would stall the frame. */
    if (gray) g.filter = "grayscale(1) contrast(.7) brightness(1.15)";
    g.drawImage(image, PORTRAIT_BOX.x, PORTRAIT_BOX.y, PORTRAIT_BOX.width, PORTRAIT_BOX.height);
  }
  spriteCache.set(key, canvas);
  return canvas;
}

/* A named portrait (outside the matching cast) as a filmstrip thumbnail. */
function namedSprite(name: string, scale: number, dpr: number, onLoad: () => void) {
  const key = `named:${name}:${scale.toFixed(3)}:${dpr}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const image = portraitImage(namedPortraitSrc(name, true), onLoad);
  if (!image) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(100 * scale * dpr);
  canvas.height = Math.ceil(120 * scale * dpr);
  const g = canvas.getContext("2d");
  if (g) {
    g.scale(scale * dpr, scale * dpr);
    g.drawImage(image, PORTRAIT_BOX.x, PORTRAIT_BOX.y, PORTRAIT_BOX.width, PORTRAIT_BOX.height);
  }
  spriteCache.set(key, canvas);
  return canvas;
}

/* The subtitle speaker's face, cropped into a round avatar; grey until her line is heard. */
function speakerAvatar(size: number, dpr: number, gray: boolean, onLoad: () => void) {
  const key = `speaker:${size.toFixed(1)}:${dpr}:${gray ? 1 : 0}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const image = portraitImage(namedPortraitSrc(SUBTITLE_SPEAKER, true), onLoad);
  if (!image) return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.ceil(size * dpr);
  const g = canvas.getContext("2d");
  if (g) {
    /* The whole head, hair included, with the top of the hoodie: the 176 x 176 square at (32, 14) of the 240 x 260 portrait. */
    const unit = image.naturalWidth / 240;
    g.beginPath();
    g.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
    g.clip();
    if (gray) g.filter = "grayscale(1) contrast(.6) brightness(1.05)";
    g.fillStyle = "#eee1d8";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(image, 32 * unit, 14 * unit, 176 * unit, 176 * unit, 0, 0, canvas.width, canvas.height);
  }
  spriteCache.set(key, canvas);
  return canvas;
}

/* One 12 x 12 tile of 6 px squares, reused as a pattern instead of hundreds of rects a frame. */
let checkerCache: { key: string; pattern: CanvasPattern | null } | null = null;
function checkerPattern(ctx: CanvasRenderingContext2D, a: string, b: string) {
  const key = `${a}|${b}`;
  if (checkerCache?.key === key) return checkerCache.pattern;
  const tile = document.createElement("canvas");
  tile.width = tile.height = 12;
  const g = tile.getContext("2d");
  if (g) {
    g.fillStyle = b;
    g.fillRect(0, 0, 12, 12);
    g.fillStyle = a;
    g.fillRect(6, 0, 6, 6);
    g.fillRect(0, 6, 6, 6);
  }
  checkerCache = { key, pattern: ctx.createPattern(tile, "repeat") };
  return checkerCache.pattern;
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
    subs: v("--tl-subs", "#52b6e8"),
    cut: v("--tl-cut", "#ec8dbd"),
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

/* A small verdict chip that drops into the clip corner. */
function drawTag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, ink: string, laneH: number, font: string, since: number, alignRight: boolean) {
  const size = Math.round(Math.max(8, Math.min(10, laneH * 0.19)));
  const appear = Math.min(1, since / 0.2);
  ctx.font = `700 ${size}px ${font}`;
  const tw = ctx.measureText(text).width + 8;
  const th = size + 6;
  const left = alignRight ? x - tw : x;
  const top = y - 4 * (1 - appear);
  ctx.globalAlpha = appear;
  ctx.fillStyle = fill;
  roundRect(ctx, left, top, tw, th, 3);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + 4, top + th / 2 + 0.5);
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

/* Every thumbnail the lanes draw, so the server can list them for an early download. */
const LANE_PORTRAITS = [
  ...(["person", "character"] as const).flatMap((kind) => [
    ...([0, 1, 2] as const).map((who) => portraitSrc(kind, who, undefined, true)),
    ...Array.from({ length: OUTFIT_COUNT }, (_, outfit) => portraitSrc(kind, 0, outfit, true)),
  ]),
  ...[...CUT_CAST, SUBTITLE_SPEAKER].map((name) => namedPortraitSrc(name, true)),
];

export function TimelineBackdrop({ className, scrubTarget }: TimelineBackdropProps) {
  /* Start the thumbnails with the page instead of after hydration, so clips are not drawn empty. */
  LANE_PORTRAITS.forEach((src) => preload(src, { as: "image", fetchPriority: "low" }));
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

    /* Position only changes on resize, so pointer moves never force a layout. */
    let wrapLeft = 0;
    let wrapPageTop = 0;
    /* The timeline band (timecode, ruler and lanes) in wrapper pixels; only it scrubs. */
    let bandTop = 0;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      wrapLeft = rect.left;
      wrapPageTop = rect.top + window.scrollY;
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

      const lanes: Array<{ key: "face" | "anime" | "bass" | "subs" | "cut"; label: string; color: string }> = [
        { key: "face", label: "Face", color: palette.face },
        { key: "anime", label: "Anime", color: palette.anime },
        { key: "bass", label: "Bass", color: palette.bass },
        { key: "subs", label: "Subs", color: palette.subs },
        { key: "cut", label: "Cutout", color: palette.cut },
      ];

      const rulerH = 26;
      const laneGap = 7;
      /* Five lanes share about 30% of the hero, so the stack never climbs under the hero buttons. */
      const laneH = Math.min(52, Math.max(30, (height * 0.3 - rulerH) / lanes.length - laneGap));
      const stackH = rulerH + (laneH + laneGap) * lanes.length;
      const top = height - stackH - Math.min(44, height * 0.05);
      bandTop = top - 34;
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
        } else if (lane.key === "cut") {
          /*
           * One subject per still, each in front of its own backdrop. Left of the playhead the
           * background is already keyed out to transparency; right of it the
           * still waits untouched, so the playhead reads as the cut being made.
           */
          const loopBase = Math.floor(tOf(labelW) / LOOP_SECONDS) * LOOP_SECONDS;
          const scale = (laneH * 1.05) / 120;
          const thumbW = 100 * scale;
          for (let base = loopBase - LOOP_SECONDS; base < tOf(width) + LOOP_SECONDS; base += LOOP_SECONDS) {
            for (const [index, clip] of CUT_CLIPS.entries()) {
              const x = xOf(base + clip.start);
              const w = clip.length * pps;
              if (x > width || x + w < labelW) continue;
              ctx.save();
              roundRect(ctx, x + 1, y, w - 2, laneH, 6);
              ctx.clip();
              ctx.globalAlpha = 1;
              CUT_BACKDROPS[(index * 3) % CUT_BACKDROPS.length](ctx, x, y, w, laneH);
              /* The keyed part: transparency shown as a checkerboard. */
              const keyedEnd = Math.min(headX, x + w);
              if (keyedEnd > x) {
                const checker = checkerPattern(ctx, palette.clip, palette.line);
                if (checker) {
                  /* Anchor the pattern to the clip so the squares travel with it. */
                  checker.setTransform(new DOMMatrix([1, 0, 0, 1, x, y]));
                  ctx.fillStyle = checker;
                  ctx.fillRect(x, y, keyedEnd - x, laneH);
                }
              }
              const sprite = namedSprite(CUT_CAST[index % CUT_CAST.length], scale, dpr, requestRedraw);
              if (sprite) ctx.drawImage(sprite, x + w / 2 - thumbW / 2, y + laneH - 120 * scale + 3, thumbW, 120 * scale);
              ctx.restore();
              ctx.globalAlpha = 1;
              ctx.fillStyle = lane.color;
              ctx.fillRect(x + 1, y, w - 2, 2);
            }
          }
        } else if (lane.key === "subs") {
          /*
           * Caption blocks: the speaker's avatar, the line and the speech under it.
           * Ahead of the playhead the speech waits in grey; as the playhead crosses a
           * block its speech lights up and the line is typed with a cursor.
           */
          const loopBase = Math.floor(tOf(labelW) / LOOP_SECONDS) * LOOP_SECONDS;
          const avatar = laneH - 16;
          const fontSize = Math.round(Math.min(13, laneH * 0.24));
          for (let base = loopBase - LOOP_SECONDS; base < tOf(width) + LOOP_SECONDS; base += LOOP_SECONDS) {
            SUB_CLIPS.forEach((clip, index) => {
              const cs = base + clip.start;
              const x = xOf(cs);
              const w = clip.length * pps;
              if (x > width || x + w < labelW) return;
              const heard = headTime >= cs;
              const written = Math.min(1, Math.max(0, (headTime - cs) / (clip.length * 0.75)));

              ctx.globalAlpha = 1;
              ctx.fillStyle = palette.clip;
              roundRect(ctx, x + 1, y, w - 2, laneH, 6);
              ctx.fill();
              ctx.fillStyle = lane.color;
              ctx.globalAlpha = heard ? 0.24 : 0.07;
              ctx.fill();
              ctx.globalAlpha = heard ? 1 : 0.5;
              ctx.fillRect(x + 1, y, w - 2, 2);

              ctx.save();
              roundRect(ctx, x + 1, y, w - 2, laneH, 6);
              ctx.clip();
              const showAvatar = w > avatar + 56;
              const tx = x + 8 + (showAvatar ? avatar + 9 : 2);
              if (showAvatar) {
                const sprite = speakerAvatar(avatar, dpr, !heard, requestRedraw);
                if (sprite) {
                  ctx.globalAlpha = heard ? 1 : 0.55;
                  ctx.drawImage(sprite, x + 8, y + 8, avatar, avatar);
                  ctx.globalAlpha = heard ? 0.9 : 0.35;
                  ctx.strokeStyle = heard ? lane.color : palette.muted;
                  ctx.lineWidth = 1.5;
                  ctx.beginPath();
                  ctx.arc(x + 8 + avatar / 2, y + 8 + avatar / 2, avatar / 2, 0, Math.PI * 2);
                  ctx.stroke();
                }
              }

              /* The speech: syllable-like bars that light up as they are heard. */
              const barsTop = y + laneH * 0.58;
              const barsH = laneH * 0.3;
              const right = x + w - 10;
              for (let bx = tx, i = 0; bx < right; bx += 3, i += 1) {
                const syllable = Math.abs(Math.sin(i * 0.55 + clip.seed)) * (0.35 + 0.65 * rand(clip.seed * 31 + i));
                const pause = Math.sin(i * 0.17 + clip.seed * 2) > 0.82 ? 0.15 : 1;
                const a = Math.max(1.5, syllable * pause * barsH);
                const lit = bx < headX;
                ctx.globalAlpha = lit ? 0.85 : 0.22;
                ctx.fillStyle = lit ? lane.color : palette.muted;
                ctx.fillRect(bx, barsTop + (barsH - a) / 2, 2, a);
              }

              ctx.font = `600 ${fontSize}px ${palette.sans}`;
              ctx.textBaseline = "middle";
              const textY = y + laneH * 0.33;
              if (written > 0) {
                const full = SUB_LINES[(clip.seed + index) % SUB_LINES.length];
                /* A line wider than its block ends in an ellipsis, as an NLE caption track shows it. */
                let line = full;
                while (line.length > 1 && ctx.measureText(line).width > right - tx) line = line.slice(0, -1);
                if (line !== full) line = `${line.trimEnd()}…`;
                const typed = line.slice(0, Math.ceil(line.length * written));
                ctx.globalAlpha = 1;
                ctx.fillStyle = palette.ink;
                ctx.fillText(typed, tx, textY);
                if (written < 1 && Math.floor(headTime * 3) % 2 === 0) {
                  ctx.fillStyle = lane.color;
                  ctx.fillRect(tx + ctx.measureText(typed).width + 2, textY - fontSize / 2, 2, fontSize);
                }
              } else {
                /* Not heard yet: where the line will be written. */
                ctx.globalAlpha = 0.22;
                ctx.fillStyle = palette.muted;
                roundRect(ctx, tx, textY - 3, Math.max(8, Math.min(right - tx, (right - tx) * 0.62)), 6, 3);
                ctx.fill();
              }
              ctx.restore();
            });
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
              /*
               * Each clip is checked as the playhead crosses it: a scan line sweeps the
               * face, then the clip either locks on (match) or greys out (no match).
               */
              const t = headTime - cs;
              const decideAt = Math.min(clip.length * 0.5, 0.8);
              const scanning = t >= 0 && t < decideAt;
              const since = t - decideAt;
              const matched = clip.match && since >= 0;
              const rejected = !clip.match && since >= 0;
              const scale = (laneH * 1.05) / 120;
              const faceW = 50 * scale;
              const faceX = x + w / 2 - faceW / 2;
              const faceTop = Math.max(y + 3, y + laneH - 120 * scale + 3 + 14 * scale);
              const faceH = Math.min(y + laneH - 3 - faceTop, 62 * scale);

              ctx.globalAlpha = 1;
              ctx.fillStyle = palette.clip;
              roundRect(ctx, x + 1, y, w - 2, laneH, 6);
              ctx.fill();
              ctx.fillStyle = lane.color;
              ctx.globalAlpha = matched ? 0.3 : rejected ? 0.05 : 0.14;
              ctx.fill();
              /* The lock flashes the clip, then settles. */
              if (matched && since < 0.5) {
                ctx.globalAlpha = 0.4 * (1 - since / 0.5);
                ctx.fill();
              }

              ctx.save();
              roundRect(ctx, x + 1, y, w - 2, laneH, 6);
              ctx.clip();
              if (rejected) {
                /* Rejected clips are hatched out, like a disabled clip in an NLE. */
                ctx.globalAlpha = 0.1;
                ctx.strokeStyle = palette.reject;
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let hx = x - laneH; hx < x + w; hx += 7) {
                  ctx.moveTo(hx, y + laneH);
                  ctx.lineTo(hx + laneH, y);
                }
                ctx.stroke();
              }
              /* Matched clips show the reference character in one of its outfits, varied per clip. */
              const look = clip.seed % (OUTFIT_COUNT + 1);
              const outfit = clip.who === 0 && look < OUTFIT_COUNT ? look : undefined;
              const sprite = characterSprite(lane.key as "face" | "anime", clip.who, outfit, scale, dpr, rejected, requestRedraw);
              if (sprite) {
                /* A rejected face shakes its head once. */
                const shake = rejected && since < 0.35 ? Math.sin(since * 55) * 3 * (1 - since / 0.35) : 0;
                ctx.globalAlpha = matched ? 1 : rejected ? 0.45 : 0.85;
                ctx.drawImage(sprite, x + w / 2 - 50 * scale + shake, y + laneH - 120 * scale + 3, 100 * scale, 120 * scale);
              }
              if (scanning) {
                const sy = faceTop + faceH * (t / decideAt);
                ctx.fillStyle = lane.color;
                ctx.globalAlpha = 0.22;
                ctx.fillRect(faceX - 4, sy - 7, faceW + 8, 7);
                ctx.globalAlpha = 0.95;
                ctx.fillRect(faceX - 7, sy, faceW + 14, 1.5);
                ctx.strokeStyle = lane.color;
                ctx.lineWidth = 1.2;
                ctx.setLineDash([3, 3]);
                ctx.lineDashOffset = -t * 30;
                ctx.globalAlpha = 0.8;
                ctx.strokeRect(faceX - 3, faceTop - 2, faceW + 6, faceH + 4);
                ctx.setLineDash([]);
              }
              ctx.restore();

              ctx.globalAlpha = rejected ? 0.6 : 0.9;
              ctx.fillStyle = rejected ? palette.reject : lane.color;
              ctx.fillRect(x + 1, y, w - 2, 2);

              if (matched) {
                /* The brackets close in from the clip edges onto the face, with a small overshoot. */
                const k = Math.min(1, since / 0.35);
                const ease = 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2;
                const fromX = x + 6;
                const fromY = y + 4;
                const fromW = w - 12;
                const fromH = laneH - 8;
                ctx.globalAlpha = 1;
                ctx.strokeStyle = palette.playhead;
                ctx.lineWidth = 2;
                drawReticle(ctx, fromX + (faceX - fromX) * ease, fromY + (faceTop - fromY) * ease, fromW + (faceW - fromW) * ease, fromH + (faceH - fromH) * ease, 1);
                if (since < 0.6) {
                  ctx.globalAlpha = 0.55 * (1 - since / 0.6);
                  ctx.lineWidth = 1.5;
                  ctx.beginPath();
                  ctx.arc(faceX + faceW / 2, faceTop + faceH / 2, (faceW / 2) * (1 + since * 2.4), 0, Math.PI * 2);
                  ctx.stroke();
                }
                drawTag(ctx, x + 6, y + 6, "MATCH", palette.playhead, "#1b1206", laneH, palette.mono, since, false);
              }
              if (rejected) drawTag(ctx, x + w - 6, y + 6, "NO MATCH", palette.reject, "#fff", laneH, palette.mono, since, true);
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
      /* Above the timeline (hero copy and buttons) the playhead keeps its own pace. */
      const localY = event.pageY - wrapPageTop;
      if (localY < bandTop || localY > height) {
        scrubX = null;
        return;
      }
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
