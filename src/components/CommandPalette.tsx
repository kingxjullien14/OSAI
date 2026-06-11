/** ⌘K command palette — VS Code / Raycast style fuzzy launcher.
 *  Self-contained: own fuzzy matcher (subsequence + contiguity/word-boundary
 *  scoring), keyboard nav, grouped results, match highlighting. No deps beyond
 *  React + lucide-react. App.tsx owns the `open` state + global ⌘K listener and
 *  passes a `commands` array — see the usage snippet in the PR notes. */
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

/** Max rows rendered at once. Scoring still ranks the full set; we just never
 *  paint more than this many buttons (the rest are unreachable noise anyway).
 *  Caps DOM churn so typing stays smooth even with hundreds of commands. */
const MAX_RESULTS = 50;

import { Brain, CornerDownLeft, MessageSquare, Search } from "lucide-react";
import { reportUsage } from "../lib/diag";

// ── MRU (recent commands) — surfaced as a "recent" group on the empty query ──
const MRU_KEY = "aios.palette.mru";
const MRU_CAP = 8;
function loadMru(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MRU_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string").slice(0, MRU_CAP) : [];
  } catch {
    return [];
  }
}
function pushMru(id: string): void {
  try {
    const next = [id, ...loadMru().filter((x) => x !== id)].slice(0, MRU_CAP);
    localStorage.setItem(MRU_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** Run a palette command + emit a light usage event (kind:"usage") keyed by the
 *  command id — seeds the "what I use" prioritization. No argument values.
 *  Skips query-specific AI-intent ids ("ai.*") since they never resolve later. */
function runCommand(c: Command) {
  reportUsage("command-palette", c.id);
  if (!c.id.startsWith("ai.")) pushMru(c.id);
  c.run();
}

export interface Command {
  id: string;
  title: string;
  subtitle?: string;
  group?: string;
  icon?: React.ReactNode;
  keywords?: string;
  /** Verb shown on the selected row's ⏎ chip ("open" / "resume" / "attach"). */
  actionLabel?: string;
  run: () => void;
}

/** Subsequence fuzzy match with BACKTRACKING — returns the matched-char indices
 *  (into `title`) of the OPTIMAL alignment + its score, or null on no match.
 *  The old greedy `indexOf` took the first occurrence of each char, which both
 *  drops valid matches and mis-ranks (e.g. "ace" vs "a-b-c-e…ace"). This does a
 *  memoized DP over every alignment and keeps the best, preserving the same
 *  heuristics: contiguous runs + word-boundary/start matches score high, deep
 *  matches decay. Higher = better. */
export function fuzzyMatch(query: string, title: string): { score: number; idx: number[] } | null {
  const q = query.toLowerCase();
  const t = title.toLowerCase();
  if (!q) return { score: 0, idx: [] };
  if (q.length > t.length) return null;

  const isBoundary = (pos: number): boolean => {
    if (pos === 0) return true;
    const b = t[pos - 1];
    return b === " " || b === "-" || b === "/" || b === ":" || b === "_" || b === ".";
  };
  // per-char points for matching q[qi] at `pos`, given the previous match `prev`
  // and the current contiguous-run length (escalating run bonus, as before).
  const charPts = (pos: number, prev: number, run: number): number => {
    let pts = 1;
    if (prev >= 0 && pos === prev + 1) pts += 4 + run; // contiguous run, escalating
    if (isBoundary(pos)) pts += 6;
    pts -= pos * 0.05; // gentle decay for deep matches
    return pts;
  };

  // memoized DP. state = (qi, prev, run); returns the best { score, idx } for
  // matching q[qi..] given the previous matched position + run length, or null.
  const memo = new Map<string, { score: number; idx: number[] } | null>();
  const solve = (qi: number, prev: number, run: number): { score: number; idx: number[] } | null => {
    if (qi >= q.length) return { score: 0, idx: [] };
    const key = `${qi}|${prev}|${run}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best: { score: number; idx: number[] } | null = null;
    for (let pos = prev + 1; pos < t.length; pos++) {
      if (t[pos] !== q[qi]) continue;
      const contiguous = prev >= 0 && pos === prev + 1;
      const rest = solve(qi + 1, pos, contiguous ? run + 1 : 0);
      if (!rest) continue;
      const score = charPts(pos, prev, run) + rest.score;
      if (!best || score > best.score) best = { score, idx: [pos, ...rest.idx] };
    }
    memo.set(key, best);
    return best;
  };

  const res = solve(0, -1, 0);
  if (!res) return null;
  // shorter titles that match are tighter — small length bonus
  return { score: res.score + Math.max(0, 8 - title.length * 0.05), idx: res.idx };
}

/** Best score across title + subtitle + keywords, but only title indices are
 *  highlighted (we never highlight the muted subtitle). */
function scoreCommand(query: string, c: Command): { score: number; idx: number[] } | null {
  if (!query) return { score: 0, idx: [] };
  const onTitle = fuzzyMatch(query, c.title);
  const haystacks: (string | undefined)[] = [c.subtitle, c.keywords];
  let best = onTitle ? onTitle.score : -Infinity;
  for (const h of haystacks) {
    if (!h) continue;
    const m = fuzzyMatch(query, h);
    if (m && m.score - 5 > best) best = m.score - 5; // off-title matches rank slightly lower
  }
  if (best === -Infinity) return null;
  return { score: best, idx: onTitle ? onTitle.idx : [] };
}

/** Render a title with matched chars wrapped in accent spans. Emits one span
 *  per contiguous RUN (matched vs plain) rather than per character, so a 40-char
 *  title makes ~3 nodes instead of 40 — keeps the list cheap to repaint. Memoized
 *  so unchanged rows don't re-render while typing. */
export const Highlight = memo(function Highlight({ text, idx }: { text: string; idx: number[] }) {
  if (!idx.length) return <>{text}</>;
  const set = new Set(idx);
  const out: React.ReactNode[] = [];
  let i = 0;
  let part = 0;
  while (i < text.length) {
    const on = set.has(i);
    let j = i + 1;
    while (j < text.length && set.has(j) === on) j++;
    const seg = text.slice(i, j);
    out.push(
      on ? (
        <span key={part} className="font-medium text-[var(--color-accent)]">
          {seg}
        </span>
      ) : (
        <span key={part}>{seg}</span>
      ),
    );
    i = j;
    part++;
  }
  return <>{out}</>;
});

interface Scored extends Command {
  _idx: number[];
  _score: number;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  onAsk,
  onDeepSearch,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  onAsk?: (query: string) => void;
  onDeepSearch?: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  // Defer the value the scorer reads so keystrokes paint instantly and the
  // (heavier) re-rank/re-render runs at lower priority — React's built-in debounce.
  const deferredQuery = useDeferredValue(query);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // reset query + selection every time it opens; focus the input.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      // focus after paint so the autofocus lands reliably
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // flat, ranked, group-ordered list. Empty query → "recent" (MRU) first.
  const results = useMemo<Scored[]>(() => {
    const q = deferredQuery.trim();
    // AI intents kept alive for ANY non-empty query (was >= 2) so a user is never
    // dead-ended — even a 1-char query can "ask aios".
    const intentCommands: Command[] = q.length >= 1
      ? [
          ...(onAsk
            ? [{
                id: `ai.ask.${q}`,
                title: `ask aios: ${q}`,
                subtitle: "open chatpane with this as the prompt",
                group: "ai",
                icon: <MessageSquare size={14} />,
                keywords: `ask ai chatpane answer prompt ${q}`,
                actionLabel: "ask",
                run: () => onAsk(q),
              }]
            : []),
          ...(onDeepSearch
            ? [{
                id: `ai.search.${q}`,
                title: `deep search: ${q}`,
                subtitle: "use chatpane intelligence to inspect memory, panes, and files",
                group: "ai",
                icon: <Brain size={14} />,
                keywords: `search find memory files panes chat history intelligence ${q}`,
                actionLabel: "search",
                run: () => onDeepSearch(q),
              }]
            : []),
        ]
      : [];

    let scored: Scored[];
    if (!q) {
      // empty query: a "recent" group (MRU) first, then the full registry in
      // its natural order. Recent commands are deduped from their normal group.
      const byId = new Map(commands.map((c) => [c.id, c]));
      const seen = new Set<string>();
      const recent: Scored[] = [];
      for (const id of loadMru()) {
        const c = byId.get(id);
        if (c && !seen.has(id)) {
          recent.push({ ...c, group: "recent", _idx: [], _score: 0 });
          seen.add(id);
        }
      }
      const rest: Scored[] = commands
        .filter((c) => !seen.has(c.id))
        .map((c) => ({ ...c, _idx: [], _score: 0 }));
      scored = [...recent, ...rest];
    } else {
      scored = [];
      for (const c of [...intentCommands, ...commands]) {
        const m = scoreCommand(deferredQuery, c);
        if (m) scored.push({ ...c, _idx: m.idx, _score: m.score });
      }
      scored.sort((a, b) => b._score - a._score);
    }

    // group while preserving order — first-seen group wins position.
    const order: string[] = [];
    const byGroup = new Map<string, Scored[]>();
    for (const s of scored) {
      const g = s.group ?? "";
      if (!byGroup.has(g)) {
        byGroup.set(g, []);
        order.push(g);
      }
      byGroup.get(g)!.push(s);
    }
    const flat: Scored[] = [];
    for (const g of order) flat.push(...byGroup.get(g)!);
    return flat.slice(0, MAX_RESULTS);
  }, [commands, onAsk, onDeepSearch, deferredQuery]);

  // clamp selection when results shrink
  useEffect(() => {
    setSel((s) => (results.length ? Math.min(s, results.length - 1) : 0));
  }, [results.length]);

  // keep the selected row in view
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel, open]);

  if (!open) return null;

  const move = (delta: number) => {
    if (!results.length) return;
    setSel((s) => (s + delta + results.length) % results.length);
  };

  const runSel = () => {
    const c = results[sel];
    if (!c) return;
    onClose();
    runCommand(c);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // emacs/readline-style nav for keyboard-first users
    if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "p")) {
      e.preventDefault();
      move(e.key === "n" ? 1 : -1);
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Tab":
        e.preventDefault();
        move(e.shiftKey ? -1 : 1);
        break;
      case "Home":
        e.preventDefault();
        setSel(0);
        break;
      case "End":
        e.preventDefault();
        setSel(Math.max(0, results.length - 1));
        break;
      case "PageDown":
        e.preventDefault();
        move(10);
        break;
      case "PageUp":
        e.preventDefault();
        move(-10);
        break;
      case "Enter":
        e.preventDefault();
        runSel();
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  // index → row position so hover/selection align across group headers
  let rowPos = -1;
  let lastGroup: string | null = null;
  const selCmd = results[sel];
  const selAction = selCmd?.actionLabel ?? "select";

  return (
    <div
      className="overlay-backdrop fixed inset-0 z-50 flex justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="command palette"
        className="modal-in glass absolute top-[14vh] flex max-h-[64vh] w-[600px] flex-col overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-panel)]/95 shadow-2xl ring-1 ring-black/20"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* search row */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3.5">
          <Search size={17} className="shrink-0 text-[var(--color-muted)]" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="palette-listbox"
            aria-autocomplete="list"
            aria-activedescendant={results.length ? `palette-opt-${sel}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="launch, ask, or resume anything…"
            spellCheck={false}
            autoComplete="off"
            className="w-full bg-transparent text-[15px] text-[var(--color-text)] placeholder:text-[var(--color-faint)] focus:outline-none"
          />
          {results.length > 0 && (
            <span aria-live="polite" className="shrink-0 font-mono text-[10px] text-[var(--color-faint)]">
              {results.length}
            </span>
          )}
        </div>

        {/* results */}
        <div ref={listRef} id="palette-listbox" role="listbox" aria-label="results" className="flex-1 overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 px-4 py-12 text-center">
              <img src="/mascot.png" alt="" className="h-10 w-10 rounded-full object-cover opacity-40" />
              <div className="text-[12.5px] text-[var(--color-muted)]">no command matches “{query}”</div>
              {/* never dead-end: offer the AI intent instead */}
              {query.trim() && onAsk && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onAsk(query.trim());
                  }}
                  className="press mt-1 inline-flex items-center gap-1.5 rounded-[var(--aios-radius-pill)] border border-[var(--color-border-strong)] px-3 py-1.5 text-[12px] text-[var(--color-text)] transition-colors hover:border-[var(--color-accent)]/50"
                >
                  <MessageSquare size={13} /> ask aios about “{query.trim()}” instead
                </button>
              )}
            </div>
          ) : (
            results.map((c) => {
              rowPos += 1;
              const pos = rowPos;
              const g = c.group ?? "";
              const showHeader = g && g !== lastGroup;
              lastGroup = g;
              const active = pos === sel;
              return (
                <div key={c.id}>
                  {showHeader && (
                    <div className="px-4 pb-1 pt-2.5 text-[10px] font-medium lowercase tracking-[0.14em] text-[var(--color-faint)]">
                      {g}
                    </div>
                  )}
                  <div className="px-2">
                    <button
                      data-row={pos}
                      id={`palette-opt-${pos}`}
                      role="option"
                      aria-selected={active}
                      onMouseMove={() => setSel(pos)}
                      onClick={() => {
                        onClose();
                        runCommand(c);
                      }}
                      className={`relative flex w-full items-center gap-3 rounded-[var(--aios-radius-md)] px-2.5 py-2 text-left transition-colors ${
                        active ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-panel-2)]/50"
                      }`}
                    >
                      {c.icon && (
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--aios-radius-sm)] border transition-colors ${
                            active
                              ? "border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                              : "border-[var(--color-border)] bg-[var(--color-panel-2)]/50 text-[var(--color-muted)]"
                          }`}
                        >
                          {c.icon}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--color-text)]">
                        <Highlight text={c.title} idx={c._idx} />
                      </span>
                      {c.subtitle && (
                        <span className="shrink-0 truncate font-mono text-[10.5px] text-[var(--color-faint)]">
                          {c.subtitle}
                        </span>
                      )}
                      {active && (
                        <span className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-panel-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted)]">
                          {c.actionLabel ?? "select"} <CornerDownLeft size={10} />
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* footer hint */}
        <div className="flex items-center gap-3.5 border-t border-[var(--color-border)] px-4 py-2 font-mono text-[10px] text-[var(--color-faint)]">
          <span>↑↓ navigate</span>
          <span className="flex items-center gap-1">
            <CornerDownLeft size={10} /> {selAction}
          </span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
