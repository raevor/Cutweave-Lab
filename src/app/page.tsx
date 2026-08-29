"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef } from "react";
import faceRecognitionHero from "../../assets/face-recognition-hero.png";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ToolVisual } from "@/components/tool-visual";
import { useLanguage } from "@/i18n/language-provider";
import type { ToolSlug } from "@/lib/tool-catalog";

const homeTools: Array<{ slug: ToolSlug; index: string; accent: "rust" | "blue" | "signal" }> = [
  { slug: "face-recognition", index: "01", accent: "rust" },
  { slug: "bass-markers", index: "02", accent: "blue" },
  { slug: "clarity-boost", index: "03", accent: "signal" },
];

export default function HomePage() {
  const { text } = useLanguage();
  const copy = text.home;
  const previewScrollFrame = useRef<number | null>(null);

  function scrollToFaceRecognition(event: React.MouseEvent<HTMLAnchorElement>) {
    const target = document.getElementById("face-recognition");
    if (!target) return;

    event.preventDefault();
    const targetY = window.scrollY + target.getBoundingClientRect().top - 24;
    const startY = window.scrollY;
    const distance = targetY - startY;

    if (previewScrollFrame.current !== null) {
      window.cancelAnimationFrame(previewScrollFrame.current);
    }

    const duration = 950;
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      window.scrollTo({ top: startY + distance * eased });

      if (progress < 1) {
        previewScrollFrame.current = window.requestAnimationFrame(animate);
      } else {
        previewScrollFrame.current = null;
        if (window.location.hash !== "#face-recognition") {
          window.history.pushState(null, "", "#face-recognition");
        }
      }
    };

    previewScrollFrame.current = window.requestAnimationFrame(animate);
  }

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

          <a
            className="hero-instrument"
            href="#face-recognition"
            aria-label={copy.previewLinkAria}
            onClick={scrollToFaceRecognition}
          >
            <Image
              className="hero-instrument-image"
              src={faceRecognitionHero}
              alt=""
              sizes="(max-width: 900px) 100vw, 48vw"
              preload
              unoptimized
            />
            <span className="hero-instrument-cue">{copy.previewJump} <span aria-hidden="true">↓</span></span>
          </a>
        </section>

        <section className="manifesto-strip" aria-label={copy.principlesLabel}>
          {copy.principles.map((principle) => <span key={principle}>{principle}</span>)}
        </section>

        <section className="home-tools" aria-labelledby="home-tools-title">
          <div className="home-tools-heading">
            <div>
              <p className="eyebrow">{copy.toolsEyebrow}</p>
              <h2 id="home-tools-title">{copy.toolsTitleA}<br /><em>{copy.toolsTitleB}</em></h2>
            </div>
            <p>{copy.toolsIntro}</p>
          </div>

          <div className="home-tool-stack" aria-label={copy.toolsLabel}>
            {homeTools.map(({ slug, index, accent }) => {
              const tool = text.tools[slug];
              return (
                <article className={`home-tool-panel home-tool-panel--${accent}`} id={slug} key={slug}>
                  <div className="home-tool-meta">
                    <span>{index} / {tool.eyebrow}</span>
                    <span><i aria-hidden="true" /> {copy.localTool}</span>
                  </div>
                  <div className="home-tool-layout">
                    <div className="home-tool-copy">
                      <p>{tool.shortTitle}</p>
                      <h3>{tool.title}</h3>
                      <p className="home-tool-description">{tool.description}</p>
                      <dl>
                        <div><dt>{copy.inputLabel}</dt><dd>{tool.input}</dd></div>
                        <div><dt>{copy.outputLabel}</dt><dd>{tool.output}</dd></div>
                      </dl>
                      <Link className="home-tool-link" href={`/lab/${slug}`}>{copy.openTool} <span aria-hidden="true">↗</span></Link>
                    </div>
                    <div className={`home-tool-visual${slug === "face-recognition" ? " home-tool-visual--feature" : ""}`}>
                      {slug === "face-recognition" ? (
                        <Image
                          className="home-tool-feature-image"
                          src={faceRecognitionHero}
                          alt=""
                          sizes="(max-width: 980px) 100vw, 58vw"
                          unoptimized
                        />
                      ) : (
                        <ToolVisual
                          tool={slug}
                          anatomyLabel={tool.anatomy}
                          outputLabel={copy.previewOutput}
                          outputValue={tool.anatomyOutput}
                          beforeLabel={text.focused.before}
                          afterLabel={text.focused.after}
                          markerAxisLabel={text.focused.markerAxisLabel}
                        />
                      )}
                      <span className="interface-note">{copy.interfacePreview}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="workflow-section" id="workflow" aria-labelledby="workflow-title">
          <div className="section-heading">
            <p className="eyebrow">{copy.workflowEyebrow}</p>
            <h2 id="workflow-title">{copy.workflowTitleA}<br />{copy.workflowTitleB}</h2>
            <p>{copy.workflowIntro}</p>
          </div>
          <div className="workflow-list">
            {copy.workflow.map((step, index) => (
              <article className="workflow-row" key={step.title}>
                <span className="workflow-index">0{index + 1}</span>
                <span className="workflow-route" aria-hidden="true"><i /></span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="local-proof" aria-labelledby="local-title">
          <div className="local-proof-copy">
            <p className="eyebrow">{copy.localEyebrow}</p>
            <h2 id="local-title">{copy.localTitleA}<br /><em>{copy.localTitleB}</em></h2>
            <p>{copy.localCopy}</p>
            <Link className="text-link" href="/privacy">{copy.localLink} <span aria-hidden="true">→</span></Link>
          </div>
          <div className="local-route-card">
            <div className="local-route-head">
              <span>{copy.routeTitle}</span>
              <span>{copy.routeStatus}</span>
            </div>
            <div className="local-route-main" aria-label={copy.routeAria}>
              <div className="local-route-node">
                <small>01</small><span>{copy.routeDevice}</span><strong>{copy.routeFile}</strong>
              </div>
              <span className="local-route-arrow" aria-hidden="true">→</span>
              <div className="local-route-node local-route-node--active">
                <small>02</small><span>{copy.routeBrowser}</span><strong>{copy.routeWorkspace}</strong>
              </div>
              <span className="local-route-arrow" aria-hidden="true">→</span>
              <div className="local-route-node">
                <small>03</small><span>{copy.routeDevice}</span><strong>{copy.routeExport}</strong>
              </div>
            </div>
            <div className="cloud-detour">
              <span aria-hidden="true">×</span>
              <div><small>{copy.routeCloud}</small><strong>{copy.routeCloudStatus}</strong></div>
            </div>
            <div className="local-facts">
              {copy.localFacts.map((fact) => <span key={fact}><i aria-hidden="true" /> {fact}</span>)}
            </div>
          </div>
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
