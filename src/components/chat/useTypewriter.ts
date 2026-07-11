/** useTypewriter — the React glue over lib/typewriter's pure rate curve.
 *
 *  Smoothly reveals `target` as a growing prefix while `streaming`, so streamed
 *  chat writing FLOWS out instead of spawning whole network bursts at once. ONE
 *  persistent rAF loop (started on mount, torn down on unmount) advances a prefix
 *  toward the received text; it reads `target`/`streaming` from refs, so it needs
 *  no dependency-driven restarts — those would either STARVE under fast tokens
 *  (each token cancels the pending frame before it fires) or strand a cancelled
 *  loop across a StrictMode remount (the "empty response, stuck caret" bug). The
 *  loop keeps ticking while streaming so new tokens reveal instantly, flushes fast
 *  once the stream ends, then stops — so it always converges to the full text.
 *
 *  Shared by the assistant bubble and the thinking block. Its own module so both
 *  can import it without a cycle (Bubbles already imports from ThinkingBlock).
 */
import { useEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "../fx/reducedMotion";
import { revealStep, TYPEWRITER } from "../../lib/typewriter";

/** Cap streaming re-renders to ~36fps: the loop advances every frame, but we skip
 *  some setState so the markdown/text isn't re-rendered 60×/s on a long message. */
const RENDER_MS = 28;

export function useTypewriter(
  target: string,
  streaming: boolean,
): { text: string; done: boolean } {
  const [revealed, setRevealed] = useState(() =>
    !streaming || prefersReducedMotion() || target.length > TYPEWRITER.instantOnMount
      ? target.length
      : 0,
  );
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;
  const targetRef = useRef(target);
  targetRef.current = target;
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  const dwellRef = useRef(0); // frames to hold at a sentence end (streaming only)

  useEffect(() => {
    if (prefersReducedMotion()) {
      const full = targetRef.current.length;
      if (revealedRef.current !== full) {
        revealedRef.current = full;
        setRevealed(full);
      }
      return;
    }
    let raf = 0;
    let lastFrame = performance.now();
    let lastRender = 0;
    const tick = (now: number) => {
      const dtSec = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;
      const tgt = targetRef.current;
      const cur = revealedRef.current;
      if (cur < tgt.length) {
        let next = cur;
        if (dwellRef.current > 0) {
          dwellRef.current -= 1; // a beat at the last sentence end
        } else {
          next = Math.min(
            tgt.length,
            cur + revealStep(tgt.length - cur, dtSec, streamingRef.current, Math.random()),
          );
          // organic cadence: dwell a few frames after a sentence/paragraph end,
          // but only while streaming — the post-stream flush stays fast and clean.
          if (streamingRef.current) {
            const last = tgt[next - 1];
            const after = tgt[next] ?? "";
            if ((last === "." || last === "!" || last === "?") && (after === " " || after === "\n" || after === "")) {
              dwellRef.current = 2 + Math.floor(Math.random() * 3);
            } else if (last === "\n" && (after === "\n" || after === "")) {
              dwellRef.current = 3;
            }
          }
        }
        revealedRef.current = next;
        // throttle re-renders but always land the final frame so the full text
        // appears the instant we catch up.
        if (next >= tgt.length || now - lastRender >= RENDER_MS) {
          lastRender = now;
          setRevealed(next);
        }
      }
      // keep ticking while still catching up OR still streaming (so new tokens
      // reveal without a restart); stop only once fully caught up AND settled.
      if (revealedRef.current < targetRef.current.length || streamingRef.current) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
    // Intentionally no deps: one loop for the component's life, reading target /
    // streaming via refs. (StrictMode runs setup→cleanup→setup; the local `raf`
    // + this cleanup make that safe — no stranded handle.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { text: target.slice(0, revealed), done: revealed >= target.length };
}
