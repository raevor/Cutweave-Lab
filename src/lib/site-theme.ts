export type SiteTheme = "light" | "dark";

export const SITE_THEME_STORAGE_KEY = "cutweave-theme";
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

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

/*
 * Switches the theme with a circular reveal that grows from the toggle button.
 * `update` runs the React state change; it is flushed inside the transition so
 * the new snapshot already shows the new theme.
 */
export function switchSiteTheme(theme: SiteTheme, origin: Element | null, update: () => void, flush: (fn: () => void) => void) {
  const root = document.documentElement;
  const apply = () => {
    flush(update);
    applySiteTheme(theme);
  };
  const doc = document as ViewTransitionDocument;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduced || typeof doc.startViewTransition !== "function") {
    root.classList.add("theme-fade");
    apply();
    window.setTimeout(() => root.classList.remove("theme-fade"), 600);
    return;
  }

  const rect = origin?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 48;
  const y = rect ? rect.top + rect.height / 2 : 40;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  root.style.setProperty("--theme-x", `${x}px`);
  root.style.setProperty("--theme-y", `${y}px`);
  root.style.setProperty("--theme-r", `${radius}px`);
  root.dataset.themeTo = theme;
  doc.startViewTransition(apply);
}
