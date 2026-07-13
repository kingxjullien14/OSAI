//! Durable, append-only, full-fidelity chat history store (OSAI-owned).
//!
//! Plan: `misc/PLAN-chatpane-history-and-navigation.md` §2 (phase P1).
//!
//! Every chat session's normalized event stream is mirrored to
//! `~/.osai/state/chat-history/<engineSessionId>/events.jsonl` as it streams —
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

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
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
    /// Lines (with their write-time ms) recorded before the id landed, flushed
    /// in order on `set_id`.
    pending: Vec<(u64, String)>,
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
        for (ts, line) in pending {
            self.write(&line, ts);
        }
    }

    /// Append one normalized (claude-shaped) event line. Skips partial token
    /// deltas. Before the id is known the line is held (capped) and flushed later
    /// by `set_id`.
    pub fn record(&mut self, line: &str) {
        if line.contains("\"type\":\"stream_event\"") {
            return;
        }
        let ts = now_ms();
        if self.file.is_some() {
            self.write(line, ts);
        } else if self.pending.len() < PENDING_CAP {
            self.pending.push((ts, line.to_string()));
        }
    }

    fn write(&mut self, line: &str, ts_ms: u64) {
        if let Some(file) = self.file.as_mut() {
            // one JSON object per row — strip any stray CR/LF so the row stays valid.
            let trimmed = line.trim_end_matches(|c| c == '\n' || c == '\r');
            // stamp a write-time `_ts` (ms) so replay can show hover times and the
            // P6 scrubber can map time→turn. Stays a valid event (extra field,
            // ignored by the reducers); an unparseable line is stored raw.
            let stamped = match serde_json::from_str::<Value>(trimmed) {
                Ok(Value::Object(mut obj)) => {
                    obj.insert("_ts".to_string(), Value::from(ts_ms));
                    serde_json::to_string(&Value::Object(obj))
                        .unwrap_or_else(|_| trimmed.to_string())
                }
                _ => trimmed.to_string(),
            };
            let _ = file.write_all(stamped.as_bytes());
            let _ = file.write_all(b"\n");
        }
    }
}

/// `~/.osai/state/chat-history` — the store root (shared with the future reader +
/// history pane). Mirrors the path convention of `chat::sessions_store`.
pub fn history_root() -> Option<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(PathBuf::from(home).join(".osai/state/chat-history"))
}

/// `~/.osai/state/chat-history/<id>` for an already-sanitized id.
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
/// Returns an empty page when there's no OSAI-owned store for the id (a foreign
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

// ── history pane + management (P5) ───────────────────────────────────────────

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn write_json_atomic(path: &std::path::Path, json: &str) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, json).is_ok() {
        let _ = std::fs::rename(&tmp, path);
    }
}

// ── stars ────────────────────────────────────────────────────────────────────
fn stars_path() -> Option<PathBuf> {
    Some(history_root()?.join("stars.json"))
}
fn load_stars() -> HashSet<String> {
    stars_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .map(|v| v.into_iter().collect())
        .unwrap_or_default()
}
fn save_stars(stars: &HashSet<String>) {
    let Some(p) = stars_path() else { return };
    let list: Vec<&String> = stars.iter().collect();
    if let Ok(json) = serde_json::to_string(&list) {
        write_json_atomic(&p, &json);
    }
}

#[tauri::command]
pub fn set_starred(id: String, starred: bool) {
    let Some(safe) = safe_id(&id) else { return };
    let mut stars = load_stars();
    let changed = if starred {
        stars.insert(safe)
    } else {
        stars.remove(&safe)
    };
    if changed {
        save_stars(&stars);
    }
}

// ── trash (soft-delete, recoverable) ─────────────────────────────────────────
#[derive(Serialize, Deserialize)]
struct TrashRecord {
    id: String,
    title: String,
    deleted_at: u64,
    /// The chat-sessions.json entry kept verbatim, so restore re-inserts it.
    entry: Value,
}

/// Slim view returned to the Trash UI (no raw index entry).
#[derive(Serialize)]
pub struct TrashEntry {
    pub id: String,
    pub title: String,
    pub deleted_at: u64,
}

fn trash_root() -> Option<PathBuf> {
    Some(history_root()?.join(".trash"))
}
fn trash_manifest_path() -> Option<PathBuf> {
    Some(trash_root()?.join("manifest.json"))
}
fn load_manifest() -> Vec<TrashRecord> {
    trash_manifest_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
fn save_manifest(recs: &[TrashRecord]) {
    let Some(p) = trash_manifest_path() else { return };
    if let Ok(json) = serde_json::to_string(recs) {
        write_json_atomic(&p, &json);
    }
}

// chat-sessions.json (the /resume index, owned by chat.rs) — manipulated here as
// generic JSON so delete/restore stay decoupled from the typed struct.
fn sessions_index_path() -> Option<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(PathBuf::from(home).join(".osai/state/chat-sessions.json"))
}
fn load_sessions_index() -> Vec<Value> {
    sessions_index_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Vec<Value>>(&s).ok())
        .unwrap_or_default()
}
fn save_sessions_index(entries: &[Value]) {
    let Some(p) = sessions_index_path() else { return };
    if let Ok(json) = serde_json::to_string(entries) {
        write_json_atomic(&p, &json);
    }
}

fn move_to_trash(id: &str) {
    let Some(safe) = safe_id(id) else { return };
    let (Some(src), Some(troot)) = (history_session_dir(&safe), trash_root()) else {
        return;
    };
    if !src.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(&troot);
    let dst = troot.join(&safe);
    let _ = std::fs::remove_dir_all(&dst); // clear any stale copy first
    let _ = std::fs::rename(&src, &dst);
}

fn restore_from_trash(id: &str) {
    let Some(safe) = safe_id(id) else { return };
    let (Some(dst), Some(troot)) = (history_session_dir(&safe), trash_root()) else {
        return;
    };
    let src = troot.join(&safe);
    if src.exists() {
        let _ = std::fs::rename(&src, &dst);
    }
}

/// One row in the History pane: the /resume index entry + a `starred` flag.
/// Counts/cost are loaded lazily per-row via `chat_history_meta`.
#[derive(Serialize)]
pub struct HistoryEntry {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub mtime: u64,
    pub engine: String,
    pub model: String,
    pub last_user: String,
    pub starred: bool,
}

/// The browsable history = the /resume index MINUS trashed ids, + starred flag.
#[tauri::command]
pub fn list_chat_history(limit: Option<u32>) -> Vec<HistoryEntry> {
    let sessions = crate::chat::list_chat_sessions(limit);
    let stars = load_stars();
    let trashed: HashSet<String> = load_manifest().into_iter().map(|r| r.id).collect();
    sessions
        .into_iter()
        .filter(|s| !trashed.contains(&s.id))
        .map(|s| HistoryEntry {
            starred: stars.contains(&s.id),
            id: s.id,
            title: s.title,
            cwd: s.cwd,
            mtime: s.mtime,
            engine: s.engine,
            model: s.model,
            last_user: s.last_user,
        })
        .collect()
}

/// Soft-delete: pull each id out of the /resume index (so it leaves history AND
/// the /resume picker), move its durable store under `.trash/`, and record the
/// index entry in the manifest so a restore is exact. Un-stars them too.
#[tauri::command]
pub fn delete_chats(ids: Vec<String>) {
    if ids.is_empty() {
        return;
    }
    // Serialize with every other chat-sessions.json writer (record/rename/fork) so
    // a concurrent upsert can't clobber the index right as we rewrite it here.
    crate::chat::with_store_lock(|| delete_chats_locked(ids));
}

fn delete_chats_locked(ids: Vec<String>) {
    let id_set: HashSet<String> = ids.iter().cloned().collect();
    let mut manifest = load_manifest();
    let already: HashSet<String> = manifest.iter().map(|r| r.id.clone()).collect();
    let now = now_secs();
    let mut kept: Vec<Value> = Vec::new();
    // ids actually handled this run (already-trashed or pulled from the index), so
    // we know which requested ids exist ONLY as discovered sessions (codex rollouts
    // aren't in chat-sessions.json) and must still be trashed to disappear.
    let mut handled: HashSet<String> = already.clone();
    for entry in load_sessions_index() {
        let eid = entry
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if id_set.contains(&eid) {
            if !handled.contains(&eid) {
                let title = entry
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                move_to_trash(&eid);
                manifest.push(TrashRecord {
                    id: eid.clone(),
                    title,
                    deleted_at: now,
                    entry,
                });
                handled.insert(eid);
            }
        } else {
            kept.push(entry);
        }
    }
    // Discovered-only sessions (e.g. a codex rollout never written to the index):
    // `list_chat_sessions` re-finds them on every list, so deleting the index entry
    // alone left them undeletable. Record a trash marker so `list_chat_history`
    // (which filters trashed ids) hides them. The codex rollout itself is left on
    // disk — we only hide it from OSAI history.
    for id in &ids {
        if !handled.contains(id) {
            move_to_trash(id); // no-op when there's no OSAI-owned store
            manifest.push(TrashRecord {
                id: id.clone(),
                title: String::new(),
                deleted_at: now,
                entry: Value::Null,
            });
            handled.insert(id.clone());
        }
    }
    save_sessions_index(&kept);
    save_manifest(&manifest);
    let mut stars = load_stars();
    if ids.iter().fold(false, |acc, id| stars.remove(id) || acc) {
        save_stars(&stars);
    }
}

/// Undo a soft-delete: move the stores back + re-insert the index entries.
#[tauri::command]
pub fn restore_chats(ids: Vec<String>) {
    if ids.is_empty() {
        return;
    }
    crate::chat::with_store_lock(|| restore_chats_locked(ids));
}

fn restore_chats_locked(ids: Vec<String>) {
    let id_set: HashSet<String> = ids.into_iter().collect();
    let mut manifest = load_manifest();
    let mut index = load_sessions_index();
    let existing: HashSet<String> = index
        .iter()
        .filter_map(|e| e.get("id").and_then(|v| v.as_str()).map(String::from))
        .collect();
    let mut restored: Vec<Value> = Vec::new();
    manifest.retain(|r| {
        if id_set.contains(&r.id) {
            restore_from_trash(&r.id);
            if !existing.contains(&r.id) {
                restored.push(r.entry.clone());
            }
            false
        } else {
            true
        }
    });
    index.extend(restored);
    index.sort_by(|a, b| {
        let ma = a.get("mtime").and_then(|v| v.as_u64()).unwrap_or(0);
        let mb = b.get("mtime").and_then(|v| v.as_u64()).unwrap_or(0);
        mb.cmp(&ma)
    });
    save_sessions_index(&index);
    save_manifest(&manifest);
}

/// Permanently purge trashed chats: the given ids, or ALL trash when `ids` is None.
#[tauri::command]
pub fn purge_trash(ids: Option<Vec<String>>) {
    let target: Option<HashSet<String>> = ids.map(|v| v.into_iter().collect());
    let mut manifest = load_manifest();
    manifest.retain(|r| {
        let purge = target.as_ref().map(|t| t.contains(&r.id)).unwrap_or(true);
        if purge {
            if let (Some(safe), Some(troot)) = (safe_id(&r.id), trash_root()) {
                let _ = std::fs::remove_dir_all(troot.join(&safe));
            }
            false
        } else {
            true
        }
    });
    save_manifest(&manifest);
}

#[tauri::command]
pub fn list_trash() -> Vec<TrashEntry> {
    let mut v: Vec<TrashEntry> = load_manifest()
        .into_iter()
        .map(|r| TrashEntry {
            id: r.id,
            title: r.title,
            deleted_at: r.deleted_at,
        })
        .collect();
    v.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    v
}

/// The user/assistant text of a stored event line (content is an array of blocks
/// or a raw string for synthetic messages).
fn message_text(v: &Value) -> String {
    let Some(content) = v.pointer("/message/content") else {
        return String::new();
    };
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    let mut out = String::new();
    if let Some(arr) = content.as_array() {
        for b in arr {
            if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                    out.push_str(t);
                }
            }
        }
    }
    out
}

/// Persist the conversation TREE sidecar (`tree.json`) for a session — branch
/// structure + each node's settled turn — so reopening a branched chat restores
/// the tree instead of replaying the LINEAR event log flat (Tier-4 branching).
#[tauri::command]
pub fn save_chat_tree(id: String, json: String) -> Result<(), String> {
    let Some(safe) = safe_id(&id) else {
        return Err("bad session id".into());
    };
    let Some(dir) = history_session_dir(&safe) else {
        return Err("no home dir".into());
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_json_atomic(&dir.join("tree.json"), &json);
    Ok(())
}

/// Read the tree sidecar (empty string when none → caller falls back to the log).
#[tauri::command]
pub fn load_chat_tree(id: String) -> String {
    let Some(safe) = safe_id(&id) else {
        return String::new();
    };
    let Some(dir) = history_session_dir(&safe) else {
        return String::new();
    };
    std::fs::read_to_string(dir.join("tree.json")).unwrap_or_default()
}

/// Map ONE durable event line to an API message `{role, content}` for resume — or
/// `None` if it isn't a user/assistant TEXT turn (results, tools, and synthetic
/// plumbing are skipped). Pure (string in → value out), so it's unit-testable and
/// the branching reconstruction can lean on it too.
pub fn line_to_api_message(line: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(line).ok()?;
    let role = match v.get("type").and_then(|t| t.as_str()) {
        Some("user") if v.get("isSynthetic").and_then(|b| b.as_bool()) != Some(true) => "user",
        Some("assistant") => "assistant",
        _ => return None,
    };
    let body = message_text(&v);
    if body.trim().is_empty() {
        return None;
    }
    Some(json!({ "role": role, "content": body }))
}

/// Rebuild the API-tier conversation `[{role, content}]` from a session's durable
/// log, in order — so a BYO-key chat RESUMES with full context (chat.rs
/// `start_api_session`). Empty when there's no OSAI-owned store for the id.
pub fn replay_api_messages(id: &str) -> Vec<Value> {
    let Some(safe) = safe_id(id) else {
        return Vec::new();
    };
    let Some(dir) = history_session_dir(&safe) else {
        return Vec::new();
    };
    let Ok(text) = std::fs::read_to_string(dir.join("events.jsonl")) else {
        return Vec::new();
    };
    text.lines().filter_map(line_to_api_message).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_to_api_message_maps_user_and_assistant_text() {
        let u = line_to_api_message(
            r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}"#,
        )
        .unwrap();
        assert_eq!(u["role"], "user");
        assert_eq!(u["content"], "hi");
        let a = line_to_api_message(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"yo"}]}}"#,
        )
        .unwrap();
        assert_eq!(a["role"], "assistant");
        assert_eq!(a["content"], "yo");
    }

    #[test]
    fn line_to_api_message_skips_plumbing() {
        assert!(line_to_api_message(r#"{"type":"result","subtype":"success"}"#).is_none());
        assert!(line_to_api_message(
            r#"{"type":"user","isSynthetic":true,"message":{"role":"user","content":[{"type":"text","text":"x"}]}}"#
        )
        .is_none());
        assert!(line_to_api_message(
            r#"{"type":"assistant","message":{"role":"assistant","content":[]}}"#
        )
        .is_none());
        assert!(line_to_api_message("not json at all").is_none());
    }
}

/// Export one chat from its durable log. `format`: "json" (raw event array) or
/// "md" (user/assistant prose). Empty string if there's no store for the id.
#[tauri::command]
pub fn export_chat(id: String, format: String) -> String {
    let Some(safe) = safe_id(&id) else {
        return String::new();
    };
    let Some(dir) = history_session_dir(&safe) else {
        return String::new();
    };
    let Ok(text) = std::fs::read_to_string(dir.join("events.jsonl")) else {
        return String::new();
    };
    if format == "json" {
        let arr: Vec<Value> = text
            .lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect();
        return serde_json::to_string_pretty(&arr).unwrap_or_default();
    }
    let mut out = String::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let role = match v.get("type").and_then(|t| t.as_str()) {
            Some("user") if v.get("isSynthetic").and_then(|b| b.as_bool()) != Some(true) => "You",
            Some("assistant") => "Assistant",
            _ => continue,
        };
        let body = message_text(&v);
        if !body.trim().is_empty() {
            out.push_str(&format!("**{role}:**\n\n{}\n\n", body.trim()));
        }
    }
    out
}

// ── cross-history search (P7) ────────────────────────────────────────────────

/// A chat whose message content matched a search — the row data (joined from the
/// /resume index) + a context snippet + total matching messages.
#[derive(Serialize)]
pub struct SearchHit {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub mtime: u64,
    pub engine: String,
    pub model: String,
    pub last_user: String,
    pub starred: bool,
    /// A short context window around the first match (… elided …).
    pub snippet: String,
    /// Total user/assistant messages in this chat that matched.
    pub matches: usize,
}

/// A ~140-char context window around the first occurrence of `q_lower` in `body`
/// (newlines flattened), char-safe with … elision.
fn make_snippet(body: &str, q_lower: &str) -> String {
    let body = body.replace(['\n', '\r'], " ");
    let lower = body.to_lowercase();
    let chars: Vec<char> = body.chars().collect();
    let char_idx = match lower.find(q_lower) {
        Some(bytepos) => lower[..bytepos].chars().count(),
        None => 0,
    };
    let start = char_idx.saturating_sub(50);
    let end = (char_idx + q_lower.chars().count() + 90).min(chars.len());
    let mut s = String::new();
    if start > 0 {
        s.push('…');
    }
    s.extend(&chars[start..end]);
    if end < chars.len() {
        s.push('…');
    }
    s
}

/// Full-text search over every durable log's user/assistant message content
/// (skips trashed chats + the JSON plumbing). Fast-rejects non-matching files,
/// then joins matches with the /resume index for the row data. Newest first.
#[tauri::command]
pub fn search_chat_history(query: String, limit: Option<u32>) -> Vec<SearchHit> {
    let q = query.trim().to_lowercase();
    if q.len() < 2 {
        return Vec::new();
    }
    let Some(root) = history_root() else {
        return Vec::new();
    };
    let trashed: HashSet<String> = load_manifest().into_iter().map(|r| r.id).collect();
    let stars = load_stars();
    let index = load_sessions_index();
    let mut hits: Vec<SearchHit> = Vec::new();
    let Ok(dirs) = std::fs::read_dir(&root) else {
        return Vec::new();
    };
    for dir in dirs.flatten() {
        if !dir.path().is_dir() {
            continue;
        }
        let Some(id) = dir.file_name().to_str().map(String::from) else {
            continue;
        };
        if id == ".trash" || trashed.contains(&id) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(dir.path().join("events.jsonl")) else {
            continue;
        };
        // fast reject before the per-line JSON parse
        if !text.to_lowercase().contains(&q) {
            continue;
        }
        let mut matches = 0usize;
        let mut snippet = String::new();
        for line in text.lines() {
            let Ok(v) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            let is_content = match v.get("type").and_then(|t| t.as_str()) {
                Some("user") => v.get("isSynthetic").and_then(|b| b.as_bool()) != Some(true),
                Some("assistant") => true,
                _ => false,
            };
            if !is_content {
                continue;
            }
            let body = message_text(&v);
            if body.to_lowercase().contains(&q) {
                matches += 1;
                if snippet.is_empty() {
                    snippet = make_snippet(&body, &q);
                }
            }
        }
        if matches == 0 {
            continue; // matched only in JSON keys / tool args, not real content
        }
        let entry = index
            .iter()
            .find(|e| e.get("id").and_then(|v| v.as_str()) == Some(id.as_str()));
        let field = |k: &str| {
            entry
                .and_then(|e| e.get(k))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        let title = {
            let t = field("title");
            if t.is_empty() {
                id.clone()
            } else {
                t
            }
        };
        hits.push(SearchHit {
            mtime: entry
                .and_then(|e| e.get("mtime"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            cwd: field("cwd"),
            engine: field("engine"),
            model: field("model"),
            last_user: field("last_user"),
            starred: stars.contains(&id),
            title,
            id,
            snippet,
            matches,
        });
    }
    hits.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    hits.truncate(limit.unwrap_or(50) as usize);
    hits
}
