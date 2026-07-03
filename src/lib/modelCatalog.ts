// Launch-time model-catalog refresh — frontend half. The backend
// (model_catalog.rs) sweeps every CONNECTED source that exposes a model
// listing (anthropic via key or the claude CLI's OAuth token, openai,
// openrouter, local ollama), caches the result on disk, and returns it here;
// `applyDynamicCatalog` (providers.ts) overlays it on the curated static
// lists so new models are pickable WITHOUT an app update.

import { invoke } from "./tauri";
import { applyDynamicCatalog, type DynamicProviderModel } from "./providers";
import { reportDiag } from "./diag";

export interface DynamicCatalog {
  fetched_at: number;
  providers: Record<string, DynamicProviderModel[]>;
}

/** One best-effort sweep; resolves with the merged (fresh ∪ last-good) catalog. */
export async function refreshModelCatalog(
  ollamaEndpoint?: string | null,
): Promise<DynamicCatalog> {
  return invoke("refresh_model_catalog", { ollamaEndpoint: ollamaEndpoint ?? null });
}

/** Fire the launch sweep in the background and overlay the result. Never
 *  throws — an offline launch just keeps the static catalog. */
export function refreshModelCatalogAtLaunch(ollamaEndpoint?: string | null): void {
  refreshModelCatalog(ollamaEndpoint)
    .then((cat) => applyDynamicCatalog(cat.providers))
    .catch((e) => reportDiag("models.refresh", e, { action: "launch" }));
}
