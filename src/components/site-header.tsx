import Link from "next/link";
import { siteCopy as text } from "@/i18n/messages/en";
import { BrandMark } from "./brand-mark";

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={compact ? "site-header site-header--compact" : "site-header"}>
      <BrandMark />
      <div className="header-actions">
        <nav className="site-nav" aria-label={text.common.nav.label}>
          <Link href="/#workflow">{text.common.nav.workflow}</Link>
          <Link href="/privacy">{text.common.nav.privacy}</Link>
          <Link className="nav-cta" href="/lab">{text.common.nav.openLab}</Link>
        </nav>
      </div>
    </header>
  );
}
