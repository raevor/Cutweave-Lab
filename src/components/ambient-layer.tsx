"use client";

import { useEffect, useRef } from "react";
import styles from "./ambient-layer.module.css";

/*
 * A quiet, animated background for long sections: editing marks (markers,
 * crop corners, clips, keyframes) drift slowly, follow the scroll with a little
 * parallax and brighten near the pointer. Place it as the first child of a
 * section; the section gets `isolation: isolate` so the layer stays behind
 * the content.
 */

type Glyph = { x: number; y: number; vx: number; vy: number; size: number; rot: number; vr: number; kind: number; color: number; depth: number; alpha: number };

const KINDS = 6;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function AmbientLayer({ seed = 7, density = 1 }: { seed?: number; density?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    /* Canvas -> sticky wrapper -> section. */
    const host = canvas?.parentElement?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let colors: string[] = [];
    let width = 0;
    let height = 0;
    /* The canvas only covers the viewport, not the whole section. */
    let viewH = 0;
    let dpr = 1;
    let glyphs: Glyph[] = [];
    let frame: number | null = null;
    let visible = false;
    let last = performance.now();
    /* Pointer in viewport coordinates; converted to canvas coordinates once per frame in draw(). */
    const pointer = { x: -9999, y: -9999 };

    const readColors = () => {
      const cs = getComputedStyle(canvas);
      colors = ["--amb-face", "--amb-anime", "--amb-bass", "--amb-playhead"].map((n) => cs.getPropertyValue(n).trim() || "#8890a8");
    };

    const build = () => {
      const random = seeded(seed * 9973 + 1);
      const count = Math.round(Math.min(70, Math.max(12, (width * height) / 24000)) * density);
      glyphs = Array.from({ length: count }, () => ({
        x: random() * width,
        y: random() * height,
        vx: (random() - 0.5) * 6,
        vy: -3 - random() * 7,
        size: 10 + random() * 14,
        rot: random() * Math.PI * 2,
        vr: (random() - 0.5) * 0.25,
        kind: Math.floor(random() * KINDS),
        color: Math.floor(random() * 4),
        depth: 0.08 + random() * 0.22,
        alpha: 0.2 + random() * 0.22,
      }));
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      /* Decorative marks: rendering at 1x keeps a viewport-sized canvas cheap on high-density screens. */
      dpr = 1;
      const sizeChanged = Math.abs(rect.width - width) > 1 || Math.abs(rect.height - height) > 40;
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      viewH = Math.max(1, Math.min(height, window.innerHeight));
      /* Assigning canvas dimensions reallocates the bitmap, so only do it when they change. */
      const nextW = Math.round(width * dpr);
      const nextH = Math.round(viewH * dpr);
      if (canvas.width !== nextW) canvas.width = nextW;
      if (canvas.height !== nextH) canvas.height = nextH;
      if (sizeChanged || glyphs.length === 0) build();
      draw();
    };

    const glyph = (g: Glyph) => {
      const s = g.size;
      ctx.beginPath();
      switch (g.kind) {
        case 0: /* Marker: flag and stem. */
          ctx.moveTo(-s * 0.5, -s * 0.6); ctx.lineTo(s * 0.5, -s * 0.6); ctx.lineTo(0, -s * 0.1); ctx.closePath();
          ctx.fill();
          ctx.fillRect(-0.75, -s * 0.15, 1.5, s * 1.1);
          return;
        case 1: { /* Crop corners. */
          const a = s * 0.32;
          const h = s * 0.6;
          ctx.moveTo(-h, -h + a); ctx.lineTo(-h, -h); ctx.lineTo(-h + a, -h);
          ctx.moveTo(h - a, -h); ctx.lineTo(h, -h); ctx.lineTo(h, -h + a);
          ctx.moveTo(h, h - a); ctx.lineTo(h, h); ctx.lineTo(h - a, h);
          ctx.moveTo(-h + a, h); ctx.lineTo(-h, h); ctx.lineTo(-h, h - a);
          ctx.stroke();
          return;
        }
        case 2: /* Clip. */
          ctx.roundRect(-s, -s * 0.3, s * 2, s * 0.6, 3);
          ctx.stroke();
          ctx.fillRect(-s, -s * 0.3, s * 2, 1.6);
          return;
        case 3: /* Keyframe diamond. */
          ctx.moveTo(0, -s * 0.5); ctx.lineTo(s * 0.5, 0); ctx.lineTo(0, s * 0.5); ctx.lineTo(-s * 0.5, 0); ctx.closePath();
          ctx.stroke();
          return;
        case 4: /* Waveform blip. */
          [0.3, 0.7, 1, 0.55, 0.35].forEach((h, i) => ctx.fillRect(-s * 0.5 + i * s * 0.25, -s * 0.5 * h, s * 0.13, s * h));
          return;
        default: /* Cut point. */
          ctx.moveTo(-s * 0.45, 0); ctx.lineTo(s * 0.45, 0);
          ctx.moveTo(0, -s * 0.45); ctx.lineTo(0, s * 0.45);
          ctx.stroke();
      }
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, viewH);
      const rect = host.getBoundingClientRect();
      const scroll = rect.top;
      /* Where the sticky canvas currently sits inside the section. */
      const offset = Math.min(Math.max(0, -rect.top), Math.max(0, height - viewH));
      /* The sticky canvas starts at the section top plus that offset. */
      const canvasTop = rect.top + offset;
      const pointerX = pointer.x - rect.left;
      const pointerY = pointer.y - canvasTop;

      ctx.lineWidth = 1.8;
      ctx.lineCap = "round";
      for (const g of glyphs) {
        const py = ((g.y + scroll * g.depth) % height + height) % height - offset;
        if (py < -30 || py > viewH + 30) continue;
        const dx = g.x - pointerX;
        const dy = py - pointerY;
        const near = Math.max(0, 1 - Math.hypot(dx, dy) / 190);
        ctx.save();
        ctx.translate(g.x + (dx / 190) * near * 18, py + (dy / 190) * near * 18);
        ctx.rotate(g.rot);
        ctx.globalAlpha = Math.min(0.85, g.alpha + near * 0.6);
        ctx.fillStyle = colors[g.color];
        ctx.strokeStyle = colors[g.color];
        glyph(g);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };

    const tick = (now: number) => {
      /* The marks drift a few pixels per second; 30 fps is plenty and halves the work. */
      if (now - last < 32) {
        frame = visible && !reduced.matches && !document.hidden ? requestAnimationFrame(tick) : null;
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const g of glyphs) {
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        g.rot += g.vr * dt;
        if (g.x < -20) g.x = width + 20;
        if (g.x > width + 20) g.x = -20;
      }
      draw();
      frame = visible && !reduced.matches && !document.hidden ? requestAnimationFrame(tick) : null;
    };

    const start = () => {
      if (frame === null && visible && !reduced.matches && !document.hidden) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };

    const onPointer = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      /* With motion reduced nothing drifts, but marks near the pointer still light up. */
      if (frame === null && visible) draw();
    };

    readColors();
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    window.addEventListener("resize", resize);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      start();
    });
    io.observe(host);
    const themeObserver = new MutationObserver(() => {
      readColors();
      draw();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const onVisibility = () => start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointermove", onPointer, { passive: true });
    const onScroll = () => { if (frame === null) draw(); };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", resize);
      io.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [seed, density]);

  return (
    <div className={styles.layer} aria-hidden="true">
      <canvas className={styles.canvas} ref={canvasRef} />
    </div>
  );
}
