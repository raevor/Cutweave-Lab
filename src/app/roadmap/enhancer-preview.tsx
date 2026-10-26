import { Portrait } from "@/components/character-portraits";
import styles from "./roadmap.module.css";

/*
 * Video Enhancer teaser: a soft night frame is restored by a pass that sweeps
 * across it, leaving the sharp frame behind. The restored frame holds, then
 * fades back to the soft source and the pass runs again. Drawn on the same
 * 640 x 380 canvas as the tool illustrations so every roadmap preview has one size.
 */

const STARS = [[84, 62], [122, 90], [168, 58], [214, 84], [262, 60], [380, 70], [420, 96], [470, 62], [520, 88], [556, 66], [146, 120], [498, 120]];
const WINDOWS = [[78, 214], [86, 230], [112, 196], [120, 212], [150, 222], [176, 186], [184, 204], [176, 222], [420, 200], [428, 218], [458, 182], [466, 200], [458, 226], [500, 210], [532, 192], [540, 210], [532, 228], [560, 216]];

/* Rumi on a rooftop at night, shared by the soft and the restored layer. */
function Scene() {
  return (
    <>
      <rect x="60" y="44" width="520" height="260" fill="url(#enhancer-night)" />
      {STARS.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" fill="#e9ecff" opacity=".85" />)}
      <circle cx="500" cy="96" r="34" fill="#cfd8ff" opacity=".12" />
      <circle cx="500" cy="96" r="20" fill="#eef1ff" />
      <circle cx="509" cy="89" r="17" fill="#141538" />
      {/* Skyline with lit windows. */}
      <path d="M60 304 V204 h26 v-18 h22 v-14 h24 v40 h20 v-36 h30 v52 h18 V304 Z M400 304 V196 h22 v-26 h28 v-16 h22 v46 h24 v-30 h30 v46 h20 V304 Z" fill="#1a1838" />
      {WINDOWS.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="5" height="7" rx="1" fill="#ffd27a" opacity=".9" />)}
      {/* Neon sign on the right building. */}
      <rect x="486" y="236" width="56" height="18" rx="4" fill="none" stroke="#ff7ac6" strokeWidth="2.5" />
      <rect x="486" y="236" width="56" height="18" rx="4" fill="none" stroke="#ff7ac6" strokeWidth="8" opacity=".18" />
      <path d="M60 268 C160 256 250 262 320 266 S500 256 580 262 V304 H60 Z" fill="#0f0e24" />
      <g transform="translate(220 64) scale(2)"><Portrait kind="person" variant={0} name="rumi" /></g>
    </>
  );
}

export function EnhancerPreview({ className }: { className?: string }) {
  return (
    <svg className={`${styles.enhancer} ${className ?? ""}`} viewBox="0 0 640 380" role="img" aria-label="Video Enhancer preview: a restoration pass sweeps across a soft night frame and leaves it sharp">
      <defs>
        <filter id="enhancer-soft" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation="4" />
          <feColorMatrix type="saturate" values=".6" />
        </filter>
        <linearGradient id="enhancer-night" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1030" />
          <stop offset=".6" stopColor="#241d52" />
          <stop offset="1" stopColor="#4a2a63" />
        </linearGradient>
        <linearGradient id="enhancer-glow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7fe3ff" stopOpacity="0" />
          <stop offset="1" stopColor="#7fe3ff" stopOpacity=".45" />
        </linearGradient>
        <clipPath id="enhancer-frame"><rect x="60" y="44" width="520" height="260" rx="14" /></clipPath>
        <clipPath id="enhancer-restored"><rect className={styles.enhancerReveal} x="60" y="44" width="520" height="260" /></clipPath>
      </defs>

      <g clipPath="url(#enhancer-frame)">
        <g filter="url(#enhancer-soft)"><Scene /></g>
        <g className={styles.enhancerRestored} clipPath="url(#enhancer-restored)"><Scene /></g>
        {/* The restoration pass: a bright edge with a glow trailing behind it. */}
        <g className={styles.enhancerPass}>
          <rect x="20" y="44" width="40" height="260" fill="url(#enhancer-glow)" />
          <rect x="58" y="44" width="2.5" height="260" fill="#bff1ff" />
        </g>
      </g>
      <rect className={styles.enhancerEdge} x="60" y="44" width="520" height="260" rx="14" />

      {/* Status chip: soft source, then restored. */}
      <g transform="translate(72 56)">
        <g className={styles.enhancerSoftTag}>
          <rect width="94" height="22" rx="4" fill="rgb(10 12 30 / .7)" />
          <text className={styles.enhancerTagText} x="47" y="15" textAnchor="middle" fill="#cfd3e6">SOFT SOURCE</text>
        </g>
        <g className={styles.enhancerDoneTag}>
          <rect width="94" height="22" rx="4" fill="#ffb238" />
          <text className={styles.enhancerTagText} x="47" y="15" textAnchor="middle" fill="#1b1206">RESTORED</text>
        </g>
      </g>
      <g transform="translate(496 56)">
        <rect width="72" height="22" rx="4" fill="rgb(10 12 30 / .7)" />
        <text className={styles.enhancerTagText} x="36" y="15" textAnchor="middle" fill="#bff1ff">2× · CLEAN</text>
      </g>

      {/* Progress of the pass under the frame. */}
      <rect className={styles.enhancerTrack} x="60" y="322" width="520" height="4" rx="2" />
      <rect className={styles.enhancerProgress} x="60" y="322" width="520" height="4" rx="2" />
      <text className={styles.enhancerCaption} x="62" y="350">Restoring on this device</text>
      <text className={styles.enhancerCaption} x="578" y="350" textAnchor="end">No upload</text>
    </svg>
  );
}
