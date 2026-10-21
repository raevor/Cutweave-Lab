import type { CSSProperties } from "react";
import Link from "next/link";
import { PublicPageFrame } from "@/components/public-page-frame";
import { TimelineBackdrop } from "@/components/timeline-backdrop";
import { ToolIllustration } from "@/components/tool-illustration";
import { ToolRouteLink } from "@/components/tool-route-link";
import { siteCopy as text } from "@/i18n/messages/en";
import { isToolAvailable, primaryTools } from "@/lib/tool-catalog";
import { AmbientLayer } from "@/components/ambient-layer";
import { SequenceNav } from "@/components/sequence-nav";
import styles from "./lab.module.css";

export default function LabPage() {
  const copy = text.library;

  return (
    <PublicPageFrame activePage="tools">
      <section className={styles.hero} id="overview" aria-labelledby="lab-title">
        <div className={styles.heroCopy}>
          <p className={styles.kicker}><span>{copy.eyebrowA}</span><span>{copy.eyebrowB}</span></p>
          <h1 id="lab-title"><span>{copy.titleA}</span><em>{copy.titleB}</em></h1>
          <p>{copy.intro}</p>
          <div className={styles.localStatus}><i aria-hidden="true" />{copy.localNote}</div>
        </div>

        <aside className={styles.dispatch} aria-label="Cutweave tool desk overview">
          <header><span>CUT/WEAVE / TOOL DESK</span><b>{String(primaryTools.length).padStart(2, "0")} FOCUSED ROUTES</b></header>
          <div className={styles.dispatchScreen} aria-hidden="true">
            <TimelineBackdrop className={styles.dispatchTimeline} />
            <span className={styles.dispatchLabel}>Choose the job<br />before the source</span>
          </div>
          <div className={styles.dispatchTracks} aria-hidden="true">
            {primaryTools.map((tool) => (
              <div key={tool.slug} data-tool-key={tool.slug}>
                <span>{tool.index}</span>
                <strong>{text.tools[tool.slug].title}</strong>
                <i><b /></i>
              </div>
            ))}
          </div>
          <footer><span>ONE WORKSPACE AT A TIME</span><strong>EDITOR IN CONTROL</strong></footer>
        </aside>
      </section>

      <section className={styles.facts} aria-label="Tool library facts">
        <div><small>01</small><strong>Local source</strong><span>No media upload</span></div>
        <div><small>02</small><strong>Focused analysis</strong><span>No all-purpose dashboard</span></div>
        <div><small>03</small><strong>Reviewable output</strong><span>You decide what leaves</span></div>
      </section>

      <section className={`${styles.launcher} ambient-host`} aria-labelledby="launcher-title">
        <AmbientLayer seed={4} />
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.kicker}>Tool desk / {String(primaryTools.length).padStart(2, "0")} routes</p>
            <h2 id="launcher-title">Choose the job.<br /><em>Enter its workspace.</em></h2>
          </div>
          <p>Each route opens around one preparation task, one local source and one result you can inspect before export.</p>
        </header>

        <div className={styles.toolStack}>
          {primaryTools.map((tool) => {
            const available = isToolAvailable(tool.slug);
            const toolCopy = text.tools[tool.slug];

            return (
              <article className={styles.toolCard} id={`tool-${tool.slug}`} data-index={tool.index} data-tool-key={tool.slug} key={tool.slug}>
                <div className={styles.toolVisual} aria-hidden="true">
                  <div className={styles.visualHead}>
                    <span>Track {tool.index}</span>
                    <b>{available ? "Ready to use" : "In development"}</b>
                  </div>
                  <ToolIllustration tool={tool.slug} className={styles.visualScene} />
                  <div className={styles.visualOutput}><span>You get</span><strong>{toolCopy.anatomyOutput}</strong></div>
                </div>

                <div className={styles.toolBody}>
                  <div className={styles.toolMeta}>
                    <span>{toolCopy.eyebrow}</span>
                    <b className={available ? styles.ready : styles.building}><i aria-hidden="true" />{available ? copy.available : copy.inBuild}</b>
                  </div>
                  <h3>{toolCopy.title}</h3>
                  <p>{toolCopy.description}</p>
                  <dl>
                    <div><dt>{copy.inputLabel}</dt><dd>{toolCopy.input}</dd></div>
                    <div><dt>{copy.outputLabel}</dt><dd>{toolCopy.output}</dd></div>
                  </dl>
                  <ToolRouteLink className={styles.toolAction} toolSlug={tool.slug} aria-label={`${available ? copy.startTool : copy.previewTool}: ${toolCopy.title}`}>
                    {available ? copy.startTool : copy.previewTool}<span aria-hidden="true">↗</span>
                  </ToolRouteLink>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className={styles.sectionBand} aria-hidden="true" />

      <section className={`${styles.guide} ambient-host`} id="guide" aria-labelledby="guide-title">
        <AmbientLayer seed={9} density={0.7} />
        <div className={styles.guideTitle}>
          <p className={styles.kicker}>{copy.guideEyebrow}</p>
          <h2 id="guide-title">{copy.guideTitle}</h2>
        </div>
        <ol>
          {copy.guideSteps.map((step, index) => (
            <li key={step.title}>
              <span>0{index + 1}</span>
              <div aria-hidden="true" style={{ "--step-fill": `${Math.round(((index + 1) / copy.guideSteps.length) * 100)}%` } as CSSProperties}><i /></div>
              <strong>{step.title}</strong>
              <p>{step.copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.boundary} aria-labelledby="boundary-title">
        <div>
          <p className={styles.kicker}>{copy.boundaryEyebrow}</p>
          <h2 id="boundary-title">{copy.boundaryTitle}</h2>
        </div>
        <p>{copy.boundaryCopy}</p>
        <Link className={styles.boundaryAction} href="/privacy">{copy.boundaryAction}<span aria-hidden="true">→</span></Link>
      </section>
      <SequenceNav
        items={[
          { id: "overview", label: "Overview" },
          { id: "tool-face-recognition", label: "Face Recognition", tool: "face-recognition" },
          { id: "tool-anime-face-recognition", label: "Anime Face Recognition", tool: "anime-face-recognition" },
          { id: "tool-bass-markers", label: "Music & Bass Markers", tool: "bass-markers" },
          { id: "guide", label: "Picking a tool" },
        ]}
      />
    </PublicPageFrame>
  );
}
