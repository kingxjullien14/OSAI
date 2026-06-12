/** App-level motion provider (W5-1): LazyMotion keeps the Framer Motion
 *  runtime at the `domAnimation` feature set (~18kb gz instead of ~32kb) and
 *  `strict` makes any accidental full-`motion.` import a loud dev error —
 *  every animated element in the app is an `m.` component. MotionConfig
 *  bridges OUR reduce-motion truth (settings + OS query) into every motion
 *  value: "always" hard-disables transform animation app-wide the moment the
 *  setting flips.
 *
 *  NOTE for W5-4: layoutId / shared-element work needs `domMax` — swap the
 *  feature bundle there (and re-measure the gz delta), not per-component. */
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
