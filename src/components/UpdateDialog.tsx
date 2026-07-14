import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";
import { DownloadCloud, RotateCcw, Sparkles, X } from "lucide-react";
import type { Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";

import { installUpdate, type UpdatePhase } from "../lib/updater";
import { modalPop, overlayFade } from "./fx/motionTokens";

/** Splits on `**bold**` and renders the bold runs as <strong> (the rest verbatim).
 *  Just enough inline markdown for changelog lead-ins ("**Feature** — …"). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((seg, i) => {
    const b = seg.match(/^\*\*([^*]+)\*\*$/);
    return b ? (
      <strong key={i} className="font-semibold text-[var(--color-text)]">
        {b[1]}
      </strong>
    ) : (
      <span key={i}>{seg}</span>
    );
  });
}

/** Renders the release-notes body (the annotated git tag baked into latest.json)
 *  with light markdown: `#`/`##` lines become headings, `-`/`*`/`•` become
 *  bullets, `**bold**` renders inline, blank lines become spacing. Deliberately
 *  tiny — no markdown dep for one dialog; changelogs are short and predictable. */
function Changelog({ body }: { body: string }) {
  const lines = useMemo(() => body.replace(/\r\n/g, "\n").split("\n"), [body]);
  return (
    <div className="flex flex-col gap-1.5">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={i} className="h-1.5" />;
        const heading = line.match(/^#{1,3}\s+(.*)$/);
        if (heading) {
          return (
            <div
              key={i}
              className="pt-1 text-[12.5px] font-semibold text-[var(--color-text)]"
            >
              {inline(heading[1])}
            </div>
          );
        }
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 pl-1 text-[12px] leading-snug text-[var(--color-text-2)]">
              <span className="mt-[2px] shrink-0 text-[var(--color-accent)]">•</span>
              <span className="min-w-0">{inline(bullet[1])}</span>
            </div>
          );
        }
        return (
          <div key={i} className="text-[12px] leading-snug text-[var(--color-text-2)]">
            {inline(line)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Launch-time "update available" dialog — replaces the easy-to-miss toast with a
 * modal that shows the changelog and asks the user to update now or skip. Drives
 * the download/install/relaunch through `installUpdate` (progress + phases), so
 * the whole flow lives here instead of only in Settings.
 *
 * · X / backdrop / Esc → "later": dismiss for this session; it reappears next
 *   launch (nothing persisted).
 * · Skip this version → `onSkip(version)`: the caller persists it so this exact
 *   version never nags again (a newer one still will).
 */
export function UpdateDialog({
  update,
  onClose,
  onSkip,
}: {
  update: Update;
  onClose: () => void;
  onSkip: (version: string) => void;
}) {
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "idle" });
  const [current, setCurrent] = useState<string | null>(null);

  const installing =
    phase.kind === "downloading" || phase.kind === "installing" || phase.kind === "ready";

  useEffect(() => {
    let alive = true;
    getVersion()
      .then((v) => alive && setCurrent(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Esc = later (but never mid-install — a relaunch is coming; don't tease a close)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !installing) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, installing]);

  const runInstall = async () => {
    try {
      // installUpdate walks setPhase through downloading → installing → ready,
      // then relaunches (this promise usually never resolves). Errors fold into
      // the phase itself, so the catch is just to keep the await tidy.
      await installUpdate(update, setPhase);
    } catch {
      /* phase already === "error" */
    }
  };

  const notes = update.body?.trim();

  const status = (() => {
    switch (phase.kind) {
      case "downloading":
        return phase.pct == null ? "downloading…" : `downloading… ${phase.pct}%`;
      case "installing":
        return "installing…";
      case "ready":
        return "installed — restarting…";
      case "error":
        return `couldn't update: ${phase.message}`;
      default:
        return null;
    }
  })();

  return (
    <AnimatePresence>
      <m.div
        {...overlayFade()}
        className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-6 backdrop-blur-sm"
        onMouseDown={() => !installing && onClose()}
      >
        <m.div
          {...modalPop()}
          role="dialog"
          aria-modal="true"
          aria-label="update available"
          className="glass-strong flex max-h-[80vh] w-[480px] max-w-full flex-col overflow-hidden rounded-2xl shadow-[var(--osai-shadow-pop)]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* header */}
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[var(--color-accent)]"
                style={{ background: "color-mix(in srgb, var(--color-accent) 15%, transparent)" }}
              >
                <Sparkles size={15} />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[14px] font-medium text-[var(--color-text)]">
                  Update available
                </span>
                <span className="font-mono text-[10.5px] text-[var(--color-faint)]">
                  {current ? `v${current} → ` : ""}
                  <span className="text-[var(--color-accent)]">v{update.version}</span>
                </span>
              </div>
            </div>
            {!installing && (
              <button
                onClick={onClose}
                aria-label="later"
                title="later"
                className="grid h-7 w-7 place-items-center rounded-lg text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {/* changelog */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
              what's new
            </div>
            {notes ? (
              <Changelog body={notes} />
            ) : (
              <div className="text-[12px] leading-snug text-[var(--color-muted)]">
                A new version is ready to install.
              </div>
            )}
          </div>

          {/* progress (while installing) */}
          {status && (
            <div className="px-4 pb-1">
              <p
                className={`text-[11px] leading-snug ${
                  phase.kind === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"
                }`}
              >
                {status}
              </p>
              {phase.kind === "downloading" && (
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--color-panel-2)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300"
                    style={{ width: phase.pct == null ? "100%" : `${phase.pct}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* actions */}
          <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-3">
            <button
              type="button"
              onClick={() => onSkip(update.version)}
              disabled={installing}
              className="rounded-lg px-2.5 py-1.5 text-[12px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-40"
            >
              Skip this version
            </button>
            <div className="flex items-center gap-2">
              {!installing && (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
                >
                  Later
                </button>
              )}
              <button
                type="button"
                onClick={runInstall}
                disabled={installing}
                className="flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_25%,transparent)] disabled:opacity-50"
              >
                {installing ? (
                  <>
                    <RotateCcw size={13} className="animate-spin" /> updating…
                  </>
                ) : phase.kind === "error" ? (
                  <>
                    <RotateCcw size={13} /> retry
                  </>
                ) : (
                  <>
                    <DownloadCloud size={13} /> Update now
                  </>
                )}
              </button>
            </div>
          </div>
        </m.div>
      </m.div>
    </AnimatePresence>
  );
}
