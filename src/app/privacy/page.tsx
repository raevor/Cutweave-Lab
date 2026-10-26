import type { Metadata } from "next";
import Link from "next/link";
import { AmbientLayer } from "@/components/ambient-layer";
import { PublicPageFrame } from "@/components/public-page-frame";
import { siteCopy as text } from "@/i18n/messages/en";
import { PrivacyDiagram } from "./privacy-diagram";
import { SequenceNav } from "@/components/sequence-nav";
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
        <section className={`${styles.hero} ambient-host`} id="overview" aria-labelledby="privacy-title">
          <AmbientLayer seed={12} density={0.6} />
          <div className={styles.heroCopy}>
            <p className={styles.kicker}><span>{copy.eyebrowA}</span><span>{copy.eyebrowB}</span></p>
            <h1 id="privacy-title"><span>{copy.titleA}</span> <em>{copy.titleB}</em></h1>
            <p className={styles.intro}>{copy.intro}</p>
            <div className={styles.actions}>
              <Link className={styles.primaryAction} href="/lab">{copy.primaryAction}<span aria-hidden="true">↗</span></Link>
              <Link className={styles.secondaryAction} href="/lab/face-recognition">{copy.secondaryAction}<span aria-hidden="true">→</span></Link>
            </div>
          </div>
          <div className={styles.heroVisual}><PrivacyDiagram /></div>
        </section>

        <section className={styles.facts} aria-label={copy.factsLabel}>
          {copy.facts.map((fact) => (
            <div key={fact.label}><strong>{fact.value}</strong><span>{fact.label}</span></div>
          ))}
        </section>

        <section className={`${styles.flow} ambient-host`} id="flow" aria-labelledby="flow-title">
          <AmbientLayer seed={13} density={0.6} />
          <header className={styles.sectionHead}>
            <h2 id="flow-title">{copy.flowTitle}</h2>
            <p>{copy.flowIntro}</p>
          </header>
          <div className={styles.flowGrid}>
            <article className={styles.inbound}>
              <div className={styles.flowIcon} aria-hidden="true">
                <svg viewBox="0 0 40 40"><path d="M20 6 V28 M11 19 L20 28 L29 19 M8 34 H32" /></svg>
              </div>
              <h3>{copy.inbound.title}</h3>
              <ul>{copy.inbound.items.map((item) => <li key={item}>{item}</li>)}</ul>
              <p>{copy.inbound.note}</p>
              <div className={styles.credits}>
                <h4>{copy.inbound.creditsTitle}</h4>
                <dl>
                  {copy.inbound.credits.map((credit) => (
                    <div key={credit.tool}><dt>{credit.tool}</dt><dd>{credit.model}</dd></div>
                  ))}
                </dl>
              </div>
            </article>
            <article className={styles.outbound}>
              <div className={styles.flowIcon} aria-hidden="true">
                <svg viewBox="0 0 40 40"><rect x="9" y="18" width="22" height="16" rx="3" /><path d="M14 18 V13 a6 6 0 0 1 12 0 V18" /></svg>
              </div>
              <h3>{copy.outbound.title}</h3>
              <ul>{copy.outbound.items.map((item) => <li key={item}>{item}</li>)}</ul>
              <p>{copy.outbound.note}</p>
            </article>
          </div>
        </section>

        <section className={styles.steps} id="steps" aria-labelledby="steps-title">
          <h2 id="steps-title">{copy.stepsTitle}</h2>
          <ol>
            {copy.steps.map((step, index) => (
              <li key={step.title}>
                <span className={styles.stepDot} aria-hidden="true">{index + 1}</span>
                <strong>{step.title}</strong>
                <p>{step.copy}</p>
              </li>
            ))}
            <i className={styles.stepHead} aria-hidden="true" />
          </ol>
        </section>

        <section className={`${styles.face} ambient-host`} id="face-scope" data-tool-key="face-recognition" aria-labelledby="face-title">
          <AmbientLayer seed={14} density={0.5} />
          <header className={styles.sectionHead}>
            <h2 id="face-title">{copy.faceTitleA} <em>{copy.faceTitleB}</em></h2>
            <p>{copy.faceIntro}</p>
          </header>
          <div className={styles.scope}>
            <article className={styles.does}>
              <h3>{copy.faceDoesTitle}</h3>
              <ul>{copy.faceDoes.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
            <article className={styles.doesNot}>
              <h3>{copy.faceDoesNotTitle}</h3>
              <ul>{copy.faceDoesNot.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          </div>
        </section>

        <aside className={styles.closing} id="control" aria-labelledby="responsibility-title">
          <h2 id="responsibility-title">{copy.responsibilityTitle}</h2>
          <div>
            <p>{copy.responsibilityCopy}</p>
            <small>{copy.responsibilityNote}</small>
          </div>
        </aside>
      </div>
      <SequenceNav
        items={[
          { id: "overview", label: "Overview" },
          { id: "flow", label: "What moves" },
          { id: "steps", label: "Every step" },
          { id: "face-scope", label: "Face Recognition scope", tool: "face-recognition" },
          { id: "control", label: "Your control" },
        ]}
      />
    </PublicPageFrame>
  );
}
