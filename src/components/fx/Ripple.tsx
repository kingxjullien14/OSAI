/** Ripple — adapted from Magic UI (magicui.design/docs/components/ripple,
 *  2026-06-14). Concentric, whisper-faint accent rings that expand and fade
 *  behind the idle pet companion when liveness is high — it ties the liveness
 *  backdrop to the companion. Pure CSS (keyframe `osai-ripple` in App.css, so
 *  the master reduce-motion guard governs it); the parent only mounts it when
 *  funFx is on, so under reduce-motion it never renders at all. */
import { cn } from "./cn";

const RINGS = 3;

export function Ripple({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 grid place-items-center", className)}>
      {Array.from({ length: RINGS }, (_, i) => (
        <span
          key={i}
          className="osai-ripple absolute rounded-full border"
          style={{
            width: 64 + i * 44,
            height: 64 + i * 44,
            borderColor: "color-mix(in srgb, var(--color-accent) 22%, transparent)",
            animationDelay: `${i * 0.6}s`,
          }}
        />
      ))}
    </div>
  );
}
