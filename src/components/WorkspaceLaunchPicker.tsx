/** WorkspaceLaunchPicker — when you open a *structured* workspace (split or
 *  environments), this lets you choose WHERE to land: the workspace root (for
 *  cross-cutting work) or a specific component's folder (env-qualified), as a
 *  terminal or a chat agent. The generated CLAUDE.md/AGENTS.md context (P4a) does
 *  the explaining; this just sets the right `cwd`. (PLAN-projects-workspaces.md P4b)
 *
 *  Token-only styling (Neon Glass) — no hex (design-token ratchet). */
import { useEffect } from "react";
import { AnimatePresence, m } from "motion/react";
import { MessageSquare, SquareTerminal, X } from "lucide-react";

import { modalPop, overlayFade } from "./fx/motionTokens";
import {
  type ProjectComponent,
  type ProjectWorkspace,
  joinPath,
  projectShapeLabel,
} from "../lib/projectWorkspaces";

type Mode = "shell" | "chat";

const ROLE_TONE: Record<string, "accent" | "cyan" | "muted"> = {
  frontend: "accent",
  fullstack: "accent",
  backend: "cyan",
};

function Chip({ label, tone = "muted" }: { label: string; tone?: "accent" | "cyan" | "muted" }) {
  const map = {
    accent: {
      bg: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
      fg: "var(--color-accent)",
      bd: "color-mix(in srgb, var(--color-accent) 40%, transparent)",
    },
    cyan: {
      bg: "color-mix(in srgb, var(--osai-accent-2) 14%, transparent)",
      fg: "var(--osai-accent-2)",
      bd: "color-mix(in srgb, var(--osai-accent-2) 38%, transparent)",
    },
    muted: {
      bg: "color-mix(in srgb, var(--color-panel-2) 60%, transparent)",
      fg: "var(--color-muted)",
      bd: "var(--color-border)",
    },
  }[tone];
  return (
    <span
      className="shrink-0 rounded-[5px] border px-1.5 py-px font-mono text-[9px] uppercase tracking-wide"
      style={{ background: map.bg, color: map.fg, borderColor: map.bd }}
    >
      {label}
    </span>
  );
}

/** A launch target: its title/path + terminal + chat buttons. */
function TargetRow({
  title,
  path,
  chips,
  onOpen,
}: {
  title: string;
  path: string;
  chips?: { label: string; tone: "accent" | "cyan" | "muted" }[];
  onOpen: (mode: Mode) => void;
}) {
  return (
    <div className="group flex items-center justify-between gap-3 rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:border-[var(--osai-surface-edge)] hover:bg-[color-mix(in_srgb,white_3%,transparent)]">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-[12.5px] text-[var(--color-text)]">{title}</span>
          {chips?.map((c) => (
            <Chip key={c.label} label={c.label} tone={c.tone} />
          ))}
        </div>
        <span className="truncate font-mono text-[10px] text-[var(--color-faint)]">{path}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => onOpen("shell")}
          title="open a terminal here"
          className="press grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] hover:text-[var(--color-accent)]"
        >
          <SquareTerminal size={14} />
        </button>
        <button
          onClick={() => onOpen("chat")}
          title="open a chat agent here"
          className="press grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] hover:text-[var(--color-accent)]"
        >
          <MessageSquare size={14} />
        </button>
      </div>
    </div>
  );
}

export function WorkspaceLaunchPicker({
  ws,
  onClose,
  onOpen,
}: {
  ws: ProjectWorkspace;
  onClose: () => void;
  /** Launch in `cwd` as a terminal or chat agent; `label` titles the pane. */
  onOpen: (cwd: string, mode: Mode, label: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const comp = (c: ProjectComponent, envName?: string) => {
    const title = envName ? `${envName} · ${c.name}` : c.name;
    const chips: { label: string; tone: "accent" | "cyan" | "muted" }[] = [
      { label: c.role, tone: ROLE_TONE[c.role] ?? "muted" },
    ];
    if (c.stack) chips.push({ label: c.stack, tone: "muted" });
    if (c.status && c.status !== "current") chips.push({ label: c.status, tone: "muted" });
    return (
      <TargetRow
        key={c.id}
        title={title}
        path={c.path === "." ? ws.root : joinPath(ws.root, c.path)}
        chips={chips}
        onOpen={(mode) => onOpen(c.path === "." ? ws.root : joinPath(ws.root, c.path), mode, `${ws.name} · ${c.name}`)}
      />
    );
  };

  const st = ws.structure;

  return (
    <AnimatePresence>
      <m.div
        {...overlayFade()}
        className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-6 backdrop-blur-sm"
        onMouseDown={onClose}
      >
        <m.div
          {...modalPop()}
          role="dialog"
          aria-modal="true"
          aria-label={`open ${ws.name}`}
          className="glass-strong flex max-h-[80vh] w-[460px] max-w-full flex-col overflow-hidden rounded-2xl shadow-[var(--osai-shadow-pop)]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[14px] font-medium text-[var(--color-text)]">{ws.name}</span>
              <Chip label={projectShapeLabel(ws)} tone="muted" />
            </div>
            <button
              onClick={onClose}
              aria-label="close"
              className="grid h-7 w-7 place-items-center rounded-lg text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            >
              <X size={15} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="px-1 pb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
              whole workspace
            </div>
            <TargetRow
              title="workspace root"
              path={ws.root}
              chips={[{ label: "root", tone: "muted" }]}
              onOpen={(mode) => onOpen(ws.root, mode, ws.name)}
            />

            {st.kind === "split" && (
              <>
                <div className="px-1 pb-1 pt-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                  components
                </div>
                {st.components.map((c) => comp(c))}
              </>
            )}

            {st.kind === "environments" &&
              st.environments.map((env) => (
                <div key={env.id}>
                  <div className="flex items-center gap-1.5 px-1 pb-1 pt-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                      {env.name}
                    </span>
                    {env.id === st.defaultEnv && <Chip label="default" tone="accent" />}
                  </div>
                  {env.components.map((c) => comp(c, env.name))}
                </div>
              ))}
          </div>

          <div className="border-t border-[var(--color-border)] px-4 py-2 font-mono text-[10px] text-[var(--color-faint)]">
            ⏎ terminal · agent reads CLAUDE.md / AGENTS.md from the chosen folder
          </div>
        </m.div>
      </m.div>
    </AnimatePresence>
  );
}
