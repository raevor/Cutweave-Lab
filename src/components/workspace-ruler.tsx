import styles from "./workspace-ruler.module.css";

/* A decorative timecode ruler with a moving playhead for the top of a tool workspace. */
const MARKS = ["00:00", "00:10", "00:20", "00:30", "00:40", "00:50", "01:00", "01:10"];

export function WorkspaceRuler({ className }: { className?: string }) {
  return (
    <div className={`${styles.ruler} ${className ?? ""}`} aria-hidden="true">
      <div className={styles.labels}>{MARKS.map((mark) => <span key={mark}>{mark}</span>)}</div>
      <div className={styles.ticks} />
      <i className={styles.head} />
    </div>
  );
}
