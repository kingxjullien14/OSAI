/** One reduce-motion source for ALL JS-driven motion (Wave-5 contract rule 2).
 *  CSS already honors `html[data-reduce-motion]` + the OS media query via the
 *  master guard in App.css; these helpers expose the SAME truth to Framer
 *  Motion props and canvas/rAF effects so the two motion systems can never
 *  disagree. The dataset is maintained by lib/appearance.applyReduceMotion
 *  (boot + Settings toggle). */
import { useSyncExternalStore } from "react";

import { subscribe as subscribeSettings } from "../../lib/settings";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Snapshot read — safe during render (pure), in effects, or in rAF loops. */
export function prefersReducedMotion(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.documentElement.dataset.reduceMotion === "true" ||
    (typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches)
  );
}

function subscribeAll(onChange: () => void): () => void {
  // settings store fires on the app toggle; the media query covers OS flips.
  const offSettings = subscribeSettings(onChange);
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => {
    offSettings();
    mq.removeEventListener("change", onChange);
  };
}

/** Reactive form — drives `<MotionConfig reducedMotion>` and any component
 *  that must re-render when the preference flips mid-session. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeAll, prefersReducedMotion, () => false);
}
