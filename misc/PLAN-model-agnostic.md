# PLAN — model-agnostic AIOS chat (CLI swap + API fallback)

_decided 2026-05-30 · firaz chose "both" (full opencode-grade)._
_internal build plan. not for the public repo._

> ## STATUS (2026-06-24) — Tier 4 of the go-to-harness review; the BYO-key epic.
> **CLI tier (Phases 0–2) = effectively DONE already:** `chat.rs` has the `Engine`
> enum (claude/codex/opencode) + per-engine arg builders + `adapt_line` normalizer +
> `detect_providers`. The remaining work is the **BYO-key API tier (Phase 3)** + secure
> storage (Phase 5) — also the piece that makes AIOS own the message array (unlocks
> honest branching / edit-rewind, deferred here from Tier 3 chat-power).
>
> **Owner decisions (2026-06-24):** providers = **all four** (OpenRouter, Anthropic API,
> OpenAI API, Ollama-local); key storage = **OS keychain** (not localStorage).
>
> **P0 foundation SHIPPED (gated: tsc 0 / 201 tests / build ✓ / cargo ✓):**
> - `src/lib/providers.ts` (+ `providers.test.ts`, 4 tests) — the API provider/model
>   **catalog**: `API_PROVIDERS` (endpoint, protocol `anthropic-messages|openai-chat|
>   ollama-chat`, models w/ ctx + toolUse, keyless flag) + helpers `apiModelByKey`
>   (`provider:model` composite, splits on first ":"), `availableApiModels(configured)`
>   (gates on configured keys; ollama always present).
> - `src-tauri/src/apikeys.rs` (+ `keyring = "2"`) — **OS-keychain** storage. Commands
>   `aios_set_api_key` / `aios_delete_api_key` / `aios_has_api_key` / `aios_list_api_keys`.
>   Keys NEVER cross into JS; the runtime reads them via `key_for()` (keychain → env
>   fallback). Registered in lib.rs.
> - `src/lib/apiKeys.ts` — thin invoke wrappers (set/delete/has/list; web-mirror = no-op).
>
> **API RUNTIME SHIPPED 2026-06-24 (cargo ✓ / 26 Rust tests inc. 7 new):**
> - `src-tauri/src/chat_api.rs` — the PURE core (unit-tested, 7 tests): `build_request_body`
>   + `parse_answer` + `normalize_usage` for `anthropic-messages` / `openai-chat` (OpenAI +
>   OpenRouter) / `ollama-chat`. Usage normalized to `{input_tokens, output_tokens}` so the
>   frontend meter is uniform; API error objects surface as the turn's error.
> - `chat.rs` — `ApiProvider` (Copy) + `Engine::Api(ApiProvider)`; `chat_start` delegates to
>   `start_api_session` (no process; mints an `api-<provider>-<id>` session id + emits the
>   `system` init); `chat_send` delegates to `run_api_turn` → appends the user msg to the
>   **AIOS-owned `api_messages` array**, blocking `reqwest` POST on a worker thread, emits the
>   answer + a usage `result` via the existing `assistant_text_line`/`ingest_line` (so it
>   renders identically to claude). `reqwest` added (blocking + rustls). v1 = NON-streaming
>   (token streaming + the message-array replay/branching are follow-ups). Key read Rust-side
>   via `apikeys::key_for` (keychain → env), never JS.
> - Also fixed a pre-existing bug: two macOS-only `#[test]`s in `browser.rs` weren't gated to
>   macOS, so `cargo test` couldn't build on Windows at all. Gated them → 26 tests run green.
>
> **PICKER + KEY UI SHIPPED 2026-06-24 (tsc 0 / build ✓ / 201 tests) — BYO-key is now END-TO-END:**
> - `ChatModel.engine` widened to include the API provider ids; `ChatPane` builds API picker rows
>   from `availableApiModels(configuredApi)` (gated on `listConfiguredProviders`) + merges them as
>   picker groups ("anthropic · api" / "openrouter · api" / "openai · api" / "ollama · local",
>   empty groups drop out). Picker identity is now (engine, id) — an API id can collide with a CLI
>   id (`claude-opus-4-8`), so key + active compare both. Picking an API model `setModel`s it →
>   the session-restart effect re-spins as `Engine::Api` → `run_api_turn`. **API picks are
>   session-scoped** (no `saveSettings` — avoids the `<provider>-cli` plumbing; sticky API default
>   is a follow-up).
> - `Settings → general → "api keys · bring your own"` (`ApiKeysCard`) — masked key inputs per
>   keyed provider, save/clear → the keychain commands; shows "configured" when set; never reads a
>   key back. Ollama needs no key.
>
> **LIVE-VERIFY (owner, after rebuild):** Settings → api keys → paste an OpenRouter/Anthropic key
> (or `export ANTHROPIC_API_KEY=…` — `key_for` reads env too) → new chat → pick a model from the
> "· api" group → send. Answer lands at once (non-streaming v1) with a token footer; a bad key
> surfaces red ("invalid x-api-key"). Ollama: run it locally, its group always shows.
>
> **TOKEN STREAMING SHIPPED 2026-06-24 (cargo ✓ 0 warnings / 24 Rust tests inc. 5 streaming-parser):**
> - `chat_api.rs` now requests `stream:true` (+ OpenAI `stream_options.include_usage`) and a pure,
>   unit-tested `parse_stream_line(proto, line) → Vec<StreamEvent>` handles each provider's wire
>   format: OpenAI/OpenRouter SSE `data:` chunks (+ `[DONE]`), Anthropic SSE typed events
>   (`content_block_delta` / `message_start` input usage / `message_delta` output usage /
>   `message_stop`), Ollama ndjson (`done:true` carries the counts). `parse_answer` is kept for the
>   non-2xx error body (not streamed).
> - `chat.rs`: `call_api_blocking` → `send_api_request` (returns the live `Response`); `run_api_turn`
>   streams `BufReader::new(resp).lines()` on the worker thread → emits a `text_delta_line` per token
>   (types out live, same as claude), then the full `assistant_text_line` (recorded to history +
>   appended to the AIOS-owned `api_messages`; the reducer dedups it in the UI — confirmed via
>   chatStream.ts:197) + a usage `result`. Empty/again-empty → red error.
>
> **RESUME-REPLAY SHIPPED 2026-06-24 (cargo ✓ / 26 Rust tests inc. 2 new):**
> - `chat_history.rs` — pure, tested `line_to_api_message(line) → Option<{role,content}>` (skips
>   results/tools/synthetic plumbing) + `replay_api_messages(id)` (reads the durable `events.jsonl`
>   → the conversation array, in order).
> - `chat.rs` `start_api_session` now RESUMES: when `resume` is set it reuses that id (appends to the
>   SAME durable log) and seeds `api_messages` from `replay_api_messages`, so a BYO-key chat keeps
>   full context across reopen / model-switch (the CLI tier can't do this — AIOS owns the array).
>   This also makes **retry-with-model genuinely switch the model on the API tier** (it resumes the
>   full array under the new model), unlike the CLI caveat.
>
> **PROPER BRANCHING (Tier-3 P2, API-tier only) — PHASE 1 SHIPPED 2026-06-24 (tsc 0 / 209 tests):**
> `src/lib/chatTree.ts` (+ `chatTree.test.ts`, 8 tests) — the pure conversation-TREE model: generic
> `TreeNode<T>{id,parentId,value}` + `Selection` (branch point → active child); `childrenOf`,
> `activeChildId` (default = NEWEST child), `activePath` (cycle-guarded root→leaf walk),
> `siblingPosition` (drives ‹N/M›), `addNode`, `selectBranch`/`stepBranch`, `activeMessages`
> (projects the active path → the array to send). The headline test proves the whole point: two
> forks keep INDEPENDENT continuations — swap branch → its own subtree, never the other's.
> Recommended integration: the FRONTEND owns the tree + sends the active path each turn.
>
> **PHASE 2 SHIPPED 2026-06-24 (cargo ✓ 0 warnings / 26 Rust tests / tsc 0 / build ✓):**
> `chatSend(id,text,imagePaths?,messages?)` + `chat_send(... messages: Option<Vec<Value>>)` →
> `run_api_turn(... messages_override)`: when the frontend supplies the active root→leaf array (it
> already includes the new user turn), the API engine SENDS THAT VERBATIM (the FE owns the tree);
> otherwise it falls back to appending to `api_messages` (linear chat). Fully back-compat — the lone
> `dispatch` call site passes no `messages`, so today's behavior is unchanged. Not live-testable
> until Phase 3 wires the FE to send the active path.
>
> **PHASE 3 (frontend tree UI, API-tier only) — owner chose INCREMENTAL + verify each step.**
>   - **Step (a) SHIPPED 2026-06-24 (tsc 0 / build ✓):** ChatPane gained `treeNodes`/`treeSel` state +
>     an effect that mirrors `turns` into a LINEAR tree (nodes carry id+parentId only; values resolve
>     from `turns` by id, rebuilt only on an id-SEQUENCE change so streaming deltas don't churn it) +
>     a `treeTurns` memo (`activePath` projection) that the render's `visibleTurns` now reads.
>     **API-gated + provably a no-op:** for a linear chat the active path === `turns`, so nothing
>     changes — the owner verifies an API chat still works exactly as before. The 26 `setTurns` sites
>     are untouched (the mirror reconciles from `turns`).
>   - **Step (b) SHIPPED 2026-06-24 (tsc 0 / build ✓ / 212 tests) — fork-on-regenerate, end to end:**
>     the mirror is now INCREMENTAL + fork-aware (`pendingForkParentRef`, set by regenerate to the
>     last user turn, links the new answer as a SIBLING; a turns REPLACE = clear/resume still rebuilds
>     linearly). The ‹N/M› switcher is tree-driven for API (`siblingPosition` + `stepBranch`→`setTreeSel`),
>     so switching re-renders the active path — the other branch AND its whole continuation hide. The
>     old display-variant hiding is disabled for API (`hiddenTurnIds` empty; CLI tier unchanged). And
>     `dispatch` now SENDS the active path (`turnsToApiMessages`/`messagesUpToLastUser` via the Phase-2
>     `messages` arg), so the model sees only the active branch — fixing the reported "switch path →
>     old continuation stays + model still remembers the other path." (`apiMessages.ts` +3 tests.)
>     **Fix 2026-06-24:** regenerate first DIDN'T fork (both answers stacked, no switcher) — the fork
>     token was consumed inside a `setState` updater, which React StrictMode double-invokes (dev), so
>     the throwaway call ate it. Moved the whole mirror computation + token-consume OUTSIDE the updater
>     (read committed nodes via `treeNodesRef`, `setTreeNodes(plainArray)`). Now regenerate forks.
>   - **Step (c) SHIPPED 2026-06-24 (tsc 0 / build ✓ / 212 tests) — edit-fork:** editing a prior user
>     turn now FORKS a new sibling branch from its parent instead of overwriting. `editMessage(id,text)`
>     records the target (`pendingEditRef`, API only); on send `dispatch` sets `pendingForkParentRef`
>     to the edited turn's parent and sends the path UP TO that parent + the edit; `UserBubble` shows a
>     ‹N/M› switcher when a user turn has tree-siblings (the original vs edited prompts), each its own
>     branch. So you can branch by rewording, not just regenerating.
>
>   **Proper branching is COMPLETE** (regenerate-fork + edit-fork + swap + independent continuation +
>   active-path send, API-tier).
>   - **Branch-aware persistence + model-restore SHIPPED 2026-06-24 (tsc 0 / 215 tests / cargo ✓ /
>     build ✓):** reopening a branched chat used to (1) revert to a CLI model (the header showed
>     "Sonnet 4.6" — API models aren't in `CHAT_MODELS`, so the restore fell through) and (2) replay
>     flat (the linear log can't hold the tree). Fixes: **(A)** `resolveChatModel(modelId, engine)`
>     (chat.ts) resolves BOTH the CLI catalog AND the API providers; used in the model-init +
>     `resumeSession`, so a resumed API chat keeps its model. **(B)** a tree SIDECAR — `tree.json` per
>     session (`save_chat_tree`/`load_chat_tree` in chat_history.rs; `chatTreePersist.ts`
>     serialize/deserialize +3 tests) saved debounced on every settled API turn, and loaded FIRST on
>     reopen (else linear replay). So a chat branched after this build reopens with its exact tree
>     (active branch + switchers). NOTE: chats branched BEFORE this build have no sidecar → still
>     linear on reopen (but now on the right model).
>   - **Sticky API default SHIPPED 2026-06-24:** picking an API model now persists (`chatProvider` =
>     the bare provider id; the CLI helpers — engineForProvider/baseModelId — fall back to claude
>     gracefully, and the model-init restores it via `resolveChatModel`), so a new chat boots on the
>     last-picked API model. defaultAi (the "send to AI" route) is left untouched (CLI-only).
>   - **Retry-with-model picker fixed 2026-06-24:** the per-bubble menu was clipped by the scrolling
>     transcript ("can't see the models") AND listed only CLI models. Now PORTALED to body at fixed
>     coords (opens up/down by available space) + lists the combined CLI+API models (`retryMenuModels`).
>   - Remaining: Phase 4 free-fallback + Phase 5 polish (first-run wizard, ollama endpoint setting).
> Plus: branch-aware persistence/resume (the durable log is linear today → resume of a branched chat
> replays linearly); sticky API-model default across restarts; Phase 4 free-fallback + Phase 5 polish.

## Why
The chat pane is hardwired to spawn the local `claude` CLI and speak claude's `stream-json`
protocol end-to-end (`src-tauri/src/chat.rs`). A stranger with no claude sub clicks chat →
`failed to spawn claude` (chat.rs:247). This is the **#1 OSS-launch blocker** AND the proven
launch wedge — opencode hit 160k stars on exactly "not coupled to any provider." Goal: anyone,
any model, works; power users keep the full agentic loop.

## Target architecture (3 tiers)
```
tier 1 — local AGENTIC CLI (full power: tool-use, approvals, resume, effort)
   provider = which binary:  claude | codex | gemini-cli | opencode
   each is a real coding agent → keep the whole loop. devs pick their CLI.
tier 2 — BYO-key native API (works for everyone, no CLI installed)
   openai | openrouter | ollama (local) — paste key / endpoint.
   plain chat-completion + a tool-runner so it's still agentic where the model supports tools.
tier 3 — free fallback model (badged "you're on free models — connect your account")
   so download→first-click does SOMETHING instead of erroring.
```

## What's claude-specific (must abstract or degrade per provider)
- binary name + `stream-json` in/out protocol (chat.rs:205-211)
- tool-use approval control protocol `can_use_tool` / `control_response` (chat.rs:487+, chat.ts:291)
- `--permission-mode`, `--effort`, `--resume` flags (claude-only)
- transcript path `~/.claude/projects/<id>.jsonl`
Reusable as-is: turn model, token streaming to UI, tool cards, per-session buffer, transcript replay.

## Deps — already present (no new Cargo deps)
`reqwest = { "0.12", features=["json","stream"] }` + `tokio = { "1", features=["full"] }`.
So tier-2 async HTTP/SSE is buildable today.

## Existing seams to reuse
- settings: `src/lib/settings.ts` — plain localStorage `AppSettings`, `loadSettings/saveSettings/subscribe`. Extend it.
- model picker: `CHAT_MODELS` in `src/lib/chat.ts:183` + the model pill in ChatPane. Make provider-aware.
- bin resolver: `claude_bin()` chat.rs:95-124 (env `AIOS_CLAUDE_BIN` → fallbacks). Generalize to `agent_bin(provider)`.

---

## PHASES (ship incrementally — each is independently valuable)

### Phase 0 — onboarding/unblock (smallest, ships the "not embarrassing" win first)
- rust: a `detect_providers()` command — which agent CLIs exist on PATH (claude/codex/gemini/opencode) + which API keys are set in env.
- ts: if no provider available, ChatPane shows a clean "connect your AI" panel (not the raw spawn error).
- DOES collide with ChatPane → wait for doc-links agent to land first.

### Phase 1 — the seam + settings + provider registry (foundation)
- `src/lib/providers.ts` (NEW) — `Provider` type, registry: id, kind ('cli'|'api'), label, models, capabilities {toolUse, effort, resume}, bin/endpoint. NO collision.
- `src/lib/settings.ts` — extend `AppSettings`: `chatProvider`, `apiKeys: Record<provider,string>`, `apiEndpoints`, `defaultModel`. Default = claude-cli (back-comat). NO collision.
- `src-tauri/src/chat.rs` — add `ChatProvider` enum + thread it through `chat_start`; CLI path = today's code refactored under `match`. NO collision (rust).
- keep `chat_start` Tauri signature back-compat (provider defaults to claude).

### Phase 2 — agentic CLI swap (tier 1)
- generalize `claude_bin()` → `agent_bin(provider)` + per-CLI arg builders (codex/gemini/opencode have their own flags + event shapes).
- normalizer layer in rust: map each CLI's stream → the generic `ChatEvent` the frontend already parses.
- ChatPane: provider picker (binary) + model list per provider. Capabilities gate which pills show (hide effort/approval where unsupported).
- Settings.tsx: chat section — provider picker + detected-CLI status.

### Phase 3 — BYO-key native API (tier 2)
- rust `chat_providers/` submodule: openai (HTTP+SSE), openrouter (same shape), ollama (local stream). reqwest streaming → normalize SSE deltas → `ChatEvent`.
- a tool-runner so API providers that support function-calling stay agentic (collect tool_calls → run via existing tool infra → feed results back). Where unsupported → plain chat, degrade gracefully.
- Settings: masked API-key inputs + endpoint override (ollama url). Store in settings (plaintext now; keychain = Phase 5).
- session resume fallback: API has no `--resume` → replay transcript from our own store.

### Phase 4 — free fallback (tier 3)
- a free model (openrouter free tier or bundled) behind a badge so first-click works with zero setup. cap it.

### Phase 5 — polish
- keychain/secure storage for API keys (currently localStorage plaintext).
- per-model capability matrix + graceful pill hiding everywhere.
- first-run wizard.

---

## Collision note (today)
A background agent is editing ChatPane.tsx / App.tsx / MemoryPane / FileViewerPane (doc-links→browser-pane feature). Do NOT touch those until it commits. Start with rust (chat.rs) + new lib/providers.ts + settings.ts — all collision-free. Wire ChatPane/Settings UI after.

## First slice to build tonight (collision-free)
1. `src/lib/providers.ts` — registry + types.
2. `src/lib/settings.ts` — provider fields.
3. `src-tauri/src/chat.rs` — `ChatProvider` enum + `match`-dispatch seam, CLI path = refactor of current code, claude default.
Then (after doc agent lands): Phase 0 onboarding + Phase 2 picker.
