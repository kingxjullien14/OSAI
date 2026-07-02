//! AIOS oracle roster + CRUD, and all-tmux discovery.
//!
//! Oracles are multiplexer sessions named `aios-<identity>` — long-lived agent
//! sessions (e.g. a `claude` running in its own tmux/psmux session) that the
//! cockpit can list, attach, create, rename and delete. They survive the app
//! closing and are reattachable, exactly like the persistent terminal panes.
//!
//! Cross-platform: `tmux` on unix, **psmux** on Windows (resolved via
//! `pty::resolve_mux`). On a machine with neither installed, every list command
//! simply returns empty — the graceful path for a fresh box.
//!
//! The socket is the same configurable namespace the terminals use (Settings →
//! "terminal socket", default `aios`), so oracles + terminals share one server;
//! `aios-term-*` sessions are filtered out of the oracle roster.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::pty::{resolve_mux, run_mux_quiet};

/// Default socket when the frontend doesn't pass one (matches the terminal
/// socket default). Sanitized + overridable per call from the user's setting.
const DEFAULT_SOCKET: &str = "aios";

/// Sanitizes the socket name from the optional frontend setting; falls back to
/// `DEFAULT_SOCKET`. Rejects shell-unsafe chars (flows into `-L <socket>`).
fn clean_socket(socket: Option<String>) -> String {
    socket
        .map(|s| s.trim().to_string())
        .filter(|s| {
            !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
        .unwrap_or_else(|| DEFAULT_SOCKET.to_string())
}

/// One oracle in the roster, surfaced to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct OracleInfo {
    /// Identity slug, e.g. `helper` (from session `aios-helper`).
    pub identity: String,
    /// Full session name, e.g. `aios-helper`.
    pub session: String,
    /// The socket this session lives on.
    pub socket: String,
    /// Human label from instances.json, falling back to the identity.
    pub display_name: String,
    /// Whether a client is currently attached to this session.
    pub attached: bool,
    /// Reserved for a future pinned/primary concept; always false now.
    pub is_master: bool,
    /// Whether the underlying session actually exists right now.
    pub running: bool,
}

/// A live multiplexer session on any socket — the all-sessions attach surface.
#[derive(Debug, Clone, Serialize)]
pub struct TmuxSession {
    pub socket: String,
    pub name: String,
    pub attached: bool,
    pub windows: u32,
    /// True when this session is an AIOS oracle (`aios-*`, not `aios-term-*`).
    pub is_oracle: bool,
    /// Friendly display label = the session's window name (set via `new-session
    /// -n` / `rename-window`). For `aios-term-*` it's the datetime/renamed label;
    /// for others it's the running program. Falls back to the name in the UI.
    pub label: String,
}

/// Shape of an entry in `~/.aios/instances.json` (optional display-name registry).
#[derive(Debug, Deserialize)]
struct Instance {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
}

/// Resolves a usable `tmux` binary on unix. GUI apps inherit a minimal PATH, so
/// prefer known Homebrew/system locations before falling back to bare `tmux`.
/// (Windows goes through `pty::resolve_mux` → psmux instead.)
#[cfg(not(windows))]
pub fn tmux_bin() -> String {
    #[cfg(unix)]
    {
        for candidate in ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"] {
            if std::path::Path::new(candidate).exists() {
                return candidate.to_string();
            }
        }
    }
    "tmux".to_string()
}

/// Lowercases + strips anything outside `[a-z0-9_-]` so identities map safely to
/// session names. Empty result is rejected by callers.
fn sanitize_identity(raw: &str) -> String {
    raw.trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

/// Reads the optional instance registry (`~/.aios/instances.json`); missing → empty.
fn read_instances() -> Vec<Instance> {
    let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) else {
        return Vec::new();
    };
    let path = std::path::PathBuf::from(home).join(".aios/instances.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<Instance>>(&text).unwrap_or_default()
}

/// Runs a multiplexer command on a socket, capturing stdout on success. No
/// console window on Windows. `None` binary (psmux/tmux not found) → Err.
fn mux_output(app: &AppHandle, socket: &str, args: &[&str]) -> Result<String, String> {
    let bin = resolve_mux(app).ok_or("no multiplexer found (install psmux/tmux)")?;
    let mut full = vec!["-L", socket];
    full.extend_from_slice(args);
    let mut cmd = std::process::Command::new(&bin);
    cmd.args(&full);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = cmd
        .output()
        .map_err(|e| format!("failed to run multiplexer: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Resolves an `aios-*` session's display name from the instance registry.
fn display_name_for(identity: &str, session: &str, instances: &[Instance]) -> String {
    instances
        .iter()
        .find(|i| {
            let id = i.id.to_lowercase();
            id == session.to_lowercase()
                || id == identity.to_lowercase()
                || i.name.to_lowercase() == identity.to_lowercase()
        })
        .map(|i| i.name.clone())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| identity.to_string())
}

/// Lists oracle sessions (`aios-<identity>`, excluding the shell's own
/// `aios-term-*` panes) on the configured socket. Empty when no server/sessions.
#[tauri::command]
pub fn list_oracles(app: AppHandle, socket: Option<String>) -> Result<Vec<OracleInfo>, String> {
    let sock = clean_socket(socket);
    let stdout = mux_output(
        &app,
        &sock,
        &["list-sessions", "-F", "#{session_name}|#{session_attached}"],
    )
    .unwrap_or_default();
    let instances = read_instances();
    let mut oracles: Vec<OracleInfo> = Vec::new();

    for line in stdout.lines() {
        let mut parts = line.splitn(2, '|');
        let session = parts.next().unwrap_or("").trim().to_string();
        let attached = parts.next().unwrap_or("0").trim() != "0";
        // Real oracles are `aios-<identity>`. EXCLUDE `aios-term-*` (persistent
        // terminal panes) — they'd otherwise leak in as cryptic roster entries.
        if !session.starts_with("aios-") || session.starts_with("aios-term-") {
            continue;
        }
        let identity = session.trim_start_matches("aios-").to_string();
        let display_name = display_name_for(&identity, &session, &instances);
        oracles.push(OracleInfo {
            socket: sock.clone(),
            is_master: false,
            running: true,
            identity,
            session,
            display_name,
            attached,
        });
    }

    // Flat list: attached first, then alphabetical.
    oracles.sort_by(|a, b| b.attached.cmp(&a.attached).then(a.identity.cmp(&b.identity)));
    Ok(oracles)
}

/// Lists EVERY live multiplexer session on the configured + default sockets —
/// the all-sessions attach surface. Absent server → simply skipped (no error).
#[tauri::command]
pub fn list_tmux_sessions(app: AppHandle, socket: Option<String>) -> Result<Vec<TmuxSession>, String> {
    let sock = clean_socket(socket);
    let mut sockets = vec![sock.clone(), "default".to_string()];
    sockets.dedup();
    let mut sessions = Vec::new();
    for socket in sockets {
        let out = match mux_output(
            &app,
            &socket,
            &[
                "list-sessions",
                "-F",
                // window_name LAST so any stray `|` in a label stays in that field.
                "#{session_name}|#{session_attached}|#{session_windows}|#{window_name}",
            ],
        ) {
            Ok(o) => o,
            Err(_) => continue,
        };
        for line in out.lines() {
            let mut p = line.splitn(4, '|');
            let name = p.next().unwrap_or("").trim().to_string();
            if name.is_empty() {
                continue;
            }
            let attached = p.next().unwrap_or("0").trim() != "0";
            let windows = p.next().unwrap_or("1").trim().parse().unwrap_or(1);
            let label = p.next().unwrap_or("").trim().to_string();
            let is_oracle =
                socket == sock && name.starts_with("aios-") && !name.starts_with("aios-term-");
            sessions.push(TmuxSession {
                socket: socket.clone(),
                name,
                attached,
                windows,
                is_oracle,
                label,
            });
        }
    }
    Ok(sessions)
}

/// Creates a new oracle: a detached session `aios-<identity>` on the socket,
/// running `command` (e.g. `claude`) if given, else a login shell. The session
/// stays alive after the command exits so logs remain and it's reattachable.
#[tauri::command]
pub fn create_oracle(
    app: AppHandle,
    identity: String,
    command: Option<String>,
    socket: Option<String>,
) -> Result<String, String> {
    let sock = clean_socket(socket);
    let id = sanitize_identity(&identity);
    if id.is_empty() {
        return Err("identity must contain letters or digits".into());
    }
    let session = format!("aios-{id}");
    // Refuse if it already exists.
    if run_mux_quiet(
        &resolve_mux(&app).ok_or("no multiplexer found (install psmux/tmux)")?,
        &["-L", &sock, "has-session", "-t", &session],
    ) {
        return Err(format!("oracle '{id}' already exists"));
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    let startup = command
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty());

    #[cfg(windows)]
    {
        // psmux: run the command in a shell that stays open after it exits, so the
        // oracle session survives and stays reattachable (matches the terminal path).
        let mut create: Vec<String> = vec![
            "new-session".into(),
            "-d".into(),
            "-s".into(),
            session.clone(),
            "-c".into(),
            home,
            // window name = the oracle identity, so the status bar + reattach list
            // show a friendly label (not the running program name).
            "-n".into(),
            id.clone(),
        ];
        if let Some(cmd) = &startup {
            create.push(crate::pty::windows_shell());
            create.push("-NoExit".into());
            create.push("-Command".into());
            create.push(cmd.clone());
        }
        let create_refs: Vec<&str> = std::iter::once("-L")
            .chain(std::iter::once(sock.as_str()))
            .chain(create.iter().map(String::as_str))
            .collect();
        if !run_mux_quiet(
            &resolve_mux(&app).ok_or("no multiplexer found")?,
            &create_refs,
        ) {
            return Err(format!("failed to create oracle '{id}'"));
        }
    }
    #[cfg(not(windows))]
    {
        mux_output(&app, &sock, &["new-session", "-d", "-s", &session, "-c", &home, "-n", &id])?;
        if let Some(cmd) = &startup {
            // Run the command via send-keys so it executes in the session's shell.
            mux_output(&app, &sock, &["send-keys", "-t", &session, cmd, "Enter"])?;
        }
    }
    Ok(session)
}

/// Renames an oracle session.
#[tauri::command]
pub fn rename_oracle(
    app: AppHandle,
    from: String,
    to: String,
    socket: Option<String>,
) -> Result<String, String> {
    let sock = clean_socket(socket);
    let from_id = sanitize_identity(&from);
    let to_id = sanitize_identity(&to);
    if to_id.is_empty() {
        return Err("new name must contain letters or digits".into());
    }
    let from_session = format!("aios-{from_id}");
    let to_session = format!("aios-{to_id}");
    if run_mux_quiet(
        &resolve_mux(&app).ok_or("no multiplexer found")?,
        &["-L", &sock, "has-session", "-t", &to_session],
    ) {
        return Err(format!("oracle '{to_id}' already exists"));
    }
    mux_output(&app, &sock, &["rename-session", "-t", &from_session, &to_session])?;
    Ok(to_session)
}

/// Appshot: captures the screen to a PNG and sends its path into an oracle's
/// session — the ⌘⌘ "screenshot → aios" flow. macOS only (uses `screencapture`).
/// No Enter is sent, so the user can add context first. Returns the saved path.
#[tauri::command]
pub fn appshot(app: AppHandle, identity: Option<String>, socket: Option<String>) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        let sock = clean_socket(socket.clone());
        // Explicit identity, else the first running oracle (no hardcoded default).
        let id = match identity.map(|i| sanitize_identity(&i)).filter(|i| !i.is_empty()) {
            Some(i) => i,
            None => list_oracles(app.clone(), socket)?
                .into_iter()
                .next()
                .map(|o| o.identity)
                .ok_or("no oracle to send the screenshot to")?,
        };
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let path = format!("/tmp/aios-shot-{ts}.png");
        let status = std::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", &path])
            .status()
            .map_err(|e| format!("screencapture failed: {e}"))?;
        if !status.success() {
            return Err("screencapture returned non-zero".into());
        }
        let session = format!("aios-{id}");
        let keys = format!("{path} ");
        let _ = mux_output(&app, &sock, &["send-keys", "-t", &session, "-l", &keys]);
        Ok(path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, identity, socket);
        Err("screenshot capture is only supported on macOS".into())
    }
}

/// Deletes (kills) an oracle session.
#[tauri::command]
pub fn delete_oracle(
    app: AppHandle,
    identity: String,
    force: Option<bool>,
    socket: Option<String>,
) -> Result<(), String> {
    let _ = force; // no protected oracle anymore — kept for frontend compatibility
    let sock = clean_socket(socket);
    let id = sanitize_identity(&identity);
    if id.is_empty() {
        return Err("invalid identity".into());
    }
    mux_output(&app, &sock, &["kill-session", "-t", &format!("aios-{id}")])?;
    Ok(())
}

/// Kills any session on a given socket — the all-sessions attach surface's
/// delete affordance.
#[tauri::command]
pub fn kill_tmux_session(app: AppHandle, socket: String, session: String) -> Result<(), String> {
    let socket = socket.trim();
    let session = session.trim();
    if socket.is_empty() || session.is_empty() {
        return Err("socket and session are required".into());
    }
    mux_output(&app, socket, &["kill-session", "-t", session])?;
    Ok(())
}
