/**
 * Thin wrappers over the Rust PTY commands. Output streams per-session over a
 * Tauri `Channel<string>` (passed into the spawn call), not the global event bus.
 */
import { Channel } from "@tauri-apps/api/core";
import { invoke } from "./tauri";

/** An AIOS oracle session discovered by the backend (tmux + instances.json). */
export interface OracleInfo {
  identity: string;
  session: string;
  socket: string;
  display_name: string;
  attached: boolean;
  is_master: boolean;
  running: boolean;
}

/** Any live tmux session across the known sockets (all-tmux attach surface). */
export interface TmuxSession {
  socket: string;
  name: string;
  attached: boolean;
  windows: number;
  is_oracle: boolean;
  /** Friendly display label (the session's window name — datetime/renamed for
   *  `aios-term-*`). Falls back to `name` in the UI when empty. */
  label: string;
}

/** Lists oracle sessions (`aios-<identity>`) on the given socket (default "aios"). */
export async function listOracles(socket?: string | null): Promise<OracleInfo[]> {
  return invoke<OracleInfo[]>("list_oracles", { socket: socket ?? null });
}

/** Lists every live multiplexer session across the socket + default. */
export async function listTmuxSessions(socket?: string | null): Promise<TmuxSession[]> {
  return invoke<TmuxSession[]>("list_tmux_sessions", { socket: socket ?? null });
}

/** Creates a new oracle session `aios-<identity>`; optional startup command. */
export async function createOracle(
  identity: string,
  command?: string,
  socket?: string | null,
): Promise<string> {
  return invoke<string>("create_oracle", { identity, command: command ?? null, socket: socket ?? null });
}

/** Renames an oracle session. */
export async function renameOracle(from: string, to: string, socket?: string | null): Promise<string> {
  return invoke<string>("rename_oracle", { from, to, socket: socket ?? null });
}

/** Deletes (kills) an oracle session. `force` is accepted for back-compat but no
 *  oracle is protected anymore. */
export async function deleteOracle(identity: string, force = false, socket?: string | null): Promise<void> {
  return invoke("delete_oracle", { identity, force, socket: socket ?? null });
}

/** Kills any session on a socket (all-sessions attach surface). */
export async function killTmuxSession(socket: string, session: string): Promise<void> {
  return invoke("kill_tmux_session", { socket, session });
}

/** ⌘⌘ appshot: screenshot → routed into the named oracle (macOS only). */
export async function appshot(identity?: string, socket?: string | null): Promise<string> {
  return invoke<string>("appshot", { identity: identity ?? null, socket: socket ?? null });
}

/** Spawns the user's login shell in a new PTY. Returns the session id. */
export async function spawnShell(
  onData: Channel<string>,
  cwd: string | null,
  cols: number,
  rows: number,
): Promise<number> {
  return invoke<number>("pty_spawn", { onData, cwd, cols, rows });
}

/**
 * Spawns a pane attached to a PERSISTENT terminal tmux session `aios-term-<name>`
 * (created on first use). Closing the pane / quitting the app only detaches the
 * tmux client — the session (and `cmd`, e.g. `claude`) keeps running and is
 * reattachable. Unix-only: on Windows the backend command is absent, so callers
 * must fall back to `spawnShell` (the raw, non-persistent PTY).
 */
export async function spawnTerminal(
  onData: Channel<string>,
  name: string,
  cmd: string | null,
  cwd: string | null,
  cols: number,
  rows: number,
  socket?: string | null,
  label?: string | null,
): Promise<number> {
  return invoke<number>("pty_spawn_terminal", {
    onData,
    name,
    socket: socket ?? null,
    label: label ?? null,
    cmd: cmd ?? null,
    cwd: cwd ?? null,
    cols,
    rows,
  });
}

/** Renames a persistent session's friendly display label (its window name). The
 *  session key stays stable, so workspace-restore reattach is unaffected. */
export async function setSessionLabel(
  socket: string | null,
  session: string,
  label: string,
): Promise<void> {
  return invoke("pty_set_label", { socket: socket ?? null, session, label });
}

/** Spawns a pane attached to the oracle session `aios-<identity>` on `socket`. */
export async function spawnOracle(
  onData: Channel<string>,
  identity: string,
  cols: number,
  rows: number,
  socket?: string | null,
): Promise<number> {
  return invoke<number>("pty_spawn_oracle", { onData, identity, socket: socket ?? null, cols, rows });
}

/** Attaches a pane to any tmux session on a given socket (all-tmux attach). */
export async function spawnTmux(
  onData: Channel<string>,
  socket: string,
  session: string,
  cols: number,
  rows: number,
): Promise<number> {
  return invoke<number>("pty_spawn_tmux", { onData, socket, session, cols, rows });
}

/**
 * Payload of the backend `pty-exit` Tauri event (structured form), emitted when
 * a session's reader thread exits (PTY closed / process died). The backend has
 * already evicted the session by the time this fires, so any further ptyWrite /
 * ptyPaste to `id` rejects with "dead or unknown".
 *
 * MIGRATION NOTE: the backend emits `pty-exit` TWICE per exit — first a legacy
 * bare `number` (the session id, consumed by TerminalRuntime's existing
 * listener), then this structured object. New listeners must filter with
 * `typeof e.payload === "object"`.
 */
export interface PtyExitEvent {
  id: number;
  exitCode: number | null;
}

/**
 * Writes input to a session's PTY stdin. Rejects with
 * `"pty session <id> is dead or unknown"` when the session has exited or never
 * existed (was a silent no-op before wave-1C).
 */
export async function ptyWrite(id: number, data: string): Promise<void> {
  return invoke("pty_write", { id, data });
}

/**
 * Bracketed-paste write: the backend wraps `text` in ESC[200~ … ESC[201~ so
 * multiline content lands as ONE atomic paste — use this instead of chunked
 * ptyWrite timer hacks when pasting. Rejects like ptyWrite on a dead session.
 */
export async function ptyPaste(id: number, text: string): Promise<void> {
  return invoke("pty_paste", { id, text });
}

/** Propagates a resize to a session's PTY. */
export async function ptyResize(id: number, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { id, cols, rows });
}

/** Kills a session (for an oracle pane, only detaches the tmux client). */
export async function ptyKill(id: number): Promise<void> {
  return invoke("pty_kill", { id });
}

/**
 * Startup GC (B2): kills orphaned `aios-term-*` tmux sessions that have NO live
 * restored pane. `keep` is the list of `termSessionName` suffixes for the panes
 * currently in the layout; the backend reaps only sessions outside that set.
 * Returns the full session names that were reaped.
 */
export async function reapTerminals(keep: string[], socket?: string | null): Promise<string[]> {
  return invoke<string[]>("pty_reap_terminals", { keep, socket: socket ?? null });
}
