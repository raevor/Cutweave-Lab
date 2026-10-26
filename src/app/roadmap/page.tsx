import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageFrame } from "@/components/public-page-frame";
import { ToolIllustration } from "@/components/tool-illustration";
import { AmbientLayer } from "@/components/ambient-layer";
import { EnhancerPreview } from "./enhancer-preview";
import styles from "./roadmap.module.css";

export const metadata: Metadata = {
  title: "Roadmap",
  description: "What is available now and what is coming next to Cutweave Lab.",
};

const roadmap = [
  {
    index: "01",
    slug: "face-recognition",
    phase: "Available now",
    status: "Beta",
    title: "Face Recognition",
    copy: "The complete local face-finding workflow: choose three reference frames, find every scene where the same face appears again and export the clips you keep.",
    tone: "ready",
  },
  {
    index: "02",
    slug: "anime-face-recognition",
    phase: "Available now",
    status: "Beta",
    title: "Anime Face Recognition",
    copy: "Its own recognition workspace for drawn and animated characters, with a model built for anime faces. Pick a character once and find every scene they appear in.",
    tone: "ready",
  },
  {
    index: "03",
    slug: "bass-markers",
    phase: "Available now",
    status: "Beta",
    title: "Music & Bass Markers",
    copy: "A local audio workspace for finding useful impacts and bass entries, reviewing every marker, trimming the source and exporting marker timing for the edit.",
    tone: "ready",
  },
  {
    index: "04",
    slug: "auto-subtitles",
    phase: "Available now",
    status: "Beta",
    title: "Auto Subtitles",
    copy: "English speech becomes timed subtitle lines inside the browser with an on-device speech model. Every line can be corrected before exporting SRT, WebVTT or a plain transcript.",
    tone: "ready",
  },
  {
    index: "05",
    slug: "background-remover",
    phase: "Available now",
    status: "Beta",
    title: "Background Remover",
    copy: "An on-device image model separates the subject of a photo, still or illustration inside the browser. The edge can be tuned before exporting a transparent PNG, a new background or a matte.",
    tone: "ready",
  },
] as const;

export default function RoadmapPage() {
  return (
    <PublicPageFrame activePage="roadmap">
      <div className={`${styles.shell} ${styles.shellTop}`}>
        <header className={styles.hero}>
          <p className={styles.kicker}><span>Roadmap</span><span>Living plan</span></p>
          <h1>What comes<br /><em>next.</em></h1>
          <p>
            What is ready today and what we are building next.
            Plans can shift as we test each tool on real edits.
          </p>
        </header>
      </div>

      <div className={styles.band} aria-hidden="true" />

      <div className="ambient-host">
        <AmbientLayer seed={6} />
      <div className={`${styles.shell} ${styles.shellBody}`}>
        <section className={styles.timeline} aria-label="Cutweave product roadmap">
          {roadmap.map((item) => (
            <article className={styles.item} data-tone={item.tone} data-tool-key={item.slug} key={item.title}>
              <div className={styles.marker} aria-hidden="true"><span>{item.index}</span><i /></div>
              <div className={styles.itemHead}>
                <p>{item.phase}</p>
                <span>{item.status}</span>
              </div>
              <h2>{item.title}</h2>
              <p className={styles.itemCopy}>{item.copy}</p>
              <div className={styles.itemScene}><ToolIllustration tool={item.slug} /></div>
            </article>
          ))}
          <article className={`${styles.item} ${styles.soon}`} data-tone="soon">
            <div className={styles.marker} aria-hidden="true"><span>06</span><i /></div>
            <div className={styles.itemHead}>
              <p>Coming soon</p>
              <span><b className={styles.soonPulse} aria-hidden="true" />In development</span>
            </div>
            <h2>Video Enhancer</h2>
            <p className={styles.itemCopy}>
              Restore soft, compressed or low-resolution footage on your device: clean up noise and blocking,
              rebuild fine detail and export a sharper clip. Like every Cutweave tool, nothing is uploaded.
            </p>
            <div className={styles.itemScene}><EnhancerPreview /></div>
          </article>
        </section>

        <aside className={styles.more}>
          <div>
            <p>Beyond the current cut</p>
            <h2>More tools and refinements are on the way.</h2>
          </div>
          <Link href="/lab">Explore the current tools <span aria-hidden="true">→</span></Link>
        </aside>
      </div>
      </div>
    </PublicPageFrame>
  );
}
