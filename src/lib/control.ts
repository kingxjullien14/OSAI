// OSAI Control Plane — the command vocabulary + a pure router.
//
// This is the SPINE of "the agent drives the shell" (Tier 2 of the go-to-harness
// review; full design in misc/PLAN-control-plane.md). ONE dotted-verb command
// schema + a single `routeControl()` that maps each command to a handler, so the
// in-app chat, an external oracle (later, via the osai-control MCP → a localhost
// HTTP server in Rust → emit/listen), AND the UI all drive the app through one
// place — "external == UI". The transport and App's handler wiring plug into this.
//
// Pure + transport-agnostic + unit-tested, so the contract is solid before the
// (harder-to-verify) Rust/MCP transport lands.

/** Raw inbound shape before narrowing (what the transport hands us). */
export interface ControlEnvelope {
  id?: string;
  action?: unknown;
  [k: string]: unknown;
}

/** The command vocabulary (v2 — pane lifecycle, terminal, browser, named layouts,
 *  settings, sidebar, reads). Each maps to the exact closure the UI uses, so an
 *  external agent drives the app identically to a human. (Oracle verbs are still
 *  future.) */
export type ControlCmd =
  | { action: "pane.open"; content: unknown; label?: string }
  | { action: "pane.openFile"; path: string }
  | { action: "pane.close"; key: string; force?: boolean }
  | { action: "pane.maximize"; key: string; on?: boolean }
  | { action: "pane.hide"; key: string; on?: boolean }
  | { action: "pane.resumeChat"; chatId: string }
  | { action: "sidebar.toggle"; on?: boolean }
  | { action: "terminal.send"; key: string; text: string }
  | { action: "terminal.runCommand"; key: string; cmd: string }
  | { action: "terminal.interrupt"; key: string }
  | { action: "browser.open"; url: string; label?: string }
  | { action: "browser.navigate"; key: string; url: string }
  | { action: "browser.back"; key: string }
  | { action: "browser.forward"; key: string }
  | { action: "browser.reload"; key: string }
  | { action: "layout.list" }
  | { action: "layout.save"; name: string }
  | { action: "layout.apply"; name: string }
  | { action: "settings.get"; key?: string }
  | { action: "settings.set"; key: string; value: unknown }
  | { action: "oracle.list" }
  | { action: "oracle.spawn"; id: string }
  | { action: "oracle.kill"; id: string; force?: boolean }
  | { action: "notes.list"; q?: string; tag?: string }
  | { action: "notes.read"; id: string }
  | { action: "notes.create"; content: string; title?: string; tags?: string[] }
  | { action: "notes.append"; id: string; text: string }
  | { action: "pane.list" }
  | { action: "state.get" }
  | { action: "capabilities" };

export type ControlAction = ControlCmd["action"];

export interface ControlResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** The handlers App provides — each maps to an existing UI closure, so the control
 *  plane and the UI mutate state through the exact same code. Writes return void;
 *  reads return their snapshot. `terminalSend` returns false when no such pane. */
export interface ControlHandlers {
  paneOpen: (content: unknown, label?: string) => void;
  paneOpenFile: (path: string) => void;
  paneClose: (key: string, force: boolean) => void;
  paneMaximize: (key: string, on: boolean) => void;
  paneHide: (key: string, on: boolean) => void;
  paneResumeChat: (chatId: string) => void;
  sidebarToggle: (on?: boolean) => void;
  terminalSend: (key: string, text: string) => boolean;
  browserOpen: (url: string, label?: string) => void;
  /** Drive an EXISTING browser pane by key — false if no such browser pane. */
  browserNavigate: (key: string, url: string) => boolean;
  browserBack: (key: string) => boolean;
  browserForward: (key: string) => boolean;
  browserReload: (key: string) => boolean;
  /** Named pane-layouts (workspaces). `layoutApply` → false if no such name. */
  layoutList: () => unknown;
  layoutSave: (name: string) => void;
  layoutApply: (name: string) => boolean;
  /** Read all settings (or one key); `settingsSet` validates the key/type and
   *  reports the outcome so a rejected write never looks like success. */
  settingsGet: (key?: string) => unknown;
  settingsSet: (key: string, value: unknown) => { ok: boolean; error?: string; value?: unknown };
  /** Oracles = the agents OSAI runs as tmux sessions. `oracleKill` → false if no
   *  such oracle in the current roster (so a typo'd id isn't a silent no-op). */
  oracleList: () => unknown;
  oracleSpawn: (id: string) => void;
  oracleKill: (id: string, force: boolean) => boolean;
  /** Notes = the owner's Stone & Chisel notebook (lib/snc). ASYNC — these hit
   *  the network, so the router returns a Promise for them and the transport
   *  awaits before replying. Rejections become ok:false results (e.g. "notes
   *  not connected"), never unhandled. */
  notesList: (opts: { q?: string; tag?: string }) => Promise<unknown>;
  notesRead: (id: string) => Promise<unknown>;
  notesCreate: (seed: { content: string; title?: string; tags?: string[] }) => Promise<unknown>;
  notesAppend: (id: string, text: string) => Promise<unknown>;
  paneList: () => unknown;
  stateGet: () => unknown;
}

/** Every supported action — the self-describing `capabilities` reply so an agent
 *  can discover what it can do. */
export const CONTROL_ACTIONS: ControlAction[] = [
  "pane.open",
  "pane.openFile",
  "pane.close",
  "pane.maximize",
  "pane.hide",
  "pane.resumeChat",
  "sidebar.toggle",
  "terminal.send",
  "terminal.runCommand",
  "terminal.interrupt",
  "browser.open",
  "browser.navigate",
  "browser.back",
  "browser.forward",
  "browser.reload",
  "layout.list",
  "layout.save",
  "layout.apply",
  "settings.get",
  "settings.set",
  "oracle.list",
  "oracle.spawn",
  "oracle.kill",
  "notes.list",
  "notes.read",
  "notes.create",
  "notes.append",
  "pane.list",
  "state.get",
  "capabilities",
];

const ok = (result?: unknown): ControlResult => ({ ok: true, result });
const err = (error: string): ControlResult => ({ ok: false, error });

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Pure router: validate the envelope's required fields and dispatch to the
 * matching handler. Returns a `ControlResult` (never throws) — or, for the
 * async notes verbs, a Promise of one that likewise never rejects. The
 * transport (or App) attaches the correlation `id`; this only decides
 * ok/result/error.
 *
 * Reads (`pane.list`/`state.get`/`capabilities`) return data; writes return the
 * pane list so an agent stays in sync in one round-trip (App supplies it via
 * `paneList`). Unknown or malformed commands return `ok:false` with a reason —
 * a silent no-op would leave the agent thinking it succeeded.
 */
export function routeControl(
  env: ControlEnvelope,
  h: ControlHandlers,
): ControlResult | Promise<ControlResult> {
  const action = env.action;
  switch (action) {
    case "capabilities":
      return ok({ actions: CONTROL_ACTIONS });
    case "pane.list":
      return ok(h.paneList());
    case "state.get":
      return ok(h.stateGet());
    case "pane.open": {
      if (env.content == null || typeof env.content !== "object")
        return err("pane.open requires a `content` object (a PaneContent)");
      h.paneOpen(env.content, asString(env.label) ?? undefined);
      return ok(h.paneList());
    }
    case "pane.openFile": {
      const path = asString(env.path);
      if (!path) return err("pane.openFile requires a `path` string");
      h.paneOpenFile(path);
      return ok(h.paneList());
    }
    case "pane.close": {
      const key = asString(env.key);
      if (!key) return err("pane.close requires a `key` string");
      h.paneClose(key, env.force === true);
      return ok(h.paneList());
    }
    case "pane.maximize": {
      const key = asString(env.key);
      if (!key) return err("pane.maximize requires a `key` string");
      h.paneMaximize(key, env.on !== false); // default on:true
      return ok(h.paneList());
    }
    case "pane.hide": {
      const key = asString(env.key);
      if (!key) return err("pane.hide requires a `key` string");
      h.paneHide(key, env.on !== false); // default on:true
      return ok(h.paneList());
    }
    case "pane.resumeChat": {
      const chatId = asString(env.chatId);
      if (!chatId) return err("pane.resumeChat requires a `chatId` string");
      h.paneResumeChat(chatId);
      return ok(h.paneList());
    }
    case "sidebar.toggle":
      h.sidebarToggle(typeof env.on === "boolean" ? env.on : undefined);
      return ok();
    case "terminal.send": {
      const key = asString(env.key);
      const text = typeof env.text === "string" ? env.text : null;
      if (!key || text == null) return err("terminal.send requires `key` + `text` strings");
      return h.terminalSend(key, text) ? ok() : err(`no terminal pane "${key}"`);
    }
    case "terminal.runCommand": {
      const key = asString(env.key);
      const cmd = asString(env.cmd);
      if (!key || !cmd) return err("terminal.runCommand requires `key` + `cmd` strings");
      return h.terminalSend(key, cmd.endsWith("\n") ? cmd : `${cmd}\n`)
        ? ok()
        : err(`no terminal pane "${key}"`);
    }
    case "terminal.interrupt": {
      const key = asString(env.key);
      if (!key) return err("terminal.interrupt requires a `key` string");
      return h.terminalSend(key, "\x03") ? ok() : err(`no terminal pane "${key}"`);
    }
    case "browser.open": {
      const url = asString(env.url);
      if (!url) return err("browser.open requires a `url` string");
      h.browserOpen(url, asString(env.label) ?? undefined);
      return ok(h.paneList());
    }
    case "browser.navigate": {
      const key = asString(env.key);
      const url = asString(env.url);
      if (!key || !url) return err("browser.navigate requires `key` + `url` strings");
      return h.browserNavigate(key, url) ? ok() : err(`no browser pane "${key}"`);
    }
    case "browser.back":
    case "browser.forward":
    case "browser.reload": {
      const key = asString(env.key);
      if (!key) return err(`${action} requires a "key" string`);
      const drive =
        action === "browser.back"
          ? h.browserBack
          : action === "browser.forward"
            ? h.browserForward
            : h.browserReload;
      return drive(key) ? ok() : err(`no browser pane "${key}"`);
    }
    case "layout.list":
      return ok(h.layoutList());
    case "layout.save": {
      const name = asString(env.name);
      if (!name) return err("layout.save requires a `name` string");
      h.layoutSave(name);
      return ok(h.layoutList());
    }
    case "layout.apply": {
      const name = asString(env.name);
      if (!name) return err("layout.apply requires a `name` string");
      return h.layoutApply(name) ? ok(h.paneList()) : err(`no saved layout "${name}"`);
    }
    case "settings.get":
      return ok(h.settingsGet(asString(env.key) ?? undefined));
    case "settings.set": {
      const key = asString(env.key);
      if (!key) return err("settings.set requires a `key` string");
      if (env.value === undefined) return err("settings.set requires a `value`");
      const r = h.settingsSet(key, env.value);
      return r.ok ? ok({ key, value: r.value }) : err(r.error ?? "settings.set rejected");
    }
    case "oracle.list":
      return ok(h.oracleList());
    case "oracle.spawn": {
      const id = asString(env.id);
      if (!id) return err("oracle.spawn requires an `id` string");
      h.oracleSpawn(id);
      return ok(h.paneList());
    }
    case "oracle.kill": {
      const id = asString(env.id);
      if (!id) return err("oracle.kill requires an `id` string");
      return h.oracleKill(id, env.force === true) ? ok() : err(`no oracle "${id}"`);
    }
    case "notes.list": {
      return h
        .notesList({ q: asString(env.q) ?? undefined, tag: asString(env.tag) ?? undefined })
        .then(ok, (e) => err(String(e)));
    }
    case "notes.read": {
      const id = asString(env.id);
      if (!id) return err("notes.read requires an `id` string (from notes.list)");
      return h.notesRead(id).then(ok, (e) => err(String(e)));
    }
    case "notes.create": {
      const content = typeof env.content === "string" && env.content.trim() ? env.content : null;
      if (!content) return err("notes.create requires a non-empty `content` string");
      const tags =
        Array.isArray(env.tags) && env.tags.every((t) => typeof t === "string")
          ? (env.tags as string[])
          : undefined;
      return h
        .notesCreate({ content, title: asString(env.title) ?? undefined, tags })
        .then(ok, (e) => err(String(e)));
    }
    case "notes.append": {
      const id = asString(env.id);
      const text = typeof env.text === "string" && env.text.trim() ? env.text : null;
      if (!id || !text) return err("notes.append requires `id` + non-empty `text` strings");
      return h.notesAppend(id, text).then(ok, (e) => err(String(e)));
    }
    default:
      return err(`unknown action "${String(action)}" — see capabilities`);
  }
}
