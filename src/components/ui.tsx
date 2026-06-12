/** Shared pane primitives (PLAN §10): the small set every pane reaches for so
 *  empties/loading/copy converge on one look instead of per-file re-rolls.
 *  Token-driven; entrances ride the App.css utilities (master reduce-motion
 *  guard covers everything). */
import { useState, type CSSProperties, type ComponentType, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

/** Calm centered empty/unavailable state: faint icon, quiet title, optional
 *  mono hint and a single neutral action. One per surface, per DESIGN.md. */
export function PaneEmpty({
  icon: Icon,
  title,
  hint,
  action,
  children,
}: {
  icon?: ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
  children?: ReactNode;
}) {
  return (
    <div className="fade-in-up flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
      {Icon && <Icon size={28} className="text-[var(--color-faint)]" />}
      <p className="text-[12.5px] text-[var(--color-muted)]">{title}</p>
      {hint && (
        <p className="max-w-[280px] font-mono text-[10.5px] leading-relaxed text-[var(--color-faint)]">
          {hint}
        </p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="pill press mt-1"
        >
          {action.label}
        </button>
      )}
      {children}
    </div>
  );
}

/** Shimmering loading block (the brand's cadence — `.skeleton` in App.css). */
export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden />;
}

/** Copy-to-clipboard button with a brief check confirmation. Lifted from the
 *  chat surface so every pane shares one affordance. */
export function CopyButton({
  text,
  size = 13,
  title = "copy",
  className,
}: {
  text: string;
  size?: number;
  title?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={title}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          },
          () => {},
        );
      }}
      className={
        className ??
        "grid h-6 w-6 place-items-center rounded-md text-[var(--color-faint)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
      }
    >
      {done ? <Check size={size} className="text-[var(--color-success)]" /> : <Copy size={size} />}
    </button>
  );
}
