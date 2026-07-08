/** Mouse-follow spotlight glow for neutral rows/chips — the CardSpotlight
 *  pattern (Aceternity / ReactBits, 2026-06-14) reduced to its essence: a
 *  pointer handler that writes `--spot-x`/`--spot-y` onto the element, paired
 *  with the `.osai-spotlight` CSS rule (App.css) that paints a low-alpha
 *  `--color-text` radial there. No motion-lib subscription on the hot pointer
 *  path (CSS var writes only), and the glow is reserved for NEUTRAL surfaces —
 *  accent stays for the primary (DESIGN.md §6). The CSS transition is governed
 *  by the master reduce-motion guard, so no JS gate is needed here. */
import type { MouseEvent } from "react";

export function spotlightMove(e: MouseEvent<HTMLElement>): void {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
  el.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
}
