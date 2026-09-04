import Link from "next/link";
import { PublicPageFrame } from "@/components/public-page-frame";
import { ToolRouteLink } from "@/components/tool-route-link";
import { siteCopy as text } from "@/i18n/messages/en";
import { primaryTools } from "@/lib/tool-catalog";
import styles from "./lab.module.css";

const trackPoints = {
  "face-recognition": ["11%", "36%", "63%", "84%"],
  "bass-markers": ["17%", "31%", "55%", "79%", "91%"],
  "clarity-boost": ["24%", "49%", "76%"],
  "anime-face-recognition": ["10%", "32%", "57%", "81%"],
} as const;

export default function LabPage() {
  const copy = text.library;

  return (
    <PublicPageFrame activePage="tools">
      <section className={styles.hero} aria-labelledby="lab-title">
        <div className={styles.heroCopy}>
          <p className={styles.kicker}><span>{copy.eyebrowA}</span><span>{copy.eyebrowB}</span></p>
          <h1 id="lab-title"><span>{copy.titleA}</span><em>{copy.titleB}</em></h1>
          <p>{copy.intro}</p>
          <div className={styles.localStatus}><i aria-hidden="true" />{copy.localNote}</div>
        </div>

        <aside className={styles.dispatch} aria-label="Cutweave tool desk overview">
          <header><span>CUT/WEAVE / TOOL DESK</span><b>04 FOCUSED ROUTES</b></header>
          <div className={styles.dispatchScreen}>
            <div className={styles.dispatchTarget} aria-hidden="true"><i /><i /><i /><i /></div>
            <span className={styles.dispatchLabel}>CHOOSE THE JOB<br />BEFORE THE SOURCE</span>
          </div>
          <div className={styles.dispatchTracks} aria-hidden="true">
            {primaryTools.map((tool) => (
              <div key={tool.slug}>
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

      <section className={styles.launcher} aria-labelledby="launcher-title">
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.kicker}>Tool desk / 04 routes</p>
            <h2 id="launcher-title">Choose the job.<br /><em>Enter its workspace.</em></h2>
          </div>
          <p>Each route opens around one preparation task, one local source and one result you can inspect before export.</p>
        </header>

        <div className={styles.toolStack}>
          {primaryTools.map((tool, index) => {
            const available = tool.slug === "face-recognition" || tool.slug === "anime-face-recognition";
            const toolCopy = text.tools[tool.slug];

            return (
              <article className={styles.toolCard} data-index={tool.index} key={tool.slug}>
                <div className={styles.toolVisual} aria-hidden="true">
                  <div className={styles.visualHead}>
                    <span>TRACK / {tool.index}</span>
                    <b>{available ? "ACTIVE TOOL" : "INTERFACE PREVIEW"}</b>
                  </div>
                  <div className={styles.visualFrame}>
                    <span>{toolCopy.anatomy}</span>
                    <div className={styles.focusBox}><i /><i /><i /><i /></div>
                    <b>{String(index + 1).padStart(2, "0")} / 04</b>
                  </div>
                  <div className={styles.visualTimeline}>
                    <span>00:00</span>
                    <div>
                      {trackPoints[tool.slug].map((left) => <i style={{ left }} key={left} />)}
                      <b style={{ left: `${28 + index * 19}%` }} />
                    </div>
                    <span>END</span>
                  </div>
                  <div className={styles.visualOutput}><span>EXPECTED OUTPUT</span><strong>{toolCopy.anatomyOutput}</strong></div>
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

      <section className={styles.guide} aria-labelledby="guide-title">
        <div className={styles.guideTitle}>
          <p className={styles.kicker}>{copy.guideEyebrow}</p>
          <h2 id="guide-title">{copy.guideTitle}</h2>
        </div>
        <ol>
          {copy.guideSteps.map((step, index) => (
            <li key={step.title}>
              <span>0{index + 1}</span>
              <div aria-hidden="true"><i /></div>
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
    </PublicPageFrame>
  );
}
