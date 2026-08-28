"use client";

import Image, { type StaticImageData } from "next/image";
import { useEffect, useRef, useState } from "react";
import enFlag from "../../assets/eu-flag.png";
import trFlag from "../../assets/tr-flag.png";
import { localeLabels, locales, type Locale } from "@/i18n/config";
import { useLanguage } from "@/i18n/language-provider";

const flags: Record<Locale, StaticImageData> = { en: enFlag, tr: trFlag };

function FlagIcon({ locale, size = 28 }: { locale: Locale; size?: number }) {
  return (
    <span className="language-flag" style={{ width: size, height: size }}>
      <Image src={flags[locale]} alt="" width={size * 2} height={size * 2} sizes={`${size}px`} unoptimized priority={locale === "en"} />
    </span>
  );
}

export function LanguageSwitcher({ dark = false }: { dark?: boolean }) {
  const { locale, setLocale, text } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
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
    <div className={dark ? "language-switcher language-switcher--dark" : "language-switcher"} ref={rootRef}>
      <button
        className="language-current"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`${text.common.language.current}: ${localeLabels[locale].nativeName}. ${text.common.language.label}`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <FlagIcon locale={locale} />
        <span className="language-current-code" aria-hidden="true">{localeLabels[locale].short}</span>
        <svg className="language-chevron" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>

      <div className={open ? "language-menu language-menu--open" : "language-menu"} role="menu" aria-label={text.common.language.label} aria-hidden={!open}>
        <div className="language-menu-head" aria-hidden="true">
          <span>{text.common.language.label}</span>
          <small>02</small>
        </div>
        {locales.map((option) => (
          <button
            className={option === locale ? "language-option language-option--active" : "language-option"}
            type="button"
            role="menuitemradio"
            aria-checked={option === locale}
            tabIndex={open ? 0 : -1}
            key={option}
            onClick={() => {
              setLocale(option);
              setOpen(false);
            }}
          >
            <FlagIcon locale={option} size={30} />
            <span className="language-option-name">
              <strong>{localeLabels[option].nativeName}</strong>
              <small>{localeLabels[option].short}</small>
            </span>
            <span className="language-option-state" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
