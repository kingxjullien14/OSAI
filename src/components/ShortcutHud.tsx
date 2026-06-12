/** Mod+? shortcut HUD — every live chord on one calm overlay, rendered from
 *  the single shortcuts.ts catalog (the same source the Settings cheat-sheet
 *  consumes, so the two can never drift apart). Platform-correct keycaps. */
import type { ReactNode } from "react";
import { Keyboard, X } from "lucide-react";

import { shortcutGroups } from "../lib/shortcuts";
import { trapTab, useExitState } from "./ui";

function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-[var(--color-border)] bg-[var(--color-panel-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-2)]">
      {children}
    </kbd>
  );
}

export function ShortcutHud({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mounted, closing } = useExitState(open);
  if (!mounted) return null;
  const groups = shortcutGroups();
  return (
    <div
      data-closing={closing || undefined}
      className={`overlay-backdrop fixed inset-0 z-50 grid place-items-center bg-black/45 p-6 backdrop-blur-sm ${closing ? "pointer-events-none" : ""}`}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="keyboard shortcuts"
        data-closing={closing || undefined}
        className="modal-in glass w-[660px] max-w-full overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-panel)]/95 shadow-[var(--aios-shadow-pop)]"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            return;
          }
          trapTab(e, e.currentTarget);
        }}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
          <Keyboard size={14} className="text-[var(--color-muted)]" />
          <span className="text-[13px] font-medium text-[var(--color-text)]">keyboard shortcuts</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
          >
            <X size={13} />
          </button>
        </div>
        <div className="stagger grid max-h-[62vh] grid-cols-1 gap-x-8 gap-y-4 overflow-y-auto p-4 sm:grid-cols-3">
          {groups.map((g) => (
            <div key={g.title} className="min-w-0">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-faint)]">
                {g.title}
              </div>
              {g.items.map((s) => (
                <div
                  key={s.action}
                  className="flex items-center justify-between gap-3 border-b border-[var(--color-border)]/50 py-1.5 last:border-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] text-[var(--color-text-2)]">{s.action}</span>
                    {s.note && (
                      <span className="block truncate font-mono text-[9.5px] text-[var(--color-faint)]">{s.note}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5">
                    {s.keys.map((k, i) => (
                      <Keycap key={i}>{k}</Keycap>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
