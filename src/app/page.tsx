import Link from "next/link";
import { ShowcaseHeader } from "@/components/showcase-header";
import { SiteFooter } from "@/components/site-footer";
import { siteCopy as text } from "@/i18n/messages/en";
import { primaryTools } from "@/lib/tool-catalog";
import styles from "./home.module.css";

const toolTracks = {
  "face-recognition": ["12%", "34%", "58%", "82%"],
  "bass-markers": ["17%", "43%", "67%", "88%"],
  "clarity-boost": ["9%", "38%", "72%"],
} as const;

export default function HomePage() {
  const copy = text.home;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <ShowcaseHeader />

        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.kicker}><span>{copy.eyebrowA}</span><span>{copy.eyebrowB}</span></p>
            <h1 id="hero-title">
              <span>{copy.titleLine1}</span>
              <span>{copy.titleLine2}</span>
              <em>{copy.titleLine3}</em>
            </h1>
            <p className={styles.lede}>{copy.lede}</p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/lab/face-recognition">
                {copy.primaryAction}<span aria-hidden="true">↗</span>
              </Link>
              <Link className={styles.secondaryAction} href="/lab">
                {copy.secondaryAction}<span aria-hidden="true">→</span>
              </Link>
            </div>
            <p className={styles.localStatus}><i aria-hidden="true" />{copy.privacyNote}</p>
          </div>

          <div className={styles.signalMap} role="img" aria-label={copy.heroMapAria}>
            <div className={styles.mapHead}>
              <span>{copy.heroMapLabel}</span>
              <span>{copy.heroMapNote}</span>
            </div>
            <div className={styles.timeRail} aria-hidden="true">
              <span>00:00</span><span>12:16</span><span>28:42</span><span>44:08</span>
            </div>
            <div className={styles.trackField} aria-hidden="true">
              <div className={styles.playhead}><i /></div>
              {primaryTools.map((tool) => (
                <div className={`${styles.track} ${styles[`track_${tool.accent}`]}`} key={tool.slug}>
                  <span>{tool.index}</span>
                  <strong>{text.tools[tool.slug].title}</strong>
                  <div className={styles.trackLine}>
                    {toolTracks[tool.slug].map((left, index) => <i style={{ left }} key={`${left}-${index}`} />)}
                  </div>
                  <small>{tool.slug === "face-recognition" ? copy.available : copy.inBuild}</small>
                </div>
              ))}
            </div>
            <div className={styles.mapOutput}>
              <span>{copy.heroOutput}</span>
              <strong>{copy.heroOutputValue}</strong>
              <b aria-hidden="true">/</b>
            </div>
          </div>
        </section>

        <section className={styles.proofStrip} aria-label={copy.principlesLabel}>
          {copy.facts.map((fact) => (
            <div key={fact.label}><strong>{fact.value}</strong><span>{fact.label}</span></div>
          ))}
        </section>

        <section className={styles.tools} aria-labelledby="home-tools-title">
          <header className={styles.sectionHead}>
            <p className={styles.kicker}>{copy.toolsEyebrow}</p>
            <h2 id="home-tools-title">{copy.toolsTitleA}<br /><em>{copy.toolsTitleB}</em></h2>
            <p>{copy.toolsIntro}</p>
          </header>

          <div className={styles.toolList}>
            {primaryTools.map((tool) => {
              const available = tool.slug === "face-recognition";
              return (
                <article className={`${styles.toolRow} ${styles[`tool_${tool.accent}`]}`} id={tool.slug} key={tool.slug}>
                  <div className={styles.toolIndex}><span>{tool.index}</span><i aria-hidden="true" /></div>
                  <div className={styles.toolMain}>
                    <p>{text.tools[tool.slug].eyebrow}</p>
                    <h3>{text.tools[tool.slug].title}</h3>
                    <p>{text.tools[tool.slug].description}</p>
                  </div>
                  <dl className={styles.toolContract}>
                    <div><dt>{copy.inputLabel}</dt><dd>{text.tools[tool.slug].input}</dd></div>
                    <div><dt>{copy.outputLabel}</dt><dd>{text.tools[tool.slug].output}</dd></div>
                  </dl>
                  <div className={styles.toolLaunch}>
                    <span className={available ? styles.statusReady : styles.statusBuild}><i aria-hidden="true" />{available ? copy.available : copy.inBuild}</span>
                    <Link href={`/lab/${tool.slug}`} aria-label={`${available ? copy.startTool : copy.previewTool}: ${text.tools[tool.slug].title}`}>
                      <span>{available ? copy.startTool : copy.previewTool}</span><b aria-hidden="true">↗</b>
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.workflow} id="workflow" aria-labelledby="workflow-title">
          <div className={styles.workflowTitle}>
            <p className={styles.kicker}>{copy.workflowEyebrow}</p>
            <h2 id="workflow-title">{copy.workflowTitleA}<br /><em>{copy.workflowTitleB}</em></h2>
          </div>
          <div className={styles.workflowSteps}>
            {copy.workflow.map((step, index) => (
              <article key={step.title}>
                <span>0{index + 1}</span>
                <div aria-hidden="true"><i /></div>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.localProof} aria-labelledby="local-title">
          <div className={styles.localCopy}>
            <p className={styles.kicker}>{copy.localEyebrow}</p>
            <h2 id="local-title">{copy.localTitleA}<br /><em>{copy.localTitleB}</em></h2>
            <p>{copy.localCopy}</p>
            <Link href="/privacy">{copy.localLink}<span aria-hidden="true">→</span></Link>
          </div>
          <div className={styles.localDiagram} aria-label={copy.routeAria}>
            <div className={styles.localDiagramHead}><span>{copy.routeTitle}</span><b>{copy.routeStatus}</b></div>
            <div className={styles.boundary}>
              <div><small>01 / {copy.routeDevice}</small><strong>{copy.routeFile}</strong></div>
              <span aria-hidden="true">→</span>
              <div className={styles.browserNode}><small>02 / {copy.routeBrowser}</small><strong>{copy.routeWorkspace}</strong></div>
              <span aria-hidden="true">→</span>
              <div><small>03 / {copy.routeDevice}</small><strong>{copy.routeExport}</strong></div>
            </div>
            <div className={styles.blockedRoute}><span aria-hidden="true">×</span><small>{copy.routeCloud}</small><strong>{copy.routeCloudStatus}</strong></div>
          </div>
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
