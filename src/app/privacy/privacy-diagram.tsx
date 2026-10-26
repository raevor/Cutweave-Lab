import { Portrait } from "@/components/character-portraits";
import { siteCopy as text } from "@/i18n/messages/en";
import styles from "./privacy.module.css";

/*
 * Hero diagram: a file is analyzed and exported inside the browser tab. The
 * upload route to Cutweave servers is cut, while app code and models arrive.
 */

const CYCLE = 7;
const FRAMES = 5;
/* Who appears in each scanned frame. */
const FRAME_CAST = ["noor", "kian", "yara", "theo", "rumi"];

export function PrivacyDiagram() {
  const d = text.privacy.diagram;
  return (
    <svg className={styles.diagram} viewBox="0 0 600 440" role="img" aria-label={d.label}>
      {/* Browser window. */}
      <rect className={styles.win} x="16" y="40" width="400" height="384" rx="16" />
      <path className={styles.winBar} d="M16 56 a16 16 0 0 1 16 -16 h368 a16 16 0 0 1 16 16 v20 h-400 Z" />
      <circle className={styles.dot} cx="38" cy="58" r="5" />
      <circle className={styles.dot} cx="55" cy="58" r="5" />
      <circle className={styles.dot} cx="72" cy="58" r="5" />
      <text className={styles.winLabel} x="92" y="62">{d.tab}</text>
      <g className={styles.lockIcon} transform="translate(386 49)">
        <rect x="0" y="7" width="14" height="11" rx="2.5" />
        <path d="M3 7 V4.5 a4 4 0 0 1 8 0 V7" />
      </g>

      {/* The file arrives. */}
      <g className={styles.fileChip}>
        <rect className={styles.chip} x="40" y="98" width="182" height="42" rx="9" />
        <rect className={styles.fileIcon} x="54" y="108" width="20" height="22" rx="3" />
        <path className={styles.fileGlyph} d="M60 114 l8 5 l-8 5 Z" />
        <text className={styles.chipText} x="84" y="124">{d.file}</text>
      </g>

      {/* Frames scanned locally. */}
      {Array.from({ length: FRAMES }, (_, i) => {
        const x = 40 + i * 72;
        const delay = `${((0.18 + (0.4 * (i + 0.5)) / FRAMES) * CYCLE).toFixed(2)}s`;
        return (
          <g key={i}>
            <clipPath id={`privacy-frame-${i}`}><rect x={x} y="170" width="64" height="50" rx="6" /></clipPath>
            <rect className={styles.frame} style={{ animationDelay: delay }} x={x} y="170" width="64" height="50" rx="6" />
            <g clipPath={`url(#privacy-frame-${i})`}>
              <g transform={`translate(${x + 7} 174) scale(.5)`}><Portrait kind="person" variant={0} name={FRAME_CAST[i]} small /></g>
            </g>
            <rect className={styles.frameEdge} style={{ animationDelay: delay }} x={x} y="170" width="64" height="50" rx="6" />
          </g>
        );
      })}
      <rect className={styles.scanLine} x="38" y="162" width="3" height="66" rx="1.5" />
      <text className={styles.caption} x="40" y="252">{d.scanning}</text>
      <rect className={styles.progressTrack} x="40" y="266" width="352" height="8" rx="4" />
      <rect className={styles.progress} x="40" y="266" width="352" height="8" rx="4" />

      {/* Export happens here too: the slot waits, then the result lands in it. */}
      <rect className={styles.exportSlot} x="40" y="302" width="168" height="42" rx="9" />
      <text className={styles.slotText} x="124" y="328" textAnchor="middle">{d.exported}</text>
      <g className={styles.exportChip}>
        <rect className={styles.chipOk} x="40" y="302" width="168" height="42" rx="9" />
        <path className={styles.check} d="M58 323 l6 6 l11 -12" />
        <text className={styles.chipText} x="86" y="328">{d.exported}</text>
      </g>

      {/* Upload route: cut. */}
      <path className={styles.blockedLine} d="M222 119 H452" />
      <circle className={styles.packet} cx="230" cy="119" r="5" />
      <g transform="translate(336 119)">
        <circle className={styles.blockBadge} r="13" />
        <path className={styles.blockMark} d="M-5 -5 L5 5 M5 -5 L-5 5" />
      </g>
      <text className={styles.blockedLabel} x="336" y="96" textAnchor="middle">{d.blocked}</text>

      {/* Cutweave servers receive nothing. */}
      <rect className={styles.server} x="452" y="62" width="134" height="164" rx="14" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect className={styles.rack} x="472" y={80 + i * 16} width="94" height="11" rx="3" />
          <circle className={styles.rackLed} cx="480" cy={85.5 + i * 16} r="2" />
        </g>
      ))}
      <text className={styles.serverLabel} x="519" y="148" textAnchor="middle">{d.server}</text>
      <text className={styles.zero} x="519" y="190" textAnchor="middle">{d.value}</text>
      <text className={styles.serverLabel} x="519" y="210" textAnchor="middle">{d.received}</text>

      {/* App code and models are allowed in. */}
      <path className={styles.downLine} d="M519 226 V382 H416" />
      {[0, 1, 2].map((i) => (
        <circle key={i} className={styles.downDot} style={{ animationDelay: `${(-i * 0.9).toFixed(1)}s` }} r="4.5" />
      ))}
      <text className={styles.downLabel} x="508" y="318" textAnchor="end">{d.download}</text>
    </svg>
  );
}
