export const locales = ["en", "tr"] as const;
export type Locale = (typeof locales)[number];

export const localeLabels: Record<Locale, { nativeName: string; short: string }> = {
  en: { nativeName: "English", short: "EN" },
  tr: { nativeName: "Türkçe", short: "TR" },
};

export function isLocale(value: string | null): value is Locale {
  return value !== null && locales.includes(value as Locale);
}
