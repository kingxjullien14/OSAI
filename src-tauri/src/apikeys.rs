//! BYO-key API key storage (Tier 4 — model-agnostic chat).
//!
//! Keys live in the OS keychain (Windows Credential Manager / macOS Keychain /
//! Linux Secret Service) via the `keyring` crate — NEVER in localStorage or the
//! settings blob. The chat runtime (next slice) reads them Rust-side via
//! `key_for()` when calling a provider; the frontend can only set / delete / list,
//! so a key can never be read back into JS.
//!
//! Provider ids mirror `src/lib/providers.ts` (`ApiProviderId`).

use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "osai-api-keys";

/// Providers that take a key (ollama is keyless/local, so it's never stored here).
const KEYED_PROVIDERS: [&str; 3] = ["openrouter", "anthropic", "openai"];

fn valid_provider(p: &str) -> bool {
    KEYED_PROVIDERS.contains(&p)
}

fn entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, provider).map_err(|e| format!("keychain unavailable: {e}"))
}

/// The env var a provider's key may also come from (power-user / CI parity).
fn env_var(provider: &str) -> Option<&'static str> {
    match provider {
        "openrouter" => Some("OPENROUTER_API_KEY"),
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "openai" => Some("OPENAI_API_KEY"),
        _ => None,
    }
}

/// Store (or replace) the API key for a provider in the OS keychain.
#[tauri::command]
pub fn osai_set_api_key(provider: String, key: String) -> Result<(), String> {
    if !valid_provider(&provider) {
        return Err(format!("unknown provider \"{provider}\""));
    }
    let k = key.trim();
    if k.is_empty() {
        return Err("empty api key".into());
    }
    entry(&provider)?
        .set_password(k)
        .map_err(|e| format!("failed to store key: {e}"))
}

/// Remove a provider's stored key. A missing key is success (idempotent).
#[tauri::command]
pub fn osai_delete_api_key(provider: String) -> Result<(), String> {
    if !valid_provider(&provider) {
        return Err(format!("unknown provider \"{provider}\""));
    }
    match entry(&provider)?.delete_password() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(format!("failed to delete key: {e}")),
    }
}

/// Whether a provider has a usable key (keychain OR env fallback). Never returns
/// the key itself.
#[tauri::command]
pub fn osai_has_api_key(provider: String) -> bool {
    key_for(&provider).is_some()
}

/// The provider ids that currently have a key configured — drives the model
/// catalog gating in the frontend. Never returns key material.
#[tauri::command]
pub fn osai_list_api_keys() -> Vec<String> {
    KEYED_PROVIDERS
        .iter()
        .filter(|p| key_for(p).is_some())
        .map(|p| p.to_string())
        .collect()
}

/// Resolve a provider's key for the chat runtime: keychain first, then the env-var
/// fallback. `None` if neither is set or the value is blank. (Not a command — the
/// key never crosses into JS.)
pub fn key_for(provider: &str) -> Option<String> {
    if valid_provider(provider) {
        if let Ok(e) = Entry::new(SERVICE, provider) {
            if let Ok(k) = e.get_password() {
                if !k.trim().is_empty() {
                    return Some(k);
                }
            }
        }
    }
    env_var(provider)
        .and_then(|v| std::env::var(v).ok())
        .filter(|k| !k.trim().is_empty())
}
