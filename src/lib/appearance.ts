/** Appearance side-effects reflected onto <html>: font-scale, density, and
 *  reduce-motion. Centralized so BOTH the Settings panel and the app boot path
 *  apply them from one source (previously these lived privately inside
 *  Settings.tsx and only ran when the panel mounted — so a fresh launch ignored
 *  the user's reduce-motion / font-scale / density until they opened Settings).
 *  See PLAN-superapp-uiux.md §13 (boot-time apply) + §2 (motion). */
import { loadSettings } from "./settings";

export type Density = "compact" | "comfortable";

const DENSITY_KEY = "aios.density";
/** Baseline px the font-scale multiplier is relative to (TerminalPane's default). */
const FONT_BASELINE = 13;

export function getDensity(): Density {
  try {
    const v = localStorage.getItem(DENSITY_KEY);
    if (v === "compact" || v === "comfortable") return v;
  } catch {
    /* ignore */
  }
  return "comfortable";
}

/** Persist density + reflect it as `data-density` on :root so App.css responds. */
export function applyDensity(d: Density): void {
  try {
    localStorage.setItem(DENSITY_KEY, d);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.documentElement.dataset.density = d;
  }
}

/** Map a font size (px) onto a root `--app-font-scale` multiplier so chat/UI
 *  surfaces that read `var(--app-font-scale)` scale with the control. */
export function applyFontScale(px: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--app-font-scale",
    String(px / FONT_BASELINE),
  );
}

/** Reflect reduce-motion as `data-reduce-motion` on :root for App.css to honor. */
export function applyReduceMotion(on: boolean): void {
  if (typeof document === "undefined") return;
  if (on) document.documentElement.dataset.reduceMotion = "true";
  else delete document.documentElement.dataset.reduceMotion;
}

/** Apply every appearance side-effect from the current settings. Call once at
 *  app boot (next to initTheme) so a fresh launch honors stored preferences. */
export function applyAppearance(): void {
  const s = loadSettings();
  applyFontScale(s.terminalFontSize);
  applyReduceMotion(s.reduceMotion);
  applyDensity(getDensity());
}
