import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageFrame } from "@/components/public-page-frame";
import { siteCopy as text } from "@/i18n/messages/en";
import { NotFoundScene } from "./not-found-scene";
import styles from "./not-found.module.css";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  const copy = text.notFound;
  return (
    <PublicPageFrame>
      <div className={styles.shell}>
        <section className={styles.copy} aria-labelledby="not-found-title">
          <p className={styles.kicker}>{copy.eyebrow}</p>
          <h1 id="not-found-title">{copy.titleA}<br /><em>{copy.titleB}</em></h1>
          <p className={styles.lede}>{copy.body}</p>
          <div className={styles.actions}>
            <Link className={styles.primaryAction} href="/">{copy.home}<span aria-hidden="true">↗</span></Link>
            <Link className={styles.secondaryAction} href="/lab">{copy.desk}<span aria-hidden="true">→</span></Link>
          </div>
        </section>
        <NotFoundScene />
      </div>
    </PublicPageFrame>
  );
}
