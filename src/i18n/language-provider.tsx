"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { isLocale, type Locale } from "./config";
import { messages } from "./messages";
import type { Messages } from "./messages/en";

const STORAGE_KEY = "cutweave.locale";
const listeners = new Set<() => void>();
let memoryLocale: Locale = "en";

function getLocaleSnapshot(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) memoryLocale = stored;
  } catch {
    // Keep the in-memory preference when browser storage is unavailable.
  }
  return memoryLocale;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function setLocalePreference(locale: Locale) {
  memoryLocale = locale;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // The active session still changes language when storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

const getServerLocaleSnapshot = (): Locale => "en";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  text: Messages;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore<Locale>(subscribe, getLocaleSnapshot, getServerLocaleSnapshot);
  const value = useMemo(() => ({ locale, setLocale: setLocalePreference, text: messages[locale] }), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider");
  return context;
}
