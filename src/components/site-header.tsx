"use client";

import Link from "next/link";
import { useLanguage } from "@/i18n/language-provider";
import { BrandMark } from "./brand-mark";
import { LanguageSwitcher } from "./language-switcher";

export function SiteHeader({ compact = false, dark = false }: { compact?: boolean; dark?: boolean }) {
  const { text } = useLanguage();
  return (
    <header className={compact ? "site-header site-header--compact" : "site-header"}>
      <BrandMark />
      <div className="header-actions">
        <LanguageSwitcher dark={compact || dark} />
        <nav className="site-nav" aria-label={text.common.nav.label}>
          <Link href="/#workflow">{text.common.nav.workflow}</Link>
          <Link href="/privacy">{text.common.nav.privacy}</Link>
          <Link className="nav-cta" href="/lab">{text.common.nav.openLab}</Link>
        </nav>
      </div>
    </header>
  );
}
