/** Shared pane primitives (PLAN §10): the small set every pane reaches for so
 *  empties/loading/copy converge on one look instead of per-file re-rolls.
 *  Token-driven; entrances ride the App.css utilities (master reduce-motion
 *  guard covers everything). */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Check, Copy } from "lucide-react";

/** Exit-motion driver for overlays that hard-unmount on close. Returns
 *  `{ mounted, closing }`: keep rendering while `mounted`, and put
 *  `data-closing={closing || undefined}` on the `.overlay-backdrop` and
 *  `.modal-in` elements — App.css plays the fast ease-in exit, then we
 *  unmount after `ms`. Open→true resets instantly (no exit replay).
 *  Under reduce-motion the exit is invisible (durations are killed) and the
 *  ms delay is imperceptible. */
export function useExitState(open: boolean, ms = 160): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setMounted(true);
      return;
    }
    // closing only if we were actually open (not the initial closed mount)
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { mounted: open || mounted, closing: !open && mounted };
}

/** Exit-motion wrapper for overlays mounted conditionally by a parent
 *  (`{open && <Settings/>}` style) whose internals we don't restructure.
 *  Keeps children mounted ~160ms after `open` flips false and flags
 *  data-closing on a layout-neutral wrapper; App.css descendant rules play
 *  the backdrop/card exits and disable pointer events while closing. */
export function ExitGate({
  open,
  ms = 160,
  children,
}: {
  open: boolean;
  ms?: number;
  children: ReactNode;
}) {
  const { mounted, closing } = useExitState(open, ms);
  if (!mounted) return null;
  return (
    <div className="contents" data-closing={closing || undefined}>
      {children}
    </div>
  );
}

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

/**
 * Dialog focus trap: keep Tab cycling inside `container`. Call from the dialog
 * root's onKeyDown — it walks the CURRENT visible focusables each press, so
 * dynamic content (filtered lists, conditional buttons) stays trapped without
 * any registration. Skips when something inner already handled the key (e.g.
 * the palette's Tab-moves-selection input calls preventDefault first).
 */
export function trapTab(e: ReactKeyboardEvent, container: HTMLElement | null) {
  if (e.key !== "Tab" || e.defaultPrevented || !container) return;
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null); // visible only
  if (focusables.length === 0) {
    e.preventDefault();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const inside = active != null && container.contains(active);
  if (e.shiftKey) {
    if (!inside || active === first) {
      e.preventDefault();
      last.focus();
    }
  } else if (!inside || active === last) {
    e.preventDefault();
    first.focus();
  }
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
