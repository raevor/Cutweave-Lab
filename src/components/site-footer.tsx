"use client";

import { BrandMark } from "./brand-mark";
import { useLanguage } from "@/i18n/language-provider";

export function SiteFooter() {
  const { text } = useLanguage();
  return (
    <footer className="site-footer">
      <BrandMark />
      <p>{text.common.footer.line}</p>
      <p className="footer-status"><span aria-hidden="true" /> {text.common.footer.status}</p>
    </footer>
  );
}
