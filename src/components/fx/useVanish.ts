/** useVanish — the canvas dissolve half of Aceternity's placeholders-and-vanish-input
 *  (ui.aceternity.com/components/placeholders-and-vanish-input, 2026-06-14),
 *  extracted to a hook so it plays over OUR command-line input rather than
 *  Aceternity's. On `vanish(text)` it rasterizes the input's current text to an
 *  overlay canvas (matching the input's real font + color token), samples the
 *  glyph pixels into particles, and disperses them up-and-right over ~560ms.
 *  Reduce-motion → it resolves immediately (caller clears the input the same
 *  frame either way, so the text just disappears). The canvas is invisible
 *  except while `vanishing`. */
import { useCallback, useRef, useState, type RefObject } from "react";

import { prefersReducedMotion } from "./reducedMotion";

const DURATION = 560;
// device-pixel sampling stride: every Nth pixel becomes a particle (keeps the
// particle count sane on a wide input without visibly thinning the text).
const STRIDE = 2;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export function useVanish(inputRef: RefObject<HTMLInputElement | null>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [vanishing, setVanishing] = useState(false);

  const vanish = useCallback(
    (text: string): Promise<void> =>
      new Promise<void>((resolve) => {
        const input = inputRef.current;
        const canvas = canvasRef.current;
        if (!input || !canvas || !text || prefersReducedMotion()) {
          resolve();
          return;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve();
          return;
        }

        const rect = input.getBoundingClientRect();
        const cs = getComputedStyle(input);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const W = Math.max(1, Math.ceil(rect.width * dpr));
        const H = Math.max(1, Math.ceil(rect.height * dpr));
        canvas.width = W;
        canvas.height = H;
        canvas.style.width = `${Math.ceil(rect.width)}px`;
        canvas.style.height = `${Math.ceil(rect.height)}px`;

        // draw the text in device px so the raster is crisp; match the input's
        // weight/size/family + the resolved text color (a token in our theme).
        ctx.clearRect(0, 0, W, H);
        ctx.font = `${cs.fontWeight} ${parseFloat(cs.fontSize) * dpr}px ${cs.fontFamily}`;
        ctx.fillStyle = cs.color;
        ctx.textBaseline = "middle";
        ctx.fillText(text, 0, H / 2);

        const data = ctx.getImageData(0, 0, W, H).data;
        const particles: Particle[] = [];
        for (let y = 0; y < H; y += STRIDE) {
          for (let x = 0; x < W; x += STRIDE) {
            const a = data[(y * W + x) * 4 + 3];
            if (a < 8) continue;
            const i = (y * W + x) * 4;
            particles.push({
              x,
              y,
              vx: (Math.random() * 0.7 + 0.3) * 42, // drift right
              vy: (Math.random() - 0.5) * 36, // small vertical scatter
              r: data[i],
              g: data[i + 1],
              b: data[i + 2],
              a,
            });
          }
        }
        if (particles.length === 0) {
          resolve();
          return;
        }

        setVanishing(true);
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / DURATION);
          ctx.clearRect(0, 0, W, H);
          if (t >= 1) {
            setVanishing(false);
            resolve();
            return;
          }
          const fade = 1 - t;
          for (const p of particles) {
            const px = p.x + p.vx * t;
            const py = p.y + p.vy * t;
            ctx.fillStyle = `rgba(${p.r}, ${p.g}, ${p.b}, ${(p.a / 255) * fade})`;
            ctx.fillRect(px, py, STRIDE, STRIDE);
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [inputRef],
  );

  return { canvasRef, vanishing, vanish };
}
