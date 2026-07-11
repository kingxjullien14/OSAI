/**
 * Pure geometry for the chat transcript's "stick to the bottom" autoscroll.
 *
 * The whole model is deliberately tiny: autoscroll is driven by ONE flag ("keep
 * the view pinned to the newest message?") that is a pure function of scroll
 * POSITION — within `STICK_THRESHOLD_PX` of the bottom ⇒ follow; scrolled away ⇒
 * don't. The component (ChatPane) owns the flag and re-pins on every content
 * resize via a ResizeObserver; these helpers are the only math it needs, kept
 * here so they stay unit-testable outside the browser.
 */
export interface ScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/** How close to the live bottom still counts as "at the bottom" (px). Wide
 *  enough that a fast token stream growing the height between frames doesn't
 *  read as "scrolled away", tight enough that a deliberate scroll-up releases. */
export const STICK_THRESHOLD_PX = 80;

/** Distance in px from the current viewport bottom to the content bottom. */
export function distanceFromBottom(metrics: ScrollMetrics): number {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
}

/** Is the viewport within `threshold` px of the live bottom? This is the single
 *  predicate that flips autoscroll on/off — evaluated on the user's own scrolls
 *  (our programmatic pins land at distance ≈ 0, so they simply re-confirm it). */
export function atBottom(metrics: ScrollMetrics, threshold: number = STICK_THRESHOLD_PX): boolean {
  return distanceFromBottom(metrics) <= threshold;
}
