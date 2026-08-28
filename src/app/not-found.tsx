"use client";

import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { useLanguage } from "@/i18n/language-provider";

export default function NotFound() {
  const { text } = useLanguage();
  const copy = text.notFound;
  return (
    <main className="not-found">
      <BrandMark />
      <p className="eyebrow">{copy.eyebrow}</p>
      <h1>{copy.titleA}<br />{copy.titleB}</h1>
      <Link className="button button--primary" href="/">{copy.home}</Link>
    </main>
  );
}
