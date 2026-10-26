"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { ToolSlug } from "@/lib/tool-catalog";
import { Portrait, SUBTITLE_SPEAKER, type CharacterKind } from "./character-portraits";
import styles from "./tool-illustration.module.css";

/*
 * Scenes that explain what each tool does. They are illustrations of the
 * workflow, not analysis output, and use original illustrated characters.
 */

type Props = { tool: ToolSlug; className?: string };

function Corners({ x, y, w, h, className, style }: { x: number; y: number; w: number; h: number; className?: string; style?: CSSProperties }) {
  const a = Math.min(w, h) * 0.26;
  return (
    <path
      className={className}
      style={style}
      d={`M ${x} ${y + a} V ${y} H ${x + a} M ${x + w - a} ${y} H ${x + w} V ${y + a} M ${x + w} ${y + h - a} V ${y + h} H ${x + w - a} M ${x + a} ${y + h} H ${x} V ${y + h - a}`}
    />
  );
}

/* Reference identity is variant 0, shown in other outfits; frames mix it with two other characters. */
const FRAMES: { who: 0 | 1 | 2; outfit?: number }[] = [
  { who: 0, outfit: 0 },
  { who: 1 },
  { who: 0, outfit: 1 },
  { who: 2 },
  { who: 0, outfit: 2 },
];

const CYCLE = 8;

const TRACK_X = 34;
const TRACK_W = 572;
const SLOT = TRACK_W / FRAMES.length;
const CHIP_W = 84;
const SCAN_START = 8;
const SCAN_SPAN = 60;

function pct(n: number) {
  return `${n.toFixed(2)}%`;
}

function MatchScene({ kind, id }: { kind: CharacterKind; id: string }) {
  const fw = 72;
  const fh = 100;
  const gap = 10;
  const x0 = 214;
  const y0 = 92;
  const scanFrom = x0 - 6;
  const scanDistance = FRAMES.length * (fw + gap) - gap + 12;
  const pass = FRAMES.map((_, i) => SCAN_START + (SCAN_SPAN * (x0 + i * (fw + gap) + fw / 2 - scanFrom)) / scanDistance);
  const matches = FRAMES.map((f, i) => ({ i, ok: f.who === 0 })).filter((f) => f.ok);
  const skipped = FRAMES.length - matches.length;
  const css = [
    `.${id}-scan{animation:${id}-scan ${CYCLE}s linear infinite}`,
    `@keyframes ${id}-scan{0%,${pct(SCAN_START)}{transform:translateX(0);opacity:0}${pct(SCAN_START + 1)}{opacity:1}${pct(SCAN_START + SCAN_SPAN)}{transform:translateX(${scanDistance}px);opacity:1}${pct(SCAN_START + SCAN_SPAN + 2)},100%{transform:translateX(${scanDistance}px);opacity:0}}`,
    ...pass.flatMap((p, i) => [
      `.${id}-v${i}{animation:${id}-v${i} ${CYCLE}s ease infinite}`,
      `@keyframes ${id}-v${i}{0%,${pct(p)}{opacity:0}${pct(p + 2)},90%{opacity:1}95%,100%{opacity:0}}`,
      `.${id}-b${i}{transform-box:fill-box;transform-origin:center;animation:${id}-b${i} ${CYCLE}s cubic-bezier(.3,1.6,.5,1) infinite}`,
      `@keyframes ${id}-b${i}{0%,${pct(p)}{transform:scale(0)}${pct(p + 3)},90%{transform:scale(1)}95%,100%{transform:scale(0)}}`,
    ]),
    `@media (prefers-reduced-motion:reduce){.${id} *{animation:none!important}.${id}-scan{opacity:0}}`,
  ].join("");

  return (
    <g className={id}>
      <style>{css}</style>
      <defs>
        <clipPath id={`${id}-ref`}><rect x="34" y="56" width="150" height="176" rx="12" /></clipPath>
        {FRAMES.map((_, i) => (
          <clipPath id={`${id}-f${i}`} key={i}><rect x={x0 + i * (fw + gap)} y={y0} width={fw} height={fh} rx="8" /></clipPath>
        ))}
      </defs>

      {/* Reference chosen by the editor. */}
      <rect className={styles.refCard} x="34" y="56" width="150" height="176" rx="12" />
      <g clipPath={`url(#${id}-ref)`}>
        {/* The portrait fills the card height so the face sits centred. */}
        <g transform="translate(40 66.4) scale(1.38)"><Portrait kind={kind} variant={0} /></g>
      </g>
      <Corners className={styles.lock} x={44} y={66} w={130} h={156} />
      <text className={styles.caption} x="36" y="256">Your reference</text>

      {/* Frames from the video, scanned left to right. */}
      {FRAMES.map((frame, i) => {
        const x = x0 + i * (fw + gap);
        const ok = frame.who === 0;
        /* The anime cast sits a little smaller with its shoulders in frame, so the outfit stays visible. */
        const s = kind === "character" ? 0.8 : 0.88;
        const cx = x + fw / 2;
        const transform = `translate(${cx} ${y0 + fh - 120 * s + (kind === "character" ? 2 : 16)}) scale(${s}) translate(-50 0)`;
        return (
          <g key={i}>
            <rect className={styles.frame} x={x} y={y0} width={fw} height={fh} rx="8" />
            <g clipPath={`url(#${id}-f${i})`}>
              <g transform={transform}><Portrait kind={kind} variant={frame.who} outfit={frame.outfit} small /></g>
              <rect className={`${ok ? styles.okTint : styles.noTint} ${id}-v${i}`} x={x} y={y0} width={fw} height={fh} />
            </g>
            <rect className={`${ok ? styles.okRing : styles.noRing} ${id}-v${i}`} x={x} y={y0} width={fw} height={fh} rx="8" />
            <g className={`${id}-b${i}`}>
              <circle className={ok ? styles.okBadge : styles.noBadge} cx={x + fw - 6} cy={y0 + 6} r="12" />
              <path className={styles.badgeMark} d={ok ? `M ${x + fw - 12} ${y0 + 6} l 4.5 4.5 l 8 -9` : `M ${x + fw - 10.5} ${y0 + 1.5} l 9 9 M ${x + fw - 1.5} ${y0 + 1.5} l -9 9`} />
            </g>
          </g>
        );
      })}
      <g className={`${id}-scan`}>
        <rect className={styles.scanGlow} x={scanFrom - 9} y={y0 - 12} width="20" height={fh + 24} rx="10" />
        <rect className={styles.scan} x={scanFrom} y={y0 - 14} width="3" height={fh + 28} rx="1.5" />
      </g>
      <text className={styles.caption} x={x0} y="222">Frames from your video</text>

      {/* Kept scenes placed on the timeline. */}
      <rect className={styles.track} x={TRACK_X} y="276" width={TRACK_W} height="40" rx="9" />
      {/* One equal slot per frame: dividers sit between slots and each kept scene is centred in its slot. */}
      {FRAMES.slice(1).map((_, i) => (
        <rect key={`t${i}`} className={styles.tick} x={TRACK_X + (i + 1) * SLOT - 1} y="286" width="2" height="20" rx="1" />
      ))}
      {matches.map(({ i }) => (
        <rect key={`c${i}`} className={`${styles.chip} ${id}-b${i}`} x={TRACK_X + i * SLOT + (SLOT - CHIP_W) / 2} y="283" width={CHIP_W} height="26" rx="6" />
      ))}
      <text className={styles.caption} x="36" y="346">
        <tspan className={styles.okText}>{matches.length} scenes kept</tspan>
        <tspan dx="10">{skipped} other {kind === "person" ? "people" : "characters"} skipped</tspan>
      </text>
    </g>
  );
}

const BARS = Array.from({ length: 72 }, (_, i) => {
  const kick = i % 9 === 0 || i % 9 === 5;
  const base = 0.22 + 0.18 * Math.abs(Math.sin(i * 0.9)) * Math.abs(Math.cos(i * 0.31));
  return { h: kick ? 0.9 - (i % 2) * 0.14 : base * 0.8, kick };
});

function BeatScene() {
  const x0 = 40;
  const w = 5;
  const gap = 3;
  const mid = 168;
  const amp = 96;
  const hitCount = BARS.filter((bar) => bar.kick).length;
  return (
    <>
      <rect className={styles.panel} x="28" y="54" width="584" height="228" rx="12" />
      {BARS.map((bar, i) => {
        const x = x0 + i * (w + gap);
        const h = Math.round(bar.h * amp * 10) / 10;
        return <rect key={i} className={styles.bar} style={{ animationDelay: `${((i / BARS.length) * 4.2).toFixed(2)}s` }} x={x} y={(mid - h).toFixed(1)} width={w} height={(h * 2).toFixed(1)} rx="2" />;
      })}
      {BARS.map((bar, i) => {
        if (!bar.kick) return null;
        const x = x0 + i * (w + gap) + w / 2;
        const delay = `${((i / BARS.length) * 4.2).toFixed(2)}s`;
        return (
          <g key={`m${i}`} className={styles.marker} style={{ animationDelay: delay }}>
            <path d={`M ${x - 7} 66 H ${x + 7} L ${x} 77 Z`} />
            <rect x={x - 1} y="76" width="2" height="196" />
          </g>
        );
      })}
      <rect className={styles.sweep} x={x0 - 2} y="58" width="3" height="220" rx="1.5" />
      <text className={styles.caption} x="30" y="312">{hitCount} hits found on the track</text>
      <rect className={styles.track} x="28" y="326" width="584" height="34" rx="8" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} className={styles.exportChip} style={{ animationDelay: `${0.6 + i * 0.6}s` }} x={42 + i * 94} y="333" width="80" height="20" rx="4" />
      ))}
    </>
  );
}

/* Spoken lines on the speech strip, as start and end x positions. */
const SPEECH = [
  { from: 44, to: 168, text: "We start by the river.", time: "00:01.2" },
  { from: 190, to: 300, text: "Keep the camera low.", time: "00:04.8" },
  { from: 326, to: 452, text: "Then cut to the bridge.", time: "00:08.1" },
  { from: 474, to: 596, text: "That is our opening shot.", time: "00:11.6" },
];
const SPEECH_X0 = 40;
const SPEECH_X1 = 600;
const SUB_CYCLE = 9;
const SUB_SWEEP = 72;

function SubtitleScene({ id }: { id: string }) {
  const toPct = (x: number) => ((x - SPEECH_X0) / (SPEECH_X1 - SPEECH_X0)) * SUB_SWEEP;
  const bars = Array.from({ length: 70 }, (_, i) => {
    const x = SPEECH_X0 + 4 + i * 8;
    const speaking = SPEECH.some((line) => x >= line.from && x <= line.to);
    const h = speaking ? 9 + 13 * Math.abs(Math.sin(i * 1.7)) * Math.abs(Math.cos(i * 0.45)) : 1.5;
    return { x, h: Math.round(h * 10) / 10 };
  });
  const css = [
    `.${id}-sweep{animation:${id}-sweep ${SUB_CYCLE}s linear infinite}`,
    `@keyframes ${id}-sweep{0%{transform:translateX(0);opacity:1}${pct(SUB_SWEEP)}{transform:translateX(${SPEECH_X1 - SPEECH_X0}px);opacity:1}${pct(SUB_SWEEP + 1)},100%{transform:translateX(${SPEECH_X1 - SPEECH_X0}px);opacity:0}}`,
    ...SPEECH.flatMap((line, i) => {
      const start = toPct(line.from);
      const end = toPct(line.to);
      return [
        `.${id}-c${i}{animation:${id}-c${i} ${SUB_CYCLE}s ease infinite}`,
        `@keyframes ${id}-c${i}{0%,${pct(start)}{opacity:0}${pct(start + 1)},${pct(end + 2)}{opacity:1}${pct(end + 3)},100%{opacity:0}}`,
        `.${id}-r${i}{animation:${id}-r${i} ${SUB_CYCLE}s cubic-bezier(.2,.8,.2,1) infinite}`,
        `@keyframes ${id}-r${i}{0%,${pct(start)}{opacity:0;transform:translateX(10px)}${pct(start + 3)},92%{opacity:1;transform:none}97%,100%{opacity:0}}`,
      ];
    }),
    // Reduced motion shows the finished state: every line listed, the last one on screen.
    `@media (prefers-reduced-motion:reduce){.${id} *{animation:none!important}.${id}-sweep{opacity:0}${SPEECH.slice(0, -1).map((_, i) => `.${id}-c${i}`).join(",")}{opacity:0}}`,
  ].join("");

  return (
    <g className={id}>
      <style>{css}</style>
      <defs><clipPath id={`${id}-frame`}><rect x="28" y="40" width="320" height="196" rx="12" /></clipPath></defs>

      {/* The source video with the current line on screen. */}
      <rect className={styles.frame} x="28" y="40" width="320" height="196" rx="12" />
      <g clipPath={`url(#${id}-frame)`}>
        <g transform="translate(188 44) scale(1.6) translate(-50 0)"><Portrait kind="person" variant={0} name={SUBTITLE_SPEAKER} /></g>
      </g>
      {SPEECH.map((line, i) => (
        <g key={line.time} className={`${id}-c${i}`}>
          <rect className={styles.subtitlePlate} x={188 - line.text.length * 3.9 - 10} y="198" width={line.text.length * 7.8 + 20} height="26" rx="4" />
          <text className={styles.subtitleText} x="188" y="216" textAnchor="middle">{line.text}</text>
        </g>
      ))}

      {/* Subtitle lines written as the speech is heard. */}
      <text className={styles.caption} x="370" y="54">Subtitle lines</text>
      {SPEECH.map((line, i) => (
        <g key={`r${line.time}`} className={`${id}-r${i}`}>
          <rect className={styles.cueRow} x="368" y={68 + i * 42} width="244" height="34" rx="6" />
          <text className={styles.cueTime} x="380" y={89 + i * 42}>{line.time}</text>
          <text className={styles.cueText} x="438" y={89 + i * 42}>{line.text}</text>
        </g>
      ))}

      {/* The soundtrack: speech shows as dense bars, pauses stay flat. */}
      <rect className={styles.track} x="28" y="258" width="584" height="52" rx="9" />
      {bars.map((bar) => <rect key={bar.x} className={styles.speechBar} x={bar.x} y={284 - bar.h} width="4" height={bar.h * 2} rx="2" />)}
      <rect className={`${styles.scan} ${id}-sweep`} x={SPEECH_X0 - 1} y="250" width="3" height="68" rx="1.5" />
      <text className={styles.caption} x="30" y="346">
        <tspan className={styles.okText}>{SPEECH.length} lines written</tspan>
        <tspan dx="10">every word editable before export</tspan>
      </text>
    </g>
  );
}

const ACCENT: Record<ToolSlug, string> = {
  "face-recognition": styles.face,
  "anime-face-recognition": styles.anime,
  "bass-markers": styles.bass,
  "auto-subtitles": styles.subtitles,
};

const LABEL: Record<ToolSlug, string> = {
  "face-recognition": "Illustration: a reference frame being matched across video frames",
  "anime-face-recognition": "Illustration: a reference frame being matched across video frames",
  "bass-markers": "Illustration: markers dropping on the hits of a waveform",
  "auto-subtitles": "Illustration: spoken lines on a soundtrack becoming subtitle lines on the video",
};

export function ToolIllustration({ tool, className }: Props) {
  const ref = useRef<SVGSVGElement>(null);

  /* The scene's CSS animations repaint the whole SVG; pause them while it is off screen. */
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const io = new IntersectionObserver(([entry]) => svg.toggleAttribute("data-paused", !entry.isIntersecting), { rootMargin: "120px 0px" });
    io.observe(svg);
    return () => io.disconnect();
  }, []);

  return (
    <svg ref={ref} className={`${styles.scene} ${ACCENT[tool]} ${className ?? ""}`} viewBox="0 0 640 380" role="img" aria-label={LABEL[tool]}>
      {tool === "bass-markers" ? <BeatScene /> : tool === "auto-subtitles" ? <SubtitleScene id="cw-auto-subtitles" /> : <MatchScene kind={tool === "face-recognition" ? "person" : "character"} id={`cw-${tool}`} />}
    </svg>
  );
}
