/** funFx gate (W5-5) — one truth for the playful tier (click sparks, pet
 *  confetti, the liveness ripple): the `funFx` setting (default ON) AND NOT
 *  reduce-motion. Personality is the first thing reduce-motion should silence,
 *  so the OS/app motion preference always wins over the toggle. */
import { useSyncExternalStore } from "react";

import { getSetting, subscribe as subscribeSettings } from "../../lib/settings";
import { prefersReducedMotion } from "./reducedMotion";

/** Snapshot read — safe in event handlers / rAF / render. */
export function funFxOn(): boolean {
  return getSetting("funFx") !== false && !prefersReducedMotion();
}

/** Reactive form for components that mount/unmount on the preference. */
export function useFunFx(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const off = subscribeSettings(onChange);
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onChange);
      return () => {
        off();
        mq.removeEventListener("change", onChange);
      };
    },
    funFxOn,
    () => false,
  );
}
