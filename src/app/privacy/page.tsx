"use client";

import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { useLanguage } from "@/i18n/language-provider";

export default function PrivacyPage() {
  const { text } = useLanguage();
  const copy = text.privacy;
  return (
    <main className="privacy-page">
      <div className="landing-shell">
        <SiteHeader />
        <section className="privacy-hero">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.titleA}<br /><em>{copy.titleB}</em></h1>
          <p>{copy.intro}</p>
          <Link className="button button--primary" href="/lab">{copy.browseTools} <span aria-hidden="true">→</span></Link>
        </section>
        <section className="boundary-list" aria-label={copy.boundaryLabel}>
          {copy.boundaries.map((boundary, index) => (
            <article key={boundary.title}>
              <span>0{index + 1}</span>
              <h2>{boundary.title}</h2>
              <p>{boundary.copy}</p>
            </article>
          ))}
        </section>
        <aside className="foundation-notice">
          <strong>{copy.statusTitle}</strong>
          <p>{copy.statusCopy}</p>
        </aside>
      </div>
      <SiteFooter />
    </main>
  );
}
