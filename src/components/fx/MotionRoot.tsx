/** App-level motion provider (W5-1): LazyMotion keeps the Framer Motion runtime
 *  at the `domAnimation` feature set (~18kb gz vs domMax's ~32kb) and `strict`
 *  makes any accidental full-`motion.` import a loud dev error — every animated
 *  element in the app is an `m.` component. MotionConfig bridges OUR
 *  reduce-motion truth (settings + OS query): "always" hard-disables transform
 *  animation app-wide the moment the setting flips.
 *
 *  W5-4 deliberately STAYED on domAnimation: the `domMax` swap (for `layoutId`
 *  shared-element morphs) measured +13.8kb gz, which would have eaten the
 *  whole remaining wave budget. The Settings-nav / palette sliding indicators
 *  instead animate a single measured `SlidingIndicator` (top/height transform
 *  — no layout feature needed), which is also more robust than layoutId. The
 *  W5-3 notification `layout` prop is a harmless no-op under this bundle. */
import type { ReactNode } from "react";

import { LazyMotion, MotionConfig, domAnimation } from "motion/react";

import { useReducedMotion } from "./reducedMotion";

export function MotionRoot({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion={reduce ? "always" : "user"}>{children}</MotionConfig>
    </LazyMotion>
  );
}
