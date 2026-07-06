/** Composer satellite surfaces — a slice of the ChatPane split
 *  (PLAN-odysseus-feel.md, W4). The floating chrome that anchors to the
 *  composer: the dropdown/menu primitives behind the control pills, the
 *  slash/@ overlay panel + rows, the /resume session picker, the cwd browser,
 *  the goal editor, and the attachment image preview. Moved verbatim from
 *  ChatPane; behavior unchanged. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronRight,
  ChevronUp,
  Clock,
  CornerDownLeft,
  Folder,
  History,
  Loader2,
  RotateCcw,
  Search,
  Target,
  X,
} from "lucide-react";
import type { ChatSessionInfo } from "../../lib/chat";
import { homeDir, readDir, type DirEntry } from "../../lib/fs";
import { groupByDate } from "../../lib/historyManage";
import { trapTab } from "../ui";
import { baseName } from "./format";

/** A pasted/attached image: live thumbnail + its saved temp path (null while saving). */
export interface ImageChip {
  id: string;
  url: string;
  path: string | null;
}

/** Parent directory of a path, handling both separators + drive/unix roots.
 *  Returns null at a root (C:\, /) so callers can disable an "up" affordance. */
function parentDir(p: string): string | null {
  const sep = p.includes("\\") ? "\\" : "/";
  const clean = p.replace(/[\\/]+$/, "");
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  if (idx < 0) return null;
  let parent = clean.slice(0, idx);
  if (parent === "") parent = sep; // unix root "/"
  else if (/^[A-Za-z]:$/.test(parent)) parent = parent + sep; // windows drive "C:" → "C:\"
  return parent === clean ? null : parent;
}

/** Compact "time since" label from a unix-SECONDS timestamp ("3h ago", "2d ago",
 *  "just now"). Used for the /resume session picker's faint secondary line. */
function fmtRelativeTime(unixSeconds: number): string {
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (diffSec < 45) return "just now";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

/**
 * Directory browser for the composer's working-directory pill. Browse into
 * subfolders, jump home, type/paste an absolute path, then "use this folder" to
 * re-root the chat. Listing is dirs-only (the agent works on a folder, not a
 * file). Lives inside a Dropdown menu, so it's already dismiss-on-outside-click.
 */
export function CwdPicker({
  cwd,
  onPick,
}: {
  cwd: string | null;
  onPick: (dir: string) => void;
}) {
  const [path, setPath] = useState<string>(cwd ?? "");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  // resolve $HOME once so an empty start (no cwd) still has somewhere to browse.
  useEffect(() => {
    if (path) return;
    let alive = true;
    homeDir()
      .then((h) => alive && h && setPath(h))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);

  // (re)list the current path whenever it changes.
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    setError(null);
    readDir(path)
      .then((list) => {
        if (!alive) return;
        setEntries(
          list
            .filter((e) => e.is_dir && !e.name.startsWith("."))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path]);

  const parent = path ? parentDir(path) : null;
  const goManual = () => {
    const p = manual.trim();
    if (p) {
      setManual("");
      setPath(p); // listing it confirms it exists (errors surface inline)
    }
  };

  return (
    <div className="flex w-[300px] max-w-[80vw] flex-col">
      <div className="px-3 pb-1 pt-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-faint)]">
        working directory
      </div>
      {/* current path + up */}
      <div className="flex items-center gap-1.5 px-2 pb-1">
        <button
          type="button"
          disabled={!parent}
          onClick={() => parent && setPath(parent)}
          title="up one folder"
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)] disabled:opacity-30"
        >
          <ChevronUp size={14} />
        </button>
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text-2)]"
          title={path}
          dir="rtl"
        >
          {path || "…"}
        </span>
      </div>
      {/* subfolder list */}
      <div className="max-h-52 overflow-y-auto px-1">
        {loading ? (
          <div className="px-2 py-3 text-center font-sans text-[11.5px] text-[var(--color-faint)]">
            loading…
          </div>
        ) : error ? (
          <div className="px-2 py-3 font-sans text-[11.5px] text-[var(--color-danger)]">
            {error}
          </div>
        ) : entries.length === 0 ? (
          <div className="px-2 py-3 text-center font-sans text-[11.5px] text-[var(--color-faint)]">
            no subfolders here
          </div>
        ) : (
          entries.map((e) => (
            <button
              key={e.path}
              type="button"
              onClick={() => setPath(e.path)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-sans text-[12.5px] text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
            >
              <Folder size={13} className="shrink-0 text-[var(--color-muted)]" />
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <ChevronRight size={12} className="shrink-0 text-[var(--color-faint)]" />
            </button>
          ))
        )}
      </div>
      {/* manual path entry */}
      <div className="border-t border-[var(--color-border)] px-2 pt-2">
        <input
          type="text"
          value={manual}
          placeholder="or paste a path…"
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              goManual();
            }
          }}
          className="w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)]/40 px-2.5 py-1.5 font-mono text-[11px] text-[var(--color-text)] placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]/60 focus:outline-none"
        />
      </div>
      {/* confirm */}
      <div className="flex items-center gap-2 px-2 py-2">
        <button
          type="button"
          disabled={!path || path === cwd}
          onClick={() => path && onPick(path)}
          className="press flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 font-sans text-[12px] font-medium text-[var(--color-accent-fg)] transition-all enabled:bg-[linear-gradient(135deg,var(--color-accent),color-mix(in_srgb,var(--color-accent)_50%,var(--aios-accent-2)))] enabled:shadow-[0_0_16px_-5px_color-mix(in_srgb,var(--color-accent)_70%,transparent)] hover:enabled:brightness-110 disabled:cursor-not-allowed disabled:bg-[var(--color-panel)] disabled:text-[var(--color-faint)]"
        >
          <Check size={13} />
          {path === cwd ? "current folder" : "use this folder"}
        </button>
      </div>
    </div>
  );
}

/** Full-size preview of an attached image — confirm it (or remove it) before
 *  sending. Click the backdrop or press Esc to close; clicking the image itself
 *  doesn't dismiss. Portaled to <body> so it floats above the whole app. */
export function ImagePreview({
  image,
  onClose,
  onRemove,
}: {
  image: ImageChip;
  onClose: () => void;
  onRemove: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-5 bg-black/70 p-8 backdrop-blur-md"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt="attachment preview"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[78vh] max-w-[88vw] rounded-2xl border border-[var(--color-border-strong)] object-contain shadow-[var(--aios-shadow-pop)]"
      />
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-strong flex items-center gap-1.5 rounded-full p-1.5"
      >
        <span className="px-3 font-mono text-[11px] text-[var(--color-faint)]">
          {image.path == null ? "saving…" : "ready to send"}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-[var(--color-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)]"
        >
          <X size={13} /> remove
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-accent-fg)] transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          <Check size={14} /> looks good
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Inline editor for /goal — a calm, themed popover scoped to the chat pane
 *  (replaces the off-brand native window.prompt). ⏎ saves · esc / backdrop
 *  cancels. Mounted inside PaneDropZone so it covers only this pane. */
export function GoalEditorOverlay({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div
      className="fade-in-up absolute inset-0 z-40 grid place-items-center bg-[var(--color-bg)]/60 px-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="surface-pop focus-accent w-full max-w-md p-4"
        role="dialog"
        aria-modal="true"
        aria-label="ongoing goal"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.defaultPrevented) {
            e.preventDefault();
            onCancel();
            return;
          }
          trapTab(e, e.currentTarget);
        }}
      >
        <div className="mb-2 flex items-center gap-1.5 text-[12px] text-[var(--color-text-2)]">
          <Target size={13} className="text-[var(--color-accent)]" />
          ongoing goal
        </div>
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onCommit(value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          rows={2}
          placeholder="describe a goal — kept as context across turns until cleared"
          spellCheck={false}
          className="block w-full resize-none rounded-[var(--aios-radius-md)] bg-[var(--color-bg)] px-3 py-2 font-sans text-[14px] leading-relaxed text-[var(--color-text)] placeholder:text-[var(--color-faint)] focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] text-[var(--color-faint)]">
          <span>⏎ save · esc cancel</span>
          <button
            type="button"
            onClick={() => onCommit(value)}
            className="press rounded-[var(--aios-radius-pill)] bg-[var(--color-accent)] px-3 py-1 text-[11px] font-medium text-[var(--color-bg)]"
          >
            save goal
          </button>
        </div>
      </div>
    </div>
  );
}

// ── tiny dropdown primitive ──────────────────────────────────────────────────

export function Dropdown({
  open,
  onToggle,
  trigger,
  children,
  align = "left",
  triggerClassName,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  /** Override the trigger pill styling (e.g. the ultracode gradient). */
  triggerClassName?: string;
  /** Accessible name for icon-only triggers (the wrench). */
  label?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // FIXED positioning (computed from the trigger on open) so the menu can
  // never be clipped by the pane's overflow — the old absolute/bottom-full
  // menu was cut off at the pane edge with the long model list. Opens upward
  // when there's room (the composer lives at the bottom), else downward, and
  // long lists scroll INSIDE the menu.
  const [menuPos, setMenuPos] = useState<React.CSSProperties | null>(null);
  useEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const r = rootRef.current?.getBoundingClientRect();
    if (r) {
      // open toward the LARGER side and never exceed it — the wrench/model
      // lists used to clip at the window edge on short panes.
      const spaceAbove = r.top - 10;
      const spaceBelow = window.innerHeight - r.bottom - 10;
      const openUp = spaceAbove >= spaceBelow;
      const pos: React.CSSProperties = {};
      if (align === "right") pos.right = Math.max(8, window.innerWidth - r.right);
      else pos.left = Math.max(8, r.left);
      if (openUp) pos.bottom = window.innerHeight - r.top + 6;
      else pos.top = r.bottom + 6;
      pos.maxHeight = Math.max(140, openUp ? spaceAbove : spaceBelow);
      (pos as Record<string, string | number>)["--aios-origin"] = openUp
        ? "bottom center"
        : "top center";
      setMenuPos(pos);
    }
    // repositioning mid-scroll is overkill — dismiss instead (standard menus).
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      onToggle();
    };
    window.addEventListener("resize", onToggle);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onToggle);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, align, onToggle]);
  // outside-click + Escape close — a pinned-open menu over the composer was
  // the old behavior; standard dismissal everywhere else in the app. The menu
  // lives in a body portal, so "inside" means trigger OR menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      onToggle();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggle();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onToggle]);
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        title={label}
        className={
          triggerClassName ??
          "flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)]/50 px-2.5 py-1 font-sans text-[11.5px] text-[var(--color-text-2)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
        }
      >
        {trigger}
      </button>
      {open &&
        menuPos &&
        // PORTAL to <body>: position:fixed is re-anchored by any ancestor with
        // backdrop-filter/transform (the composer has backdrop-blur), which
        // teleported menus into the wrong corner. From <body> the viewport
        // coordinates are honored everywhere.
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            // SOLID, no backdrop-filter: WebView2 blurs the backdrop in a
            // SQUARE that ignores border-radius (the owner's "boxy border"
            // over the hero title while searching) — same bug W1.6c fixed on
            // PaneMenu. Solid panel + shadow, no straight-lit inset lip.
            className="scale-in fixed z-[70] min-w-[200px] overflow-y-auto rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] p-1 shadow-[var(--aios-shadow-pop)]"
            style={menuPos}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MenuItem({
  children,
  active,
  disabled,
  title,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      role="menuitem"
      className={`relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-sans text-[12px] transition-colors ${
        disabled
          ? "cursor-not-allowed text-[var(--color-faint)]"
          : active
            ? "bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-text)] shadow-[inset_0_0_24px_-14px_var(--color-accent)]"
            : "text-[var(--color-text-2)] hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
      }`}
    >
      {active && !disabled && (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-[linear-gradient(180deg,var(--color-accent),var(--aios-accent-2))] shadow-[var(--aios-glow-soft)]"
        />
      )}
      <span className="min-w-0 flex-1">{children}</span>
      {active && !disabled && (
        <Check size={13} className="shrink-0 text-[var(--color-accent)]" />
      )}
    </button>
  );
}

// ── slash / @ overlay primitives ─────────────────────────────────────────────

export interface SlashCommand {
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  run: () => void;
}

/** The floating panel that sits just above the composer for `/` and `@`. */
export function OverlayPanel({
  children,
  compact = false,
  drop = "up",
}: {
  children: React.ReactNode;
  /** compact = a left-anchored dropdown (slash menu) vs the full-width panel. */
  compact?: boolean;
  /** "up" above the composer (transcript view: composer at the bottom);
   *  "down" below it (hero: composer near the top — upward would clip at the
   *  pane edge, user-reported). */
  drop?: "up" | "down";
}) {
  return (
    <div
      className={`absolute z-40 max-h-64 overflow-y-auto rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] py-1 shadow-[var(--aios-shadow-pop)] ${
        drop === "up" ? "bottom-full mb-2" : "top-full mt-2"
      } ${compact ? "left-3 min-w-[220px] max-w-[min(360px,90%)]" : "left-0 right-0"}`}
    >
      {children}
    </div>
  );
}

export function OverlayRow({
  active,
  onClick,
  onMouseEnter,
  icon,
  label,
  desc,
  mono,
}: {
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  icon: React.ReactNode;
  label: string;
  desc?: string;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
        active ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-panel)]"
      }`}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center">{icon}</span>
      <span
        className={`shrink-0 text-[12.5px] text-[var(--color-text)] ${
          mono ? "font-mono" : "font-sans"
        }`}
      >
        {label}
      </span>
      {desc && (
        <span className="truncate font-sans text-[11px] text-[var(--color-faint)]">
          {desc}
        </span>
      )}
      {active && (
        <>
          <span className="flex-1" />
          <CornerDownLeft size={12} className="shrink-0 text-[var(--color-faint)]" />
        </>
      )}
    </button>
  );
}

// ── /resume picker ────────────────────────────────────────────────────────────

/**
 * Floating picker (surface-pop style) listing recent past chat sessions for
 * `/resume`. Sits just above the composer like the slash/@ menus. A sticky
 * search header filters by title; each row shows the title + a faint secondary
 * line with the cwd basename and a relative time. Arrow-key navigable (driven
 * from the search input — see onResumeKeyDown), click to pick, Esc to close.
 */
export function ResumePicker({
  sessions,
  total,
  loading,
  query,
  activeIdx,
  currentSessionId,
  searchRef,
  onQueryChange,
  onKeyDown,
  onPick,
  onClose,
  drop = "up",
}: {
  sessions: ChatSessionInfo[];
  total: number;
  loading: boolean;
  query: string;
  activeIdx: number;
  /** The engine session id currently open in THIS pane — its row gets an
   *  accent ring + "current" dot so "which one am I in" is obvious. */
  currentSessionId: string | null;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPick: (s: ChatSessionInfo) => void;
  onClose: () => void;
  /** "up" above the composer (transcript view), "down" below it (hero —
   *  opening upward there clipped the list at the pane edge, user-reported). */
  drop?: "up" | "down";
}) {
  // hover blooms rows too (owner ask) — tracked LOCALLY so a mouse pass never
  // re-renders the whole composer, and the row animates height in place (one
  // element, grid-rows transition) instead of remounting: that remount was
  // the "ghost trailing" lag. Keyboard movement reclaims the bloom.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  useEffect(() => {
    setHoverIdx(null);
  }, [activeIdx]);
  // standard dismissal — click anywhere outside or Escape closes, no matter
  // where focus sits (the search input's own handler only fires when focused;
  // owner-reported "doesn't close"). Capture phase so a click that also
  // focuses something else still dismisses.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);
  // THE RAIL LEDGER (sketch board rev 4 — R1 + R2 merged, locked): a glowing
  // accent→cyan time rail carries engine-colored dots; resting sessions are
  // ONE tight line, and only the keyboard-active row blooms into a card with
  // the preview + resume chip. Date buckets match the History pane.
  const byDate = groupByDate([...sessions].sort((a, b) => b.mtime - a.mtime), Date.now());
  let rowIndex = 0;
  return (
    <div
      ref={rootRef}
      // solid for the same reason as the Dropdown menu: WebView2's backdrop
      // blur paints a square that ignores the rounded corners.
      className={`absolute left-0 right-0 z-40 overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] shadow-[var(--aios-shadow-pop)] ${
        drop === "up" ? "bottom-full mb-2" : "top-full mt-2"
      }`}
    >
      {/* sticky search header */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <History size={14} className="shrink-0 text-[var(--color-accent)]" />
        <span className="shrink-0 font-sans text-[12px] text-[var(--color-text-2)]">
          resume
        </span>
        <span className="ml-1 flex min-w-0 flex-1 items-center gap-1.5">
          <Search size={12} className="shrink-0 text-[var(--color-faint)]" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="search title, project, model, id…"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-sans text-[12.5px] text-[var(--color-text)] placeholder:text-[var(--color-faint)] focus:outline-none"
          />
        </span>
        <span className="shrink-0 font-mono text-[9.5px] text-[var(--color-faint)]">
          {total} sessions
        </span>
        <button
          type="button"
          onClick={onClose}
          title="close (esc)"
          className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-[var(--color-faint)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
        >
          <X size={12} />
        </button>
      </div>

      {/* body — the time rail runs behind every row's dot gutter. Height caps
          to the viewport share so the hero never has to scroll. */}
      <div
        onMouseLeave={() => setHoverIdx(null)}
        className="relative max-h-[min(20rem,42vh)] overflow-y-auto py-1.5 pl-1 pr-1.5"
      >
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-3 font-sans text-[12px] text-[var(--color-faint)]">
            <Loader2 size={13} className="animate-spin" />
            loading codex + chatpane sessions…
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-3 font-sans text-[12px] text-[var(--color-faint)]">
            {total === 0
              ? "no past chat sessions yet"
              : `no sessions match “${query}”`}
          </div>
        ) : (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-2 left-[18px] top-2 w-[2px] rounded-full bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-accent)_45%,transparent),color-mix(in_srgb,var(--aios-accent-2)_25%,transparent),transparent)]"
            />
            {byDate.map((grp) => (
              <div key={grp.group}>
                <div className="flex items-center justify-between py-1 pl-9 pr-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
                  <span className="truncate">{grp.group}</span>
                  <span className="tracking-normal">{grp.entries.length}</span>
                </div>
                {grp.entries.map((s) => {
                  const i = rowIndex++;
                  return (
                    <ResumeRow
                      key={s.id}
                      session={s}
                      active={i === (hoverIdx ?? activeIdx)}
                      current={!!currentSessionId && s.id === currentSessionId}
                      onHoverStart={() => setHoverIdx(i)}
                      onClick={() => onPick(s)}
                    />
                  );
                })}
              </div>
            ))}
          </>
        )}
      </div>

      {/* kbd foot */}
      <div className="flex items-center gap-3.5 border-t border-[var(--color-border)] px-3 py-1.5 font-mono text-[9.5px] text-[var(--color-faint)]">
        <span><span className="rounded border border-[var(--color-border)] px-1 text-[var(--color-muted)]">↑↓</span> navigate</span>
        <span><span className="rounded border border-[var(--color-border)] px-1 text-[var(--color-muted)]">⏎</span> resume</span>
        <span><span className="rounded border border-[var(--color-border)] px-1 text-[var(--color-muted)]">esc</span> close</span>
      </div>
    </div>
  );
}

/** The accent color for an engine — so claude/codex/local rows are
 *  distinguishable at a glance (claude=accent, codex=blue, local/ollama=cyan,
 *  opencode=amber). */
function engineColorVar(engine: string): string {
  if (engine === "codex" || engine === "openai") return "var(--color-info)";
  if (engine === "local" || engine === "ollama") return "var(--aios-accent-2)";
  if (engine === "opencode" || engine === "openrouter") return "var(--color-warning)";
  return "var(--color-accent)";
}

/** One rail-ledger row — a SINGLE element in both states so the bloom is an
 *  in-place height animation (grid-rows 0fr→1fr), never a remount: the old
 *  two-shape swap read as "ghost trailing" lag (owner-reported). Resting =
 *  one line (dot · title · pill · age); active (hover OR keyboard) blooms the
 *  preview + meta well open and grows the rail dot. */
function ResumeRow({
  session,
  active,
  current,
  onHoverStart,
  onClick,
}: {
  session: ChatSessionInfo;
  active: boolean;
  current: boolean;
  onHoverStart: () => void;
  onClick: () => void;
}) {
  const dir = baseName(session.cwd || "");
  const when = session.mtime ? fmtRelativeTime(session.mtime) : "";
  const engine = session.engine || "claude";
  const model = session.model || "";
  const shortId = session.id ? session.id.slice(0, 8) : "";
  const preview = (session.last_user || "").trim();
  const engineColor = engineColorVar(engine);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onHoverStart}
      className={`relative block w-full rounded-xl border py-[5px] pl-9 pr-2 text-left transition-[background-color,border-color,box-shadow] duration-150 ${
        active
          ? "border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] bg-[var(--color-accent-soft)] shadow-[var(--aios-glow-soft)]"
          : "border-transparent"
      }`}
    >
      {/* rail dot — grows + glows with the bloom */}
      <span
        aria-hidden
        style={{
          background: engineColor,
          boxShadow: active ? `0 0 10px color-mix(in srgb, ${engineColor} 75%, transparent)` : undefined,
        }}
        className={`absolute left-[15px] top-[11px] rounded-full border-2 border-[var(--color-bg)] transition-all duration-150 ${
          active ? "h-3 w-3 -translate-x-[2px]" : "h-2 w-2"
        }`}
      />
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-sans text-[13px] text-[var(--color-text)]">
          {session.title || "untitled session"}
        </span>
        {current && (
          <span
            style={{ color: engineColor, borderColor: `color-mix(in srgb, ${engineColor} 50%, transparent)` }}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-[0.06em]"
          >
            <span style={{ background: engineColor }} className="h-1.5 w-1.5 rounded-full" />
            current
          </span>
        )}
        {active ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-panel)]/60 px-1.5 py-0.5 font-mono text-[9.5px] text-[var(--color-text-2)]">
            resume
            <CornerDownLeft size={10} />
          </span>
        ) : (
          <span className="shrink-0 font-mono text-[9.5px] text-[var(--color-faint)]">
            {when}
            {engine !== "claude" ? ` · ${engine}` : ""}
          </span>
        )}
      </span>
      {/* the bloom well — animates open in place */}
      <span
        aria-hidden={!active}
        style={{ gridTemplateRows: active ? "1fr" : "0fr" }}
        className="grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
      >
        <span className="block min-h-0 overflow-hidden">
          {preview && (
            <span className="mt-0.5 block truncate font-sans text-[11.5px] text-[var(--color-text-2)]">
              {preview}
            </span>
          )}
          <span className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[10px] text-[var(--color-faint)]">
            {dir && (
              <span className="inline-flex items-center gap-1">
                <Folder size={10} />
                {dir}
              </span>
            )}
            {dir && when && <span className="text-[var(--color-border-strong)]">·</span>}
            {when && (
              <span className="inline-flex items-center gap-1">
                <Clock size={10} />
                {when}
              </span>
            )}
            {model && <span className="text-[var(--color-border-strong)]">·</span>}
            {model && <span className="truncate">{model}</span>}
            {shortId && <span className="text-[var(--color-border-strong)]">·</span>}
            {shortId && <span>{shortId}</span>}
          </span>
        </span>
      </span>
    </button>
  );
}

/** Faint inline pill noting which past session this chat was resumed from. */
export function ResumedNote({ title, onClear }: { title: string; onClear: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-panel)]/70 px-2.5 py-1 font-sans text-[11px] text-[var(--color-text-2)]">
      <RotateCcw size={11} className="shrink-0 text-[var(--color-accent)]" />
      <span className="truncate">resumed: {title}</span>
      <button
        type="button"
        onClick={onClear}
        title="dismiss"
        className="ml-0.5 shrink-0 rounded-full p-0.5 text-[var(--color-muted)] hover:text-[var(--color-text)]"
      >
        <X size={11} />
      </button>
    </span>
  );
}
