import { BrandMark } from "./brand-mark";
import { siteCopy as text } from "@/i18n/messages/en";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <BrandMark />
      <p>{text.common.footer.line}</p>
      <p className="footer-status"><span aria-hidden="true" /> {text.common.footer.status}</p>
    </footer>
  );
}
