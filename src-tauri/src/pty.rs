//! Multi-session PTY manager for the AIOS cockpit.
//!
//! Each terminal pane owns one real PTY (via portable-pty → openpty on unix,
//! ConPTY on Windows). Output is streamed to the frontend over a per-session
//! Tauri `Channel<String>` (NOT the global event bus) so many busy panes stay
//! cheap. A dedicated reader thread per PTY keeps blocking reads off the async
//! runtime; bytes are split on valid UTF-8 boundaries so multibyte sequences
//! never corrupt across reads.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};
#[cfg(windows)]
use tauri::Manager;

use crate::oracles::tmux_bin;

/// Default multiplexer socket name for AIOS's own persistent terminal sessions
/// when the frontend doesn't pass one. Was a legacy hardcoded name; now a
/// neutral default the user can override in Settings → "terminal socket".
const DEFAULT_TERM_SOCKET: &str = "aios";

/// Resolves + sanitizes the socket name from the optional frontend setting.
/// Falls back to `DEFAULT_TERM_SOCKET`; rejects anything with shell-unsafe chars
/// (the socket flows into tmux/psmux `-L <socket>`).
fn term_socket(socket: Option<String>) -> String {
    socket
        .map(|s| s.trim().to_string())
        .filter(|s| {
            !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
        .unwrap_or_else(|| DEFAULT_TERM_SOCKET.to_string())
}

/// Resolves the multiplexer binary — `tmux` on unix, **psmux** on Windows.
/// psmux is "native Windows tmux" (https://github.com/psmux/psmux): a from-scratch
/// Rust/ConPTY reimplementation that speaks tmux's command language (`-L` socket
/// namespaces, `new-session -A -d`, `attach`, persistent detach/reattach server),
/// so it's a drop-in for the exact CLI the unix paths drive. It's what gives
/// Windows the persistent/detachable sessions tmux can't (tmux is unix-only).
///
/// Windows resolution honors the user's choice ("bundle, prefer PATH"):
///   1. a user-installed `psmux`/`tmux`/`pmux` on PATH (power users pin a version)
///   2. the bundled sidecar shipped in the app's resource dir
/// `None` on Windows → not found, so callers gracefully degrade (no persistence /
/// no oracles) instead of hard-failing. On unix it's always `Some(tmux_bin())`.
pub fn resolve_mux(app: &AppHandle) -> Option<String> {
    #[cfg(windows)]
    {
        // PATH — psmux installs `tmux.exe`/`pmux.exe` aliases too, so any works.
        if let Some(path) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&path) {
                for name in ["psmux.exe", "pmux.exe", "tmux.exe"] {
                    let p = dir.join(name);
                    if p.is_file() {
                        return Some(p.to_string_lossy().into_owned());
                    }
                }
            }
        }
        // bundled sidecar (scripts/fetch-psmux.ps1 stages it under resources/).
        if let Ok(res) = app.path().resource_dir() {
            let p = res.join("resources").join("psmux.exe");
            if p.is_file() {
                return Some(p.to_string_lossy().into_owned());
            }
        }
        None
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Some(tmux_bin())
    }
}

/// Runs a multiplexer control command to completion with stdio discarded and (on
/// Windows) no console window. Returns true on a zero exit. Shared by the PTY
/// pre-steps here and the oracle CRUD in `oracles.rs`.
pub fn run_mux_quiet(bin: &str, args: &[&str]) -> bool {
    let mut cmd = std::process::Command::new(bin);
    cmd.args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

/// Applies AIOS's shared session styling on a socket (global, idempotent): mouse
/// on, plus a `status-left` that shows the session's WINDOW NAME — which we set
/// to a friendly per-session label (datetime by default, renameable) via
/// `new-session -n`. The default `[#S]` truncated every `aios-term-*` key to the
/// same `aios-term`, so panes looked identical; `#W` is the human label instead.
#[cfg(windows)]
fn apply_mux_style(bin: &str, sock: &str) {
    run_mux_quiet(bin, &["-L", sock, "set", "-g", "mouse", "on"]);
    run_mux_quiet(bin, &["-L", sock, "set", "-g", "status-left-length", "24"]);
    run_mux_quiet(bin, &["-L", sock, "set", "-g", "status-left", "[#W] "]);
}

/// One live PTY-backed session. All fields are behind Mutex so the whole
/// `Session` is `Sync` and can live in shared app state.
struct Session {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
}

/// Shared registry of all live sessions, keyed by an incrementing id. The map
/// is behind an `Arc` so a session's reader thread can hold a handle and remove
/// itself when the child exits (B4) without borrowing `&self`.
pub struct PtyState {
    sessions: Arc<Mutex<HashMap<u32, Arc<Session>>>>,
    next_id: AtomicU32,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU32::new(1),
        }
    }

    /// A cloned handle to the shared session map — for the reader thread to
    /// evict its own entry on child exit.
    fn sessions_handle(&self) -> Arc<Mutex<HashMap<u32, Arc<Session>>>> {
        Arc::clone(&self.sessions)
    }
}

/// Splits a byte buffer at the last valid UTF-8 boundary, returning the decoded
/// prefix and any trailing incomplete bytes (to be prepended to the next read).
fn split_valid_utf8(buf: &[u8]) -> (String, Vec<u8>) {
    match std::str::from_utf8(buf) {
        Ok(s) => (s.to_string(), Vec::new()),
        Err(e) => {
            let valid = e.valid_up_to();
            // SAFETY: bytes up to `valid` are guaranteed valid UTF-8 by the check above.
            let s = unsafe { std::str::from_utf8_unchecked(&buf[..valid]) }.to_string();
            (s, buf[valid..].to_vec())
        }
    }
}

/// Structured payload for the `pty-exit` event (wave-1C, ported from
/// upstream@64899fe). Mirrored as `PtyExitEvent` in `src/lib/pty.ts`.
/// `exit_code` is `None` when the child couldn't be reaped quickly (or the
/// reader stopped while the child was still alive, e.g. the frontend dropped its
/// channel on a webview reload). Emitted ALONGSIDE the legacy bare-`id` event so
/// the existing TerminalRuntime listener keeps working until it adopts this shape.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExit {
    id: u32,
    exit_code: Option<u32>,
}

/// Core spawn: opens a PTY, runs `cmd`, wires a reader thread → `on_data`, and
/// registers the session. Returns the new session id.
fn spawn_internal(
    app: AppHandle,
    state: &PtyState,
    on_data: Channel<String>,
    cmd: CommandBuilder,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let portable_pty::PtyPair { master, slave } = pair;

    let child = slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // Close the slave in the parent so the reader sees EOF when the child exits.
    drop(slave);

    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = master.take_writer().map_err(|e| e.to_string())?;

    let id = state.next_id.fetch_add(1, Ordering::SeqCst);

    // The reader thread needs to drop the session from the registry when the
    // child exits (B4) — otherwise dead PTYs leak AND `pty_write` keeps finding
    // the corpse and write_all's into a dead master (error swallowed by the
    // frontend's `.catch(()=>{})`), so the user types into nothing with zero
    // feedback. Clone the sessions Arc-map into the thread so it can self-remove.
    let sessions = state.sessions_handle();

    // Reader thread: blocking reads → UTF-8-safe chunks → per-session Channel.
    thread::spawn(move || {
        let mut pending: Vec<u8> = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let (text, rem) = split_valid_utf8(&pending);
                    pending = rem;
                    if !text.is_empty() {
                        if on_data.send(text).is_err() {
                            break; // frontend dropped the channel
                        }
                    }
                }
                Err(_) => break,
            }
        }
        // Child exited / reader EOF: evict the session BEFORE announcing the
        // exit, so any pty_write racing the exit notification can't land on a
        // dead master (post-eviction, pty_write returns Err("dead or unknown")
        // so the frontend gets a real signal instead of a black hole). Dropping
        // the Arc<Session> here also frees the PTY master.
        let removed = sessions.lock().remove(&id);
        // Resolve the exit code WITHOUT blocking indefinitely: after EOF the
        // child has normally already exited, but if the reader stopped because
        // the frontend dropped the channel the child may still be alive —
        // `wait()` would park this thread forever. Bounded try_wait instead.
        let mut exit_code: Option<u32> = None;
        if let Some(s) = &removed {
            let mut child = s.child.lock();
            for _ in 0..5 {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        exit_code = Some(status.exit_code());
                        break;
                    }
                    Ok(None) => thread::sleep(std::time::Duration::from_millis(50)),
                    Err(_) => break,
                }
            }
        }
        // Dual-emit: 1) legacy bare id (existing TerminalRuntime listener),
        // 2) structured PtyExit (the canonical shape going forward).
        let _ = app.emit("pty-exit", id);
        let _ = app.emit("pty-exit", PtyExit { id, exit_code });
    });

    let session = Arc::new(Session {
        master: Mutex::new(master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
    });
    state.sessions.lock().insert(id, session);
    Ok(id)
}

/// Resolves the shell to launch on Windows. Honors `$SHELL` if the user set one,
/// otherwise prefers PowerShell 7 (`pwsh.exe`) and falls back to the built-in
/// Windows PowerShell — always an ABSOLUTE path so the PTY layer never depends on
/// PATH resolution (a common cause of a terminal that opens but can't be typed
/// into because the shell never actually spawned).
#[allow(dead_code)]
pub fn windows_shell() -> String {
    if let Ok(s) = std::env::var("SHELL") {
        if !s.is_empty() {
            return s;
        }
    }
    let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
    let pwsh = format!(r"{program_files}\PowerShell\7\pwsh.exe");
    if std::path::Path::new(&pwsh).exists() {
        return pwsh;
    }
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    format!(r"{system_root}\System32\WindowsPowerShell\v1.0\powershell.exe")
}

/// Spawns the user's login shell in a new PTY pane.
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<PtyState>,
    on_data: Channel<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let mut cmd = if cfg!(windows) {
        // On Windows there's no SHELL/login-shell convention; launch PowerShell by
        // absolute path and skip the `-l` login flag.
        CommandBuilder::new(windows_shell())
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let mut c = CommandBuilder::new(shell);
        c.arg("-l");
        c
    };
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    match cwd {
        Some(dir) if !dir.is_empty() => cmd.cwd(dir),
        _ => {
            if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
                cmd.cwd(home);
            }
        }
    }
    spawn_internal(app, &state, on_data, cmd, cols, rows)
}

/// Attaches a pane to an oracle session (`aios-<identity>`) on the configurable
/// socket. Closing the pane detaches the client without killing the session
/// (`pty_kill` only kills the attach client).
#[tauri::command]
pub fn pty_spawn_oracle(
    app: AppHandle,
    state: State<PtyState>,
    on_data: Channel<String>,
    identity: String,
    socket: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let sock = term_socket(socket);
    let safe = !identity.is_empty()
        && identity
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if !safe {
        return Err("invalid oracle identity".into());
    }
    let session = format!("aios-{identity}");
    #[cfg(windows)]
    {
        let Some(psmux) = resolve_mux(&app) else {
            return Err("oracle attach needs psmux on Windows — install it (winget install psmux) or it ships bundled".into());
        };
        // Confirm it exists before attaching so a dead/typo'd session errors
        // cleanly instead of spawning an empty shell (the `new-session -A` would).
        if !run_mux_quiet(&psmux, &["-L", &sock, "has-session", "-t", &session]) {
            return Err(format!("oracle session '{session}' isn't running"));
        }
        apply_mux_style(&psmux, &sock);
        // `new-session -A -s` (not `attach -t`): psmux's `attach -t` ignores its
        // target and joins the most-recently-active session — `-A` binds to the
        // named one and attaches without disturbing it.
        let mut cmd = CommandBuilder::new(&psmux);
        for a in ["-L", &sock, "new-session", "-A", "-s"] {
            cmd.arg(a);
        }
        cmd.arg(&session);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        spawn_internal(app, &state, on_data, cmd, cols, rows)
    }
    #[cfg(not(windows))]
    {
        let tmux = tmux_bin();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        // enable mouse so the wheel scrolls inside tmux (it owns the alt-screen, so
        // xterm's own scrollback is bypassed), then attach.
        cmd.arg(format!(
            "{tmux} -L {sock} set -g mouse on 2>/dev/null; \
             {tmux} -L {sock} set -g status-left-length 24 2>/dev/null; \
             {tmux} -L {sock} set -g status-left '[#W] ' 2>/dev/null; \
             exec {tmux} -L {sock} attach -t {session}"
        ));
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        spawn_internal(app, &state, on_data, cmd, cols, rows)
    }
}

/// Attaches a pane to a PERSISTENT terminal tmux session (`aios-term-<name>` on
/// socket), creating it on first use. Unlike `pty_spawn`'s ephemeral
/// login shell, this session lives on the tmux daemon — so closing the pane (or
/// quitting the whole app) only detaches the `tmux attach` client; the shell (or
/// whatever `cmd` ran, e.g. `claude`) keeps running and is reattachable later.
///
/// `cmd` is the session's startup command — passed to `new-session` so a "claude
/// code" pane boots claude inside the persistent session. `None` → a login shell.
///
/// tmux is Unix-only, so persistence (detach/reattach, survive-app-close) only
/// works on unix. On Windows we still expose the SAME command — it just spawns a
/// normal (non-persistent) PowerShell PTY, optionally running `cmd` (e.g. the
/// "claude code" pane boots `claude`). This keeps the command registered on every
/// platform so the frontend's `spawnTerminal` invoke never 404s.
#[cfg(windows)]
#[tauri::command]
pub fn pty_spawn_terminal(
    app: AppHandle,
    state: State<PtyState>,
    on_data: Channel<String>,
    name: String,
    socket: Option<String>,
    label: Option<String>,
    cmd: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    // Prefer a PERSISTENT psmux session (real tmux-style detach/reattach that
    // survives closing the pane or quitting the app) when psmux is installed or
    // bundled. Mirrors the unix tmux path, minus the `/bin/sh` chaining: we run
    // the detached create + mouse-on as quiet pre-steps, then PTY-attach.
    let sock = term_socket(socket);
    let safe_name = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if safe_name {
        if let Some(psmux) = resolve_mux(&app) {
            let session = format!("aios-term-{name}");
            // create-or-noop, detached. `-A` makes a re-open a harmless no-op
            // (not a relaunch of `cmd`) — same atomic guarantee as unix.
            let mut create: Vec<String> = vec![
                "-L".into(),
                sock.clone(),
                "new-session".into(),
                "-A".into(),
                "-d".into(),
                "-s".into(),
                session.clone(),
            ];
            // `-n <label>` names the window = the human display label (datetime by
            // default). It's applied only when the session is CREATED (`-A` reopen
            // ignores it), so it survives detach/reattach, and `-n` sets the
            // manual-rename flag so the shell can't auto-rename it away.
            if let Some(l) = label.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
                create.push("-n".into());
                create.push(l.to_string());
            }
            if let Some(dir) = cwd
                .as_deref()
                .map(str::trim)
                .filter(|c| !c.is_empty() && std::path::Path::new(c).is_dir())
            {
                create.push("-c".into());
                create.push(dir.to_string());
            }
            if let Some(c) = cmd.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
                // Run the startup command in a shell that STAYS OPEN after it
                // exits (VS Code-style run terminal — logs remain, re-runnable),
                // inside the persistent session. Same intent as the unix
                // keepalive wrapper + the existing Windows `-NoExit -Command`.
                create.push(windows_shell());
                create.push("-NoExit".into());
                create.push("-Command".into());
                create.push(c.to_string());
            }
            let create_refs: Vec<&str> = create.iter().map(String::as_str).collect();
            run_mux_quiet(&psmux, &create_refs);
            // mouse on so the wheel scrolls inside psmux (it owns the alt-screen).
            apply_mux_style(&psmux, &sock);
            // Attach in the PTY via `new-session -A -s <name>`, NOT `attach -t`:
            // psmux's `attach -t` ignores its target and joins the most-recently-
            // ACTIVE session, so every new pane mirrored the first one (verified).
            // `new-session -A` binds to the session NAMED here — it exists from the
            // detached create above, so `-A` attaches to exactly it. Killing this
            // client detaches; the session lives on.
            let mut cmdb = CommandBuilder::new(&psmux);
            for a in ["-L", &sock, "new-session", "-A", "-s"] {
                cmdb.arg(a);
            }
            cmdb.arg(&session);
            cmdb.env("TERM", "xterm-256color");
            cmdb.env("COLORTERM", "truecolor");
            return spawn_internal(app, &state, on_data, cmdb, cols, rows);
        }
    }
    // ---- fallback: psmux absent → a plain, NON-persistent PowerShell PTY (the
    // pane still works everywhere; persistence is the bonus psmux unlocks). ----
    let _ = name; // no session name in the non-persistent fallback
    let shell = windows_shell();
    let mut cmdb = CommandBuilder::new(&shell);
    let startup = cmd.map(|c| c.trim().to_string()).filter(|c| !c.is_empty());
    // Boot the startup command (e.g. `claude --dangerously-skip-permissions`) as
    // the shell's OWN launch argument rather than typing it into the PTY after
    // spawn. Injecting keystrokes races PowerShell's PSReadLine init — early
    // bytes get swallowed and `claude` never starts (the "claude code pane does
    // nothing" bug). `-NoExit` keeps the shell alive after claude exits so the
    // pane stays usable; on a bare PowerShell shell the binary resolves `claude`
    // (a `claude.cmd`/`claude.exe` shim) from PATH.
    if let Some(c) = &startup {
        let is_powershell = shell.to_lowercase().contains("powershell")
            || shell.to_lowercase().ends_with("pwsh.exe");
        if is_powershell {
            cmdb.arg("-NoExit");
            cmdb.arg("-Command");
            cmdb.arg(c);
        } else {
            // cmd.exe or another shell: /k keeps it open after the command.
            cmdb.arg("/k");
            cmdb.arg(c);
        }
    }
    cmdb.env("TERM", "xterm-256color");
    cmdb.env("COLORTERM", "truecolor");
    // Honor the requested cwd ("open terminal here", restored layouts); only
    // fall back to the home dir when it's absent or no longer a directory.
    let requested = cwd
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty() && std::path::Path::new(c).is_dir());
    if let Some(dir) = requested {
        cmdb.cwd(dir);
    } else if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        cmdb.cwd(home);
    }
    spawn_internal(app, &state, on_data, cmdb, cols, rows)
}

#[cfg(unix)]
#[tauri::command]
pub fn pty_spawn_terminal(
    app: AppHandle,
    state: State<PtyState>,
    on_data: Channel<String>,
    name: String,
    socket: Option<String>,
    label: Option<String>,
    cmd: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    // Guard against shell-injection via the pane-derived session name.
    let safe = |s: &str| {
        s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    };
    if name.is_empty() || !safe(&name) {
        return Err("invalid terminal name".into());
    }
    let tmux = tmux_bin();
    let sock = term_socket(socket);
    let session = format!("aios-term-{name}");
    // Single-quote for the outer `sh -c` so spaces/args survive.
    let sq = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    // `-n <label>` names the window = the human display label (datetime by
    // default); applied only on CREATE (`-A` reopen ignores it) and `-n` sets the
    // manual-rename flag so the shell can't auto-rename it. Empty → no flag.
    let nflag = label
        .as_deref()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|l| format!(" -n {}", sq(l)))
        .unwrap_or_default();
    // Optional start directory — `new-session -c <dir>`. Drives "run project"
    // (the command MUST execute in the project root, else `npm run`/`flutter run`
    // fail in $HOME and the pane exits). Only applied when the dir exists.
    let cdir = cwd
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty() && std::path::Path::new(c).is_dir())
        .map(|c| format!(" -c {}", sq(c)))
        .unwrap_or_default();
    // Build the optional startup command for `new-session`. tmux runs it via its
    // own default-shell, so a bare string like `claude` is fine; empty → login shell.
    let startup = cmd
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
        .unwrap_or_default();
    // `new-session -A -d` is atomic create-or-noop: it creates the session
    // detached if absent and is a harmless no-op (NOT a re-launch of `cmd`) if it
    // already exists. This replaces the old `has-session || new-session` pair,
    // whose gap before `attach` was a TOCTOU race — if the session wasn't present
    // at attach time tmux printed `can't find session: aios-term-<name>`. With
    // `-A` the session is GUARANTEED to exist before we attach, so that error
    // class is gone.
    let create = if startup.is_empty() {
        let login_shell = "exec ${SHELL:-/bin/zsh} -l";
        format!(
            "{tmux} -L {sock} new-session -A -d -s {session}{cdir}{nflag} {}",
            sq(login_shell)
        )
    } else {
        // Run the command, then drop to an interactive shell so the pane STAYS
        // ALIVE after the command finishes or errors (a VS Code-style run
        // terminal: logs remain, you can re-run) instead of the tmux session
        // dying the instant the command exits.
        let keepalive = format!(
            "exec ${{SHELL:-/bin/zsh}} -lc {}",
            sq(&format!("{startup}; exec ${{SHELL:-/bin/zsh}} -l"))
        );
        format!(
            "{tmux} -L {sock} new-session -A -d -s {session}{cdir}{nflag} {}",
            sq(&keepalive)
        )
    };
    let mut cmdb = CommandBuilder::new("/bin/sh");
    cmdb.arg("-c");
    // Ensure the session exists (atomic), enable mouse so the wheel scrolls inside
    // tmux (it owns the alt-screen, bypassing xterm's scrollback), then attach.
    // `exec` replaces the shell so closing the pane detaches the client — see
    // pty_kill. (Real tmux honors `attach -t`; only psmux on Windows needs the
    // `new-session -A -s` workaround.)
    cmdb.arg(format!(
        "{create} 2>/dev/null; \
         {tmux} -L {sock} set -g mouse on 2>/dev/null; \
         {tmux} -L {sock} set -g status-left-length 24 2>/dev/null; \
         {tmux} -L {sock} set -g status-left '[#W] ' 2>/dev/null; \
         exec {tmux} -L {sock} attach -t {session}"
    ));
    cmdb.env("TERM", "xterm-256color");
    cmdb.env("COLORTERM", "truecolor");
    spawn_internal(app, &state, on_data, cmdb, cols, rows)
}

/// Attaches a pane to ANY tmux session on a given socket — the all-tmux attach
/// surface (oracles, the bridge, even the session you're typing in now). `exec`
/// replaces the shell so closing the pane detaches the client without killing
/// the underlying session.
#[tauri::command]
pub fn pty_spawn_tmux(
    app: AppHandle,
    state: State<PtyState>,
    on_data: Channel<String>,
    socket: String,
    session: String,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    #[cfg(windows)]
    {
        // Guard against injection via socket/session names.
        let safe = |s: &str| {
            !s.is_empty()
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        };
        if !safe(&socket) || !safe(&session) {
            return Err("invalid socket or session name".into());
        }
        let Some(psmux) = resolve_mux(&app) else {
            return Err("tmux attach needs psmux on Windows — install it (winget install psmux) or it ships bundled".into());
        };
        // The session is created elsewhere — confirm it EXISTS before attaching, so
        // a typo/dead session errors instead of silently spawning an empty shell
        // (the `new-session -A` attach below would otherwise create one).
        if !run_mux_quiet(&psmux, &["-L", &socket, "has-session", "-t", &session]) {
            return Err(format!("no session '{session}' on socket '{socket}'"));
        }
        apply_mux_style(&psmux, &socket);
        // `new-session -A -s` (not `attach -t`): psmux's `attach -t` ignores its
        // target and joins the most-recently-active session. `-A` on an existing
        // session attaches to exactly the named one without disturbing it.
        let mut cmd = CommandBuilder::new(&psmux);
        for a in ["-L", &socket, "new-session", "-A", "-s"] {
            cmd.arg(a);
        }
        cmd.arg(&session);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        spawn_internal(app, &state, on_data, cmd, cols, rows)
    }
    #[cfg(not(windows))]
    {
        // Guard against shell-injection via socket/session names.
        let safe = |s: &str| {
            s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        };
        if !safe(&socket) || !safe(&session) {
            return Err("invalid socket or session name".into());
        }
        let tmux = tmux_bin();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg(format!(
            "{tmux} -L {socket} set -g mouse on 2>/dev/null; \
             {tmux} -L {socket} set -g status-left-length 24 2>/dev/null; \
             {tmux} -L {socket} set -g status-left '[#W] ' 2>/dev/null; \
             exec {tmux} -L {socket} attach -t {session}"
        ));
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        spawn_internal(app, &state, on_data, cmd, cols, rows)
    }
}

/// Writes raw input bytes to a session's PTY stdin. Errs on a dead/unknown
/// session (instead of the old silent-Ok black hole) so the frontend gets a
/// real signal when a write lands after the child exited.
#[tauri::command]
pub fn pty_write(state: State<PtyState>, id: u32, data: String) -> Result<(), String> {
    let session = state.sessions.lock().get(&id).cloned();
    let Some(s) = session else {
        return Err(format!("pty session {id} is dead or unknown"));
    };
    let mut w = s.writer.lock();
    w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Bracketed-paste write (wave-1C, ported from upstream@64899fe): wraps
/// `text` in `ESC[200~ … ESC[201~` so a multiline paste arrives at the app as
/// ONE atomic paste instead of N typed lines — replacing the frontend's chunked
/// write timer hacks. Safe for every pane we spawn: tmux-backed panes parse the
/// markers themselves; raw zsh/bash/fish shells enable bracketed paste by
/// default. Errs on a dead/unknown session like pty_write.
#[tauri::command]
pub fn pty_paste(state: State<PtyState>, id: u32, text: String) -> Result<(), String> {
    let session = state.sessions.lock().get(&id).cloned();
    let Some(s) = session else {
        return Err(format!("pty session {id} is dead or unknown"));
    };
    // Paste-breakout guard: an embedded end-marker would terminate the bracket
    // early and let the remainder of the text execute as typed keystrokes.
    let sanitized = text.replace("\x1b[201~", "");
    let mut w = s.writer.lock();
    w.write_all(b"\x1b[200~").map_err(|e| e.to_string())?;
    w.write_all(sanitized.as_bytes()).map_err(|e| e.to_string())?;
    w.write_all(b"\x1b[201~").map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Propagates a terminal resize to a session's PTY.
#[tauri::command]
pub fn pty_resize(state: State<PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let session = state.sessions.lock().get(&id).cloned();
    if let Some(s) = session {
        s.master
            .lock()
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Kills a session: removes it from the registry and terminates the child.
///
/// For any tmux-backed pane (oracle, all-tmux, OR a persistent terminal spawned
/// via `pty_spawn_terminal`) the child PTY runs the `tmux attach` process, not
/// the tmux session itself — so killing it merely DETACHES the client. Closing
/// the pane = detach; the `aios-term-*` (or `aios-*`) session keeps running on
/// the tmux daemon and is reattachable later. The session only dies when its own
/// process exits or someone explicitly `kill-session`s it.
#[tauri::command]
pub fn pty_kill(state: State<PtyState>, id: u32) -> Result<(), String> {
    let removed = state.sessions.lock().remove(&id);
    if let Some(s) = removed {
        let _ = s.child.lock().kill();
    }
    Ok(())
}

/// Renames a session's friendly DISPLAY label (what the status bar shows + the
/// reattach list lists). We rename the session's window — the session NAME stays
/// the stable `aios-term-<key>` so workspace-restore reattach still works. The
/// label survives detach/reattach (it lives on the multiplexer server).
#[tauri::command]
pub fn pty_set_label(
    app: AppHandle,
    socket: Option<String>,
    session: String,
    label: String,
) -> Result<(), String> {
    let sock = term_socket(socket);
    let safe = !session.is_empty()
        && session
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if !safe {
        return Err("invalid session name".into());
    }
    // The label is passed as a single argv (no shell), so spaces/colons are fine;
    // just trim, cap length, and strip control chars.
    let label: String = label.trim().chars().filter(|c| !c.is_control()).take(48).collect();
    if label.is_empty() {
        return Err("label is empty".into());
    }
    let bin = resolve_mux(&app).ok_or("no multiplexer found")?;
    if run_mux_quiet(&bin, &["-L", &sock, "rename-window", "-t", &session, &label]) {
        Ok(())
    } else {
        Err("rename failed — is the session still running?".into())
    }
}

/// Startup reaper (B2): kills orphaned `aios-term-*` tmux sessions on the oracle
/// socket that have NO corresponding restored pane. Without this, B1's old
/// new-key-every-launch behaviour (now fixed) plus normal pane churn leaves
/// zombie sessions — often a `claude` still burning context — accumulating
/// forever (`pty_kill` only detaches the attach client; nothing ever
/// kill-sessions them).
///
/// `keep` is the set of `aios-term-<name>` SESSION SUFFIXES that map to live
/// restored panes (the frontend passes each pane's `termSessionName`). We list
/// every `aios-term-*` session and `kill-session` only those NOT in `keep` —
/// conservative by design: an unknown session is reaped only when it provably
/// has no pane. Non-unix / no-tmux → no-op. Returns the names reaped.
#[tauri::command]
pub fn pty_reap_terminals(keep: Vec<String>, socket: Option<String>) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        let _ = (keep, socket);
        Ok(Vec::new())
    }
    #[cfg(not(windows))]
    {
        use std::collections::HashSet;
        let tmux = tmux_bin();
        let sock = term_socket(socket);
        // The full session names we must preserve, e.g. `aios-term-k3-abcd`.
        let keep: HashSet<String> = keep
            .into_iter()
            .map(|n| format!("aios-term-{n}"))
            .collect();
        let output = std::process::Command::new(&tmux)
            .args(["-L", &sock, "list-sessions", "-F", "#{session_name}"])
            .output()
            .map_err(|e| format!("failed to run tmux: {e}"))?;
        // No server / no sessions → tmux exits non-zero; treat as "nothing to do".
        if !output.status.success() {
            return Ok(Vec::new());
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut reaped = Vec::new();
        for line in stdout.lines() {
            let name = line.trim();
            if name.is_empty() || !name.starts_with("aios-term-") {
                continue;
            }
            if keep.contains(name) {
                continue; // has a live pane → leave it running
            }
            let killed = std::process::Command::new(&tmux)
                .args(["-L", &sock, "kill-session", "-t", name])
                .output();
            if matches!(killed, Ok(o) if o.status.success()) {
                reaped.push(name.to_string());
            }
        }
        Ok(reaped)
    }
}
