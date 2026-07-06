/** Transcript bubble family — third slice of the ChatPane split
 *  (PLAN-odysseus-feel.md, W4). The per-turn presentation pieces: the framed
 *  assistant turn card, the YOU / assistant bubbles with their hover actions +
 *  context menus, and the small transcript furniture (day seams, working line,
 *  result footer). Moved verbatim from ChatPane; behavior unchanged. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  NotebookPen,
  Pencil,
  Pin,
  Quote,
  RefreshCw,
  Waypoints,
} from "lucide-react";
import type { ChatModel } from "../../lib/chat";
import type { ChatTurn } from "../../lib/chatStream";
import { fileSrc } from "../../lib/fs";
import { saveToNotes } from "../../lib/snc";
import { CopyButton } from "../ui";
import { PaneMenu, type PaneMenuEntry } from "../PaneMenu";
import { CadencedShimmer } from "./ThinkingBlock";
import { fmtClock, fmtDuration } from "./format";
import { Markdown } from "./Markdown";

type Turn = ChatTurn;

/** The bare live working line when a turn is in flight before any tool runs. */
export function WorkingLine({ elapsedMs, label }: { elapsedMs: number; label?: string }) {
  return (
    <div className="flex items-center gap-1.5 font-sans text-[12.5px] text-[var(--color-muted)]">
      <Loader2 size={13} className="shrink-0 animate-spin text-[var(--color-accent)]" />
      <span className="animate-pulse">{label ?? "Working…"} {fmtClock(elapsedMs)}</span>
    </div>
  );
}

/** Faint, centered turn footer — tokens · cost · (duration on text-only turns). */
export function ResultFooter({
  turn,
  onRetry,
}: {
  turn: Extract<Turn, { kind: "result" }>;
  onRetry?: () => void;
}) {
  // a failure must NOT read like a benign "1.2s · 340 tok" footer.
  if (turn.ok === false) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-[var(--color-danger)]/35 bg-[var(--color-danger)]/[0.07] px-3.5 py-2.5 backdrop-blur-md shadow-[0_0_26px_-14px_var(--color-danger)]">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--color-danger)]" />
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-[var(--color-text-2)]">
          {turn.text || "something went wrong."}
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="press inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-border-strong)] px-2 py-1 font-sans text-[11.5px] text-[var(--color-muted)] transition-colors hover:border-[var(--color-text)] hover:text-[var(--color-text)]"
          >
            <RefreshCw size={11} /> retry
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="text-center font-mono text-[10.5px] text-[var(--color-faint)]">
      {turn.text}
    </div>
  );
}

/** "today" / "yesterday" / "wed 11 jun" for the transcript's day rules. */
function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "today";
  if (d.toDateString() === yesterday.toDateString()) return "yesterday";
  return d
    .toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
    .toLowerCase();
}

/** "14:32" hover stamp shared by both bubbles' action rows. */
function turnClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Quiet hairline + day label where the transcript crosses midnight (resumed
 *  sessions span days; "yesterday" deserves a seam). */
export function DaySeparator({ at }: { at: number }) {
  return (
    <div
      role="separator"
      aria-label={dayLabel(at)}
      className="sticky top-0 z-10 -mx-1 flex items-center gap-3 bg-[var(--color-bg)]/80 px-1 py-1 backdrop-blur-sm"
    >
      <span className="h-px flex-1 bg-[var(--color-border)]" />
      <span className="font-mono text-[10px] lowercase tracking-wide text-[var(--color-faint)]">
        {dayLabel(at)}
      </span>
      <span className="h-px flex-1 bg-[var(--color-border)]" />
    </div>
  );
}

/** 02 Framed Turns — one assistant response = one glass card. The render loop
 *  groups the run of non-user blocks (thinking · activity · change · prose ·
 *  result) following a user message into a single frame; this draws the card
 *  chrome + the mono header strip (status dot · AIOS·model · worked/steps).
 *  Non-positioned on purpose: the minimap reads child `offsetTop`, so a
 *  positioned wrapper would shift every marker. */
export function TurnFrame({
  modelLabel,
  steps,
  workedMs,
  live,
  variantNav,
  children,
}: {
  modelLabel: string;
  steps: number;
  workedMs: number;
  live: boolean;
  variantNav?: { index: number; count: number; onPrev: () => void; onNext: () => void };
  children: React.ReactNode;
}) {
  const stepLbl = steps > 0 ? `${steps} step${steps === 1 ? "" : "s"}` : "";
  const meta = live
    ? ""
    : workedMs > 0
      ? `worked ${fmtDuration(workedMs)}${stepLbl ? ` · ${stepLbl}` : ""}`
      : stepLbl;
  return (
    <div className="aios-turn overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-panel)_55%,transparent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)]/70 px-3.5 py-2 font-mono text-[10.5px]">
        <span
          className="h-[7px] w-[7px] shrink-0 rounded-full"
          style={
            live
              ? { background: "var(--color-accent)", boxShadow: "var(--aios-glow-soft)" }
              : { background: "var(--color-success)", boxShadow: "0 0 7px var(--color-success-glow)" }
          }
        />
        <span className="tracking-[0.06em] text-[var(--color-text-2)]">
          OSAI · <span className="uppercase">{modelLabel}</span>
        </span>
        {variantNav && variantNav.count > 1 && (
          <span
            className="flex items-center gap-0.5 rounded-full border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-panel)_60%,transparent)] px-1 py-px"
            title={`alternate answer ${variantNav.index + 1} of ${variantNav.count} to this message — regenerate re-rolls the SAME prompt (not a separate, continuable branch; that lands with BYO-key)`}
          >
            <button
              type="button"
              onClick={variantNav.onPrev}
              disabled={variantNav.index <= 0}
              title="previous response"
              className="press grid h-4 w-4 place-items-center rounded text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight size={11} className="rotate-180" />
            </button>
            <span className="px-0.5 tabular-nums text-[var(--color-text-2)]">
              {variantNav.index + 1}/{variantNav.count}
            </span>
            <button
              type="button"
              onClick={variantNav.onNext}
              disabled={variantNav.index >= variantNav.count - 1}
              title="next response"
              className="press grid h-4 w-4 place-items-center rounded text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight size={11} />
            </button>
          </span>
        )}
        <span className="ml-auto text-[var(--color-faint)]">
          {live ? <CadencedShimmer>streaming</CadencedShimmer> : meta}
        </span>
      </div>
      <div className="flex flex-col gap-3 p-3.5">{children}</div>
    </div>
  );
}

export function UserBubble({
  turn,
  at,
  streaming,
  isLast,
  onRegenerate,
  onRetryModel,
  retryModels,
  currentModelId,
  onEdit,
  variantNav,
}: {
  turn: Extract<Turn, { kind: "user" }>;
  /** wall-clock of the turn (send time / transcript time); null = unknown. */
  at?: number | null;
  streaming: boolean;
  isLast: boolean;
  onRegenerate: () => void;
  /** retry this turn on a different model (restart-resume-regenerate). */
  onRetryModel?: (m: ChatModel) => void;
  /** the models offered in the retry menu (CLI available + API) — parent-supplied
   *  so it includes the BYO-key models, not just the static CLI catalog. */
  retryModels?: ChatModel[];
  /** the model currently driving the session (marked in the retry menu). */
  currentModelId?: string;
  onEdit: (id: string, text: string) => void;
  /** edit-fork branch switcher (API tier): this prompt has alternate edits. */
  variantNav?: { index: number; count: number; onPrev: () => void; onNext: () => void };
}) {
  // The retry menu is rendered in a PORTAL at fixed coords anchored to its button
  // — an in-flow dropdown gets clipped by the scrolling transcript (the reported
  // "can't see the models"). `retryPos` holds the resolved screen position.
  const retryBtnRef = useRef<HTMLButtonElement>(null);
  const [retryPos, setRetryPos] = useState<{
    right: number;
    top?: number;
    bottom?: number;
    maxH: number;
  } | null>(null);
  const models = retryModels ?? [];
  const openRetryMenu = () => {
    const r = retryBtnRef.current?.getBoundingClientRect();
    if (!r) return;
    const right = Math.round(window.innerWidth - r.right);
    const spaceAbove = r.top;
    const spaceBelow = window.innerHeight - r.bottom;
    // open upward when there's more room above (the common case — bubbles sit low),
    // else downward; cap the height to the available space so it never clips.
    setRetryPos(
      spaceAbove >= spaceBelow
        ? { right, bottom: Math.round(window.innerHeight - r.top + 4), maxH: Math.min(320, spaceAbove - 12) }
        : { right, top: Math.round(r.bottom + 4), maxH: Math.min(320, spaceBelow - 12) },
    );
    setRetryOpen(true);
  };
  const [retryOpen, setRetryOpen] = useState(false);
  // close the retry menu on any outside click, or Escape — ONLY Escape: closing
  // on every keystroke dismissed the list before it could even be read.
  useEffect(() => {
    if (!retryOpen) return;
    const close = () => setRetryOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [retryOpen]);
  // attachments that rode this turn: a clicked image opens a read-only lightbox;
  // a clicked snippet chip expands its full quoted text inline.
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [openSnip, setOpenSnip] = useState<string | null>(null);
  // right-click menu (W3): the hover actions, reachable without hover-hunting.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const images = turn.images ?? [];
  const snippets = turn.snippets ?? [];
  // image-only sends carry a "[N images]" placeholder as their wire text (so the
  // model's prompt is unchanged) — hide it here since the thumbnails say it better.
  const isImgPlaceholder = images.length > 0 && /^\[\d+ images?\]$/.test(turn.text);
  const showText = turn.text.length > 0 && !isImgPlaceholder;
  const hasBody = showText || images.length > 0 || snippets.length > 0;
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);
  const ctxItems: PaneMenuEntry[] = [
    {
      key: "copy",
      label: "Copy message",
      onSelect: () => void navigator.clipboard?.writeText(turn.text).catch(() => {}),
    },
    {
      key: "edit",
      label: "Edit & resend",
      hint: "rewinds",
      disabled: streaming,
      onSelect: () => onEdit(turn.id, turn.text),
    },
    ...(isLast
      ? [
          {
            key: "regen",
            label: "Regenerate response",
            disabled: streaming,
            onSelect: onRegenerate,
          } satisfies PaneMenuEntry,
        ]
      : []),
    ...(isLast && onRetryModel && models.length > 0
      ? [
          {
            key: "retry",
            label: "Retry with another model",
            disabled: streaming,
            children: models.map((m) => ({
              key: `retry-${m.id}`,
              label: m.label ?? m.id,
              hint: m.id === currentModelId ? "current" : undefined,
              onSelect: () => onRetryModel(m),
            })),
          } satisfies PaneMenuEntry,
        ]
      : []),
  ];
  return (
    <div
      className="group flex flex-col items-end gap-1"
      onContextMenu={(e) => {
        // keep native menus on editable/selected text
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {ctxMenu && (
        <PaneMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxItems} onClose={() => setCtxMenu(null)} />
      )}
      {turn.steered && (
        <span className="flex items-center gap-1 pr-1 font-mono text-[10px] text-[var(--color-faint)]">
          <Waypoints size={10} /> steered into the running turn
        </span>
      )}
      {/* 02 framed turn — your message is a compact accent-glass card with a
          mono YOU·time strip (matches the AIOS frame's header language). */}
      <div className="w-fit max-w-[82%] overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-accent-soft)_82%,transparent)] shadow-[var(--aios-glow-soft)] backdrop-blur-md">
        <div className="flex items-center gap-2 border-b border-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] px-3.5 py-1.5 font-mono text-[10.5px]">
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--color-accent)] shadow-[var(--aios-glow-soft)]" />
          <span className="tracking-[0.05em] text-[var(--color-text-2)]">YOU</span>
          {variantNav && variantNav.count > 1 && (
            <span
              className="flex items-center gap-0.5 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_22%,transparent)] bg-[color-mix(in_srgb,var(--color-panel)_50%,transparent)] px-1 py-px"
              title={`prompt ${variantNav.index + 1} of ${variantNav.count} — edited versions of this message (each its own branch)`}
            >
              <button
                type="button"
                onClick={variantNav.onPrev}
                disabled={variantNav.index <= 0}
                title="previous prompt"
                className="press grid h-4 w-4 place-items-center rounded text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronRight size={11} className="rotate-180" />
              </button>
              <span className="px-0.5 tabular-nums text-[var(--color-text-2)]">
                {variantNav.index + 1}/{variantNav.count}
              </span>
              <button
                type="button"
                onClick={variantNav.onNext}
                disabled={variantNav.index >= variantNav.count - 1}
                title="next prompt"
                className="press grid h-4 w-4 place-items-center rounded text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronRight size={11} />
              </button>
            </span>
          )}
          {at != null && (
            <span
              className="ml-auto text-[var(--color-faint)]"
              title={new Date(at).toLocaleString()}
            >
              {turnClock(at)}
            </span>
          )}
        </div>
        {showText && (
          <div className="whitespace-pre-wrap break-words px-3.5 py-2.5 font-sans text-[13.5px] leading-relaxed text-[var(--color-text)]">
            {turn.text}
          </div>
        )}
        {(images.length > 0 || snippets.length > 0) && (
          <div
            className={`flex flex-col gap-2 px-3.5 pb-3 ${showText ? "border-t border-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] pt-2.5" : "pt-3"}`}
          >
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.map((path, i) => (
                  <button
                    key={`${path}:${i}`}
                    type="button"
                    onClick={() => setLightbox(fileSrc(path))}
                    title="click to view"
                    className="press group/img relative h-16 w-16 cursor-zoom-in overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-panel)] transition-colors hover:border-[color-mix(in_srgb,var(--color-accent)_50%,transparent)]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fileSrc(path)} alt="attachment" className="h-full w-full object-cover" />
                    <span className="absolute inset-0 grid place-items-center bg-[var(--color-bg)]/0 opacity-0 transition-opacity group-hover/img:bg-[var(--color-bg)]/30 group-hover/img:opacity-100">
                      <ImageIcon size={15} className="text-[var(--color-text)] drop-shadow" />
                    </span>
                  </button>
                ))}
              </div>
            )}
            {snippets.map((s) => {
              const open = openSnip === s.id;
              return (
                <div key={s.id} className="overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] bg-[color-mix(in_srgb,var(--color-panel)_45%,transparent)]">
                  <button
                    type="button"
                    onClick={() => setOpenSnip(open ? null : s.id)}
                    className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left font-sans text-[11.5px] text-[var(--color-text-2)] transition-colors hover:text-[var(--color-text)]"
                    title={open ? "collapse" : "expand quoted snippet"}
                  >
                    <Quote size={12} className="shrink-0 text-[var(--color-accent)]" />
                    <span className={open ? "flex-1" : "flex-1 truncate"}>{open ? "quoted snippet" : s.text.replace(/\s+/g, " ").slice(0, 60)}</span>
                    <ChevronDown size={12} className={`shrink-0 text-[var(--color-muted)] transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && (
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words border-t border-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-text-2)]">
                      {s.text}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!hasBody && (
          <div className="px-3.5 py-2.5 font-sans text-[12px] italic text-[var(--color-faint)]">(empty message)</div>
        )}
      </div>
      {lightbox &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-8 backdrop-blur-md"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox}
              alt="attachment"
              onClick={(e) => e.stopPropagation()}
              className="max-h-[82vh] max-w-[88vw] rounded-2xl border border-[var(--color-border-strong)] object-contain shadow-[var(--aios-shadow-pop)]"
            />
          </div>,
          document.body,
        )}
      <div className="flex items-center gap-0.5 pr-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <CopyButton text={turn.text} title="copy message" />
        <button
          type="button"
          title="edit & resend"
          disabled={streaming}
          onClick={() => onEdit(turn.id, turn.text)}
          className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-faint)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Pencil size={13} />
        </button>
        {/* regenerate replays the most recent user turn — only honest on the last one */}
        {isLast && (
          <button
            type="button"
            title="regenerate response"
            disabled={streaming}
            onClick={onRegenerate}
            className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-faint)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw size={13} />
          </button>
        )}
        {/* retry the last turn on a different model (restart-resume-regenerate);
            opens upward — the last turn sits near the scroll bottom. */}
        {isLast && onRetryModel && (
          <>
            <button
              ref={retryBtnRef}
              type="button"
              title="retry with another model"
              disabled={streaming}
              onClick={(e) => {
                e.stopPropagation();
                if (retryOpen) setRetryOpen(false);
                else openRetryMenu();
              }}
              className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-faint)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronDown size={13} />
            </button>
            {retryOpen &&
              retryPos &&
              createPortal(
                <div
                  className="fixed z-[200] w-52 overflow-auto rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] p-1 shadow-xl shadow-black/40 backdrop-blur"
                  style={{
                    right: retryPos.right,
                    top: retryPos.top,
                    bottom: retryPos.bottom,
                    maxHeight: retryPos.maxH,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-2 pb-1 pt-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-faint)]">
                    retry with
                  </div>
                  {models.length === 0 && (
                    <div className="px-2 py-1 text-[11px] text-[var(--color-faint)]">
                      no other models available
                    </div>
                  )}
                  {models.map((m) => (
                    <button
                      key={`${m.engine ?? "claude"}:${m.id}`}
                      type="button"
                      onClick={() => {
                        setRetryOpen(false);
                        onRetryModel(m);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[12px] text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
                    >
                      <span className="truncate">{m.label}</span>
                      {m.id === currentModelId && (
                        <span className="shrink-0 font-mono text-[9px] text-[var(--color-faint)]">current</span>
                      )}
                    </button>
                  ))}
                </div>,
                document.body,
              )}
          </>
        )}
      </div>
    </div>
  );
}

/** Hover-row "save to notes": one click puts this reply in the owner's Stone
 *  & Chisel notebook (readable on every device), tagged so S&C can filter
 *  what came from chats. States flow idle → busy → saved/error and settle
 *  back so the row never gets stuck. */
function SaveToNotesButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "err">("idle");
  useEffect(() => {
    if (state !== "done" && state !== "err") return;
    const t = setTimeout(() => setState("idle"), 2600);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      disabled={state === "busy"}
      onClick={() => {
        if (state !== "idle") return;
        setState("busy");
        saveToNotes(text, { tags: ["from-aios", "chat"] })
          .then(() => setState("done"))
          .catch(() => setState("err"));
      }}
      title={
        state === "done"
          ? "saved to stone & chisel"
          : state === "err"
            ? "couldn't save — is the notes pane connected?"
            : "save to notes (stone & chisel)"
      }
      className={`grid h-6 w-6 place-items-center rounded transition-colors hover:bg-[var(--color-panel-2)] ${
        state === "done"
          ? "text-[var(--color-accent)]"
          : state === "err"
            ? "text-[var(--color-danger)]"
            : "text-[var(--color-faint)] hover:text-[var(--color-text)]"
      }`}
    >
      {state === "busy" ? (
        <Loader2 size={12} className="animate-spin" />
      ) : state === "done" ? (
        <Check size={12} />
      ) : (
        <NotebookPen size={12} />
      )}
    </button>
  );
}

/** Parse the WA-style `[[btn: a | b | c]]` choice sentinel out of an assistant
 *  message: returns the prose with the sentinel stripped + up to 3 button
 *  labels. Mirrors the bridge's WhatsApp interactive-button behavior so a choice
 *  offered in chat is tappable here too, not dead literal text. */
function parseButtons(text: string): { body: string; buttons: string[] } {
  const m = text.match(/\[\[btn:\s*([^\]]+?)\s*\]\]/i);
  if (!m) return { body: text, buttons: [] };
  const buttons = m[1]
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  return { body: text.replace(m[0], "").trimEnd(), buttons };
}

export function AssistantBubble({
  turn,
  at,
  onButton,
  disabled,
  onOpenUrl,
  pinned,
  onTogglePin,
}: {
  turn: Extract<Turn, { kind: "assistant" }>;
  /** wall-clock of the turn (arrival / transcript time); null = unknown. */
  at?: number | null;
  onButton: (label: string) => void;
  disabled: boolean;
  onOpenUrl?: (url: string) => void;
  /** true when this answer is pinned to the session's pin strip. */
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  // Don't render the sentinel as a half-baked pill while still streaming in —
  // wait for the full message so we don't flicker partial `[[btn:` text.
  const { body, buttons } = turn.streaming
    ? { body: turn.text, buttons: [] as string[] }
    : parseButtons(turn.text);
  // right-click menu (W3) — copy the SOURCE markdown or pin, sans hover-hunt.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxItems: PaneMenuEntry[] = [
    {
      key: "copy",
      label: "Copy response",
      hint: "markdown",
      onSelect: () => void navigator.clipboard?.writeText(body).catch(() => {}),
    },
    {
      key: "notes",
      label: "Save to notes",
      hint: "stone & chisel",
      onSelect: () =>
        void saveToNotes(body, { tags: ["from-aios", "chat"] }).catch(() => {}),
    },
    ...(onTogglePin
      ? [
          {
            key: "pin",
            label: pinned ? "Unpin answer" : "Pin answer",
            onSelect: onTogglePin,
          } satisfies PaneMenuEntry,
        ]
      : []),
  ];
  return (
    <div
      className="group flex flex-col items-start gap-1"
      onContextMenu={(e) => {
        if (turn.streaming) return;
        if (window.getSelection()?.toString()) return;
        // code fences own their right-click (run/copy) — let them win.
        if ((e.target as HTMLElement).closest("pre")) return;
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {ctxMenu && (
        <PaneMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxItems} onClose={() => setCtxMenu(null)} />
      )}
      <div className="max-w-[92%] font-sans text-[14.5px] leading-relaxed text-[var(--color-text-2)]">
        <Markdown text={body} onOpenUrl={onOpenUrl} />
        {turn.streaming && (
          <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-[var(--color-accent)]" />
        )}
      </div>
      {buttons.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {buttons.map((label) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => onButton(label)}
              className="rounded-[var(--aios-radius-pill)] border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!turn.streaming && body.trim() && (
        <div
          className={`flex items-center gap-0.5 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 ${
            pinned ? "opacity-100" : "opacity-0"
          }`}
        >
          {at != null && (
            <span className="mr-1 font-mono text-[10px] text-[var(--color-faint)]" title={new Date(at).toLocaleString()}>
              {turnClock(at)}
            </span>
          )}
          <CopyButton text={body} title="copy response" />
          <SaveToNotesButton text={body} />
          {onTogglePin && (
            <button
              type="button"
              onClick={onTogglePin}
              title={pinned ? "unpin this answer" : "pin this answer to the top strip"}
              className={`grid h-6 w-6 place-items-center rounded transition-colors hover:bg-[var(--color-panel-2)] ${
                pinned
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-faint)] hover:text-[var(--color-text)]"
              }`}
            >
              <Pin size={12} className={pinned ? "fill-current" : undefined} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
