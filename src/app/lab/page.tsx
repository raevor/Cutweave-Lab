import Link from "next/link";
import { ShowcaseHeader } from "@/components/showcase-header";
import { SiteFooter } from "@/components/site-footer";
import { siteCopy as text } from "@/i18n/messages/en";
import { primaryTools } from "@/lib/tool-catalog";
import styles from "./lab.module.css";

export default function LabPage() {
  const copy = text.library;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <ShowcaseHeader />

        <section className={styles.hero} aria-labelledby="lab-title">
          <div>
            <p className={styles.kicker}><span>{copy.eyebrowA}</span><span>{copy.eyebrowB}</span></p>
            <h1 id="lab-title">{copy.titleA}<br /><em>{copy.titleB}</em></h1>
          </div>
          <div className={styles.heroIntro}>
            <p>{copy.intro}</p>
            <div><i aria-hidden="true" />{copy.localNote}</div>
          </div>
        </section>

        <section className={styles.launcher} aria-label={copy.toolsLabel}>
          <header className={styles.launcherHead}>
            <span>{copy.launcherLabel}</span>
            <span>{copy.launcherHint}</span>
            <span>{copy.launcherCount}</span>
          </header>

          {primaryTools.map((tool) => {
            const available = tool.slug === "face-recognition";
            const toolCopy = text.tools[tool.slug];
            return (
              <Link
                className={`${styles.tool} ${styles[`tool_${tool.accent}`]}`}
                href={`/lab/${tool.slug}`}
                aria-label={`${available ? copy.startTool : copy.previewTool}: ${toolCopy.title}`}
                key={tool.slug}
              >
                <div className={styles.toolNumber}>
                  <span>{tool.index}</span>
                  <i aria-hidden="true" />
                </div>

                <div className={styles.toolIdentity}>
                  <p>{toolCopy.eyebrow}</p>
                  <h2>{toolCopy.title}</h2>
                  <p>{toolCopy.shortTitle}</p>
                </div>

                <div className={styles.toolAnatomy} aria-hidden="true">
                  <div className={styles.anatomyTop}><span>{copy.inputLabel}</span><b>{toolCopy.input}</b></div>
                  <div className={styles.anatomyRail}>
                    <i /><i /><i />
                    <span />
                  </div>
                  <div className={styles.anatomyBottom}><span>{copy.outputLabel}</span><b>{toolCopy.output}</b></div>
                </div>

                <div className={styles.toolAction}>
                  <span className={available ? styles.ready : styles.building}><i aria-hidden="true" />{available ? copy.available : copy.inBuild}</span>
                  <strong>{available ? copy.startTool : copy.previewTool}<b aria-hidden="true">↗</b></strong>
                </div>
              </Link>
            );
          })}
        </section>

        <section className={styles.guide} aria-labelledby="guide-title">
          <div className={styles.guideLead}>
            <p className={styles.kicker}>{copy.guideEyebrow}</p>
            <h2 id="guide-title">{copy.guideTitle}</h2>
          </div>
          <ol>
            {copy.guideSteps.map((step, index) => (
              <li key={step.title}>
                <span>0{index + 1}</span>
                <strong>{step.title}</strong>
                <p>{step.copy}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.boundary} aria-label={copy.boundaryLabel}>
          <div><span>{copy.boundaryEyebrow}</span><strong>{copy.boundaryTitle}</strong></div>
          <p>{copy.boundaryCopy}</p>
          <Link href="/privacy">{copy.boundaryAction}<span aria-hidden="true">→</span></Link>
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
