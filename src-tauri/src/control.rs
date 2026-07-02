//! AIOS Control Plane transport (Tier 2) — a localhost-only HTTP server that lets
//! an external agent drive the running app. Each POSTed command is forwarded to
//! the webview via `app.emit("aios://control", …)`, where `App.tsx`'s
//! `dispatchControl` runs it through the SAME closures the UI uses ("external ==
//! UI"). The command vocabulary + routing live in `src/lib/control.ts`.
//!
//! **Request/response:** the server injects a correlation `id`, emits the command,
//! and waits (≤5s) for the webview to `emit("aios://control-reply", {id, …})`,
//! which it returns as the HTTP body. So READS (`pane.list`/`state.get`) return
//! real data, and writes echo the new pane list — the agent stays in sync in one
//! round-trip.
//!
//! Security: **off by default**. Two gates:
//!   1. A runtime enable flag (`ENABLED`) flipped by **Settings → general → agent
//!      control** (or `AIOS_CONTROL=1` to force it on at boot for dev/headless).
//!      The choice persists in `~/.aios/control-enabled` so it survives restarts
//!      (Rust can't read the webview's localStorage — that file is the source of
//!      truth). Enabling lazily starts the server, so the toggle needs no restart;
//!      while disabled every request is refused with 403.
//!   2. Bind **127.0.0.1 only** + a 256-bit `X-AIOS-Token` (OS CSPRNG, in
//!      `~/.aios/control-token`). The ephemeral port is advertised in
//!      `~/.aios/control-port` so a client (the `aios-control` MCP / curl / the
//!      WhatsApp bridge) can discover it.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Listener};

/// In-flight requests awaiting a webview reply, keyed by correlation id.
type Pending = Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>>;

/// Runtime on/off gate, shared with the request loop. The single source of truth
/// for "is control allowed right now" — flipped by the Settings toggle. Lazily
/// created so the getter is always safe to call.
static ENABLED: OnceLock<Arc<AtomicBool>> = OnceLock::new();
/// Whether the listener thread has been spawned (idempotent-start guard).
static STARTED: AtomicBool = AtomicBool::new(false);
/// The bound port (0 until the listener binds) — surfaced to the Settings UI.
static PORT: AtomicU16 = AtomicU16::new(0);

fn enabled_flag() -> &'static Arc<AtomicBool> {
    ENABLED.get_or_init(|| Arc::new(AtomicBool::new(false)))
}

/// `~/.aios` (HOME, or USERPROFILE on Windows — the app aliases HOME to it at
/// startup, but read both so the server works regardless of launch context).
fn aios_home() -> Option<PathBuf> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(|h| PathBuf::from(h).join(".aios"))
}

/// A 256-bit bearer token from the OS CSPRNG (getrandom), hex-encoded. Falls back
/// to a time/pid mix ONLY if the OS RNG is somehow unavailable, so the server
/// still starts rather than failing closed on a non-security-critical path.
fn gen_token() -> String {
    let mut buf = [0u8; 32];
    if getrandom::getrandom(&mut buf).is_ok() {
        let mut s = String::with_capacity(64);
        for b in buf {
            s.push_str(&format!("{b:02x}"));
        }
        return s;
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(1);
    let pid = std::process::id() as u128;
    let mix = nanos ^ pid.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ nanos.rotate_left(32);
    format!("{:032x}{:08x}", mix, std::process::id())
}

fn read_or_create_token(dir: &PathBuf) -> std::io::Result<String> {
    let path = dir.join("control-token");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let t = existing.trim().to_string();
        if !t.is_empty() {
            return Ok(t);
        }
    }
    let token = gen_token();
    std::fs::write(&path, &token)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(token)
}

/// Monotonic-ish correlation id (time + counter) — unique per request so replies
/// can't cross-talk.
fn next_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros())
        .unwrap_or(0);
    format!("ctl-{t:x}-{n:x}")
}

/// Persisted enable intent — survives restarts (the cross-launch source of truth,
/// since Rust can't read the webview's localStorage).
fn enabled_file(dir: &PathBuf) -> PathBuf {
    dir.join("control-enabled")
}
fn persist_enabled(on: bool) {
    if let Some(dir) = aios_home() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(enabled_file(&dir), if on { "1" } else { "0" });
    }
}
fn read_persisted_enabled() -> bool {
    aios_home()
        .and_then(|dir| std::fs::read_to_string(enabled_file(&dir)).ok())
        .map(|s| s.trim() == "1")
        .unwrap_or(false)
}
/// `AIOS_CONTROL=1` forces control on at boot (dev/headless override).
fn env_enabled() -> bool {
    std::env::var("AIOS_CONTROL")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Spawn the listener thread ONCE (idempotent). Binds localhost, writes the
/// token + port discovery files, registers the reply-correlation listener, and
/// serves `POST /control` — but every request is gated on `enabled_flag()`, so a
/// disabled server refuses with 403 without ever touching the app.
fn ensure_started(app: AppHandle) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return; // already running
    }
    let Some(dir) = aios_home() else {
        eprintln!("[control] no HOME/USERPROFILE — control server disabled");
        STARTED.store(false, Ordering::SeqCst);
        return;
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("[control] cannot create {}: {e}", dir.display());
        STARTED.store(false, Ordering::SeqCst);
        return;
    }
    let token = match read_or_create_token(&dir) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[control] token error: {e}");
            STARTED.store(false, Ordering::SeqCst);
            return;
        }
    };

    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));

    // Reply correlation: the webview emits `aios://control-reply` with {id, …};
    // match the id to the waiting request and hand it the result.
    let pending_reply = pending.clone();
    app.listen_any("aios://control-reply", move |event| {
        let Ok(reply) = serde_json::from_str::<Value>(event.payload()) else {
            return;
        };
        let Some(id) = reply.get("id").and_then(|i| i.as_str()) else {
            return;
        };
        let tx = pending_reply.lock().ok().and_then(|mut m| m.remove(id));
        if let Some(tx) = tx {
            let _ = tx.send(reply);
        }
    });

    let gate = enabled_flag().clone();
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http("127.0.0.1:0") {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[control] bind failed: {e}");
                STARTED.store(false, Ordering::SeqCst);
                return;
            }
        };
        let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
        PORT.store(port, Ordering::Relaxed);
        let _ = std::fs::write(dir.join("control-port"), port.to_string());
        eprintln!("[control] listening on 127.0.0.1:{port} — POST /control (X-AIOS-Token)");

        for mut request in server.incoming_requests() {
            if *request.method() != tiny_http::Method::Post || request.url() != "/control" {
                let _ = request
                    .respond(tiny_http::Response::from_string("not found").with_status_code(404));
                continue;
            }
            // Gate 1: runtime enable flag (Settings toggle). Refuse loudly while off.
            if !gate.load(Ordering::Relaxed) {
                let _ = request.respond(
                    tiny_http::Response::from_string(
                        r#"{"ok":false,"error":"control disabled — enable it in AIOS Settings → general → agent control"}"#,
                    )
                    .with_status_code(403),
                );
                continue;
            }
            // Gate 2: bearer token.
            let authed = request
                .headers()
                .iter()
                .any(|h| h.field.equiv("X-AIOS-Token") && h.value.as_str() == token);
            if !authed {
                let _ = request.respond(
                    tiny_http::Response::from_string("unauthorized").with_status_code(401),
                );
                continue;
            }
            let mut body = String::new();
            if std::io::Read::read_to_string(request.as_reader(), &mut body).is_err() {
                let _ = request
                    .respond(tiny_http::Response::from_string("bad body").with_status_code(400));
                continue;
            }
            let mut cmd = match serde_json::from_str::<Value>(&body) {
                Ok(v) => v,
                Err(e) => {
                    let _ = request.respond(
                        tiny_http::Response::from_string(format!("bad json: {e}"))
                            .with_status_code(400),
                    );
                    continue;
                }
            };
            let Some(obj) = cmd.as_object_mut() else {
                let _ = request.respond(
                    tiny_http::Response::from_string(r#"{"ok":false,"error":"body must be a JSON object"}"#)
                        .with_status_code(400),
                );
                continue;
            };

            // inject a server-side correlation id (overriding any client one) and
            // register a one-shot channel before emitting, so a fast reply can't race.
            let id = next_id();
            obj.insert("id".into(), json!(id));
            let (tx, rx) = mpsc::channel::<Value>();
            if let Ok(mut map) = pending.lock() {
                map.insert(id.clone(), tx);
            }

            if let Err(e) = app.emit("aios://control", cmd) {
                if let Ok(mut map) = pending.lock() {
                    map.remove(&id);
                }
                let _ = request.respond(
                    tiny_http::Response::from_string(format!(r#"{{"ok":false,"error":"emit failed: {e}"}}"#))
                        .with_status_code(500),
                );
                continue;
            }

            let resp = match rx.recv_timeout(Duration::from_secs(5)) {
                Ok(mut reply) => {
                    // strip the internal id; clients only care about ok/result/error.
                    if let Some(m) = reply.as_object_mut() {
                        m.remove("id");
                    }
                    tiny_http::Response::from_string(reply.to_string()).with_status_code(200)
                }
                Err(_) => {
                    if let Ok(mut map) = pending.lock() {
                        map.remove(&id);
                    }
                    tiny_http::Response::from_string(
                        r#"{"ok":false,"error":"timed out waiting for the app (is a window open?)"}"#,
                    )
                    .with_status_code(504)
                }
            };
            let _ = request.respond(resp);
        }
    });
}

/// Boot entry (called from `lib.rs` setup). Starts the server only if control was
/// left enabled (persisted) or forced on via `AIOS_CONTROL=1` — otherwise NOTHING
/// binds (no port, no files) until the user flips the Settings toggle, which
/// lazily starts it.
pub fn start_control_server(app: AppHandle) {
    let on = env_enabled() || read_persisted_enabled();
    if on {
        enabled_flag().store(true, Ordering::Relaxed);
        // a one-time AIOS_CONTROL=1 also persists, so the choice sticks.
        if env_enabled() {
            persist_enabled(true);
        }
        ensure_started(app);
    }
}

/// Control-plane state for the Settings UI.
#[derive(serde::Serialize)]
pub struct ControlStatus {
    enabled: bool,
    running: bool,
    port: u16,
}

/// Read the current control-plane state (Settings → agent control).
#[tauri::command]
pub fn aios_control_status() -> ControlStatus {
    ControlStatus {
        enabled: ENABLED.get().map(|f| f.load(Ordering::Relaxed)).unwrap_or(false),
        running: STARTED.load(Ordering::Relaxed),
        port: PORT.load(Ordering::Relaxed),
    }
}

/// Flip the control plane on/off from Settings. Enabling lazily starts the
/// localhost server (no restart needed); the choice is persisted across launches.
#[tauri::command]
pub fn aios_set_control(app: AppHandle, on: bool) -> ControlStatus {
    persist_enabled(on);
    enabled_flag().store(on, Ordering::Relaxed);
    if on {
        ensure_started(app);
    }
    aios_control_status()
}
