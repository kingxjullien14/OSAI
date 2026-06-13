/** Confetti — adapted from Magic UI (magicui.design/docs/components/confetti,
 *  2026-06-14) down to a single self-contained canvas burst (no canvas-confetti
 *  dep). Fires when `trigger` changes: ≤80 accent+highlight particles erupt from
 *  the tile center, arc under gravity, and fade over ~1.2s. Gated on funFx +
 *  reduce-motion. The pet earns this on a long clean run; the rate-limit lives
 *  in pet.ts so the app never spams it. */
import { useEffect, useRef } from "react";

import { cn } from "./cn";
import { funFxOn } from "./funFx";

const MAX = 80;
const LIFE = 1200; // ms
const GRAVITY = 0.0009; // px / ms^2

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  color: string;
}

function resolveColor(varName: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${varName})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}

export function Confetti({ trigger, className }: { trigger: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFired = useRef(0);

  useEffect(() => {
    if (trigger === lastFired.current) return;
    lastFired.current = trigger;
    if (trigger === 0 || !funFxOn()) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 132;
    const h = canvas.clientHeight || 96;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const palette = [resolveColor("--color-accent"), resolveColor("--color-highlight")];
    const bits: Bit[] = [];
    for (let i = 0; i < MAX; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.7; // mostly upward
      const speed = 0.18 + Math.random() * 0.34;
      bits.push({
        x: w / 2,
        y: h * 0.42,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.02,
        size: 2.5 + Math.random() * 3,
        color: palette[i % palette.length],
      });
    }

    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = elapsed / LIFE;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (t >= 1) {
        raf = 0;
        return;
      }
      ctx.globalAlpha = 1 - t;
      for (const b of bits) {
        const px = (b.x + b.vx * elapsed) * dpr;
        const py = (b.y + b.vy * elapsed + 0.5 * GRAVITY * elapsed * elapsed) * dpr;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(b.rot + b.vrot * elapsed);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.size * dpr, -b.size * dpr, b.size * 2 * dpr, b.size * 2 * dpr);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [trigger]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 z-30 h-full w-full", className)}
    />
  );
}
