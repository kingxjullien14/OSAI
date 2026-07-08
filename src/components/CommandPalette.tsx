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

import { AlertTriangle, Brain, CornerDownLeft, MessageSquare, Monitor, Moon, Sun } from "lucide-react";
import { reportUsage } from "../lib/diag";
import {
  ACCENT_ORDER,
  ACCENT_PRESETS,
  getAccent,
  getTheme,
  setAccent,
  setTheme,
  type Accent,
  type Theme,
} from "../lib/theme";
import { AnimatePresence, m } from "motion/react";

import { consumePaletteMorphSource, peekPaletteMorphSource } from "../lib/paletteMorph";
import { modalPop, overlayFade } from "./fx/motionTokens";
import { trapTab } from "./ui";

// ── MRU (recent commands) — surfaced as a "recent" group on the empty query ──
const MRU_KEY = "osai.palette.mru";
const MRU_CAP = 8;
export function loadMru(): string[] {
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
  /** Destructive/external commands carry a visible marker (never accent). */
  danger?: string;
  /** Currently unavailable — rendered dimmed; running it explains why. */
  disabled?: boolean;
  /** Detail lines for the selected row's preview strip (≤3 shown) — what the
   *  command will actually touch: a workspace's panes, a session's engine+age,
   *  a project's path. Rows without preview show nothing (no empty chrome). */
  preview?: string[];
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
  // cost cap: the DP is quadratic-ish in (q,t) — degrade to a plain substring
  // match on pathological inputs instead of stalling a keystroke.
  if (q.length > 48 || t.length > 240) {
    const at = t.indexOf(q);
    if (at < 0) return null;
    return {
      score: (isBoundary(at) ? 7 : 1) - at * 0.05,
      idx: Array.from({ length: q.length }, (_, i) => at + i),
    };
  }
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

/** Scope tabs — the real command groups worth narrowing to (matched against
 *  `Command.group`); "all" passes everything. */
const SCOPES = ["all", "open", "resume", "workspaces", "run"] as const;

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
  // scope tabs (console omnibar, K2+K3): narrow the fuzzy search to one command
  // family. `tab` cycles; the "> verbs" tab is the existing verb mode's query.
  const [scope, setScope] = useState<(typeof SCOPES)[number]>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // reset query + selection + scope every time it opens; focus the input.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      setScope("all");
      // focus after paint so the autofocus lands reliably
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // FLIP morph: when the idle command line opened us (it records its rect via
  // paletteMorph), the panel starts as an inverted transform mapping back onto
  // that surface and settles into place — the input visibly BECOMES the
  // palette. The render below suppresses the motion entrance for a morph open
  // (peekPaletteMorphSource → initial:false), so WAAPI owns the transform;
  // reduce-motion (or a normal ⌘K open) skips it entirely.
  useEffect(() => {
    if (!open) return;
    const src = consumePaletteMorphSource();
    const el = panelRef.current;
    if (!src || !el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const dst = el.getBoundingClientRect();
    if (dst.width === 0 || dst.height === 0) return;
    const dx = src.left + src.width / 2 - (dst.left + dst.width / 2);
    const dy = src.top + src.height / 2 - (dst.top + dst.height / 2);
    const sx = src.width / dst.width;
    const sy = src.height / dst.height;
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.65 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 260, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
  }, [open]);

  // flat, ranked, group-ordered list. Empty query → "recent" (MRU) first.
  const results = useMemo<Scored[]>(() => {
    const q = deferredQuery.trim();

    // ── action mode (`>`): the palette becomes a verb router ────────────
    // `>theme dark` / `>accent blue` live-PREVIEW as you arrow over rows and
    // commit on Enter; `>workspace ship` scopes to the saved layouts. Bare
    // `>` lists the verbs (those rows refine the query instead of closing).
    if (q.startsWith(">")) {
      const body = q.slice(1).trim();
      const [verbRaw, ...restParts] = body.split(/\s+/);
      const verb = (verbRaw ?? "").toLowerCase();
      const rest = restParts.join(" ").toLowerCase();
      const rows: Scored[] = [];
      const push = (c: Command) => rows.push({ ...c, _idx: [], _score: 0 });

      if (verb === "theme") {
        for (const t of ["system", "light", "dark"] as Theme[]) {
          if (rest && !t.includes(rest)) continue;
          push({
            id: `verbtheme.${t}`,
            title: `theme: ${t}`,
            subtitle: "arrow to preview · enter to keep",
            group: "theme",
            icon: t === "light" ? <Sun size={14} /> : t === "dark" ? <Moon size={14} /> : <Monitor size={14} />,
            actionLabel: "apply",
            run: () => {
              themeBaselineRef.current = null; // commit — don't revert on close
              setTheme(t);
            },
          });
        }
        return rows;
      }
      if (verb === "accent") {
        for (const a of ACCENT_ORDER) {
          if (rest && !a.includes(rest)) continue;
          push({
            id: `verbaccent.${a}`,
            title: `accent: ${a}`,
            subtitle: "arrow to preview · enter to keep",
            group: "accent",
            icon: (
              <span
                className="inline-block h-3 w-3 rounded-full border border-[var(--color-border-strong)]"
                style={{ background: ACCENT_PRESETS[a] }}
              />
            ),
            actionLabel: "apply",
            run: () => {
              accentBaselineRef.current = null; // commit — don't revert on close
              setAccent(a);
            },
          });
        }
        return rows;
      }
      if (verb === "workspace" || verb === "ws") {
        for (const c of commands) {
          if (!c.id.startsWith("workspace.open.")) continue;
          if (rest && !c.title.toLowerCase().includes(rest)) continue;
          push(c);
        }
        return rows;
      }
      // bare `>` (or unknown verb) → the verb menu; picking one refines the
      // query in place (runSel special-cases the verbmenu. prefix).
      const verbs: { v: string; sub: string }[] = [
        { v: "theme", sub: "preview + switch system / light / dark" },
        { v: "accent", sub: "preview + switch the accent color" },
        { v: "workspace", sub: "restore a saved pane layout" },
      ];
      for (const { v, sub } of verbs) {
        if (verb && !v.startsWith(verb)) continue;
        push({
          id: `verbmenu.${v}`,
          title: `>${v}`,
          subtitle: sub,
          group: "verbs",
          icon: <CornerDownLeft size={14} />,
          actionLabel: "refine",
          run: () => {}, // handled by runSel (refines, doesn't close)
        });
      }
      return rows;
    }
    // AI intents kept alive for ANY non-empty query (was >= 2) so a user is never
    // dead-ended — even a 1-char query can "ask osai".
    const intentCommands: Command[] = q.length >= 1
      ? [
          ...(onAsk
            ? [{
                id: `ai.ask.${q}`,
                title: `ask osai: ${q}`,
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

    // scope filter (omnibar tabs): narrow the registry BEFORE ranking. The AI
    // intents always pass — the escape hatch must survive any scope.
    const scoped = scope === "all" ? commands : commands.filter((c) => c.group === scope);

    let scored: Scored[];
    if (!q) {
      // empty query: a "recent" group (MRU) first, then the full registry in
      // its natural order. Recent commands are deduped from their normal group.
      const byId = new Map(scoped.map((c) => [c.id, c]));
      const seen = new Set<string>();
      const recent: Scored[] = [];
      for (const id of loadMru()) {
        const c = byId.get(id);
        if (c && !seen.has(id)) {
          recent.push({ ...c, group: "recent", _idx: [], _score: 0 });
          seen.add(id);
        }
      }
      const rest: Scored[] = scoped
        .filter((c) => !seen.has(c.id))
        .map((c) => ({ ...c, _idx: [], _score: 0 }));
      scored = [...recent, ...rest];
    } else {
      scored = [];
      for (const c of [...intentCommands, ...scoped]) {
        const m = scoreCommand(deferredQuery, c);
        if (m) scored.push({ ...c, _idx: m.idx, _score: m.score });
      }
      scored.sort((a, b) => b._score - a._score);
      // the ask-OSAI intent is the omnibar's HERO row — pin it on top so the
      // escape hatch is always one glance (and never buried mid-list).
      const askIdx = scored.findIndex((s) => s.id.startsWith("ai.ask."));
      if (askIdx > 0) {
        const [ask] = scored.splice(askIdx, 1);
        scored.unshift(ask);
      }
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
  }, [commands, onAsk, onDeepSearch, deferredQuery, scope]);

  // clamp selection when results shrink
  useEffect(() => {
    setSel((s) => (results.length ? Math.min(s, results.length - 1) : 0));
  }, [results.length]);

  // ── action-mode live preview ─────────────────────────────────────────
  // Arrowing over a theme/accent row applies it IMMEDIATELY (that's the whole
  // magic); the pre-verb value is held in a baseline ref and restored when the
  // verb is left / the palette closes uncommitted. Commit (Enter/click) clears
  // the baseline so nothing reverts.
  const themeBaselineRef = useRef<Theme | null>(null);
  const accentBaselineRef = useRef<Accent | null>(null);
  const selected = results[sel];
  useEffect(() => {
    if (!open) return;
    if (selected?.id.startsWith("verbtheme.")) {
      if (themeBaselineRef.current == null) themeBaselineRef.current = getTheme();
      setTheme(selected.id.slice("verbtheme.".length) as Theme);
    } else if (themeBaselineRef.current != null) {
      setTheme(themeBaselineRef.current);
      themeBaselineRef.current = null;
    }
    if (selected?.id.startsWith("verbaccent.")) {
      if (accentBaselineRef.current == null) accentBaselineRef.current = getAccent();
      setAccent(selected.id.slice("verbaccent.".length));
    } else if (accentBaselineRef.current != null) {
      setAccent(accentBaselineRef.current);
      accentBaselineRef.current = null;
    }
  }, [open, selected]);
  // close without commit → revert both
  useEffect(() => {
    if (open) return;
    if (themeBaselineRef.current != null) {
      setTheme(themeBaselineRef.current);
      themeBaselineRef.current = null;
    }
    if (accentBaselineRef.current != null) {
      setAccent(accentBaselineRef.current);
      accentBaselineRef.current = null;
    }
  }, [open]);

  // keep the selected row in view
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel, open]);

  const move = (delta: number) => {
    if (!results.length) return;
    setSel((s) => (s + delta + results.length) % results.length);
  };

  const runSel = () => {
    const c = results[sel];
    if (!c) return;
    // verb-menu rows REFINE the query in place instead of running+closing.
    if (c.id.startsWith("verbmenu.")) {
      setQuery(`>${c.id.slice("verbmenu.".length)} `);
      inputRef.current?.focus();
      return;
    }
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
    // ⌥1–9 jump-runs a numbered row without arrowing to it (console omnibar).
    if (e.altKey && /^[1-9]$/.test(e.key)) {
      const c = results[Number(e.key) - 1];
      if (c) {
        e.preventDefault();
        if (c.id.startsWith("verbmenu.")) {
          setQuery(`>${c.id.slice("verbmenu.".length)} `);
          inputRef.current?.focus();
          return;
        }
        onClose();
        runCommand(c);
      }
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
        // tab cycles the SCOPE tabs (selection moves with ↑↓/⌃n·p).
        e.preventDefault();
        setScope((s) => {
          const i = SCOPES.indexOf(s);
          return SCOPES[(i + (e.shiftKey ? -1 : 1) + SCOPES.length) % SCOPES.length];
        });
        setSel(0);
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

  // Suppress the motion entrance on a morph open: the WAAPI FLIP (effect
  // above) owns the panel's transform for that one mount. `initial` is only
  // read when AnimatePresence mounts the panel, so peeking here is stable.
  const morphOpen = open && peekPaletteMorphSource();
  const pop = modalPop();

  return (
    <AnimatePresence>
      {open && (
    <m.div
      {...overlayFade()}
      className="fixed inset-0 z-50 flex justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* THE CONSOLE OMNIBAR (sketch board rev 4 — K2 + K3, locked): a lone
          glowing pill bar that speaks mono (the ❯ prompt), scope tabs riding
          the seam, and a detached results card with numbered rows, the
          ask-OSAI hero, and the filament as its bottom edge. */}
      <m.div
        {...pop}
        initial={morphOpen ? false : pop.initial}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="command palette"
        className="absolute top-[12vh] flex max-h-[68vh] w-[620px] flex-col"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // focus can sit on a clicked row, not just the input — Escape still
          // closes and Tab still cycles inside (trapTab skips when the input
          // already consumed Tab as scope-cycling).
          if (e.key === "Escape" && !e.defaultPrevented) {
            e.preventDefault();
            onClose();
            return;
          }
          trapTab(e, e.currentTarget);
        }}
      >
        {/* the bar */}
        <div className="flex items-center gap-3 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-panel-2)_90%,transparent)] px-5 py-3 shadow-[0_0_34px_-8px_color-mix(in_srgb,var(--color-accent)_45%,transparent),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl">
          <span aria-hidden className="shrink-0 font-mono text-[15px] font-semibold text-[var(--color-accent)]">
            ❯
          </span>
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
            className="w-full bg-transparent font-mono text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-faint)] focus:outline-none"
          />
          {results.length > 0 && (
            <span aria-live="polite" className="shrink-0 font-mono text-[10px] text-[var(--color-faint)]">
              {results.length}
            </span>
          )}
          <span className="shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[9.5px] text-[var(--color-faint)]">
            esc
          </span>
        </div>

        {/* scope tabs — riding the seam between bar and card. tab cycles. */}
        <div className="mt-2 flex items-center gap-[3px] px-2 font-mono text-[10px] text-[var(--color-faint)]">
          {SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setScope(s);
                setSel(0);
                inputRef.current?.focus();
              }}
              className={`rounded-[7px] px-2.5 py-[3px] transition-colors ${
                scope === s && !query.startsWith(">")
                  ? "bg-[color-mix(in_srgb,var(--color-panel-2)_85%,transparent)] text-[var(--color-text)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]"
                  : "hover:text-[var(--color-text)]"
              }`}
            >
              {s}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setQuery(">");
              setSel(0);
              inputRef.current?.focus();
            }}
            className={`ml-auto rounded-[7px] px-2.5 py-[3px] transition-colors ${
              query.startsWith(">")
                ? "bg-[color-mix(in_srgb,var(--color-panel-2)_85%,transparent)] text-[var(--color-text)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]"
                : "hover:text-[var(--color-text)]"
            }`}
          >
            &gt; verbs
          </button>
        </div>

        {/* the results card — detached, filament bottom edge */}
        <div className="relative mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[color-mix(in_srgb,var(--color-panel)_88%,transparent)] shadow-[var(--osai-shadow-pop),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl">
          <div ref={listRef} id="palette-listbox" role="listbox" aria-label="results" className="min-h-0 flex-1 overflow-y-auto py-1.5">
            {results.length === 0 ? (
              <div className="flex flex-col items-center gap-2.5 px-4 py-12 text-center">
                <span aria-hidden className="grid h-10 w-10 place-items-center rounded-xl border border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] opacity-40">
                  <span className="block h-4 w-4 rotate-45 rounded-[4px] bg-[linear-gradient(135deg,var(--color-accent),var(--osai-accent-2))]" />
                </span>
                <div className="text-[12.5px] text-[var(--color-muted)]">
                  no {scope === "all" ? "command" : scope + " command"} matches “{query}”
                </div>
                {/* never dead-end: offer the AI intent instead */}
                {query.trim() && onAsk && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onAsk(query.trim());
                    }}
                    className="press mt-1 inline-flex items-center gap-1.5 rounded-[var(--osai-radius-pill)] border border-[var(--color-border-strong)] px-3 py-1.5 text-[12px] text-[var(--color-text)] transition-colors hover:border-[var(--color-accent)]/50"
                  >
                    <MessageSquare size={13} /> ask osai about “{query.trim()}” instead
                  </button>
                )}
              </div>
            ) : (
              results.map((c) => {
                rowPos += 1;
                const pos = rowPos;
                const g = c.group ?? "";
                const hero = c.id.startsWith("ai.ask.");
                const showHeader = g && g !== lastGroup && !hero;
                lastGroup = hero ? lastGroup : g;
                const active = pos === sel;
                return (
                  <div key={c.id}>
                    {showHeader && (
                      <div className="px-4 pb-1 pt-2.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                        {g}
                      </div>
                    )}
                    <div className={hero ? "" : "px-2"}>
                      <button
                        data-row={pos}
                        id={`palette-opt-${pos}`}
                        role="option"
                        aria-selected={active}
                        onMouseMove={() => setSel(pos)}
                        onClick={() => {
                          // verb-menu rows refine the query in place (no close)
                          if (c.id.startsWith("verbmenu.")) {
                            setQuery(`>${c.id.slice("verbmenu.".length)} `);
                            inputRef.current?.focus();
                            return;
                          }
                          onClose();
                          runCommand(c);
                        }}
                        className={`relative flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors ${
                          hero
                            ? `border-b border-[var(--color-border)] bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-accent)_10%,transparent),color-mix(in_srgb,var(--osai-accent-2)_5%,transparent)_70%,transparent)] px-4 ${
                                active ? "bg-[var(--color-accent-soft)]" : ""
                              }`
                            : `rounded-[var(--osai-radius-md)] ${
                                active
                                  ? "bg-[color-mix(in_srgb,var(--color-accent)_13%,transparent)] shadow-[inset_0_0_26px_-12px_var(--color-accent)]"
                                  : "hover:bg-[var(--color-panel-2)]/50"
                              }`
                        } ${c.disabled ? "opacity-50" : ""}`}
                        title={c.disabled ? "unavailable right now — running it explains why" : undefined}
                      >
                        {active && !hero && (
                          <span
                            aria-hidden
                            className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[linear-gradient(180deg,var(--color-accent),var(--osai-accent-2))] shadow-[var(--osai-glow-soft)]"
                          />
                        )}
                        {/* row number — ⌥1–9 jump-runs it */}
                        <span aria-hidden className="w-[17px] shrink-0 text-right font-mono text-[9.5px] tabular-nums text-[var(--color-faint)]">
                          {!hero && pos < 9 ? String(pos + 1).padStart(2, "0") : ""}
                        </span>
                        {c.icon && (
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--osai-radius-sm)] border transition-colors ${
                              active || hero
                                ? "border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                                : "border-[var(--color-border)] bg-[var(--color-panel-2)]/50 text-[var(--color-muted)]"
                            }`}
                          >
                            {c.icon}
                          </span>
                        )}
                        <span
                          className={`min-w-0 flex-1 truncate ${
                            hero ? "font-sans text-[13px]" : "font-mono text-[12.5px]"
                          } text-[var(--color-text)]`}
                        >
                          <Highlight text={c.title} idx={c._idx} />
                        </span>
                        {c.danger && (
                          <AlertTriangle
                            size={11}
                            className="shrink-0 text-[var(--color-danger)]"
                            aria-label={`caution: ${c.danger}`}
                          />
                        )}
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

          {/* preview strip — what the selected command will actually touch
              (workspace panes, session engine+age, project path). Only renders
              when the row carries preview lines: no empty chrome. */}
          {selected?.preview && selected.preview.length > 0 && (
            <div className="border-t border-[var(--color-border)] bg-[var(--color-panel-2)]/40 px-4 py-2">
              {selected.preview.slice(0, 3).map((ln, i) => (
                <div key={i} className="truncate font-mono text-[10.5px] leading-relaxed text-[var(--color-faint)]">
                  {ln}
                </div>
              ))}
            </div>
          )}
          {/* footer hint */}
          <div className="flex items-center gap-3.5 border-t border-[var(--color-border)] px-4 py-2 pb-2.5 font-mono text-[10px] text-[var(--color-faint)]">
            <span>↑↓ navigate</span>
            <span className="flex items-center gap-1">
              <CornerDownLeft size={10} /> {selAction}
            </span>
            <span>⌥1–9 jump</span>
            <span>tab scope</span>
            <span className="ml-auto">&gt; verbs</span>
          </div>
          {/* the filament — same DNA as the composer deck's top edge */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-3.5 bottom-0 z-10 h-[2px] rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--osai-accent-2),transparent)] opacity-60"
          />
        </div>
      </m.div>
    </m.div>
      )}
    </AnimatePresence>
  );
}
