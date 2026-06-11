/** Platform-aware modifier labels. The keydown handlers treat
 *  `metaKey || ctrlKey` as "the mod" (so the keys already work everywhere), but
 *  every visible LABEL must match the user's actual keyboard: ⌘ on macOS, Ctrl
 *  on Windows/Linux; ⌥→Alt; ⇧→Shift. Universal glyphs (⏎ enter, ⎋ esc, ↑↓←→)
 *  are passed through untouched. This file is the single source for all of them.
 *  See PLAN-superapp-uiux.md §8 (the ⌘-on-Windows fix). */

const APPLE =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(
    // navigator.platform is deprecated but still the most reliable signal in a
    // Tauri webview; fall back to the UA string.
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent ||
      "",
  );

/** True on macOS / iOS. */
export const isApple = APPLE;

/** Primary accelerator label — ⌘ (mac) / Ctrl (win+linux). */
export const MOD = APPLE ? "⌘" : "Ctrl";
/** Alt/Option label — ⌥ (mac) / Alt (win+linux). */
export const ALT = APPLE ? "⌥" : "Alt";
/** Shift label — ⇧ (mac) / Shift (win+linux). */
export const SHIFT = APPLE ? "⇧" : "Shift";

/** Join chord tokens with the platform-correct separator (none on mac, "+" off
 *  mac). Tokens: "mod" | "alt" | "shift" | any literal (e.g. "K", "⏎", "1").
 *  fmtChord(["mod","K"]) → "⌘K" (mac) / "Ctrl+K" (win). */
export function fmtChord(parts: string[]): string {
  const sep = APPLE ? "" : "+";
  return parts
    .map((p) => (p === "mod" ? MOD : p === "alt" ? ALT : p === "shift" ? SHIFT : p))
    .join(sep);
}

/** Shorthand for the common mod+key chord. chord("K") → "⌘K" / "Ctrl+K". */
export function chord(key: string): string {
  return fmtChord(["mod", key]);
}
