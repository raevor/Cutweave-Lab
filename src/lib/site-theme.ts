export type SiteTheme = "light" | "dark";

export const SITE_THEME_STORAGE_KEY = "cutweave-home-theme";
export const DEFAULT_SITE_THEME: SiteTheme = "dark";

export function readSiteTheme(): SiteTheme {
  if (typeof window === "undefined") return DEFAULT_SITE_THEME;

  try {
    const savedTheme = window.localStorage.getItem(SITE_THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  } catch {
    // Fall back to the default when browser storage is unavailable.
  }

  return DEFAULT_SITE_THEME;
}

export function applySiteTheme(theme: SiteTheme, persist = true) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }

  if (!persist || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SITE_THEME_STORAGE_KEY, theme);
  } catch {
    // The selected theme still applies to the current visit.
  }
}
