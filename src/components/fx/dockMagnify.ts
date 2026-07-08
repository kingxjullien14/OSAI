/** Dock magnify — the macOS-dock / Magic-UI-Dock proximity scale (2026-06-14)
 *  done with plain pointer math + a CSS var, so it retrofits onto the existing
 *  icons-only sidebar rail WITHOUT turning every row into a motion component
 *  (the rail is drag/drop + menu heavy — minimal surface is the point). Attach
 *  the two handlers to the scrolling rail container; tag each magnifiable
 *  control with `osai-dock-icon` (App.css owns the `transform: scale(var(...))`
 *  + transition). No reflow — icons grow over the gap like a real dock.
 *  Reduce-motion → no scaling (the move handler bails). */
import type { PointerEvent } from "react";

import { prefersReducedMotion } from "./reducedMotion";

const MAX = 1.35;
/** px above/below the cursor where magnification falls to 1. */
const RANGE = 96;

export function dockMagnifyMove(e: PointerEvent<HTMLElement>): void {
  if (prefersReducedMotion()) return;
  const y = e.clientY;
  e.currentTarget.querySelectorAll<HTMLElement>(".osai-dock-icon").forEach((el) => {
    const r = el.getBoundingClientRect();
    const center = r.top + r.height / 2;
    const t = Math.max(0, 1 - Math.abs(y - center) / RANGE);
    el.style.setProperty("--dock-scale", (1 + (MAX - 1) * t).toFixed(3));
  });
}

export function dockMagnifyReset(e: PointerEvent<HTMLElement>): void {
  e.currentTarget.querySelectorAll<HTMLElement>(".osai-dock-icon").forEach((el) => {
    el.style.setProperty("--dock-scale", "1");
  });
}
