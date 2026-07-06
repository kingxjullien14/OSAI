//! Stone & Chisel client (Notes × S&C epic, N1 — misc/PLAN-notes-stone-chisel.md).
//!
//! The NotesPane is a native client of the owner's S&C notes app: this module
//! holds the credential + the HTTP path. The access token (minted in S&C's
//! account dialog → "Connected apps") lives in the OS keychain — same rule as
//! apikeys.rs, never in localStorage or the settings blob. The base URL lives
//! in `~/.aios/snc.json` so the control plane (N3) can reach notes without a
//! webview in the loop.
//!
//! Command surface is deliberately small: status / configure / disconnect plus
//! ONE generic `snc_fetch(method, path, body)`. Doc/folder typing lives in
//! `src/lib/snc.ts` where the UI needs it; Rust just moves authenticated JSON.

use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;

use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "aios-snc";
const ACCOUNT: &str = "token";
pub const DEFAULT_BASE_URL: &str = "https://stone-n-chisel.vercel.app";

fn config_path() -> Option<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(PathBuf::from(home).join(".aios").join("snc.json"))
}

fn read_base_url() -> String {
    config_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| {
            v.get("baseUrl")
                .and_then(|b| b.as_str())
                .map(str::to_string)
        })
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
}

fn write_base_url(base: &str) -> Result<(), String> {
    let path = config_path().ok_or("no home directory")?;
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let body = serde_json::to_string_pretty(&json!({ "baseUrl": base }))
        .map_err(|e| format!("serialize config: {e}"))?;
    std::fs::write(&path, body).map_err(|e| format!("write {}: {e}", path.display()))
}

fn token_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("keychain unavailable: {e}"))
}

fn token() -> Option<String> {
    token_entry()
        .ok()?
        .get_password()
        .ok()
        .filter(|t| !t.trim().is_empty())
}

fn http() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new())
}

/// One authenticated round-trip. Transport/config problems are `Err`; every
/// HTTP status (including 401/404/409) flows through as `(status, body)` so
/// callers can act on them — the 409 body carries the live doc for the
/// three-way merge (D6).
pub fn call(method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
    let tok = token().ok_or_else(|| NOT_CONNECTED.to_string())?;
    call_with(&read_base_url(), &tok, method, path, body)
}

pub const NOT_CONNECTED: &str = "not connected: no Stone & Chisel token stored";

fn call_with(
    base: &str,
    tok: &str,
    method: &str,
    path: &str,
    body: Option<&Value>,
) -> Result<(u16, Value), String> {
    // Everything real lives under /api/ — anything else is a caller bug, not
    // something to forward with a credential attached.
    if !path.starts_with("/api/") {
        return Err(format!("refusing non-API path {path:?}"));
    }
    let url = format!("{base}{path}");
    let client = http();
    let req = match method {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        other => return Err(format!("unsupported method {other:?}")),
    };
    let mut req = req.header("Authorization", format!("Bearer {tok}"));
    if let Some(b) = body {
        req = req.json(b);
    }
    let resp = req.send().map_err(|e| format!("network: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().unwrap_or_default();
    let data = if text.is_empty() {
        Value::Null
    } else {
        // Vercel error pages are HTML — surface them as a string rather than
        // failing the whole call.
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    };
    Ok((status, data))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SncStatus {
    pub base_url: String,
    pub has_token: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SncResponse {
    pub status: u16,
    pub data: Value,
}

/// Connection state for the pane's connect card. Never returns the token.
#[tauri::command]
pub fn snc_status() -> SncStatus {
    SncStatus {
        base_url: read_base_url(),
        has_token: token().is_some(),
    }
}

/// Store the base URL and/or token — but only after a LIVE verify against the
/// server (GET /api/folders with the candidate credentials), so a typo'd token
/// is rejected at paste time instead of surfacing as a broken pane later.
/// Omitted fields keep their current value.
#[tauri::command]
pub fn snc_configure(base_url: Option<String>, token: Option<String>) -> Result<SncStatus, String> {
    let base = base_url
        .map(|b| b.trim().trim_end_matches('/').to_string())
        .filter(|b| !b.is_empty())
        .unwrap_or_else(read_base_url);
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err(format!("base URL must be http(s): {base:?}"));
    }

    let tok = match token.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
        Some(t) => t,
        None => self::token().ok_or("no token provided and none stored yet")?,
    };

    match call_with(&base, &tok, "GET", "/api/folders", None) {
        Ok((200, _)) => {}
        Ok((401, _)) => return Err("Stone & Chisel rejected the token (401) — re-check it, or mint a new one in Account → Connected apps".into()),
        Ok((status, _)) => return Err(format!("unexpected response from {base}: HTTP {status}")),
        Err(e) => return Err(e),
    }

    write_base_url(&base)?;
    token_entry()?
        .set_password(&tok)
        .map_err(|e| format!("failed to store token: {e}"))?;
    Ok(snc_status())
}

/// Forget the token (keychain) — the base URL file stays, it isn't a secret.
/// Missing token is success (idempotent).
#[tauri::command]
pub fn snc_disconnect() -> Result<(), String> {
    match token_entry()?.delete_password() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(format!("failed to delete token: {e}")),
    }
}

/// Generic authenticated call for the pane + palette: the typed doc/folder
/// shapes live in TS. Method allowlist + /api/ prefix enforced in `call`.
#[tauri::command]
pub fn snc_fetch(
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<SncResponse, String> {
    let (status, data) = call(&method, &path, body.as_ref())?;
    Ok(SncResponse { status, data })
}
