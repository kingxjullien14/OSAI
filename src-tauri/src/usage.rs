//! Usage stats for the account menu. Reads `~/.osai/state/usage.json`, which the
//! OSAI statusline hook refreshes on every claude-code tick (the ONLY source of
//! the real 5h/7d rate-limit %, surfaced by claude only via statusLine stdin).

use serde_json::{json, Value};
use std::io::Write;
use std::process::Stdio;

use crate::proc::NoWindow;

/// Treat the statusline file as live only when it was written recently —
/// an ancient snapshot showing up as today's windows is worse than no data.
/// 24h: generous because each window also self-describes via `resets_at`
/// (see `windowed` — an expired window zeroes itself).
pub(crate) fn fresh_enough(path: &str) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .map(|age| age.as_secs() < 24 * 3600)
        .unwrap_or(false)
}

/// A rate-limit window whose `resets_at` is already in the past has rolled
/// over — the snapshot's used% belongs to the PREVIOUS window. Report the
/// truth for now: 0% used, no pending reset. (User-reported: the 5h window
/// showed the old session's 78% with "resets now".)
pub(crate) fn windowed(pct: Option<f64>, resets_at: Option<i64>) -> (Option<f64>, Option<i64>) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    match resets_at {
        Some(t) if t <= now => (pct.map(|_| 0.0), None),
        _ => (pct, resets_at),
    }
}

/// Returns the raw usage payload as JSON, or `null` if not yet written.
/// Frontend renders 5h/7d %, reset countdowns, cost, context — or a graceful
/// "waiting for first tick" state when absent.
#[tauri::command]
pub fn usage_stats() -> Value {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    let path = format!("{home}/.osai/state/usage.json");
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or(Value::Null),
        Err(_) => Value::Null,
    }
}

/// Live, ACCOUNT-GLOBAL Claude usage straight from Anthropic's OAuth usage
/// endpoint — the same source claude-code's own /usage panel reads. The
/// statusline file is only a fallback now: it goes stale the moment no
/// interactive session is ticking (user-reported: 5h showed 0% while the
/// real window was at 37%).
fn claude_usage_from_oauth() -> Option<Value> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    let creds: Value = serde_json::from_str(
        &std::fs::read_to_string(format!("{home}/.claude/.credentials.json")).ok()?,
    )
    .ok()?;
    let oauth = creds.get("claudeAiOauth")?;
    let token = oauth.get("accessToken")?.as_str()?;
    // expired token → the CLI owns the refresh; fall back until it does.
    if let Some(exp_ms) = oauth.get("expiresAt").and_then(|v| v.as_i64()) {
        if exp_ms <= chrono::Utc::now().timestamp_millis() {
            return None;
        }
    }
    let mut child = std::process::Command::new(if cfg!(windows) { "curl.exe" } else { "/usr/bin/curl" })
        .args([
            "-fsS",
            "--max-time",
            "4",
            "--config",
            "-",
            "https://api.anthropic.com/api/oauth/usage",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .no_window()
        .spawn()
        .ok()?;
    // headers ride stdin (--config -) so the token never appears in argv.
    child
        .stdin
        .as_mut()?
        .write_all(
            format!(
                "header = \"Authorization: Bearer {token}\"\nheader = \"anthropic-beta: oauth-2025-04-20\"\nheader = \"Content-Type: application/json\"\n"
            )
            .as_bytes(),
        )
        .ok()?;
    let out = child.wait_with_output().ok()?;
    if !out.status.success() {
        return None;
    }
    let payload: Value = serde_json::from_slice(&out.stdout).ok()?;
    map_oauth_usage(&payload)
}

/// Maps the OAuth usage payload onto the sidebar shape. Liberal on field names
/// (utilization vs used_percentage; ISO vs epoch resets) and on nesting (root
/// vs under rate_limits) so a server-side rename degrades to the fallback
/// instead of bogus numbers.
fn map_oauth_usage(payload: &Value) -> Option<Value> {
    let pick = |k: &str| -> Option<&Value> {
        payload
            .get(k)
            .or_else(|| payload.pointer(&format!("/rate_limits/{k}")))
            .or_else(|| payload.pointer(&format!("/usage/{k}")))
    };
    let resets_to_epoch = |v: &Value| -> Option<i64> {
        if let Some(n) = v.as_i64() {
            // tolerate ms-epoch payloads
            return Some(if n > 100_000_000_000 { n / 1000 } else { n });
        }
        let s = v.as_str()?;
        chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|t| t.timestamp())
    };
    let win = |w: Option<&Value>| -> Value {
        let Some(w) = w else {
            return json!({ "pct": null, "resetsAt": null });
        };
        let pct = w
            .get("utilization")
            .or_else(|| w.get("used_percentage"))
            .or_else(|| w.get("used_percent"))
            .and_then(|x| x.as_f64());
        let resets = w
            .get("resets_at")
            .or_else(|| w.get("reset_at"))
            .and_then(resets_to_epoch);
        let (pct, resets) = windowed(pct, resets);
        json!({ "pct": pct, "resetsAt": resets })
    };
    let five = win(pick("five_hour"));
    let seven = win(pick("seven_day"));
    if five.get("pct").map(|v| v.is_null()).unwrap_or(true)
        && seven.get("pct").map(|v| v.is_null()).unwrap_or(true)
    {
        return None; // unknown shape → let the caller fall back
    }
    // Per-model weekly carve-outs ride alongside the account windows as
    // `seven_day_<model>` keys (live-verified: seven_day_sonnet). Collect them
    // (plus any five_hour_<model> siblings) so the picker/sidebar can show
    // remaining headroom per model, mirroring codex's `models` map.
    let mut models = serde_json::Map::new();
    let mut scan = |obj: Option<&Value>| {
        let Some(map) = obj.and_then(|v| v.as_object()) else {
            return;
        };
        for (key, val) in map {
            let (kind, name) = if let Some(n) = key.strip_prefix("seven_day_") {
                ("sevenDay", n)
            } else if let Some(n) = key.strip_prefix("five_hour_") {
                ("fiveHour", n)
            } else {
                continue;
            };
            if name.is_empty() {
                continue;
            }
            let w = win(Some(val));
            if w.get("pct").map(|p| p.is_null()).unwrap_or(true) {
                continue;
            }
            let entry = models.entry(name.to_string()).or_insert_with(|| json!({}));
            entry[kind] = w;
        }
    };
    scan(Some(payload));
    scan(payload.get("rate_limits"));
    scan(payload.get("usage"));
    Some(json!({ "fiveHour": five, "sevenDay": seven, "models": models }))
}

/// On-disk copy of the last good OAuth usage payload, so the bar survives an app
/// restart that lands during an endpoint cooldown (dev churn does exactly this).
fn usage_cache_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(std::path::PathBuf::from(home).join(".osai/state/usage-cache.json"))
}

/// Reads the on-disk last-good usage — but only if recent (<6h). An older copy
/// is dropped: a 5h window would have rolled over, so stale numbers would lie.
fn read_usage_cache_disk() -> Option<Value> {
    let p = usage_cache_path()?;
    let fresh = std::fs::metadata(&p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .map(|age| age.as_secs() < 6 * 3600)
        .unwrap_or(false);
    if !fresh {
        return None;
    }
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}

fn write_usage_cache_disk(v: &Value) {
    let Some(p) = usage_cache_path() else { return };
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(s) = serde_json::to_string(v) {
        let tmp = p.with_extension("json.tmp");
        if std::fs::write(&tmp, s).is_ok() {
            let _ = std::fs::rename(&tmp, &p);
        }
    }
}

/// Cached OAuth usage with last-known-good fallback + adaptive backoff.
///
/// The `/api/oauth/usage` endpoint has its OWN request rate limit (429 "Rate
/// limited. Please try again later." — distinct from the inference quota). The
/// sidebar's 30s poll + per-turn re-reads + dev relaunches can trip it. So:
///   - success → serve it, remember it (in-process + on disk), retry no sooner
///     than 90s;
///   - failure (429 / offline) → back off 5min (stop hammering, let it recover)
///     and keep serving the last known-good numbers (in-process, else the on-disk
///     copy) instead of blanking the bar. Only a cold start that has NEVER seen a
///     good value returns `None` (the honest "unknown" state).
fn claude_usage_oauth_cached() -> Option<Value> {
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    struct Cache {
        next_attempt: Instant,
        last_good: Option<Value>,
    }
    static CACHE: OnceLock<Mutex<Option<Cache>>> = OnceLock::new();
    let cell = CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cell.lock().ok()?;

    // Inside the cooldown window → serve the last good value without re-calling.
    if let Some(c) = guard.as_ref() {
        if Instant::now() < c.next_attempt {
            return c.last_good.clone();
        }
    }

    // Time to (re)try. Carry forward the best value we have (in-process, else the
    // on-disk copy from a previous run) to fall back on if the call fails.
    let prev_good = guard
        .as_ref()
        .and_then(|c| c.last_good.clone())
        .or_else(read_usage_cache_disk);

    match claude_usage_from_oauth() {
        Some(v) => {
            write_usage_cache_disk(&v);
            *guard = Some(Cache {
                next_attempt: Instant::now() + Duration::from_secs(90),
                last_good: Some(v.clone()),
            });
            Some(v)
        }
        None => {
            *guard = Some(Cache {
                next_attempt: Instant::now() + Duration::from_secs(300),
                last_good: prev_good.clone(),
            });
            prev_good
        }
    }
}

/// Live Claude rate-limit usage: OAuth endpoint first (account-global, always
/// current), the statusline-written file as fallback. Shape mirrors
/// `codex_usage` so the sidebar renders both identically:
///   { "fiveHour": {pct, resetsAt}, "sevenDay": {pct, resetsAt} }
#[tauri::command]
pub fn claude_usage() -> Value {
    if let Some(live) = claude_usage_oauth_cached() {
        return live;
    }
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    let path = format!("{home}/.osai/state/usage.json");
    if !fresh_enough(&path) {
        return Value::Null;
    }
    let s = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return Value::Null,
    };
    let v: Value = match serde_json::from_str(&s) {
        Ok(v) => v,
        Err(_) => return Value::Null,
    };
    let rl = match v.get("rate_limits") {
        Some(rl) => rl,
        None => return Value::Null,
    };
    let win = |w: &Value| -> Value {
        let (pct, resets_at) = windowed(
            w.get("used_percentage").and_then(|x| x.as_f64()),
            w.get("resets_at").and_then(|x| x.as_i64()),
        );
        json!({ "pct": pct, "resetsAt": resets_at })
    };
    // the statusline snapshot can carry the same per-model carve-out keys
    // (seven_day_sonnet …) — surface them identically to the OAuth path.
    let mut models = serde_json::Map::new();
    if let Some(map) = rl.as_object() {
        for (key, val) in map {
            let (kind, name) = if let Some(n) = key.strip_prefix("seven_day_") {
                ("sevenDay", n)
            } else if let Some(n) = key.strip_prefix("five_hour_") {
                ("fiveHour", n)
            } else {
                continue;
            };
            let w = win(val);
            if name.is_empty() || w.get("pct").map(|p| p.is_null()).unwrap_or(true) {
                continue;
            }
            let entry = models.entry(name.to_string()).or_insert_with(|| json!({}));
            entry[kind] = w;
        }
    }
    json!({
        "fiveHour": win(&rl["five_hour"]),
        "sevenDay": win(&rl["seven_day"]),
        "models": models,
    })
}

/// Live Codex (ChatGPT-subscription) rate-limit usage from the same
/// `/backend-api/wham/usage` endpoint the Codex desktop usage panel calls.
/// Returns a shape that mirrors `usage_stats`'s rate block so the sidebar renders
/// both identically:
///   { "five_hour": {pct, resets_at}, "seven_day": {pct, resets_at}, "plan": "plus" }
/// Falls back to the newest CLI websocket event in sqlite when the account
/// endpoint is temporarily unavailable.
#[tauri::command]
pub fn codex_usage() -> Value {
    codex_usage_from_wham().unwrap_or_else(codex_usage_from_sqlite)
}

fn codex_usage_from_wham() -> Option<Value> {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    let auth: Value = serde_json::from_str(
        &std::fs::read_to_string(format!("{home}/.codex/auth.json")).ok()?,
    )
    .ok()?;
    let token = auth.pointer("/tokens/access_token")?.as_str()?;
    let account = auth.pointer("/tokens/account_id")?.as_str()?;
    let mut child = std::process::Command::new(if cfg!(windows) { "curl.exe" } else { "/usr/bin/curl" })
        .args([
            "-fsS",
            "--max-time",
            "4",
            "--config",
            "-",
            "https://chatgpt.com/backend-api/wham/usage",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .no_window()
        .spawn()
        .ok()?;
    child.stdin.as_mut()?.write_all(
        format!(
            "header = \"Authorization: Bearer {token}\"\nheader = \"ChatGPT-Account-ID: {account}\"\n"
        )
        .as_bytes(),
    )
    .ok()?;
    let out = child.wait_with_output().ok()?;
    if !out.status.success() {
        return None;
    }
    let payload: Value = serde_json::from_slice(&out.stdout).ok()?;
    map_wham_usage(&payload)
}

fn map_wham_usage(payload: &Value) -> Option<Value> {
    let rl = payload.get("rate_limit")?;
    let win = |k: &str| -> Value {
        let w = &rl[k];
        json!({
            "pct": w.get("used_percent").and_then(|v| v.as_f64()),
            "resets_at": w.get("reset_at").and_then(|v| v.as_i64()),
        })
    };
    let models = map_model_windows_from_wham(payload);
    Some(json!({
        "five_hour": win("primary_window"),
        "seven_day": win("secondary_window"),
        "plan": payload.get("plan_type").and_then(|v| v.as_str()),
        "models": models,
    }))
}

fn codex_usage_from_sqlite() -> Value {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    let db = format!("{home}/.codex/logs_2.sqlite");
    if !std::path::Path::new(&db).exists() {
        return Value::Null;
    }
    // `sqlite3` ships with macOS at /usr/bin and is always on the GUI PATH.
    // `-readonly` so we never contend with the live Codex app's writes (WAL).
    let out = std::process::Command::new("sqlite3")
        .arg("-readonly")
        .arg(&db)
        .arg(
            "SELECT feedback_log_body FROM logs \
             WHERE feedback_log_body LIKE '%codex.rate_limits%used_percent%' \
             ORDER BY ts DESC LIMIT 1;",
        )
        .no_window()
        .output();
    let body = match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).into_owned(),
        _ => return Value::Null,
    };
    // The log line embeds `…"rate_limits":{…}…`; slice out that one JSON object
    // by matching balanced braces from the first `{` after the key, then parse.
    let Some(rl) = extract_json_object(&body, "\"rate_limits\":") else {
        return Value::Null;
    };
    let parsed: Value = match serde_json::from_str(&rl) {
        Ok(v) => v,
        Err(_) => return Value::Null,
    };
    let win = |k: &str| -> Value {
        let w = &parsed[k];
        json!({
            "pct": w.get("used_percent").and_then(|v| v.as_f64()),
            "resets_at": w.get("reset_at").and_then(|v| v.as_i64()),
        })
    };
    // plan_type sits as a sibling of rate_limits in the same event object;
    // pull it out dependency-free as `"plan_type":"<word>"`.
    let plan = {
        let key = "\"plan_type\":\"";
        body.find(key).map(|i| {
            let rest = &body[i + key.len()..];
            rest.chars().take_while(|c| *c != '"').collect::<String>()
        })
    };
    let model = {
        let key = "\"model\":\"";
        body.find(key).map(|i| {
            let rest = &body[i + key.len()..];
            rest.chars().take_while(|c| *c != '"').collect::<String>()
        })
    };
    let mut models = serde_json::Map::new();
    if let Some(m) = model {
        models.insert(
            m.clone(),
            json!({
                "five_hour": win("primary"),
                "seven_day": win("secondary"),
            }),
        );
    }
    json!({
        "five_hour": win("primary"),
        "seven_day": win("secondary"),
        "plan": plan,
        "models": Value::Object(models),
    })
}

fn map_model_windows_from_wham(payload: &Value) -> Value {
    let mut out = serde_json::Map::new();
    let Some(additional) = payload.get("additional_rate_limits").and_then(|v| v.as_array()) else {
        return Value::Object(out);
    };
    for entry in additional {
        let name = entry
            .get("limit_name")
            .or_else(|| entry.get("model"))
            .or_else(|| entry.get("name"))
            .and_then(|v| v.as_str());
        let Some(name) = name else {
            continue;
        };
        let windows = entry.get("rate_limit").or_else(|| entry.get("rate_limits"));
        let windows = match windows.and_then(|v| v.as_object()) {
            Some(w) => w,
            None => continue,
        };
        let primary = windows
            .get("primary_window")
            .or_else(|| windows.get("primary"))
            .or_else(|| windows.get("five_hour"));
        let secondary = windows
            .get("secondary_window")
            .or_else(|| windows.get("secondary"))
            .or_else(|| windows.get("seven_day"));
        if primary.is_none() && secondary.is_none() {
            continue;
        }
        let parse = |w: Option<&Value>| -> Value {
            let Some(w) = w else {
                return json!({ "pct": null, "resets_at": null });
            };
            json!({
                "pct": w
                    .get("used_percent")
                    .or_else(|| w.get("usedPercent"))
                    .and_then(|v| v.as_f64()),
                "resets_at": w
                    .get("reset_at")
                    .or_else(|| w.get("resetAt"))
                    .or_else(|| w.get("resets_at"))
                    .and_then(|v| v.as_i64()),
            })
        };
        out.insert(
            name.to_string(),
            json!({
                "five_hour": parse(primary),
                "seven_day": parse(secondary),
            }),
        );
    }
    Value::Object(out)
}

/// Extracts the first balanced `{…}` JSON object that follows `key` in `s`.
/// Returns the object text (including braces) or `None` if not found / unbalanced.
fn extract_json_object(s: &str, key: &str) -> Option<String> {
    let start = s.find(key)? + key.len();
    let bytes = s.as_bytes();
    let mut i = start;
    while i < bytes.len() && bytes[i] != b'{' {
        i += 1;
    }
    if i >= bytes.len() {
        return None;
    }
    let obj_start = i;
    let mut depth = 0i32;
    let mut in_str = false;
    let mut escaped = false;
    while i < bytes.len() {
        let c = bytes[i];
        if in_str {
            if escaped {
                escaped = false;
            } else if c == b'\\' {
                escaped = true;
            } else if c == b'"' {
                in_str = false;
            }
        } else {
            match c {
                b'"' => in_str = true,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(s[obj_start..=i].to_string());
                    }
                }
                _ => {}
            }
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_codex_desktop_wham_usage_to_shell_windows() {
        let payload = json!({
            "plan_type": "plus",
            "rate_limit": {
                "primary_window": { "used_percent": 46, "reset_at": 111 },
                "secondary_window": { "used_percent": 7, "reset_at": 222 }
            }
        });
        assert_eq!(
            map_wham_usage(&payload),
            Some(json!({
                "five_hour": { "pct": 46.0, "resets_at": 111 },
                "seven_day": { "pct": 7.0, "resets_at": 222 },
                "plan": "plus",
                "models": {}
            }))
        );
    }

    #[test]
    fn maps_oauth_usage_with_per_model_weekly_windows() {
        // far-future resets so `windowed` doesn't zero the snapshot
        let future = 4102444800i64; // 2100-01-01T00:00:00Z
        let payload = json!({
            "five_hour": { "utilization": 39.0, "resets_at": "2100-01-01T00:00:00Z" },
            "seven_day": { "utilization": 31.0, "resets_at": future },
            "seven_day_sonnet": { "utilization": 2.0, "resets_at": future }
        });
        let v = map_oauth_usage(&payload).expect("mapped");
        assert_eq!(v.pointer("/fiveHour/pct"), Some(&json!(39.0)));
        assert_eq!(v.pointer("/fiveHour/resetsAt"), Some(&json!(future)));
        assert_eq!(v.pointer("/sevenDay/pct"), Some(&json!(31.0)));
        assert_eq!(v.pointer("/models/sonnet/sevenDay/pct"), Some(&json!(2.0)));
        assert_eq!(v.pointer("/models/sonnet/sevenDay/resetsAt"), Some(&json!(future)));
    }

    #[test]
    fn oauth_per_model_windows_skip_empty_and_expired_keys_stay_zeroed() {
        let future = 4102444800i64;
        let payload = json!({
            "five_hour": { "utilization": 10.0, "resets_at": future },
            "seven_day": { "utilization": 5.0, "resets_at": future },
            // expired carve-out: rolled over → reported as 0% used, no reset
            "seven_day_opus": { "utilization": 88.0, "resets_at": 1 },
            // junk entry without a percentage → dropped entirely
            "seven_day_misc": { "note": "n/a" }
        });
        let v = map_oauth_usage(&payload).expect("mapped");
        assert_eq!(v.pointer("/models/opus/sevenDay/pct"), Some(&json!(0.0)));
        assert_eq!(v.pointer("/models/opus/sevenDay/resetsAt"), Some(&Value::Null));
        assert_eq!(v.pointer("/models/misc"), None);
    }

    #[test]
    fn maps_codex_wham_additional_rate_limits_by_model() {
        let payload = json!({
            "plan_type": "plus",
            "rate_limit": {
                "primary_window": { "used_percent": 46, "reset_at": 111 },
                "secondary_window": { "used_percent": 7, "reset_at": 222 }
            },
            "additional_rate_limits": [
                {
                    "model": "gpt-5.3-codex-spark",
                    "rate_limit": {
                        "primary_window": { "used_percent": 80, "reset_at": 333 },
                        "secondary_window": { "used_percent": 20, "reset_at": 444 }
                    }
                }
            ]
        });
        assert_eq!(
            map_wham_usage(&payload).and_then(|v| v.pointer("/models/gpt-5.3-codex-spark").cloned()),
            Some(json!({
                "five_hour": { "pct": 80.0, "resets_at": 333 },
                "seven_day": { "pct": 20.0, "resets_at": 444 }
            }))
        );
    }
}
