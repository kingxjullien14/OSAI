/** Chat markdown renderer — slice 2 of the ChatPane split
 *  (PLAN-odysseus-feel.md W4): the whole prose chain (fence splitter, code
 *  blocks with run-in-terminal + context menu, block/inline markdown, the
 *  interactive checklist) moved verbatim from ChatPane. Contexts live in
 *  ./context; ChatPane provides them.
 */
import { memo, useMemo, useState } from "react";
import type React from "react";
import { Check, CornerDownLeft, Globe, Terminal } from "lucide-react";

import { spawnPane, openUrlInPane } from "../../lib/paneBus";
import { isHttpPaneTarget, isPaneFileTarget } from "../../lib/paneRouting";
import { splitFences } from "../../lib/chatFences";
import { CopyButton } from "../ui";
import { PaneMenu, type PaneMenuEntry } from "../PaneMenu";
import { useChatCwd, useChatFileOpener, useChatSubmit } from "./context";

export const Markdown = memo(function Markdown({
  text,
  onOpenUrl,
}: {
  text: string;
  onOpenUrl?: (url: string) => void;
}) {
  // CRLF normalization is LOAD-BEARING for file-sourced markdown: JS `.` and
  // `$` both exclude \r, so on a CRLF file every `(.*)$`-anchored block match
  // (headings, lists, quotes) fails while inline bold/code still works — the
  // "literal # in the .md preview" bug. Chat streams are \n-only (no-op).
  const segments = useMemo(() => splitFences(text.replace(/\r\n?/g, "\n")), [text]);
  return (
    <div className="flex flex-col gap-2">
      {segments.map((seg, i) =>
        seg.code ? (
          <CodeBlock key={i} lang={seg.lang} body={seg.body} />
        ) : (
          <MarkdownBlocks key={i} text={seg.body} onOpenUrl={onOpenUrl} />
        ),
      )}
    </div>
  );
});

/** Shell-ish fences get a "run in terminal" affordance. Single-statement blocks
 *  (no embedded newline once trimmed) seed + run directly; multi-line blocks open
 *  a terminal rooted at the session cwd and let the user run it (we still seed the
 *  whole block so it's typed in). */
const SHELL_LANGS = new Set(["bash", "sh", "shell", "zsh", "console", "shell-session"]);

function CodeBlock({ lang, body }: { lang: string; body: string }) {
  // strip a single trailing newline so the block isn't bottom-heavy
  const code = body.replace(/\n$/, "");
  const cwd = useChatCwd();
  const isShell = SHELL_LANGS.has(lang.trim().toLowerCase());
  // Single-line shell snippet → safe to seed + auto-run. Multi-line scripts →
  // don't auto-fire (avoid running half a heredoc); the block is copied to the
  // clipboard on click so the fresh terminal is one paste away — before this
  // the terminal opened completely blank and the code went nowhere.
  const seedCmd = code.includes("\n") ? undefined : code.trim();
  const runInTerminal = () => {
    if (!seedCmd) void navigator.clipboard.writeText(code).catch(() => {});
    spawnPane("terminal", { cwd: cwd ?? undefined, cmd: seedCmd });
  };
  // right-click menu (W3): the header affordances at the pointer.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxItems: PaneMenuEntry[] = [
    {
      key: "copy",
      label: "Copy code",
      onSelect: () => void navigator.clipboard?.writeText(code).catch(() => {}),
    },
    ...(isShell && code.trim()
      ? [
          {
            key: "run",
            label: "Run in terminal",
            hint: seedCmd ? undefined : "copied — paste to run",
            onSelect: runInTerminal,
          } satisfies PaneMenuEntry,
        ]
      : []),
  ];
  return (
    <div
      className="glass overflow-hidden rounded-xl"
      onContextMenu={(e) => {
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {ctxMenu && (
        <PaneMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxItems} onClose={() => setCtxMenu(null)} />
      )}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-1">
        <span className="font-mono text-[10.5px] text-[var(--color-faint)]">
          {lang || "code"}
        </span>
        <div className="flex items-center gap-1.5">
          {isShell && code.trim() && (
            <button
              type="button"
              onClick={runInTerminal}
              title={seedCmd ? "run in a new terminal pane" : "open a terminal here (multi-line — copied, paste to run)"}
              className="flex items-center gap-1 rounded px-1 py-0.5 text-[10.5px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-accent)]"
            >
              <Terminal size={11} />
              run in terminal
            </button>
          )}
          <CopyButton text={code} size={12} title="copy code" />
        </div>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-[var(--color-text)]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Render the non-code body: split into block-level lines (headings / lists /
 *  paragraphs), each with inline formatting. */
/** `[ ] item` / `[x] item` (after the list bullet was stripped). */
const TASK_ITEM_RE = /^\[( |x|X)\]\s+(.*)$/;

/**
 * Interactive task list inside assistant prose. Model-authored `[x]` items
 * render done; ticking an open item arms a "send progress" chip that reports
 * the newly-done items back into the conversation (steered mid-turn when the
 * engine allows, otherwise sent as the next message) — so the model's plan is
 * something you work THROUGH, not just read.
 */
function Checklist({
  items,
  onOpenUrl,
}: {
  items: { checked: boolean; text: string }[];
  onOpenUrl?: (url: string) => void;
}) {
  const submit = useChatSubmit();
  // your ticks, layered over the authored state; reported indexes collapse the
  // chip until something NEW is ticked.
  const [ticks, setTicks] = useState<Record<number, boolean>>({});
  const [reported, setReported] = useState<Record<number, boolean>>({});
  const done = (i: number) => ticks[i] ?? items[i].checked;
  const fresh = items
    .map((_, i) => i)
    .filter((i) => done(i) && !items[i].checked && !reported[i]);
  const sendProgress = () => {
    if (!submit || fresh.length === 0) return;
    const remaining = items.map((_, i) => i).filter((i) => !done(i));
    submit(
      `Progress update — I've completed:\n${fresh.map((i) => `- ${items[i].text}`).join("\n")}${
        remaining.length
          ? `\n\nStill open:\n${remaining.map((i) => `- ${items[i].text}`).join("\n")}`
          : "\n\nThat's everything on the list."
      }`,
    );
    setReported((prev) => {
      const next = { ...prev };
      for (const i of fresh) next[i] = true;
      return next;
    });
  };
  return (
    <div className="my-0.5 flex flex-col gap-1 pl-1">
      {items.map((it, i) => {
        const isDone = done(i);
        return (
          <button
            key={i}
            type="button"
            onClick={() => setTicks((prev) => ({ ...prev, [i]: !isDone }))}
            className="group/task flex items-start gap-2 text-left"
            title={isDone ? "mark as not done" : "mark as done"}
          >
            <span
              className={`mt-[3px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded border transition-colors ${
                isDone
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-bg)]"
                  : "border-[var(--color-border-strong)] group-hover/task:border-[var(--color-accent)]/60"
              }`}
            >
              {isDone && <Check size={11} />}
            </span>
            <span
              className={`flex-1 transition-colors ${
                isDone ? "text-[var(--color-faint)] line-through decoration-[var(--color-border-strong)]" : ""
              }`}
            >
              <Inline text={it.text} onOpenUrl={onOpenUrl} />
            </span>
          </button>
        );
      })}
      {submit != null && fresh.length > 0 && (
        <button
          type="button"
          onClick={sendProgress}
          className="mt-1 flex w-fit items-center gap-1.5 rounded-full border border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] px-2.5 py-1 font-sans text-[11px] font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
        >
          <CornerDownLeft size={11} />
          tell the model — {fresh.length} done
        </button>
      )}
    </div>
  );
}

function MarkdownBlocks({
  text,
  onOpenUrl,
}: {
  text: string;
  onOpenUrl?: (url: string) => void;
}) {
  if (!text.trim()) return null;
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let listBuf: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!listBuf) return;
    const { ordered, items } = listBuf;
    // a task list (every item `[ ]`/`[x]`-shaped) renders as an INTERACTIVE
    // checklist: tick what you've done, then hand the model a progress note in
    // one click — the model's own plans become a working surface.
    if (!ordered && items.length > 0 && items.every((it) => TASK_ITEM_RE.test(it))) {
      const rows = items.map((it) => {
        const m = it.match(TASK_ITEM_RE)!;
        return { checked: m[1] !== " ", text: m[2] };
      });
      out.push(<Checklist key={`l${key++}`} items={rows} onOpenUrl={onOpenUrl} />);
      listBuf = null;
      return;
    }
    const cls =
      "my-0.5 flex flex-col gap-1 pl-1 " +
      (ordered ? "" : "");
    out.push(
      ordered ? (
        <ol key={`l${key++}`} className={cls}>
          {items.map((it, j) => (
            <li key={j} className="flex gap-2">
              <span className="select-none text-[var(--color-faint)]">{j + 1}.</span>
              <span className="flex-1">
                <Inline text={it} onOpenUrl={onOpenUrl} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <ul key={`l${key++}`} className={cls}>
          {items.map((it, j) => (
            <li key={j} className="flex gap-2">
              <span className="select-none text-[var(--color-faint)]">•</span>
              <span className="flex-1">
                <Inline text={it} onOpenUrl={onOpenUrl} />
              </span>
            </li>
          ))}
        </ul>
      ),
    );
    listBuf = null;
  };

  // `| a | b |` → ["a","b"] (tolerant of missing outer pipes).
  const splitRow = (l: string): string[] =>
    l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  // a `|---|:--:|` separator row: only pipes/dashes/colons/space, with both a
  // dash and a pipe (so a bare `---` reads as a horizontal rule, not a table).
  const isTableSep = (l: string | undefined): boolean =>
    !!l && /^[\s|:-]+$/.test(l.trim()) && l.includes("-") && l.includes("|");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // table: a header row immediately followed by a |---| separator
    if (line.includes("|") && isTableSep(lines[i + 1])) {
      flushList();
      const header = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim() && lines[j].includes("|")) {
        rows.push(splitRow(lines[j]));
        j++;
      }
      const cell = "border border-[var(--color-border)] px-2.5 py-1 align-top";
      out.push(
        <div key={`tbl${key++}`} className="my-1 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {header.map((c, ci) => (
                  <th
                    key={ci}
                    className={`${cell} bg-[var(--color-panel)]/50 text-left font-semibold text-[var(--color-text)]`}
                  >
                    <Inline text={c} onOpenUrl={onOpenUrl} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {header.map((_, ci) => (
                    <td key={ci} className={`${cell} text-[var(--color-text-2)]`}>
                      <Inline text={r[ci] ?? ""} onOpenUrl={onOpenUrl} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      i = j - 1;
      continue;
    }
    // horizontal rule (--- / *** / ___ on their own line)
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushList();
      out.push(
        <hr key={`hr${key++}`} className="my-2 border-0 border-t border-[var(--color-border)]" />,
      );
      continue;
    }
    // headings
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      const size =
        level === 1
          ? "text-[17px]"
          : level === 2
            ? "text-[15.5px]"
            : "text-[14.5px]";
      out.push(
        <div
          key={`h${key++}`}
          className={`mt-1 font-sans font-semibold text-[var(--color-text)] ${size}`}
        >
          <Inline text={h[2]} onOpenUrl={onOpenUrl} />
        </div>,
      );
      continue;
    }
    // blockquote
    const bq = line.match(/^\s*>\s?(.*)$/);
    if (bq) {
      flushList();
      out.push(
        <blockquote
          key={`bq${key++}`}
          className="border-l-2 border-[var(--color-border)] pl-3 text-[var(--color-muted)]"
        >
          <Inline text={bq[1]} onOpenUrl={onOpenUrl} />
        </blockquote>,
      );
      continue;
    }
    // unordered list
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (!listBuf || listBuf.ordered) {
        flushList();
        listBuf = { ordered: false, items: [] };
      }
      listBuf.items.push(ul[1]);
      continue;
    }
    // ordered list
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (!listBuf || !listBuf.ordered) {
        flushList();
        listBuf = { ordered: true, items: [] };
      }
      listBuf.items.push(ol[1]);
      continue;
    }
    // blank line → paragraph break
    if (!line.trim()) {
      flushList();
      continue;
    }
    // plain paragraph line
    flushList();
    out.push(
      <p key={`p${key++}`} className="whitespace-pre-wrap break-words">
        <Inline text={line} onOpenUrl={onOpenUrl} />
      </p>,
    );
  }
  flushList();
  return <>{out}</>;
}

/** Inline span formatting: `code`, **bold**, *italic* / _italic_, [text](url).
 *  Single-pass tokenizer — partial markers (e.g. a lone trailing `**` during
 *  streaming) just render literally, never throw. */
function Inline({
  text,
  onOpenUrl,
}: {
  text: string;
  onOpenUrl?: (url: string) => void;
}) {
  // deterministic cwd-anchored file open (context-provided), so a bare
  // `foo.ts` mention resolves against the session cwd + existence-checks before
  // opening — never a blind name search.
  const openFile = useChatFileOpener();
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  let plain = "";
  const flush = () => {
    if (plain) {
      nodes.push(<span key={`s${k++}`}>{plain}</span>);
      plain = "";
    }
  };

  while (i < text.length) {
    const rest = text.slice(i);

    // inline code `…`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        flush();
        const code = text.slice(i + 1, end);
        const fileish = isPaneFileTarget(code);
        nodes.push(
          fileish ? (
            <button
              key={`c${k++}`}
              type="button"
              onClick={() => openFile(code)}
              className="rounded bg-[var(--color-panel)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--color-accent)] underline decoration-[var(--color-accent)]/30 underline-offset-2 hover:decoration-[var(--color-accent)]"
              title="open in pane"
            >
              {code}
            </button>
          ) : (
            <code
              key={`c${k++}`}
              className="rounded bg-[var(--color-panel)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--color-text)]"
            >
              {code}
            </code>
          ),
        );
        i = end + 1;
        continue;
      }
    }

    // bold **…**
    if (rest.startsWith("**")) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 1) {
        flush();
        nodes.push(
          <strong key={`b${k++}`} className="font-semibold text-[var(--color-text)]">
            <Inline text={text.slice(i + 2, end)} onOpenUrl={onOpenUrl} />
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }

    // link [text](url)
    if (text[i] === "[") {
      const close = text.indexOf("]", i + 1);
      if (close > i && text[close + 1] === "(") {
        const paren = text.indexOf(")", close + 2);
        if (paren > close) {
          flush();
          const label = text.slice(i + 1, close);
          const url = text.slice(close + 2, paren);
          const http = isHttpPaneTarget(url);
          const fileish = isPaneFileTarget(url);
          nodes.push(
            <a
              key={`a${k++}`}
              href={url}
              target={http ? "_blank" : undefined}
              rel="noreferrer"
              onClick={(e) => {
                if (http) {
                  e.preventDefault();
                  if (onOpenUrl) onOpenUrl(url);
                  else openUrlInPane(url);
                  return;
                }
                if (fileish) {
                  e.preventDefault();
                  openFile(url);
                }
              }}
              className="text-[var(--color-accent)] underline decoration-[var(--color-accent)]/40 underline-offset-2 hover:decoration-[var(--color-accent)]"
            >
              {label}
            </a>,
          );
          // For real http(s) links, add a small inline "open in browser pane"
          // affordance — a click spawns a native browser pane (don't auto-open).
          if (http) {
            nodes.push(
              <button
                key={`au${k++}`}
                type="button"
                onClick={() => spawnPane("browser", { url })}
                title="open in a browser pane"
                className="ml-0.5 inline-flex translate-y-[1px] items-center rounded p-0.5 align-baseline text-[var(--color-faint)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-accent)]"
              >
                <Globe size={11} />
              </button>,
            );
          }
          i = paren + 1;
          continue;
        }
      }
    }

    // italic *…* or _…_  (avoid eating ** — handled above)
    if ((text[i] === "*" && text[i + 1] !== "*") || text[i] === "_") {
      const marker = text[i];
      const end = text.indexOf(marker, i + 1);
      if (end > i + 1) {
        flush();
        nodes.push(
          <em key={`i${k++}`} className="italic">
            {text.slice(i + 1, end)}
          </em>,
        );
        i = end + 1;
        continue;
      }
    }

    plain += text[i];
    i += 1;
  }
  flush();
  return <>{nodes}</>;
}

