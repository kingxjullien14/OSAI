/** One-shot FLIP handoff: the idle home's command line "becomes" the palette.
 *  The line records its rect just before opening the palette; the palette
 *  consumes it on its next mount and plays an inverted transform from that
 *  rect to its own — one continuous surface instead of a modal stacking over
 *  an input that visually duplicates it. Consume-once semantics (cleared on
 *  read) so regular ⌘K opens stay on the normal modal-in entrance. */

let source: DOMRect | null = null;
let at = 0;

export function setPaletteMorphSource(rect: DOMRect): void {
  source = rect;
  at = Date.now();
}

/** The recorded rect, if it was set in the last second (stale guards against
 *  a palette opened much later by other means). Clears on read. */
export function consumePaletteMorphSource(): DOMRect | null {
  const s = source;
  source = null;
  if (!s || Date.now() - at > 1000) return null;
  return s;
}

/** Non-destructive freshness check — safe to call during render (pure). The
 *  palette uses it to suppress its motion entrance on a morph open (the WAAPI
 *  FLIP owns the transform for that one mount); the effect still consumes. */
export function peekPaletteMorphSource(): boolean {
  return source != null && Date.now() - at <= 1000;
}
