"use client";

import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { useLanguage } from "@/i18n/language-provider";

export default function HomePage() {
  const { text } = useLanguage();
  const copy = text.home;
  return (
    <main>
      <div className="landing-shell">
        <SiteHeader />

        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span>{copy.eyebrowA}</span><span>{copy.eyebrowB}</span></p>
            <h1 id="hero-title">{copy.titleLead}<br /><em>{copy.titleEmphasis}</em></h1>
            <p className="hero-lede">
              {copy.lede}
            </p>
            <div className="hero-actions">
              <Link className="button button--primary" href="/lab">{copy.browseTools} <span aria-hidden="true">↗</span></Link>
            </div>
            <p className="privacy-note"><span className="privacy-pulse" aria-hidden="true" /> {copy.privacyNote}</p>
          </div>

          <div className="hero-instrument" aria-label={copy.previewAria}>
            <div className="instrument-head">
              <span>{copy.previewLabel}</span>
              <span className="mono">00:00:24:18</span>
            </div>
            <div className="time-ruler" aria-hidden="true">
              <span>00:00</span><span>00:08</span><span>00:16</span><span>00:24</span>
            </div>
            <div className="result-preview" aria-hidden="true">
              <div className="playhead" />
              <div className="preview-track scenes"><b>{copy.faceScenes}</b><i /><i /><i /><i /><i /></div>
              <div className="preview-track subject"><b>{copy.selectedFace}</b><span className="match-line" /></div>
              <div className="preview-track beats"><b>{copy.bassMarkers}</b>{Array.from({ length: 14 }, (_, index) => <i key={index} style={{ height: `${16 + ((index * 13) % 34)}%` }} />)}</div>
            </div>
            <div className="instrument-foot">
              <div><small>{copy.scenesFound}</small><strong>05</strong></div>
              <div><small>{copy.markersFound}</small><strong>14</strong></div>
              <div><small>{copy.mediaSent}</small><strong className="signal-text">0 B</strong></div>
            </div>
          </div>
        </section>

        <section className="manifesto-strip" aria-label={copy.principlesLabel}>
          {copy.principles.map((principle) => <span key={principle}>{principle}</span>)}
        </section>

        <section className="workflow-section" id="workflow" aria-labelledby="workflow-title">
          <div className="section-heading">
            <p className="eyebrow">{copy.workflowEyebrow}</p>
            <h2 id="workflow-title">{copy.workflowTitleA}<br />{copy.workflowTitleB}</h2>
          </div>
          <div className="workflow-list">
            {copy.workflow.map((step, index) => (
              <article className="workflow-row" key={step.title}>
                <span className="workflow-index">0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="local-proof" aria-labelledby="local-title">
          <div>
            <p className="eyebrow">{copy.localEyebrow}</p>
            <h2 id="local-title">{copy.localTitleA}<br /><em>{copy.localTitleB}</em></h2>
          </div>
          <div className="local-proof-copy">
            <p>{copy.localCopy}</p>
            <Link className="text-link" href="/privacy">{copy.localLink} <span aria-hidden="true">→</span></Link>
          </div>
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
