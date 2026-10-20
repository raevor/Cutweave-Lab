"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./sequence-nav.module.css";

/*
 * The page as an edit sequence: a slim timeline on the right edge where each
 * section is a marker and the playhead follows the scroll position, with a
 * running timecode. Selecting a marker jumps to that section.
 */

type Item = { id: string; label: string; tool?: string };

const SEQUENCE_SECONDS = 150;
const FPS = 25;

function timecode(seconds: number) {
  const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
  return `${pad(seconds / 3600)}:${pad((seconds % 3600) / 60)}:${pad(seconds % 60)}:${pad((seconds % 1) * FPS)}`;
}

export function SequenceNav({ items, label = "Page sequence" }: { items: Item[]; label?: string }) {
  const [marks, setMarks] = useState<number[]>([]);
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState(false);
  const fillRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let frame: number | null = null;
    let tops: number[] = [];
    let max = 1;

    /* Scrolling only writes styles; React re-renders when the active section changes. */
    const update = () => {
      frame = null;
      const y = window.scrollY;
      const progress = Math.min(1, y / max);
      if (fillRef.current) fillRef.current.style.height = `${progress * 100}%`;
      if (headRef.current) headRef.current.style.top = `${progress * 100}%`;
      if (codeRef.current) codeRef.current.textContent = timecode(progress * SEQUENCE_SECONDS);
      setShown(y > window.innerHeight * 0.35);
      let current = 0;
      tops.forEach((top, i) => {
        if (top - y < window.innerHeight * 0.45) current = i;
      });
      setActive(current);
    };

    /* Layout reads happen only when the page size changes. */
    const layout = () => {
      max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const y = window.scrollY;
      tops = items.map(({ id }) => {
        const el = document.getElementById(id);
        return el ? el.getBoundingClientRect().top + y : 0;
      });
      const next = tops.map((top) => Math.min(1, Math.max(0, top / max)));
      setMarks((prev) => (prev.length === next.length && prev.every((v, i) => Math.abs(v - next[i]) < 0.002) ? prev : next));
      update();
    };

    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };
    const first = requestAnimationFrame(layout);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", layout);
    const ro = new ResizeObserver(layout);
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(first);
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", layout);
      ro.disconnect();
    };
  }, [items]);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  return (
    <nav className={`${styles.nav} ${shown ? styles.shown : ""}`} aria-label={label}>
      <div className={styles.track}>
        <div className={styles.fill} ref={fillRef} />
        {items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            className={`${styles.mark} ${i === active ? styles.active : ""}`}
            style={{ top: `${(marks[i] ?? 0) * 100}%` }}
            data-tool-key={item.tool}
            onClick={() => jump(item.id)}
            aria-label={`Jump to ${item.label}`}
            aria-current={i === active ? "location" : undefined}
            tabIndex={shown ? 0 : -1}
          >
            <i aria-hidden="true" />
            <span aria-hidden="true" data-label={item.label} />
          </button>
        ))}
        <div className={styles.head} ref={headRef} aria-hidden="true">
          <b ref={codeRef}>{timecode(0)}</b>
        </div>
      </div>
    </nav>
  );
}
