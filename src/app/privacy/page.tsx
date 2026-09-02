import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageFrame } from "@/components/public-page-frame";
import { siteCopy as text } from "@/i18n/messages/en";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Privacy & Local Processing",
  description: "How Cutweave keeps working media, face data, analysis and exports on the user's device.",
};

export default function PrivacyPage() {
  const copy = text.privacy;

  return (
    <PublicPageFrame activePage="privacy">
      <div className={styles.shell}>
        <section className={styles.hero} aria-labelledby="privacy-title">
          <div className={styles.heroCopy}>
            <p className={styles.kicker}><span>{copy.eyebrowA}</span><span>{copy.eyebrowB}</span></p>
            <h1 id="privacy-title"><span>{copy.titleA}</span><em>{copy.titleB}</em></h1>
            <p className={styles.intro}>{copy.intro}</p>
            <div className={styles.actions}>
              <Link className={styles.primaryAction} href="/lab">{copy.primaryAction}<span aria-hidden="true">↗</span></Link>
              <Link className={styles.secondaryAction} href="/lab/face-recognition">{copy.secondaryAction}<span aria-hidden="true">→</span></Link>
            </div>
          </div>

          <aside className={styles.proof} aria-label={copy.proofLabel}>
            <div className={styles.proofHead}><span>{copy.proofLabel}</span><i aria-hidden="true" /></div>
            <strong>{copy.proofValue}</strong>
            <div className={styles.proofStatus}><i aria-hidden="true" />{copy.proofStatus}</div>
            <p>{copy.proofNote}</p>
          </aside>
        </section>

        <section className={styles.factStrip} aria-label={copy.factsLabel}>
          {copy.facts.map((fact) => <div key={fact.label}><strong>{fact.value}</strong><span>{fact.label}</span></div>)}
        </section>

        <section className={styles.handling} aria-labelledby="handling-title">
          <header className={styles.sectionHead}>
            <div>
              <p className={styles.kicker}>{copy.handlingEyebrow}</p>
              <h2 id="handling-title">{copy.handlingTitleA}<br /><em>{copy.handlingTitleB}</em></h2>
            </div>
            <p>{copy.handlingIntro}</p>
          </header>
          <ol className={styles.policyList} aria-label={copy.handlingLabel}>
            {copy.handling.map((item, index) => (
              <li key={item.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.title}</strong>
                <p>{item.copy}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.route} aria-labelledby="route-title">
          <header>
            <p className={styles.kicker}>{copy.routeEyebrow}</p>
            <h2 id="route-title">{copy.routeTitle}</h2>
          </header>
          <div className={styles.routeDiagram} role="img" aria-label={copy.routeAria}>
            <div className={styles.routeCloud}><span>{copy.routeCloud}</span><strong>{copy.routeCloudStatus}</strong></div>
            <div className={styles.routeTrack}>
              {copy.routeSteps.map((step, index) => (
                <div className={styles.routeStep} key={step}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{step}</strong>
                  {index < copy.routeSteps.length - 1 ? <i aria-hidden="true" /> : null}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.faceScope} aria-labelledby="face-scope-title">
          <header>
            <p className={styles.kicker}>{copy.faceEyebrow}</p>
            <h2 id="face-scope-title">{copy.faceTitle}</h2>
            <p>{copy.faceIntro}</p>
          </header>
          <div className={styles.scopeColumns}>
            <article className={styles.does}>
              <h3><span aria-hidden="true">✓</span>{copy.faceDoesTitle}</h3>
              <ul>{copy.faceDoes.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
            <article className={styles.doesNot}>
              <h3><span aria-hidden="true">×</span>{copy.faceDoesNotTitle}</h3>
              <ul>{copy.faceDoesNot.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          </div>
        </section>

        <section className={styles.network} aria-labelledby="network-title">
          <div className={styles.networkCopy}>
            <p className={styles.kicker}>{copy.networkEyebrow}</p>
            <h2 id="network-title">{copy.networkTitle}</h2>
            <p>{copy.networkCopy}</p>
          </div>
          <dl>
            {copy.networkItems.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
          </dl>
        </section>

        <aside className={styles.responsibility} aria-labelledby="responsibility-title">
          <div>
            <p className={styles.kicker}>{copy.responsibilityEyebrow}</p>
            <h2 id="responsibility-title">{copy.responsibilityTitle}</h2>
          </div>
          <div>
            <p>{copy.responsibilityCopy}</p>
            <small>{copy.responsibilityNote}</small>
          </div>
        </aside>
      </div>
    </PublicPageFrame>
  );
}
