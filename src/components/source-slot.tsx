import { Portrait, REMOVER_SUBJECT, SUBTITLE_SPEAKER } from "./character-portraits";
import styles from "./source-slot.module.css";

/*
 * Empty-state art for a tool before a file is chosen. It shows an empty slot
 * waiting for media and never shows analysis results.
 */

type Props = { kind: "person" | "character" | "audio" | "subtitles" | "image"; className?: string };

const HOLES = Array.from({ length: 21 }, (_, i) => -22 + i * 22);
const TRACK_STEPS = 56;

function Film() {
  return (
    <>
      <rect className={styles.strip} x="0" y="0" width="26" height="400" />
      <rect className={styles.strip} x="274" y="0" width="26" height="400" />
      <g className={styles.holes}>
        {HOLES.map((y) => (
          <g key={y}>
            <rect x="7" y={y} width="12" height="9" rx="2" />
            <rect x="281" y={y} width="12" height="9" rx="2" />
          </g>
        ))}
      </g>
    </>
  );
}

export function SourceSlot({ kind, className }: Props) {
  if (kind === "audio") {
    const x0 = 34;
    const step = 4.2;
    return (
      <svg className={`${styles.slot} ${className ?? ""}`} viewBox="0 0 300 400" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} className={i % 4 === 0 ? styles.gridMajor : styles.grid} x={x0 + i * 20} y={i % 4 === 0 ? 96 : 120} width="1" height={i % 4 === 0 ? 208 : 160} />
        ))}
        <rect className={styles.flatline} x={x0} y="199" width={TRACK_STEPS * step} height="2" rx="1" />
        <rect className={styles.glint} x={x0} y="196" width="40" height="8" rx="4" />
        <g className={styles.idleHead}>
          <rect x="88" y="84" width="2" height="232" />
          <path d="M 82 78 H 96 L 89 87 Z" />
        </g>
      </svg>
    );
  }
  if (kind === "image") {
    return (
      <svg className={`${styles.slot} ${className ?? ""}`} viewBox="0 0 300 400" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <clipPath id="slot-image"><rect x="44" y="70" width="212" height="260" rx="10" /></clipPath>
          <pattern id="slot-checker" width="20" height="20" patternUnits="userSpaceOnUse">
            <rect width="10" height="10" className={styles.checker} /><rect x="10" y="10" width="10" height="10" className={styles.checker} />
          </pattern>
        </defs>
        <rect className={styles.frame} x="44" y="70" width="212" height="260" rx="10" />
        <g clipPath="url(#slot-image)">
          <rect x="44" y="70" width="212" height="260" fill="url(#slot-checker)" />
          <g className={styles.ghost} transform="translate(50 90) scale(2)">
            <Portrait kind="person" variant={0} name={REMOVER_SUBJECT} />
          </g>
          {/* A dashed cut line waits around the subject. */}
          <rect className={styles.scan} x="44" y="70" width="212" height="2" />
        </g>
        <text className={styles.caption} x="150" y="368" textAnchor="middle">Waiting for your image</text>
      </svg>
    );
  }
  if (kind === "subtitles") {
    return (
      <svg className={`${styles.slot} ${className ?? ""}`} viewBox="0 0 300 400" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <Film />
        <defs>
          <clipPath id="slot-subtitles"><rect x="44" y="70" width="212" height="260" rx="10" /></clipPath>
        </defs>
        <rect className={styles.frame} x="44" y="70" width="212" height="260" rx="10" />
        <g clipPath="url(#slot-subtitles)">
          <g className={styles.ghost} transform="translate(50 90) scale(2)">
            <Portrait kind="person" variant={0} name={SUBTITLE_SPEAKER} />
          </g>
        </g>
        {/* An empty subtitle line with a waiting cursor. */}
        <rect className={styles.captionSlot} x="74" y="282" width="152" height="18" rx="3" />
        <rect className={styles.captionSlot} x="96" y="304" width="108" height="12" rx="3" />
        <rect className={styles.idleHead} x="80" y="285" width="2" height="12" />
        <text className={styles.caption} x="150" y="368" textAnchor="middle">Waiting for your video</text>
      </svg>
    );
  }
  return (
    <svg className={`${styles.slot} ${className ?? ""}`} viewBox="0 0 300 400" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <Film />
      <defs>
        <clipPath id={`slot-${kind}`}><rect x="44" y="70" width="212" height="260" rx="10" /></clipPath>
      </defs>
      <rect className={styles.frame} x="44" y="70" width="212" height="260" rx="10" />
      <g clipPath={`url(#slot-${kind})`}>
        <g className={styles.ghost} transform="translate(50 90) scale(2)">
          <Portrait kind={kind} variant={0} />
        </g>
      </g>
      <g className={`${styles.search} ${kind === "character" ? styles.searchCharacter : ""}`}>
        <path d="M 0 20 V 0 H 20 M 60 0 H 80 V 20 M 80 72 V 92 H 60 M 20 92 H 0 V 72" />
      </g>
      <rect className={styles.scan} x="44" y="70" width="212" height="2" />
      <text className={styles.caption} x="150" y="368" textAnchor="middle">Waiting for your video</text>
    </svg>
  );
}
