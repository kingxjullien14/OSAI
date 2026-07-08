/** PaneMenu — the app's custom context / overflow menu for panes.
 *
 *  Replaces the OS WebView2 right-click menu (Back/Reload/Inspect…) with a
 *  Neon-Glass menu whose items are chosen per pane type. Rendered in a PORTAL at
 *  the document body so the scrolling/overflow-hidden pane chrome can't clip it,
 *  pinned at fixed viewport coords, and edge-flipped so it never spills offscreen.
 *
 *  NATIVE-WEBVIEW NOTE: a portal + high z-index is enough to clear HTML siblings,
 *  but a native child webview (browser / appcast panes) composites ABOVE all HTML
 *  regardless of z-index. PaneCard handles that separately by broadcasting
 *  `setPaneOverlay(key, true)` on the pane bus while a menu is open, which shrinks
 *  the offending webview to 0 — so by the time this renders, nothing occludes it.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export interface PaneMenuAction {
  key: string;
  icon?: ReactNode;
  label: string;
  /** right-aligned shortcut/affordance hint (e.g. "⌘W"). */
  hint?: string;
  /** render in the danger color (close / destructive). */
  danger?: boolean;
  disabled?: boolean;
  /** inline submenu: clicking the row expands these beneath it instead of
   *  selecting (e.g. "Open in chat ▸" → one row per open conversation). */
  children?: PaneMenuAction[];
  onSelect?: () => void;
}

export type PaneMenuEntry = PaneMenuAction | { key: string; separator: true };

function isAction(e: PaneMenuEntry): e is PaneMenuAction {
  return !("separator" in e);
}

export function PaneMenu({
  x,
  y,
  items,
  onClose,
  anchorEl,
  align = "left",
}: {
  /** viewport coords. With align="left" (cursor / right-click) this is the
   *  desired top-LEFT; with align="right" (the ⋯ overflow button) `x` is the
   *  desired top-RIGHT so the menu hangs leftward under the trigger. */
  x: number;
  y: number;
  items: PaneMenuEntry[];
  onClose: () => void;
  /** the trigger element (⋯ button), exempted from the outside-click close so a
   *  click on it toggles cleanly instead of close-then-reopen. */
  anchorEl?: HTMLElement | null;
  align?: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  // hidden until measured+flipped so it never paints at the unflipped spot first.
  const [ready, setReady] = useState(false);
  // keyboard navigation highlight (index into `items`, skipping separators).
  const actionIdxs = items
    .map((e, i) => (isAction(e) && !e.disabled ? i : -1))
    .filter((i) => i >= 0);
  const [hi, setHi] = useState<number>(-1);
  // key of the item whose inline submenu is expanded (one at a time).
  const [expanded, setExpanded] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    // align=right → x is the desired right edge, so the menu hangs leftward.
    let left = align === "right" ? x - r.width : x;
    left = Math.min(left, window.innerWidth - pad - r.width);
    left = Math.max(left, pad);
    // clamp vertically so a click near the bottom edge slides the menu up to fit
    // (the native "opens upward" behaviour) instead of spilling offscreen.
    let top = Math.min(y, window.innerHeight - pad - r.height);
    top = Math.max(top, pad);
    setPos({ left, top });
    setReady(true);
  }, [x, y, align, expanded]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchorEl?.contains(t)) return; // let the trigger handle its own toggle
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!actionIdxs.length) return;
        const cur = actionIdxs.indexOf(hi);
        const step = e.key === "ArrowDown" ? 1 : -1;
        const next = cur < 0 ? (e.key === "ArrowDown" ? 0 : actionIdxs.length - 1) : (cur + step + actionIdxs.length) % actionIdxs.length;
        setHi(actionIdxs[next]);
        return;
      }
      if (e.key === "Enter" && hi >= 0) {
        const it = items[hi];
        if (it && isAction(it) && !it.disabled) {
          e.preventDefault();
          if (it.children?.length) {
            setExpanded((cur) => (cur === it.key ? null : it.key));
          } else {
            it.onSelect?.();
            onClose();
          }
        }
      }
    };
    const onScroll = () => onClose();
    // capture phase: a right-click on ANOTHER pane fires pointerdown before its
    // contextmenu opens a fresh menu, so the old one closes first (no stacking).
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose, anchorEl, hi, items, actionIdxs]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.left, top: pos.top, visibility: ready ? "visible" : "hidden" }}
      className="scale-in fixed z-[300] max-h-[70vh] min-w-[188px] max-w-[280px] overflow-y-auto rounded-xl border border-[var(--color-border-strong)] bg-[var(--osai-glass-bg-strong)] p-1 shadow-[var(--osai-shadow-pop)] backdrop-blur-2xl [scrollbar-width:thin]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((e, i) =>
        !isAction(e) ? (
          <div key={e.key} className="mx-1 my-1 h-px bg-[var(--color-border)]" />
        ) : (
          <div key={e.key}>
          <button
            type="button"
            role="menuitem"
            aria-haspopup={e.children?.length ? "menu" : undefined}
            aria-expanded={e.children?.length ? expanded === e.key : undefined}
            disabled={e.disabled}
            onMouseEnter={() => setHi(i)}
            onClick={() => {
              if (e.disabled) return;
              if (e.children?.length) {
                setExpanded((cur) => (cur === e.key ? null : e.key));
                return;
              }
              e.onSelect?.();
              onClose();
            }}
            className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors disabled:pointer-events-none disabled:opacity-40 ${
              e.danger
                ? `text-[var(--color-danger)] ${hi === i ? "bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)]" : ""} hover:bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)]`
                : `text-[var(--color-text-2)] ${hi === i ? "bg-[var(--color-accent-soft)] text-[var(--color-text)]" : ""} hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-text)]`
            }`}
          >
            {e.icon != null && (
              <span
                className={
                  e.danger
                    ? "text-[var(--color-danger)]"
                    : `text-[var(--color-muted)] ${hi === i ? "text-[var(--color-accent)]" : "group-hover:text-[var(--color-accent)]"}`
                }
              >
                {e.icon}
              </span>
            )}
            <span className="flex-1 truncate">{e.label}</span>
            {e.hint && <span className="font-mono text-[10px] text-[var(--color-faint)]">{e.hint}</span>}
            {e.children != null && e.children.length > 0 && (
              <ChevronDown
                size={12}
                className={`shrink-0 text-[var(--color-faint)] transition-transform ${
                  expanded === e.key ? "" : "-rotate-90"
                }`}
              />
            )}
          </button>
          {/* inline submenu — indented children under their parent */}
          {e.children != null && e.children.length > 0 && expanded === e.key && (
            <div className="my-0.5 ml-4 flex flex-col border-l border-[var(--color-border)] pl-1">
              {e.children.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="menuitem"
                  disabled={c.disabled}
                  onClick={() => {
                    if (c.disabled) return;
                    c.onSelect?.();
                    onClose();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-text)] disabled:pointer-events-none disabled:opacity-40"
                >
                  {c.icon != null && <span className="text-[var(--color-muted)]">{c.icon}</span>}
                  <span className="flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="font-mono text-[10px] text-[var(--color-faint)]">{c.hint}</span>}
                </button>
              ))}
            </div>
          )}
          </div>
        ),
      )}
    </div>,
    document.body,
  );
}
