/** Frontend wrapper for the `detect_providers` Rust command — probes which chat
 *  engine CLIs (claude / codex / opencode) are actually installed. Used by
 *  onboarding (auto-select a detected engine) and the composer model picker
 *  (gray out engines whose CLI isn't present). See PLAN-superapp-uiux.md §5/§13.
 *
 *  GUI-launched Tauri apps don't inherit the shell PATH, so the Rust side reuses
 *  the install-dir-aware resolvers; a naive `which` would report installed CLIs
 *  as missing. Off-Tauri (web mirror) this resolves to [] so callers degrade
 *  gracefully (assume nothing detected → allow a manual pick). */
import { invoke } from "./tauri";

export type EngineId = "claude" | "codex" | "opencode";

export interface ProviderStatus {
  /** Engine id, matching ChatModel.engine. */
  id: EngineId | string;
  available: boolean;
  /** Resolved CLI path when available; null otherwise. */
  detail: string | null;
}

/** Probe installed engine CLIs. Never throws — returns [] on any failure. */
export async function detectProviders(): Promise<ProviderStatus[]> {
  try {
    return await invoke<ProviderStatus[]>("detect_providers");
  } catch {
    return [];
  }
}

/** Session-cached detection — the install set doesn't change while the app runs,
 *  so multiple panes/onboarding share one probe. */
let cached: Promise<ProviderStatus[]> | null = null;
export function detectProvidersCached(): Promise<ProviderStatus[]> {
  if (!cached) cached = detectProviders();
  return cached;
}

/** Convenience: the set of engine ids that are installed. Empty set on failure
 *  (callers should treat "empty" as "unknown → don't disable anything"). */
export async function detectAvailableEngines(): Promise<Set<string>> {
  const statuses = await detectProvidersCached();
  return new Set(statuses.filter((s) => s.available).map((s) => s.id));
}
