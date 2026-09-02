"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { siteCopy as text } from "@/i18n/messages/en";
import { primaryTools } from "@/lib/tool-catalog";
import { BrandMark } from "./brand-mark";
import styles from "./showcase-header.module.css";

export function ShowcaseHeader() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <header className={styles.header}>
      <BrandMark />
      <div className={styles.actions}>
        <nav className={styles.nav} aria-label={text.common.nav.label}>
          <Link href="/#workflow">{text.common.nav.workflow}</Link>
          <Link href="/privacy">{text.common.nav.privacy}</Link>
        </nav>
        <div className={styles.toolMenu} ref={menuRef}>
          <button
            className={styles.toolTrigger}
            type="button"
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => setOpen((value) => !value)}
          >
            <span>{text.common.nav.openLab}</span>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </button>
          <div className={open ? `${styles.menu} ${styles.menuOpen}` : styles.menu} role="menu" aria-hidden={!open}>
            <div className={styles.menuHead}>
              <span>{text.common.nav.menuLabel}</span>
              <span>03</span>
            </div>
            {primaryTools.map((tool) => {
              const available = tool.slug === "face-recognition";
              return (
                <Link
                  className={styles.menuTool}
                  href={`/lab/${tool.slug}`}
                  role="menuitem"
                  tabIndex={open ? 0 : -1}
                  key={tool.slug}
                  onClick={() => setOpen(false)}
                >
                  <small>{tool.index}</small>
                  <span>
                    <strong>{text.tools[tool.slug].title}</strong>
                    <em>{available ? text.common.nav.available : text.common.nav.inBuild}</em>
                  </span>
                  <b aria-hidden="true">↗</b>
                </Link>
              );
            })}
            <Link className={styles.menuAll} href="/lab" role="menuitem" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}>
              {text.common.nav.viewAll} <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
