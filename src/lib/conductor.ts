/** Conductor — speak a workspace into existence. The pure brain of the
 *  push-to-talk flagship: a transcript goes in, an ordered plan of existing
 *  primitives comes out (spawn pane / run command / seed a chat / apply
 *  workspace / theme / home). App executes the plan over the pane bus —
 *  NOTHING here touches the model's context window (guardrail 3): smart
 *  routing happens in plain code, the chat only sees what you said to it.
 *
 *  Grammar (deliberately literal — no "the dev server"→"npm run dev" magic):
 *    "open/add/split … a terminal|browser|chat|files|notes|pet|agents"
 *    "… browser on github.com"           → spawn browser at that url
 *    "run <verbatim command>"            → terminal running exactly that
 *    "ask|tell [claude|the agent] to …"  → chat seeded with the rest
 *    "switch to <name> mode|workspace"   → apply the saved workspace
 *    "theme dark|light|system"           → setTheme
 *    "go home / close everything"        → rest all panes to the idle home
 *  Segments split on "then" / "and" / commas; an unparseable segment right
 *  after an ask/run is folded back into it ("ask claude to wire it up AND
 *  TEST IT" must not shed its tail). Anything else is reported as unknown —
 *  the executor falls back to seeding a chat with the whole transcript when
 *  nothing at all parsed. */

export type ConductorPane =
  | "terminal"
  | "browser"
  | "chat"
  | "files"
  | "notes"
  | "pet"
  | "agents";

export type ConductorStep =
  | { kind: "spawn"; pane: ConductorPane; url?: string }
  | { kind: "run"; cmd: string }
  | { kind: "ask"; text: string }
  | { kind: "workspace"; name: string }
  | { kind: "theme"; theme: "dark" | "light" | "system" }
  | { kind: "home" }
  | { kind: "unknown"; text: string };

const PANE_NOUNS: Record<string, ConductorPane> = {
  terminal: "terminal",
  shell: "terminal",
  console: "terminal",
  browser: "browser",
  web: "browser",
  chat: "chat",
  chatpane: "chat",
  files: "files",
  file: "files",
  notes: "notes",
  note: "notes",
  pet: "pet",
  agents: "agents",
  agent: "agents",
};

/** Pull a url-ish token out of "… on github.com/docs" / "… at https://…". */
function extractUrl(seg: string): string | undefined {
  const m =
    seg.match(/\b(?:on|at|to)\s+(https?:\/\/\S+)/) ??
    seg.match(/\b(?:on|at|to)\s+([a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)/);
  if (!m) return undefined;
  const raw = m[1].replace(/[.,;]+$/, "");
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
}

function parseSegment(
  seg: string,
  ctx: { workspaces?: string[] },
): ConductorStep {
  const s = seg.trim().replace(/^[,;.\s]+|[,;.\s]+$/g, "");
  if (!s) return { kind: "unknown", text: "" };

  // home — rest everything back to the idle dashboard
  if (/^(?:go\s+)?home$|^close\s+everything$|^hide\s+(?:all|everything)(?:\s+panes?)?$/.test(s)) {
    return { kind: "home" };
  }

  // theme
  const theme = s.match(
    /^(?:switch\s+(?:to\s+)?|set\s+|use\s+)?(?:the\s+)?(?:theme\s+(?:to\s+)?)?(dark|light|system)(?:\s+(?:theme|mode))?$/,
  );
  if (theme) return { kind: "theme", theme: theme[1] as "dark" | "light" | "system" };

  // workspace — "<name> mode/workspace" or "workspace <name>"; the name must
  // actually exist (fuzzy contains) so "plan mode" can't false-positive.
  const wsm =
    s.match(/^(?:switch\s+to\s+|load\s+|apply\s+|open\s+)?(?:the\s+)?workspace\s+(.+)$/) ??
    s.match(/^(?:switch\s+to\s+|load\s+|apply\s+|open\s+)?(?:the\s+)?(.+?)\s+(?:mode|workspace)$/);
  if (wsm) {
    const want = wsm[1].trim();
    const hit = (ctx.workspaces ?? []).find(
      (w) => w.toLowerCase().includes(want) || want.includes(w.toLowerCase()),
    );
    if (hit) return { kind: "workspace", name: hit };
  }

  // run — verbatim command, no interpretation
  const run = s.match(/^run\s+(.+)$/);
  if (run) return { kind: "run", cmd: run[1].trim() };

  // ask/tell — the rest of the segment is the prompt
  const ask = s.match(
    /^(?:ask|tell)\s+(?:(?:claude|codex|opencode|aios|the\s+agent|the\s+ai|ai)\s+)?(?:to\s+)?(.+)$/,
  );
  if (ask) return { kind: "ask", text: ask[1].trim() };

  // spawn — any pane noun in an open/add/split/new phrasing (or bare noun)
  const noun = s.match(
    /(?:^|\s)(?:a\s+|an\s+|the\s+|another\s+)?(terminal|shell|console|browser|web|chatpane|chat|files?|notes?|pet|agents?)\b/,
  );
  if (noun) {
    const pane = PANE_NOUNS[noun[1]];
    if (pane === "browser") {
      return { kind: "spawn", pane, url: extractUrl(s) };
    }
    return { kind: "spawn", pane };
  }

  return { kind: "unknown", text: s };
}

/** Transcript → ordered plan. */
export function parseConductor(
  transcript: string,
  ctx: { workspaces?: string[] } = {},
): ConductorStep[] {
  const text = transcript.trim().toLowerCase();
  if (!text) return [];

  // segment: "then"/"and then" are hard separators; commas/semicolons too;
  // bare "and" separates segments (the repair pass below un-splits ask/run
  // tails that legitimately contained an "and").
  const segments = text
    .split(/\s+(?:and\s+then|then)\s+|[,;]+|\s+and\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const steps: ConductorStep[] = [];
  for (const seg of segments) {
    const step = parseSegment(seg, ctx);
    const prev = steps[steps.length - 1];
    if (step.kind === "unknown" && prev) {
      // fold an unparseable tail back into the preceding free-text step —
      // "ask claude to wire it up and test it" must keep its tail.
      if (prev.kind === "ask") {
        prev.text = `${prev.text} and ${step.text}`;
        continue;
      }
      if (prev.kind === "run") {
        prev.cmd = `${prev.cmd} && ${step.text}`;
        continue;
      }
    }
    if (step.kind === "unknown" && !step.text) continue;
    steps.push(step);
  }
  return steps;
}

/** True when the plan moved nothing — the executor falls back to a chat. */
export function planIsEmpty(steps: ConductorStep[]): boolean {
  return steps.every((s) => s.kind === "unknown");
}
