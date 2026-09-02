import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageFrame } from "@/components/public-page-frame";
import styles from "./roadmap.module.css";

export const metadata: Metadata = {
  title: "Roadmap",
  description: "What is available now and what is coming next to Cutweave Lab.",
};

const roadmap = [
  {
    index: "01",
    phase: "Available now",
    status: "Refinement ongoing",
    title: "Face Recognition",
    copy: "The complete local face-finding workflow is available today. Current work is focused on making difficult angles, lighting changes and brief appearances even more reliable.",
    tone: "ready",
  },
  {
    index: "02",
    phase: "Coming soon",
    status: "Next release",
    title: "Anime Face Recognition",
    copy: "A separate recognition workspace built for illustrated and animated faces, using the proven local workflow without changing the existing Face Recognition tool.",
    tone: "next",
  },
  {
    index: "03",
    phase: "In development",
    status: "Building",
    title: "Music & Bass Markers",
    copy: "A focused tool for finding useful musical hits and rhythm points, then turning them into adjustable markers for the edit.",
    tone: "building",
  },
  {
    index: "04",
    phase: "In development",
    status: "Building",
    title: "Video Enhancer",
    copy: "A local workspace for previewing detail recovery, denoising and upscaling choices before exporting the selected result.",
    tone: "building",
  },
] as const;

export default function RoadmapPage() {
  return (
    <PublicPageFrame activePage="roadmap">
      <div className={styles.shell}>
        <header className={styles.hero}>
          <p className={styles.kicker}><span>Roadmap</span><span>Living plan</span></p>
          <h1>What comes<br /><em>next.</em></h1>
          <p>
            A focused view of what is ready, what we are improving and what is currently being built.
            Priorities may move as we test each tool with real editing workflows.
          </p>
        </header>

        <section className={styles.timeline} aria-label="Cutweave product roadmap">
          {roadmap.map((item) => (
            <article className={styles.item} data-tone={item.tone} key={item.title}>
              <div className={styles.marker} aria-hidden="true"><span>{item.index}</span><i /></div>
              <div className={styles.itemHead}>
                <p>{item.phase}</p>
                <span>{item.status}</span>
              </div>
              <h2>{item.title}</h2>
              <p className={styles.itemCopy}>{item.copy}</p>
            </article>
          ))}
        </section>

        <aside className={styles.more}>
          <div>
            <p>Beyond the current cut</p>
            <h2>More tools and refinements are on the way.</h2>
          </div>
          <Link href="/lab">Explore the current tools <span aria-hidden="true">→</span></Link>
        </aside>
      </div>
    </PublicPageFrame>
  );
}
