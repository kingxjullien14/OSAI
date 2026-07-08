/** Frontend wrappers for the BYO-key keychain commands (Rust `apikeys.rs`).
 *  Keys are stored in the OS keychain — these only set / delete / list; a key is
 *  NEVER read back into JS (the chat runtime reads it Rust-side). Off-Tauri (web
 *  mirror) every call degrades to a safe no-op / empty so the UI still renders. */
import { invoke, isTauriRuntime } from "./tauri";
import type { ApiProviderId } from "./providers";

/** Store (or replace) a provider's API key in the OS keychain. */
export async function setApiKey(provider: ApiProviderId, key: string): Promise<void> {
  await invoke("osai_set_api_key", { provider, key });
}

/** Remove a provider's stored key (idempotent). */
export async function deleteApiKey(provider: ApiProviderId): Promise<void> {
  await invoke("osai_delete_api_key", { provider });
}

/** Whether a provider has a usable key (keychain or env fallback). */
export async function hasApiKey(provider: ApiProviderId): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    return await invoke<boolean>("osai_has_api_key", { provider });
  } catch {
    return false;
  }
}

/** The provider ids that currently have a key configured — gates the model
 *  catalog (`availableApiModels`). Empty on the web mirror / any failure. */
export async function listConfiguredProviders(): Promise<Set<string>> {
  if (!isTauriRuntime()) return new Set();
  try {
    return new Set(await invoke<string[]>("osai_list_api_keys"));
  } catch {
    return new Set();
  }
}
