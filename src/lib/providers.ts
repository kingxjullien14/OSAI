/**
 * BYO-key API provider registry (Tier 4 — model-agnostic chat).
 *
 * The CLI tier (claude/codex/opencode) already lives in chat.ts/chat.rs as the
 * `Engine` enum + `adapt_line`. THIS is the API tier: direct HTTP to a provider
 * with the user's OWN key, so AIOS owns the message array end-to-end (which is
 * also what makes honest branching / edit-rewind possible later — see
 * PLAN-chat-power.md).
 *
 * Pure data + helpers (no invoke/DOM) → node-testable. API KEYS DO NOT LIVE HERE
 * (or anywhere in the frontend): they're stored in the OS keychain via the Rust
 * `apikeys.rs` commands and read Rust-side when calling a provider. This module
 * only describes the providers + their models and gates the catalog on which
 * providers the user has configured.
 */

export type ApiProviderId = "openrouter" | "anthropic" | "openai" | "ollama";

/** How the runtime (chat.rs, next slice) must speak to the provider. */
export type ApiProtocol = "anthropic-messages" | "openai-chat" | "ollama-chat";

export interface ApiModel {
  /** the provider-native model id (what the API expects on the wire). */
  id: string;
  label: string;
  /** approximate context window (tokens) for the composer's ctx meter. */
  contextWindow: number;
  /** supports function/tool calling (gates the agentic tool-runner). */
  toolUse: boolean;
}

export interface ApiProvider {
  id: ApiProviderId;
  label: string;
  protocol: ApiProtocol;
  /** default API base URL; ollama is user-overridable (settings.apiEndpoints). */
  endpoint: string;
  /** true = no API key needed (ollama, local). */
  keyless: boolean;
  /** env var the key may also come from (power-user / CI parity). */
  keyEnv?: string;
  /** where to get a key — shown in the connect-your-AI panel. */
  keyUrl?: string;
  models: ApiModel[];
}

/** Curated flagship models per provider. A live catalog (OpenRouter /models,
 *  Ollama /api/tags) is a later enhancement; this static set is the dependable
 *  starting point and the source of truth for the picker until then. */
export const API_PROVIDERS: ApiProvider[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai-chat",
    endpoint: "https://openrouter.ai/api/v1",
    keyless: false,
    keyEnv: "OPENROUTER_API_KEY",
    keyUrl: "https://openrouter.ai/keys",
    models: [
      { id: "anthropic/claude-3.7-sonnet", label: "Claude 3.7 Sonnet", contextWindow: 200_000, toolUse: true },
      { id: "openai/gpt-4o", label: "GPT-4o", contextWindow: 128_000, toolUse: true },
      { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash", contextWindow: 1_000_000, toolUse: true },
      { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", contextWindow: 128_000, toolUse: true },
      { id: "deepseek/deepseek-chat", label: "DeepSeek V3", contextWindow: 64_000, toolUse: true },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    protocol: "anthropic-messages",
    endpoint: "https://api.anthropic.com",
    keyless: false,
    keyEnv: "ANTHROPIC_API_KEY",
    keyUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-opus-4-8", label: "Claude Opus 4.8", contextWindow: 1_000_000, toolUse: true },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", contextWindow: 200_000, toolUse: true },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", contextWindow: 200_000, toolUse: true },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai-chat",
    endpoint: "https://api.openai.com/v1",
    keyless: false,
    keyEnv: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-4o", label: "GPT-4o", contextWindow: 128_000, toolUse: true },
      { id: "gpt-4o-mini", label: "GPT-4o mini", contextWindow: 128_000, toolUse: true },
      { id: "o3", label: "o3", contextWindow: 200_000, toolUse: true },
      { id: "o4-mini", label: "o4-mini", contextWindow: 200_000, toolUse: true },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    protocol: "ollama-chat",
    endpoint: "http://localhost:11434",
    keyless: true,
    keyUrl: "https://ollama.com/download",
    models: [
      { id: "llama3.1", label: "Llama 3.1 8B", contextWindow: 128_000, toolUse: true },
      { id: "qwen2.5-coder", label: "Qwen2.5 Coder", contextWindow: 32_000, toolUse: true },
      { id: "deepseek-r1", label: "DeepSeek-R1", contextWindow: 64_000, toolUse: false },
    ],
  },
];

const BY_ID = new Map<string, ApiProvider>(API_PROVIDERS.map((p) => [p.id, p]));

export function apiProvider(id: string): ApiProvider | undefined {
  return BY_ID.get(id);
}

/** A model qualified by its provider — the catalog row + the send target. */
export interface QualifiedApiModel {
  providerId: ApiProviderId;
  providerLabel: string;
  model: ApiModel;
  /** stable composite key for the picker + settings (`provider:model`). */
  key: string;
}

/** Composite picker/settings key. The native model id can itself contain "/"
 *  (OpenRouter), so we split on the FIRST ":" only. */
export function qualifiedKey(providerId: ApiProviderId, modelId: string): string {
  return `${providerId}:${modelId}`;
}

/** Resolve a `provider:model` key back to its provider + model. */
export function apiModelByKey(key: string): QualifiedApiModel | undefined {
  const idx = key.indexOf(":");
  if (idx < 0) return undefined;
  const providerId = key.slice(0, idx);
  const modelId = key.slice(idx + 1);
  const p = BY_ID.get(providerId);
  const model = p?.models.find((m) => m.id === modelId);
  if (!p || !model) return undefined;
  return { providerId: p.id, providerLabel: p.label, model, key };
}

export function isApiModelKey(key: string): boolean {
  return apiModelByKey(key) !== undefined;
}

const API_PROVIDER_IDS = new Set<string>(API_PROVIDERS.map((p) => p.id));

/** Whether a string is one of the API provider ids (used to tell an API-tier
 *  `ChatModel.engine` apart from the CLI engines claude/codex/opencode). */
export function isApiProviderId(s: string | null | undefined): s is ApiProviderId {
  return s != null && API_PROVIDER_IDS.has(s);
}

/**
 * The catalog of API models usable RIGHT NOW: every model of a configured
 * provider, plus all keyless (ollama) models. `configured` = the set of provider
 * ids that have a key in the keychain (from the Rust list command).
 */
export function availableApiModels(configured: Set<string>): QualifiedApiModel[] {
  const out: QualifiedApiModel[] = [];
  for (const p of API_PROVIDERS) {
    if (!p.keyless && !configured.has(p.id)) continue;
    for (const model of p.models) {
      out.push({
        providerId: p.id,
        providerLabel: p.label,
        model,
        key: qualifiedKey(p.id, model.id),
      });
    }
  }
  return out;
}
