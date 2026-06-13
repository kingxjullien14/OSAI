/** ClickSpark — adapted from ReactBits (reactbits.dev/animations/click-spark,
 *  2026-06-14). A global, pooled canvas that fires four short accent ticks from
 *  the cursor when you click a `.press` control — the app's tactile "felt that"
 *  beat. Mounted once (App root). Gated on funFx + reduce-motion; the accent
 *  color is read from the canvas's own resolved `color` (so it tracks the theme
 *  and serializes any oklch token to rgb for the 2D context). */
import { useEffect, useRef } from "react";

import { funFxOn } from "./funFx";

interface Spark {
  x: number;
  y: number;
  angle: number;
  start: number;
}

const COUNT = 4;
const LIFE = 300; // ms
const LEN = 12; // px tick length
const REACH = 16; // px outward travel

export function ClickSpark() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const sparks: Spark[] = [];
    let raf = 0;

    const draw = (now: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // resolved accent (rgb — getComputedStyle serializes the token for us).
      const color = getComputedStyle(canvas).color;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        const t = (now - s.start) / LIFE;
        if (t >= 1) {
          sparks.splice(i, 1);
          continue;
        }
        const ease = 1 - (1 - t) * (1 - t); // easeOut
        const base = REACH * ease;
        const x0 = s.x + Math.cos(s.angle) * base;
        const y0 = s.y + Math.sin(s.angle) * base;
        const x1 = x0 + Math.cos(s.angle) * LEN * (1 - t);
        const y1 = y0 + Math.sin(s.angle) * LEN * (1 - t);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = 2 * dpr;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x0 * dpr, y0 * dpr);
        ctx.lineTo(x1 * dpr, y1 * dpr);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (sparks.length > 0) raf = requestAnimationFrame(draw);
      else raf = 0;
    };

    const onClick = (e: MouseEvent) => {
      if (!funFxOn()) return;
      const el = (e.target as HTMLElement | null)?.closest?.(".press");
      if (!el) return;
      const start = performance.now();
      for (let i = 0; i < COUNT; i++) {
        sparks.push({ x: e.clientX, y: e.clientY, angle: (Math.PI * 2 * i) / COUNT + Math.PI / 4, start });
      }
      if (!raf) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("click", onClick, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[200] h-screen w-screen text-[var(--color-accent)]"
    />
  );
}
