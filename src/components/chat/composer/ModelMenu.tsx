/** The model menu — REBUILT from scratch (owner, smoke round 5). The old
 *  "boxless type-to-dig" worked by focusing an invisible container div to
 *  capture keystrokes; that programmatic div-focus is the prime suspect for
 *  the ghost focus-rectangle WebView2 painted while searching. This version
 *  uses a real, visible search field — a normal focused <input>, nothing for
 *  the platform to decorate.
 *
 *  Shape: SHORT BY DEFAULT (recents + one default per engine, "all models"
 *  drill-in), a slim always-focused search row on top (typing filters the
 *  ENTIRE catalog, not just visible rows), effort segmented control pinned,
 *  and a MANAGE mode with eye-toggles → settings.hiddenModels. Only models
 *  that are actually available (CLI installed / key configured / live sweep)
 *  exist here. Renders inside the composer's Dropdown portal. */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Search, Sparkles } from "lucide-react";
import type { ChatModel } from "../../../lib/chat";
import { MenuItem } from "../overlays";

/** Stable identity for a model row — engine + id (ids collide across tiers). */
export function modelKey(m: ChatModel): string {
  return `${m.engine ?? "claude"}:${m.id}`;
}

/** Engine display groups, in pick order. The stray catch-all below guarantees
 *  an unknown engine can never vanish (that's how the first local models
 *  disappeared — owner-reported). */
const GROUP_ORDER = [
  { engine: "codex", label: "codex" },
  { engine: "claude", label: "claude" },
  { engine: "opencode", label: "other" },
  { engine: "anthropic", label: "anthropic · api" },
  { engine: "openrouter", label: "openrouter · api" },
  { engine: "openai", label: "openai · api" },
  { engine: "ollama", label: "ollama · local" },
  { engine: "local", label: "local · openai-compatible" },
];

interface EffortLike {
  id: string;
  label: string;
  ultra?: boolean;
}

function engineDot(engine: string | undefined): string {
  const e = engine ?? "claude";
  if (e === "codex" || e === "openai") return "var(--color-info)";
  if (e === "local" || e === "ollama") return "var(--osai-accent-2)";
  if (e === "openrouter") return "var(--color-warning)";
  return "var(--color-accent)";
}

function groupModels(models: ChatModel[]) {
  const groups = GROUP_ORDER.map((g) => ({
    ...g,
    rows: models.filter((m) => (m.engine ?? "claude") === g.engine),
  })).filter((g) => g.rows.length > 0);
  const known = new Set(GROUP_ORDER.map((g) => g.engine));
  const strays = models.filter((m) => !known.has(m.engine ?? "claude"));
  if (strays.length > 0) groups.push({ engine: "misc", label: "other · api", rows: strays });
  return groups;
}

export function ModelMenu({
  models,
  currentId,
  currentEngine,
  recents,
  hidden,
  effort,
  efforts,
  onPick,
  onEffort,
  onToggleHidden,
  renderWindow,
}: {
  /** The full catalog (CLI + API tiers); unavailable rows are dropped here. */
  models: ChatModel[];
  currentId: string;
  currentEngine: string;
  /** Recently picked model keys (engine:id), newest first. */
  recents: string[];
  /** Hidden model keys (engine:id) — excluded everywhere except manage view. */
  hidden: string[];
  effort: EffortLike;
  efforts: readonly EffortLike[];
  onPick: (m: ChatModel) => void;
  onEffort: (e: EffortLike) => void;
  onToggleHidden: (key: string, hide: boolean) => void;
  /** Optional right-aligned extra for a row (the usage-window readout). */
  renderWindow?: (m: ChatModel) => React.ReactNode;
}) {
  const [view, setView] = useState<"short" | "all" | "manage">("short");
  const [filter, setFilter] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // a REAL input owns the keyboard — focused on open, like every other
  // search surface in the app. No container-focus tricks.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  // DYNAMIC catalog only: a model that isn't actually available — CLI not
  // installed, provider key missing — doesn't exist here.
  const available = useMemo(() => models.filter((m) => !m.disabled), [models]);
  const visible = useMemo(
    () => available.filter((m) => !hiddenSet.has(modelKey(m))),
    [available, hiddenSet],
  );

  const query = filter.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return null;
    return visible.filter(
      (m) => m.label.toLowerCase().includes(query) || m.id.toLowerCase().includes(query),
    );
  }, [query, visible]);

  // short view: recents first, then one default per engine — ~6 rows.
  const shortRows = useMemo(() => {
    const out: ChatModel[] = [];
    const seen = new Set<string>();
    const push = (m: ChatModel | undefined) => {
      if (!m) return;
      const k = modelKey(m);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(m);
    };
    const byKey = new Map(visible.map((m) => [modelKey(m), m]));
    for (const k of recents.slice(0, 3)) push(byKey.get(k));
    for (const g of groupModels(visible)) {
      if (out.length >= 6) break;
      push(g.rows[0]);
    }
    return out;
  }, [visible, recents]);

  // the keyboard-navigable row list for the current surface
  const navRows = useMemo(() => {
    if (filtered) return filtered;
    if (view === "short") return shortRows;
    if (view === "all") return groupModels(visible).flatMap((g) => g.rows);
    return [];
  }, [filtered, view, shortRows, visible]);

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, navRows.length - 1)));
  }, [navRows.length]);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!navRows.length) return;
      setSel((s) => (s + (e.key === "ArrowDown" ? 1 : -1) + navRows.length) % navRows.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const m = navRows[sel];
      if (m) onPick(m);
    }
  };

  const isCurrent = (m: ChatModel) =>
    m.id === currentId && (m.engine ?? "claude") === currentEngine;

  const modelRow = (m: ChatModel) => {
    const navIdx = navRows.indexOf(m);
    return (
      <MenuItem
        key={modelKey(m)}
        active={isCurrent(m) || (navIdx >= 0 && navIdx === sel)}
        title={m.note}
        onClick={() => onPick(m)}
      >
        <span className="flex items-center gap-2">
          <span
            className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ background: engineDot(m.engine) }}
          />
          <span className="min-w-0 truncate">{m.label}</span>
          {isCurrent(m) && (
            <span className="font-mono text-[9px] text-[var(--color-faint)]">current</span>
          )}
          {renderWindow?.(m)}
        </span>
      </MenuItem>
    );
  };

  const groupedRows = (rows: ChatModel[]) =>
    groupModels(rows).flatMap(({ engine, label, rows: grpRows }, gi) => [
      <div
        key={`grp-${engine}`}
        className={`px-3 pb-1 pt-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-faint)] ${
          gi > 0 ? "mt-1 border-t border-[var(--color-border)]" : ""
        }`}
      >
        {label}
      </div>,
      ...grpRows.map(modelRow),
    ]);

  return (
    <div className="w-[280px]">
      {/* the search row — a real input, pinned on top of every pick surface */}
      {view !== "manage" && (
        <div className="mx-2 mb-1 mt-1 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_55%,transparent)] px-2.5 py-1.5 transition-colors focus-within:border-[color-mix(in_srgb,var(--color-accent)_50%,transparent)]">
          <Search size={12} className="shrink-0 text-[var(--color-faint)]" />
          <input
            ref={inputRef}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSel(0);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="search models…"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent font-sans text-[12px] text-[var(--color-text)] placeholder:text-[var(--color-faint)] focus:outline-none"
          />
          <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-[var(--color-faint)]">
            {query ? `${filtered?.length ?? 0} of ${visible.length}` : visible.length}
          </span>
        </div>
      )}

      {query ? (
        filtered && filtered.length > 0 ? (
          groupedRows(filtered)
        ) : (
          <div className="px-3 py-3 text-center font-sans text-[11.5px] text-[var(--color-faint)]">
            no model matches "{filter.trim()}"
          </div>
        )
      ) : view === "short" ? (
        <>
          <div className="px-3 pb-1 pt-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-faint)]">
            effort
          </div>
          <div className="mx-2 mb-1.5 flex gap-[3px] rounded-[9px] border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_60%,transparent)] p-[3px]">
            {efforts.map((ef) => {
              const on = ef.id === effort.id;
              return (
                <button
                  key={ef.id}
                  type="button"
                  onClick={() => onEffort(ef)}
                  title={ef.ultra ? "xhigh + workflows — expensive by design" : `effort: ${ef.label}`}
                  className={`flex-1 rounded-md px-0.5 py-[3px] text-center font-sans text-[10.5px] transition-colors ${
                    on
                      ? ef.ultra
                        ? "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_30%,transparent),color-mix(in_srgb,var(--osai-accent-2)_25%,transparent))] text-[var(--color-text)]"
                        : "bg-[var(--color-accent-soft)] text-[var(--color-text)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {ef.ultra ? (
                    <span className="inline-flex items-center gap-0.5">
                      <Sparkles size={9} />
                      ultra
                    </span>
                  ) : ef.id === "medium" ? (
                    "med"
                  ) : (
                    ef.label
                  )}
                </button>
              );
            })}
          </div>
          <div className="mx-2 my-1 h-px bg-[var(--color-border)]" />
          <div className="px-3 pb-1 pt-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-faint)]">
            recent
          </div>
          {shortRows.map(modelRow)}
          <div className="mx-2 my-1 h-px bg-[var(--color-border)]" />
          <button
            type="button"
            onClick={() => setView("all")}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-sans text-[12px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
          >
            <ChevronRight size={12} />
            all models
            <span className="ml-auto font-mono text-[10px] text-[var(--color-faint)]">{visible.length}</span>
          </button>
        </>
      ) : view === "all" ? (
        <>
          <button
            type="button"
            onClick={() => setView("short")}
            className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-faint)] transition-colors hover:text-[var(--color-text)]"
          >
            <ChevronLeft size={11} /> back
          </button>
          {groupedRows(visible)}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between px-3 pb-1 pt-1.5">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-faint)]">
              manage models
            </span>
            <button
              type="button"
              onClick={() => setView("short")}
              className="font-sans text-[11px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
            >
              done
            </button>
          </div>
          {groupModels(available).flatMap(({ engine, label, rows }, gi) => [
            <div
              key={`mgrp-${engine}`}
              className={`px-3 pb-1 pt-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-faint)] ${
                gi > 0 ? "mt-1 border-t border-[var(--color-border)]" : ""
              }`}
            >
              {label}
            </div>,
            ...rows.map((m) => {
              const k = modelKey(m);
              const isHidden = hiddenSet.has(k);
              return (
                <div
                  key={`m-${k}`}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 font-sans text-[12px] text-[var(--color-text-2)] ${
                    isHidden ? "opacity-40" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{m.label}</span>
                  <button
                    type="button"
                    onClick={() => onToggleHidden(k, !isHidden)}
                    title={isHidden ? "show in pickers" : "hide from pickers (retry menus too)"}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
                  >
                    {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
              );
            }),
          ])}
        </>
      )}

      {/* foot — manage entry + hidden count. Present in short/all views. */}
      {!query && view !== "manage" && (
        <button
          type="button"
          onClick={() => setView("manage")}
          className="mt-1 flex w-full items-center gap-1.5 border-t border-[var(--color-border)] px-3 pb-1 pt-1.5 text-left font-sans text-[10.5px] text-[var(--color-faint)] transition-colors hover:text-[var(--color-muted)]"
        >
          <Eye size={11} />
          manage models…
          {hidden.length > 0 && <span className="ml-auto font-mono text-[9.5px]">{hidden.length} hidden</span>}
        </button>
      )}
      {view === "manage" && (
        <div className="mt-1 border-t border-[var(--color-border)] px-3 pb-1 pt-1.5 font-sans text-[10.5px] text-[var(--color-faint)]">
          {hidden.length} hidden — hidden models stay out of the picker &amp; retry menus
        </div>
      )}
    </div>
  );
}
