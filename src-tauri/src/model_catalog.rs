//! Launch-time model-catalog refresh — the picker learns new models by itself
//! instead of waiting for an app release that hardcodes them.
//!
//! One best-effort sweep per app launch (the frontend fires
//! `refresh_model_catalog` in the background at boot): every CONNECTED source
//! that exposes a model listing is asked for its current lineup. Results are
//! cached to `~/.osai/state/model-catalog.json` — an offline launch keeps the
//! last good catalog — and returned to the frontend, which overlays them on the
//! static curated catalogs (providers.ts for the BYO-key tier, CHAT_MODELS for
//! the claude CLI picker).
//!
//! Sources:
//!   - anthropic  — GET /v1/models with the keychain API key, else the claude
//!                  CLI's own OAuth token (subscription users have no key). The
//!                  result feeds BOTH the claude-CLI picker (the CLI accepts
//!                  full model ids via --model) and the API-tier provider.
//!   - openai     — GET /v1/models with the keychain key, filtered to chat
//!                  models (the raw list is mostly embeddings/audio/imaging).
//!   - openrouter — GET /api/v1/models (public, keyless), tool-capable only,
//!                  newest first, capped.
//!   - ollama     — GET {endpoint}/api/tags (local, keyless) — the user's own
//!                  pulled models, all of them.
//!   - codex      — no listing surface today; the static catalog stands.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone)]
pub struct DynamicModel {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct DynamicCatalog {
    /// unix seconds of the last successful sweep (0 = never).
    pub fetched_at: u64,
    /// provider id → its current models, newest first.
    pub providers: HashMap<String, Vec<DynamicModel>>,
}

fn catalog_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(std::path::PathBuf::from(home).join(".osai/state/model-catalog.json"))
}

fn load_cached() -> Option<DynamicCatalog> {
    let path = catalog_path()?;
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn save_cache(cat: &DynamicCatalog) {
    if let Some(path) = catalog_path() {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string(cat) {
            let tmp = path.with_extension("json.tmp");
            let _ = std::fs::write(&tmp, json);
            let _ = std::fs::rename(&tmp, &path);
        }
    }
}

fn http() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new())
}

/// The claude CLI's OAuth access token (subscription auth) — lets us hit
/// /v1/models for users who never made an API key. Expired token → None (the
/// CLI owns the refresh; we just skip this sweep).
fn claude_oauth_token() -> Option<String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    let creds: Value = serde_json::from_str(
        &std::fs::read_to_string(format!("{home}/.claude/.credentials.json")).ok()?,
    )
    .ok()?;
    let oauth = creds.get("claudeAiOauth")?;
    if let Some(exp_ms) = oauth.get("expiresAt").and_then(|v| v.as_i64()) {
        if exp_ms <= chrono::Utc::now().timestamp_millis() {
            return None;
        }
    }
    oauth.get("accessToken")?.as_str().map(str::to_string)
}

fn anthropic_models() -> Vec<DynamicModel> {
    let req = if let Some(key) = crate::apikeys::key_for("anthropic") {
        http()
            .get("https://api.anthropic.com/v1/models?limit=100")
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
    } else if let Some(token) = claude_oauth_token() {
        http()
            .get("https://api.anthropic.com/v1/models?limit=100")
            .header("Authorization", format!("Bearer {token}"))
            .header("anthropic-beta", "oauth-2025-04-20")
            .header("anthropic-version", "2023-06-01")
    } else {
        return Vec::new();
    };
    let Ok(resp) = req.send() else { return Vec::new() };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(v) = resp.json::<Value>() else { return Vec::new() };
    let Some(data) = v.get("data").and_then(|d| d.as_array()) else {
        return Vec::new();
    };
    data.iter()
        .filter_map(|m| {
            let id = m.get("id")?.as_str()?.to_string();
            let label = m
                .get("display_name")
                .and_then(|d| d.as_str())
                .unwrap_or(&id)
                .to_string();
            Some(DynamicModel {
                id,
                label,
                context_window: None,
            })
        })
        .collect()
}

fn openai_models() -> Vec<DynamicModel> {
    let Some(key) = crate::apikeys::key_for("openai") else {
        return Vec::new();
    };
    let Ok(resp) = http()
        .get("https://api.openai.com/v1/models")
        .header("Authorization", format!("Bearer {key}"))
        .send()
    else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(v) = resp.json::<Value>() else { return Vec::new() };
    let Some(data) = v.get("data").and_then(|d| d.as_array()) else {
        return Vec::new();
    };
    // the raw list is mostly non-chat (embeddings/audio/imaging/moderation) —
    // keep the conversational families, newest first, capped.
    let noise = [
        "embed", "whisper", "tts", "dall-e", "audio", "realtime", "moderation",
        "transcribe", "image", "search",
    ];
    let mut rows: Vec<(i64, DynamicModel)> = data
        .iter()
        .filter_map(|m| {
            let id = m.get("id")?.as_str()?;
            let chatty = id.starts_with("gpt-")
                || id.starts_with("o1")
                || id.starts_with("o3")
                || id.starts_with("o4")
                || id.starts_with("chatgpt-");
            if !chatty || noise.iter().any(|n| id.contains(n)) {
                return None;
            }
            let created = m.get("created").and_then(|c| c.as_i64()).unwrap_or(0);
            Some((
                created,
                DynamicModel {
                    id: id.to_string(),
                    label: id.to_string(),
                    context_window: None,
                },
            ))
        })
        .collect();
    rows.sort_by(|a, b| b.0.cmp(&a.0));
    rows.into_iter().take(24).map(|(_, m)| m).collect()
}

fn openrouter_models() -> Vec<DynamicModel> {
    // public listing — no key required, so this works the moment the provider
    // is configured (and refreshes the curated five with the live top set).
    if crate::apikeys::key_for("openrouter").is_none() {
        return Vec::new(); // not connected — don't flood the picker for nothing
    }
    let Ok(resp) = http().get("https://openrouter.ai/api/v1/models").send() else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(v) = resp.json::<Value>() else { return Vec::new() };
    let Some(data) = v.get("data").and_then(|d| d.as_array()) else {
        return Vec::new();
    };
    let mut rows: Vec<(i64, DynamicModel)> = data
        .iter()
        .filter_map(|m| {
            let id = m.get("id")?.as_str()?.to_string();
            // agent chats need tool use; listing text-only models would break
            // the first turn that reaches for a tool.
            let tools = m
                .get("supported_parameters")
                .and_then(|p| p.as_array())
                .is_some_and(|p| p.iter().any(|x| x.as_str() == Some("tools")));
            if !tools {
                return None;
            }
            let label = m
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or(&id)
                .to_string();
            let created = m.get("created").and_then(|c| c.as_i64()).unwrap_or(0);
            Some((
                created,
                DynamicModel {
                    id,
                    label,
                    context_window: m.get("context_length").and_then(|c| c.as_u64()),
                },
            ))
        })
        .collect();
    rows.sort_by(|a, b| b.0.cmp(&a.0));
    rows.into_iter().take(30).map(|(_, m)| m).collect()
}

fn ollama_models(endpoint: &str) -> Vec<DynamicModel> {
    let url = format!("{}/api/tags", endpoint.trim_end_matches('/'));
    let Ok(resp) = reqwest::blocking::Client::builder()
        // local daemon: fail fast so a machine without ollama doesn't stall the sweep
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new())
        .get(url)
        .send()
    else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(v) = resp.json::<Value>() else { return Vec::new() };
    let Some(models) = v.get("models").and_then(|m| m.as_array()) else {
        return Vec::new();
    };
    models
        .iter()
        .filter_map(|m| {
            let name = m.get("name")?.as_str()?.to_string();
            Some(DynamicModel {
                id: name.clone(),
                label: name,
                context_window: None,
            })
        })
        .collect()
}

/// Any OpenAI-compatible server (LM Studio, llama.cpp --server, vLLM, LiteLLM)
/// on the user's `local` endpoint — GET {endpoint}/models, keyless, fail-fast.
fn local_models(endpoint: &str) -> Vec<DynamicModel> {
    let url = format!("{}/models", endpoint.trim_end_matches('/'));
    let Ok(resp) = reqwest::blocking::Client::builder()
        // local server: fail fast so a machine without one doesn't stall the sweep
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new())
        .get(url)
        .send()
    else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(v) = resp.json::<Value>() else { return Vec::new() };
    let Some(models) = v.get("data").and_then(|m| m.as_array()) else {
        return Vec::new();
    };
    models
        .iter()
        .filter_map(|m| {
            let id = m.get("id")?.as_str()?.to_string();
            Some(DynamicModel {
                id: id.clone(),
                label: id,
                context_window: None,
            })
        })
        .collect()
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn refresh_sync(ollama_endpoint: Option<String>, local_endpoint: Option<String>) -> DynamicCatalog {
    let mut providers = HashMap::new();
    let anthropic = anthropic_models();
    if !anthropic.is_empty() {
        providers.insert("anthropic".to_string(), anthropic);
    }
    let openai = openai_models();
    if !openai.is_empty() {
        providers.insert("openai".to_string(), openai);
    }
    let openrouter = openrouter_models();
    if !openrouter.is_empty() {
        providers.insert("openrouter".to_string(), openrouter);
    }
    let ollama = ollama_models(
        ollama_endpoint
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("http://localhost:11434"),
    );
    if !ollama.is_empty() {
        providers.insert("ollama".to_string(), ollama);
    }
    let local = local_models(
        local_endpoint
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("http://localhost:1234/v1"),
    );
    if !local.is_empty() {
        providers.insert("local".to_string(), local);
    }
    let mut cat = DynamicCatalog {
        fetched_at: now_secs(),
        providers,
    };
    // a source that failed THIS sweep keeps its last good listing (offline
    // launches, transient 5xx) — stale beats vanished.
    if let Some(prev) = load_cached() {
        for (k, v) in prev.providers {
            cat.providers.entry(k).or_insert(v);
        }
        if cat.providers.is_empty() {
            cat.fetched_at = prev.fetched_at;
        }
    }
    save_cache(&cat);
    cat
}

/// Best-effort model-catalog sweep (see module docs). Async so the blocking
/// HTTP rides the worker pool, never a UI-adjacent thread.
#[tauri::command]
pub async fn refresh_model_catalog(
    ollama_endpoint: Option<String>,
    local_endpoint: Option<String>,
) -> DynamicCatalog {
    tauri::async_runtime::spawn_blocking(move || refresh_sync(ollama_endpoint, local_endpoint))
        .await
        .unwrap_or_default()
}
