//! Durable, append-only, full-fidelity chat history store (AIOS-owned).
//!
//! Plan: `misc/PLAN-chatpane-history-and-navigation.md` §2 (phase P1).
//!
//! Every chat session's normalized event stream is mirrored to
//! `~/.aios/state/chat-history/<engineSessionId>/events.jsonl` as it streams —
//! ONE settled event per line — independent of the engine's own transcript files
//! (which the engine may compact or prune). Both the rendered `Turn` list and the
//! `RunEvent` timeline replay from this single log through the SAME reducers the
//! live stream uses ("one code path, live + history").
//!
//! Written from `chat::ingest_line` (the choke point every engine's reader thread
//! funnels through) and `chat::chat_send` (the user's own turn, which goes to the
//! engine's stdin and is never echoed back as an event). Because the writer lives
//! on the reader thread, capture continues even after the pane is closed/detached.
//!
//! The partial `stream_event` token deltas are intentionally skipped: the settled
//! `assistant` / `user` / `result` events carry the full content and the reducer
//! coalesces deltas anyway, so persisting them would only bloat the log.

use serde::Serialize;
use serde_json::Value;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

/// How many lines we hold before the engine session id is known. The id lands on
/// the first event carrying a `session_id` (a beat after start), so this is
/// normally 0–2 lines; the cap only guards an engine that dies before sending one.
const PENDING_CAP: usize = 4096;

/// Per-session append-only writer. Held as `Mutex<HistoryLog>` on `ChatSession`.
pub struct HistoryLog {
    /// Engine session id (claude `session_id` / codex threadId) — the on-disk key.
    /// `None` until the first event reveals it.
    id: Option<String>,
    /// Append handle, opened once the id is known.
    file: Option<File>,
    /// Lines recorded before the id landed, flushed in order on `set_id`.
    pending: Vec<String>,
}

impl HistoryLog {
    pub fn new() -> Self {
        Self {
            id: None,
            file: None,
            pending: Vec::new(),
        }
    }

    /// Learn the engine session id (idempotent). Opens the log and flushes any
    /// lines buffered before the id was known. No-op once an id is set, or if the
    /// id isn't a safe single path segment.
    pub fn set_id(&mut self, id: &str) {
        if self.id.is_some() {
            return;
        }
        let Some(safe) = safe_id(id) else { return };
        self.file = open_log(&safe);
        self.id = Some(safe);
        let pending = std::mem::take(&mut self.pending);
        for line in pending {
            self.write(&line);
        }
    }

    /// Append one normalized (claude-shaped) event line. Skips partial token
    /// deltas. Before the id is known the line is held (capped) and flushed later
    /// by `set_id`.
    pub fn record(&mut self, line: &str) {
        if line.contains("\"type\":\"stream_event\"") {
            return;
        }
        if self.file.is_some() {
            self.write(line);
        } else if self.pending.len() < PENDING_CAP {
            self.pending.push(line.to_string());
        }
    }

    fn write(&mut self, line: &str) {
        if let Some(file) = self.file.as_mut() {
            // one JSON object per row — strip any stray CR/LF so the row stays valid.
            let trimmed = line.trim_end_matches(|c| c == '\n' || c == '\r');
            let _ = file.write_all(trimmed.as_bytes());
            let _ = file.write_all(b"\n");
        }
    }
}

/// `~/.aios/state/chat-history` — the store root (shared with the future reader +
/// history pane). Mirrors the path convention of `chat::sessions_store`.
pub fn history_root() -> Option<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(PathBuf::from(home).join(".aios/state/chat-history"))
}

/// `~/.aios/state/chat-history/<id>` for an already-sanitized id.
fn history_session_dir(id: &str) -> Option<PathBuf> {
    Some(history_root()?.join(id))
}

/// Opens (creating parents) the append-only `events.jsonl` for a session id.
fn open_log(id: &str) -> Option<File> {
    let dir = history_session_dir(id)?;
    std::fs::create_dir_all(&dir).ok()?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("events.jsonl"))
        .ok()
}

/// Accept only ids that are a single safe path segment (engine ids are uuids /
/// threadIds: alphanumerics + `-` `_`). Rejects empties and anything that could
/// traverse the filesystem. An unsupported id simply means no durable log for
/// that session (graceful — never a crash).
fn safe_id(id: &str) -> Option<String> {
    let id = id.trim();
    if id.is_empty() || id.len() > 128 {
        return None;
    }
    if id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Some(id.to_string())
    } else {
        None
    }
}

// ── read side (P1c) + on-demand metadata (P1b) ──────────────────────────────

/// One page of a session's durable event log. `lines` are the raw normalized
/// event rows (one JSON object each), in order, ready to replay through the
/// frontend's stream reducer.
#[derive(Serialize)]
pub struct ChatHistoryPage {
    /// Total settled-event lines on disk for this session.
    pub total: usize,
    /// 0-based index of the first returned line.
    pub from: usize,
    pub lines: Vec<String>,
}

/// Reads a session's durable log. `from_seq`/`limit` page it (omit both → all).
/// Returns an empty page when there's no AIOS-owned store for the id (a foreign
/// or pre-store chat) — the caller then falls back to the engine transcript.
#[tauri::command]
pub fn read_chat_history(
    id: String,
    from_seq: Option<usize>,
    limit: Option<usize>,
) -> ChatHistoryPage {
    let empty = || ChatHistoryPage {
        total: 0,
        from: 0,
        lines: Vec::new(),
    };
    let Some(safe) = safe_id(&id) else { return empty() };
    let Some(dir) = history_session_dir(&safe) else {
        return empty();
    };
    let Ok(text) = std::fs::read_to_string(dir.join("events.jsonl")) else {
        return empty();
    };
    let all: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let total = all.len();
    let from = from_seq.unwrap_or(0).min(total);
    let end = limit.map(|n| from.saturating_add(n).min(total)).unwrap_or(total);
    ChatHistoryPage {
        total,
        from,
        lines: all[from..end].iter().map(|s| s.to_string()).collect(),
    }
}

/// Cheap per-session metadata for the history pane (P5), computed on demand from
/// the log (the pane reads it for only the visible rows, so a full scan of those
/// small files is fine). Title/engine/model/cwd come from `chat-sessions.json`;
/// this carries the store-derived counts/cost the index lacks. Starred + segment
/// counts arrive with P5/P2.
#[derive(Serialize, Default)]
pub struct ChatHistoryMeta {
    /// True when a durable log exists for this id.
    pub exists: bool,
    pub message_count: usize,
    pub user_count: usize,
    pub assistant_count: usize,
    pub tool_count: usize,
    pub cost_usd: f64,
    pub byte_size: u64,
    /// Unix SECONDS, from the log file's create/modify time (best-effort — the
    /// rows carry no per-event stamp yet; that lands with the P6 scrubber).
    pub first_ts: Option<u64>,
    pub last_ts: Option<u64>,
}

#[tauri::command]
pub fn chat_history_meta(id: String) -> ChatHistoryMeta {
    let mut meta = ChatHistoryMeta::default();
    let Some(safe) = safe_id(&id) else { return meta };
    let Some(dir) = history_session_dir(&safe) else {
        return meta;
    };
    let path = dir.join("events.jsonl");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return meta;
    };
    meta.exists = true;
    if let Ok(m) = std::fs::metadata(&path) {
        meta.byte_size = m.len();
        let to_secs = |t: std::time::SystemTime| {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_secs())
        };
        meta.last_ts = m.modified().ok().and_then(to_secs);
        meta.first_ts = m.created().ok().and_then(to_secs).or(meta.last_ts);
    }
    let has_block = |v: &Value, kind: &str| -> bool {
        v.pointer("/message/content")
            .and_then(|c| c.as_array())
            .map(|a| {
                a.iter()
                    .any(|b| b.get("type").and_then(|t| t.as_str()) == Some(kind))
            })
            .unwrap_or(false)
    };
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        match v.get("type").and_then(|t| t.as_str()) {
            // a user TEXT turn (a tool_result-only "user" event is engine plumbing)
            Some("user") if !has_block(&v, "tool_result") => meta.user_count += 1,
            Some("assistant") => {
                if has_block(&v, "text") {
                    meta.assistant_count += 1;
                }
                if let Some(arr) = v.pointer("/message/content").and_then(|c| c.as_array()) {
                    meta.tool_count += arr
                        .iter()
                        .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
                        .count();
                }
            }
            Some("result") => {
                if let Some(c) = v.get("total_cost_usd").and_then(|x| x.as_f64()) {
                    meta.cost_usd += c;
                }
            }
            _ => {}
        }
    }
    meta.message_count = meta.user_count + meta.assistant_count;
    meta
}
