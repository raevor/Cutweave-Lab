"use client";

import { useSyncExternalStore } from "react";
import styles from "./not-found.module.css";

/*
 * The 404 in the language of the tool illustrations: the requested address is the
 * reference, the lab's real tools are the frames, and a scan line checks each one
 * and finds no match. Pure illustration, no analysis.
 */

const TOOLS = [
  { slug: "face-recognition", title: ["Face", "Recognition"] },
  { slug: "anime-face-recognition", title: ["Anime Face", "Recognition"] },
  { slug: "bass-markers", title: ["Music & Bass", "Markers"] },
  { slug: "auto-subtitles", title: ["Auto", "Subtitles"] },
  { slug: "background-remover", title: ["Background", "Remover"] },
];

const FRAME_X = 166;
const FRAME_Y = 64;
const FRAME_W = 80;
const FRAME_H = 118;
const GAP = 6;

/*
 * The 404 page is prerendered once, so the server cannot know the address that was
 * requested. The path is read only in the browser; the server and the first client
 * render both show a placeholder, which keeps hydration consistent.
 */
const noSubscription = () => () => {};
const readPath = () => window.location.pathname;
const serverPath = () => null;

function shorten(path: string) {
  return path.length > 17 ? `${path.slice(0, 16)}…` : path;
}

export function NotFoundScene() {
  const pathname = useSyncExternalStore(noSubscription, readPath, serverPath);
  return (
    <svg className={styles.scene} viewBox="0 0 600 340" role="img" aria-label="Illustration: the requested address is checked against every tool and no match is found">
      {/* The requested address, framed like a reference. */}
      <rect className={styles.refCard} x="20" y="40" width="130" height="166" rx="12" />
      <path className={styles.corners} d="M 32 70 V 54 H 48 M 122 54 H 138 V 70 M 138 176 V 192 H 122 M 48 192 H 32 V 176" />
      <text className={styles.refMark} x="85" y="128" textAnchor="middle">?</text>
      <text className={styles.refPath} x="85" y="160" textAnchor="middle">{pathname ? shorten(pathname) : "/…"}</text>
      <text className={styles.caption} x="22" y="232">Your request</text>

      {/* The lab's tools, checked left to right. */}
      {TOOLS.map((tool, index) => {
        const x = FRAME_X + index * (FRAME_W + GAP);
        return (
          <g key={tool.slug}>
            <rect className={styles.frame} x={x} y={FRAME_Y} width={FRAME_W} height={FRAME_H} rx="8" />
            <rect className={styles.frameBar} x={x + 10} y={FRAME_Y + 14} width={FRAME_W - 20} height="5" rx="2.5" />
            <rect className={styles.frameLine} x={x + 10} y={FRAME_Y + 30} width={FRAME_W - 32} height="3" rx="1.5" />
            <rect className={styles.frameLine} x={x + 10} y={FRAME_Y + 39} width={FRAME_W - 26} height="3" rx="1.5" />
            <rect className={styles.frameLine} x={x + 10} y={FRAME_Y + 48} width={FRAME_W - 40} height="3" rx="1.5" />
            <text className={styles.frameTitle} x={x + FRAME_W / 2} y={FRAME_Y + 74} textAnchor="middle">
              <tspan x={x + FRAME_W / 2}>{tool.title[0]}</tspan>
              <tspan x={x + FRAME_W / 2} dy="13">{tool.title[1]}</tspan>
            </text>
            <text className={styles.framePath} x={x + FRAME_W / 2} y={FRAME_Y + 104} textAnchor="middle">{tool.slug}</text>
            <rect className={`${styles.noTint} ${styles[`hit${index}`]}`} x={x} y={FRAME_Y} width={FRAME_W} height={FRAME_H} rx="8" />
            <rect className={`${styles.noRing} ${styles[`hit${index}`]}`} x={x} y={FRAME_Y} width={FRAME_W} height={FRAME_H} rx="8" />
            <g className={`${styles.badge} ${styles[`pop${index}`]}`}>
              <circle className={styles.noBadge} cx={x + FRAME_W - 6} cy={FRAME_Y + 6} r="11" />
              <path className={styles.badgeMark} d={`M ${x + FRAME_W - 10} ${FRAME_Y + 2} l 8 8 M ${x + FRAME_W - 2} ${FRAME_Y + 2} l -8 8`} />
            </g>
          </g>
        );
      })}
      <g className={styles.scan}>
        <rect className={styles.scanGlow} x={FRAME_X - 15} y={FRAME_Y - 12} width="20" height={FRAME_H + 24} rx="10" />
        <rect className={styles.scanLine} x={FRAME_X - 6} y={FRAME_Y - 14} width="3" height={FRAME_H + 28} rx="1.5" />
      </g>
      <text className={styles.caption} x={FRAME_X} y="206">Tools in the lab</text>

      {/* Result strip: nothing to keep. */}
      <rect className={styles.track} x="20" y="258" width="560" height="34" rx="8" />
      {TOOLS.slice(1).map((tool, i) => (
        <rect key={tool.slug} className={styles.tick} x={20 + ((i + 1) * 560) / TOOLS.length - 1} y="266" width="2" height="18" rx="1" />
      ))}
      <text className={styles.resultText} x="22" y="324"><tspan className={styles.noText}>0 tools matched</tspan><tspan dx="10">{TOOLS.length} checked</tspan></text>
    </svg>
  );
}
