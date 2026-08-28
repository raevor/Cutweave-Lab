"use client";

import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ToolVisual } from "@/components/tool-visual";
import { primaryTools } from "@/lib/tool-catalog";
import { useLanguage } from "@/i18n/language-provider";

export default function LabPage() {
  const { text } = useLanguage();
  const copy = text.library;
  return (
    <main className="tool-library-page">
      <div className="tool-library-shell">
        <SiteHeader dark />
        <section className="tool-library-hero">
          <div>
            <p className="eyebrow"><span>{copy.eyebrowA}</span><span>{copy.eyebrowB}</span></p>
            <h1>{copy.titleA}<br /><em>{copy.titleB}</em></h1>
          </div>
          <div className="tool-library-intro">
            <p>{copy.intro}</p>
            <div><span className="privacy-pulse" /> {copy.localNote}</div>
          </div>
        </section>

        <section className="tool-card-grid" aria-label={copy.toolsLabel}>
          {primaryTools.map((tool) => (
            <Link className={`tool-card tool-card--${tool.accent}`} href={`/lab/${tool.slug}`} key={tool.slug}>
              <div className="tool-card-topline"><span>{tool.index} / {copy.cardLabel}</span><b>{copy.openTool} ↗</b></div>
              <ToolVisual tool={tool.slug} anatomyLabel={text.tools[tool.slug].anatomy} outputLabel={text.focused.output} outputValue={text.tools[tool.slug].anatomyOutput} beforeLabel={text.focused.before} afterLabel={text.focused.after} markerAxisLabel={text.focused.markerAxisLabel} />
              <div className="tool-card-copy">
                <div>
                  <p>{text.tools[tool.slug].eyebrow}</p>
                  <h2>{text.tools[tool.slug].title}</h2>
                </div>
                <p>{text.tools[tool.slug].description}</p>
              </div>
            </Link>
          ))}
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
